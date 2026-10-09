import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { db, tx, initDB } from './db';
import { randomUUID, randomInt } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { sendPushInBackground, sendPush, PushMessage } from './push';

if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined in environment variables.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_SALT_ROUNDS = 12;

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const app = express();
app.set('trust proxy', 1); // Render proxy IP pass-through for rate-limiter

// Secure CORS: restrict origins in production
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://sportarea.onrender.com'] // add your frontend domain here
  : '*'; // allow all in dev

app.use(cors({ origin: allowedOrigins }));
// Profil fotoğrafı küçültülmüş base64 olarak geliyor (birkaç on KB); 1 MB fazlasıyla yeter.
app.use(express.json({ limit: '1mb' }));

// Rate limiters for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.AUTH_RATE_LIMIT) || 10, // IP başına 15 dakikada 10 deneme (testlerde artırılabilir)
  message: { error: 'Çok fazla deneme yaptınız, lütfen 15 dakika sonra tekrar deneyin.' }
});

// Görünen ad: lakap varsa lakap, yoksa "Ahmet Y." (ad + soyadın baş harfi). Misafir adı yazıldığı gibi.
// Uygulamadaki displayName (mobile/src/utils/format.ts) ile aynı kural.
const shortName = (name: string) => {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const last = parts.pop() as string;
  return `${parts.join(' ')} ${last.charAt(0).toLocaleUpperCase('tr-TR')}.`;
};
const displayName = (u: any) => {
  if (!u) return '';
  if (u.role === 'GUEST') return String(u.name ?? '');
  const nick = String(u.nickname ?? '').trim();
  return nick || shortName(u.name);
};

const toSafeUser = (user: any) => {
  if (!user) return user;
  const { password, ...safeUser } = user;
  return safeUser;
};

const isLockedOut = (match: any) => {
  if (!(Number(match.matchTimestamp) > 0) || match.lockoutHours === null) return false;
  const lockoutMs = match.lockoutHours * 60 * 60 * 1000;
  return Date.now() > Number(match.matchTimestamp) - lockoutMs;
};

// Maçı yönetme yetkisi (takım kurma, bitirme, iptal): maçı kuran kişi, grubun kurucusu ya da grup yöneticileri.
// Haftalık otomatik maçlarda maçı "kuran" grup kurucusudur.
const canManageMatch = async (matchId: string, userId: string) => {
  const row = await db.get(
    `SELECT m."creatorId", g."creatorId" AS "groupCreatorId",
       EXISTS (SELECT 1 FROM "GroupMembers" gm WHERE gm."groupId" = m."groupId" AND gm."userId" = ? AND gm."isAdmin") AS "isAdmin"
     FROM "Matches" m LEFT JOIN "Groups" g ON g.id = m."groupId"
     WHERE m.id = ?`,
    [userId, matchId]
  );
  if (!row) return { exists: false, allowed: false };
  return { exists: true, allowed: row.creatorId === userId || row.groupCreatorId === userId || Boolean(row.isAdmin) };
};

// ---- Haftalık maç zamanlaması ----
// Türkiye yıl boyu UTC+3; sunucu (Render) UTC çalıştığı için hesaplar sabit +3 ile yapılır.
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const DAY_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

// Bildirim metinleri için maç zamanı: "Cumartesi 21:00", gece maçında "Çarşamba gecesi 00:30".
// Uygulamadaki gösterimle aynı kural: 06:00 öncesi bir önceki günün gecesidir.
function friendlyMatchTime(ts: number) {
  if (!ts) return '';
  const d = new Date(ts + TR_OFFSET_MS);
  const h = d.getUTCHours();
  const hhmm = `${String(h).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const day = new Date(d.getTime() - (h < 6 ? 86400000 : 0)).getUTCDay();
  return `${DAY_LONG[day]}${h < 6 ? ' gecesi' : ''} ${hhmm}`;
}

const parseHHMM = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
};

// Haftanın günü (0=Pazar) ve saat verildiğinde, şu andan sonraki ilk maç zamanı.
// 06:00'dan önceki saatler o günün gecesi sayılır: "Çarşamba 00:00" = Çarşamba'yı Perşembe'ye bağlayan gece.
function nextWeeklyOccurrence(dayOfWeek: number, time: string, nowMs = Date.now()) {
  const t = parseHHMM(time);
  if (!t) return null;
  const nightShift = t.h < 6 ? 1 : 0;
  const nowTr = new Date(nowMs + TR_OFFSET_MS);
  for (let k = 0; k <= 14; k++) {
    const day = new Date(Date.UTC(nowTr.getUTCFullYear(), nowTr.getUTCMonth(), nowTr.getUTCDate() + k));
    if (day.getUTCDay() !== dayOfWeek) continue;
    const ts = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + nightShift, t.h, t.min) - TR_OFFSET_MS;
    if (ts > nowMs) {
      return {
        ts,
        // Eski uygulama sürümleri maç kartında bu metni gösteriyor.
        label: `${day.getUTCDate()}/${day.getUTCMonth() + 1} ${DAY_SHORT[dayOfWeek]}, ${time}`,
      };
    }
  }
  return null;
}

// Grubun haftalık maç ayarı varsa ve ileri tarihli bir maçı yoksa, sıradakini açar.
// "Her hafta varım" diyen üyeler kadroya otomatik eklenir, diğerlerine davet gider.
// Zamanlayıcı yerine uygulama açıldıkça çağrılır: Render'ın ücretsiz sunucusu uykudayken iş kaçmaz.
async function ensureUpcomingMatch(groupId: string): Promise<string | null> {
  const pushes: PushMessage[] = [];
  const matchId = await tx(async (t) => {
    // Aynı anda iki istek gelirse aynı maç iki kez açılmasın.
    await t.run('SELECT pg_advisory_xact_lock(hashtext(?))', [groupId]);

    const g = await t.get(
      `SELECT id, name, "creatorId", "weeklyDay", "weeklyTime", "weeklyLocation", "weeklyMaxPlayers", "weeklyLockoutHours", "weeklyFee"
       FROM "Groups" WHERE id = ?`,
      [groupId]
    );
    if (!g || g.weeklyDay === null || !g.weeklyTime || !g.weeklyLocation) return null;

    const upcoming = await t.get(
      'SELECT id FROM "Matches" WHERE "groupId" = ? AND "matchTimestamp" > ? LIMIT 1',
      [groupId, Date.now()]
    );
    if (upcoming) return null;

    const next = nextWeeklyOccurrence(g.weeklyDay, g.weeklyTime);
    if (!next) return null;

    const matchId = randomUUID();
    const maxPlayers = g.weeklyMaxPlayers || 14;
    await t.run(
      `INSERT INTO "Matches" (id, "groupId", "creatorId", date, time, location, "maxPlayers", "matchTimestamp", "lockoutHours", "pitchFee")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [matchId, groupId, g.creatorId, next.label, g.weeklyTime, g.weeklyLocation, maxPlayers, next.ts, g.weeklyLockoutHours ?? 3, g.weeklyFee ?? null]
    );

    const members = await t.all(
      `SELECT "userId", "alwaysIn" FROM "GroupMembers" WHERE "groupId" = ? ORDER BY "joinedAt" ASC`,
      [groupId]
    );
    let filled = 0;
    for (const m of members) {
      if (m.alwaysIn) {
        const status = filled < maxPlayers ? 'ACTIVE' : 'RESERVE';
        filled++;
        await t.run('INSERT INTO "MatchPlayers" ("matchId", "userId", status) VALUES (?, ?, ?)', [matchId, m.userId, status]);
        await t.run('INSERT INTO "Notifications" (id, "userId", message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
          randomUUID(), m.userId,
          `${g.name}: haftalık maç açıldı (${next.label}). "Her hafta varım" dediğin için ${status === 'ACTIVE' ? 'kadroya' : 'yedek listesine'} eklendin. Gelemeyeceksen maç sayfasından "Yokum" de.`,
          'INFO', JSON.stringify({ matchId })
        ]);
        pushes.push({
          userId: m.userId,
          title: `${g.name} · ${friendlyMatchTime(next.ts)}`,
          body: status === 'ACTIVE'
            ? 'Haftalık maç açıldı, kadrodasın. Gelemeyeceksen "Yokum" demeyi unutma.'
            : 'Haftalık maç açıldı. Kadro dolu olduğu için yedek listesindesin.',
          data: { matchId },
        });
      } else {
        await t.run('INSERT INTO "Notifications" (id, "userId", message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
          randomUUID(), m.userId,
          `${g.name}: haftalık maç açıldı (${next.label}, ${g.weeklyLocation}). Geliyor musun?`,
          'MATCH_INVITE', JSON.stringify({ matchId })
        ]);
        pushes.push({
          userId: m.userId,
          title: `${g.name} · ${friendlyMatchTime(next.ts)}`,
          body: `Haftalık maç açıldı (${g.weeklyLocation}). Geliyor musun?`,
          data: { matchId },
        });
      }
    }
    return matchId;
  });
  sendPushInBackground(pushes);
  return matchId;
}

// Kullanıcının tüm gruplarında sıradaki haftalık maçın açık olduğundan emin olur.
async function ensureUpcomingMatchesForUser(userId: string) {
  const groups = await db.all(
    `SELECT g.id FROM "Groups" g JOIN "GroupMembers" gm ON gm."groupId" = g.id
     WHERE gm."userId" = ? AND g."weeklyDay" IS NOT NULL`,
    [userId]
  );
  for (const g of groups) {
    try { await ensureUpcomingMatch(g.id); } catch (err) { console.error('Weekly match error:', err); }
  }
}

const isUniqueViolation = (err: any) => err && err.code === '23505';

// Saha ücreti (₺, tam sayı). Boş / 0 = ücret yok (null). Geçersizse undefined.
const parseFee = (v: any): number | null | undefined => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) return undefined;
  return n === 0 ? null : n;
};

// Kişi başı pay: ücret / sahada oynayan (ACTIVE) kişi sayısı, yukarı yuvarlanır.
const sharePerPerson = (fee: number | null, players: number) =>
  fee && players > 0 ? Math.ceil(fee / players) : null;

// Yasal sayfalar (Google Play için): gizlilik politikası ve hesap silme. server/pages altında.
const PAGES_DIR = path.join(__dirname, 'pages');
const sendPage = (file: string) => async (req: any, res: any) => {
  try {
    let html = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
    // İletişim e-postası veritabanından (AppConfig.contact_email); yoksa ilgili satır gizlenir.
    const cfg = await db.get(`SELECT value FROM "AppConfig" WHERE key = 'contact_email'`).catch(() => null);
    const email = cfg?.value ? String(cfg.value).replace(/[<>"&]/g, '') : '';
    html = html
      .replace(/{{CONTACT_EMAIL}}/g, email)
      .replace(/<!--IF_CONTACT-->([\s\S]*?)<!--END_IF_CONTACT-->/g, email ? '$1' : '');
    res.type('html').send(html);
  } catch (e) {
    res.status(500).send('Sayfa yüklenemedi.');
  }
};
app.get(['/gizlilik', '/privacy'], sendPage('gizlilik.html'));
app.get(['/hesap-sil', '/delete-account'], sendPage('hesap-sil.html'));

// Uygulamanın web sürümü (iPhone'u olanlar ve uygulamayı indirmek istemeyenler için).
// mobile klasöründen `npm run build:web` ile server/public içine üretilir.
const WEB_DIR = path.join(__dirname, 'public');
const hasWeb = fs.existsSync(path.join(WEB_DIR, 'index.html'));
if (hasWeb) {
  app.use(express.static(WEB_DIR, { index: 'index.html', maxAge: '1h' }));
} else {
  app.get('/', (req, res) => {
    res.send('SporArea API Çalışıyor!');
  });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Authentication Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  // /cron/tick kendi gizli anahtarıyla korunuyor (aşağıda).
  if (req.path === '/login' || req.path === '/register' || (req.path === '/me' && req.method === 'GET') || req.path === '/cron/tick' || req.path === '/health' || req.path.startsWith('/invite/') || req.path === '/account/delete') {
    return next();
  }
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Yetkisiz erişim.' });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // expects { id: string }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Geçersiz token.' });
  }
};
app.use('/api', authenticateToken);

app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { name, password } = req.body;
    const email = String(req.body.email ?? '').trim();
    if (!String(name ?? '').trim() || !email || !password) {
      return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });
    }

    const existing = await db.get('SELECT id FROM "User" WHERE lower(email) = lower(?)', [email]);
    if (existing) {
      return res.status(400).json({ error: 'Bu e-posta zaten kullanımda.' });
    }

    const id = randomUUID();
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const cleanName = String(name).trim().slice(0, 40);
    await db.run('INSERT INTO "User" (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)', [id, cleanName, email, hashedPassword, 'PLAYER']);

    const user = { id, name: cleanName, email, role: 'PLAYER' };
    const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ message: 'Kayıt başarılı!', user, token });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ error: 'Bu e-posta zaten kullanımda.' });
    }
    console.error("Register Error:", error);
    res.status(500).json({ error: 'Kayıt olurken bir hata oluştu.' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const email = String(req.body.email ?? '').trim();
    if (!email || !password) {
      return res.status(400).json({ error: 'Lütfen E-posta ve şifrenizi girin.' });
    }

    const user = await db.get('SELECT * FROM "User" WHERE lower(email) = lower(?)', [email]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ message: 'Giriş başarılı!', user: toSafeUser(user), token });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ error: 'Giriş yaparken bir hata oluştu.' });
  }
});

// Şifre değiştir. Geçici şifreyle girenden mevcut şifre istenmez.
app.post('/api/me/password', async (req, res) => {
  try {
    const user = await db.get('SELECT id, password, "mustChangePassword" FROM "User" WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    const newPassword = String(req.body.newPassword ?? '');
    if (newPassword.length < 6) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı.' });
    if (!user.mustChangePassword) {
      const ok = await bcrypt.compare(String(req.body.currentPassword ?? ''), user.password);
      if (!ok) return res.status(400).json({ error: 'Mevcut şifre hatalı.' });
    }
    const hash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await db.run('UPDATE "User" SET password = ?, "mustChangePassword" = false WHERE id = ?', [hash, user.id]);
    res.json({ message: 'Şifren güncellendi.' });
  } catch (e) {
    res.status(500).json({ error: 'Şifre güncellenemedi.' });
  }
});

app.get('/api/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Yetkisiz erişim.' });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const user = await db.get('SELECT * FROM "User" WHERE id = ?', [decoded.id]);

    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

    res.json({ user: toSafeUser(user) });
  } catch (err) {
    res.status(401).json({ error: 'Geçersiz token.' });
  }
});

// GROUPS API
// Her zaman giriş yapan kullanıcının grupları döner (davet kodları başkasına sızmaz).
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await db.all(`
      SELECT g.*, gm."isAdmin" AS "myIsAdmin",
        (SELECT COUNT(*) FROM "GroupMembers" x WHERE x."groupId" = g.id) AS "memberCount"
      FROM "Groups" g
      JOIN "GroupMembers" gm ON g.id = gm."groupId"
      WHERE gm."userId" = ?
      ORDER BY g."createdAt" DESC
    `, [req.user.id]);
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: 'Gruplar getirilirken hata oluştu.' });
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const name = String(req.body.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Grup adı gerekli.' });
    const creatorId = req.user.id;
    const groupId = randomUUID();

    // Davet kodu çakışırsa birkaç kez yeniden dene.
    for (let attempt = 0; attempt < 5; attempt++) {
      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase().padEnd(6, 'X');
      try {
        await tx(async (t) => {
          await t.run('INSERT INTO "Groups" (id, name, "inviteCode", "creatorId") VALUES (?, ?, ?, ?)', [groupId, name, inviteCode, creatorId]);
          await t.run('INSERT INTO "GroupMembers" ("groupId", "userId") VALUES (?, ?)', [groupId, creatorId]);
        });
        // Mobil uygulama davet kodunu data.group.inviteCode'dan okuyor.
        return res.status(201).json({ message: 'Grup oluşturuldu', inviteCode, group: { id: groupId, name, inviteCode } });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    res.status(500).json({ error: 'Grup oluşturulamadı.' });
  } catch (error) {
    res.status(500).json({ error: 'Grup oluşturulamadı.' });
  }
});

app.post('/api/groups/join', async (req, res) => {
  try {
    const inviteCode = String(req.body.inviteCode ?? '').trim().toUpperCase();
    const userId = req.user.id;
    const group = await db.get('SELECT id FROM "Groups" WHERE "inviteCode" = ?', [inviteCode]);

    if (!group) return res.status(404).json({ error: 'Geçersiz davet kodu' });

    const r = await db.run('INSERT INTO "GroupMembers" ("groupId", "userId") VALUES (?, ?) ON CONFLICT DO NOTHING', [group.id, userId]);
    const full = await db.get('SELECT id, name, "inviteCode", "creatorId" FROM "Groups" WHERE id = ?', [group.id]);
    res.json({
      message: r.changes ? 'Gruba katılım başarılı!' : 'Zaten bu grubun üyesisin.',
      alreadyMember: r.changes === 0,
      group: full,
    });
  } catch (error) {
    res.status(500).json({ error: 'Gruba katılırken hata oluştu.' });
  }
});

// Davet linki önizlemesi (giriş yapmadan): "X grubuna davet edildin". Sadece ad ve üye sayısı döner.
const inviteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Çok fazla deneme.' } });
app.get('/api/invite/:code', inviteLimiter, async (req, res) => {
  try {
    const code = String(req.params.code ?? '').trim().toUpperCase();
    const g = await db.get(
      `SELECT g.name, (SELECT COUNT(*) FROM "GroupMembers" WHERE "groupId" = g.id) AS "memberCount"
       FROM "Groups" g WHERE g."inviteCode" = ?`,
      [code]
    );
    if (!g) return res.status(404).json({ error: 'Davet kodu bulunamadı.' });
    res.json(g);
  } catch (e) {
    res.status(500).json({ error: 'Davet okunamadı.' });
  }
});

const isGroupMember = async (groupId: string, userId: string) =>
  Boolean(await db.get('SELECT 1 FROM "GroupMembers" WHERE "groupId" = ? AND "userId" = ?', [groupId, userId]));

// Gruptaki rol: kurucu (tek kişi, grubu silebilir, yönetici atar), yönetici (maçları ve haftalık ayarı yönetir), üye.
type GroupRole = 'founder' | 'admin' | 'member' | null;
async function groupRole(groupId: string, userId: string): Promise<GroupRole> {
  const r = await db.get(
    `SELECT g."creatorId", gm."isAdmin" FROM "Groups" g
     LEFT JOIN "GroupMembers" gm ON gm."groupId" = g.id AND gm."userId" = ?
     WHERE g.id = ?`,
    [userId, groupId]
  );
  if (!r) return null;
  if (r.creatorId === userId) return 'founder';
  if (r.isAdmin === null || r.isAdmin === undefined) return null; // üye değil
  return r.isAdmin ? 'admin' : 'member';
}

// Grup sayfası: grup bilgisi, haftalık maç ayarı, benim "her hafta varım" durumum ve sayılar.
app.get('/api/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await isGroupMember(id, req.user.id))) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz.' });
    await ensureUpcomingMatch(id).catch((err) => console.error('Weekly match error:', err));

    const group = await db.get(`
      SELECT g.*,
        (SELECT COUNT(*) FROM "GroupMembers" WHERE "groupId" = g.id) AS "memberCount",
        (SELECT COUNT(*) FROM "Matches" WHERE "groupId" = g.id AND status = 'COMPLETED') AS "matchCount",
        (SELECT "alwaysIn" FROM "GroupMembers" WHERE "groupId" = g.id AND "userId" = ?) AS "myAlwaysIn"
      FROM "Groups" g WHERE g.id = ?
    `, [req.user.id, id]);
    res.json({ ...group, myRole: await groupRole(id, req.user.id) });
  } catch (e) {
    res.status(500).json({ error: 'Grup bilgisi alınamadı.' });
  }
});

app.get('/api/groups/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await isGroupMember(id, req.user.id))) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz.' });
    const members = await db.all(`
      SELECT u.id, u.name, u.nickname, u.avatar, u.position, gm."alwaysIn", gm."isAdmin",
        (SELECT COUNT(*) FROM "MatchPlayers" mp JOIN "Matches" m ON m.id = mp."matchId"
          WHERE mp."userId" = u.id AND m."groupId" = gm."groupId" AND m.status = 'COMPLETED') AS matches
      FROM "User" u
      JOIN "GroupMembers" gm ON u.id = gm."userId"
      WHERE gm."groupId" = ?
      ORDER BY u.name
    `, [id]);
    res.json(members);
  } catch (e) {
    res.status(500).json({ error: 'Üyeler alınamadı' });
  }
});

// Haftalık maç ayarı (sadece grup kurucusu). { enabled: false } ile kapatılır.
app.put('/api/groups/:id/schedule', async (req, res) => {
  try {
    const { id } = req.params;
    const group = await db.get('SELECT "creatorId" FROM "Groups" WHERE id = ?', [id]);
    if (!group) return res.status(404).json({ error: 'Grup bulunamadı.' });
    const role = await groupRole(id, req.user.id);
    if (role !== 'founder' && role !== 'admin') return res.status(403).json({ error: 'Haftalık maçı sadece grup kurucusu ya da yöneticiler ayarlayabilir.' });

    if (req.body.enabled === false) {
      await db.run(
        `UPDATE "Groups" SET "weeklyDay" = NULL, "weeklyTime" = NULL, "weeklyLocation" = NULL, "weeklyMaxPlayers" = NULL, "weeklyLockoutHours" = NULL, "weeklyFee" = NULL WHERE id = ?`,
        [id]
      );
      return res.json({ message: 'Haftalık maç kapatıldı. Açık olan maç yerinde kalır.' });
    }

    const day = Number(req.body.day);
    const time = String(req.body.time ?? '').trim();
    const location = String(req.body.location ?? '').trim();
    const maxPlayers = Number(req.body.maxPlayers);
    const lockoutHours = req.body.lockoutHours === undefined ? 3 : Number(req.body.lockoutHours);
    if (!Number.isInteger(day) || day < 0 || day > 6) return res.status(400).json({ error: 'Gün seçin.' });
    if (!parseHHMM(time)) return res.status(400).json({ error: 'Saat SS:DD biçiminde olmalı.' });
    if (!location) return res.status(400).json({ error: 'Saha adı gerekli.' });
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 40) return res.status(400).json({ error: 'Kontenjan 2 ile 40 arasında olmalı.' });
    if (!Number.isInteger(lockoutHours) || lockoutHours < 0 || lockoutHours > 48) return res.status(400).json({ error: 'Kilit süresi 0 ile 48 saat arasında olmalı.' });
    const fee = parseFee(req.body.fee);
    if (fee === undefined) return res.status(400).json({ error: 'Saha ücreti 0 ile 100.000 ₺ arasında bir tam sayı olmalı.' });

    await db.run(
      `UPDATE "Groups" SET "weeklyDay" = ?, "weeklyTime" = ?, "weeklyLocation" = ?, "weeklyMaxPlayers" = ?, "weeklyLockoutHours" = ?, "weeklyFee" = ? WHERE id = ?`,
      [day, time, location, maxPlayers, lockoutHours, fee, id]
    );
    const created = await ensureUpcomingMatch(id);
    res.json({
      message: created
        ? 'Haftalık maç ayarlandı ve sıradaki maç açıldı.'
        : 'Haftalık maç ayarlandı. Şu an açık bir maç olduğu için yeni ayar bir sonraki maçtan itibaren geçerli.',
      createdMatchId: created
    });
  } catch (e) {
    console.error('Schedule error:', e);
    res.status(500).json({ error: 'Haftalık maç ayarlanamadı.' });
  }
});

// "Her hafta varım": açılan her haftalık maçta otomatik kadroya girer.
// Açıldığında, henüz cevap vermediği yaklaşan grup maçına da hemen Varım olarak eklenir.
app.post('/api/groups/:id/always-in', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const alwaysIn = Boolean(req.body.alwaysIn);
    const r = await db.run('UPDATE "GroupMembers" SET "alwaysIn" = ? WHERE "groupId" = ? AND "userId" = ?', [alwaysIn, id, userId]);
    if (r.changes === 0) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz.' });

    let joinedMatch: string | null = null;
    if (alwaysIn) {
      const open = await db.all(
        `SELECT m.id FROM "Matches" m
         WHERE m."groupId" = ? AND m.status = 'OPEN' AND m."matchTimestamp" > ?
           AND NOT EXISTS (SELECT 1 FROM "MatchPlayers" mp WHERE mp."matchId" = m.id AND mp."userId" = ?)
           AND NOT EXISTS (SELECT 1 FROM "MatchResponses" r WHERE r."matchId" = m.id AND r."userId" = ?)
         ORDER BY m."matchTimestamp" ASC`,
        [id, Date.now(), userId, userId]
      );
      for (const m of open) {
        const result = await respondToMatch(m.id, userId, 'YES');
        if (result.status === 200 && !joinedMatch) joinedMatch = m.id;
      }
    }
    res.json({
      message: alwaysIn
        ? 'Artık her haftalık maçta otomatik kadrodasın. Gelemeyeceğin hafta "Yokum" demen yeterli.'
        : 'Otomatik katılım kapatıldı.',
      alwaysIn,
      joinedMatch
    });
  } catch (e) {
    console.error('Always-in error:', e);
    res.status(500).json({ error: 'Ayar kaydedilemedi.' });
  }
});

// Bir üyeyi gruptan çıkarır: yaklaşan maçlarda kadrodaysa yerini boşaltır (ilk yedek kadroya geçer),
// cevaplarını ve bekleyen davetlerini temizler. Kilit süresi dolmuş maçlarda kadroda kalır.
async function removeFromGroup(groupId: string, userId: string) {
  const upcoming = await db.all(
    `SELECT m.id FROM "Matches" m
     JOIN "MatchPlayers" mp ON mp."matchId" = m.id AND mp."userId" = ?
     WHERE m."groupId" = ? AND m.status = 'OPEN' AND m."matchTimestamp" > ?`,
    [userId, groupId, Date.now()]
  );
  for (const m of upcoming) {
    await respondToMatch(m.id, userId, 'NO').catch(() => null);
  }
  await db.run(
    `DELETE FROM "MatchResponses" WHERE "userId" = ? AND "matchId" IN (SELECT id FROM "Matches" WHERE "groupId" = ?)`,
    [userId, groupId]
  );
  await db.run(
    `DELETE FROM "Notifications" WHERE "userId" = ? AND type = 'MATCH_INVITE'
       AND metadata::jsonb ->> 'matchId' IN (SELECT id FROM "Matches" WHERE "groupId" = ?)`,
    [userId, groupId]
  );
  await db.run('DELETE FROM "GroupMembers" WHERE "groupId" = ? AND "userId" = ?', [groupId, userId]);
}

// HESAP SİLME (Google Play şartı: uygulama içinden ve web sayfasından)
// Kurduğu gruplarda kuruculuk önce bir yöneticiye, yoksa en eski üyeye geçer; grupta başka kimse yoksa grup silinir.
// Yaklaşan maçlardaki yeri boşalır (ilk yedek kadroya geçer). Sonra tüm kişisel verisi silinir
// (oylar, puanlar, bildirimler, cihaz kayıtları veritabanı kuralıyla birlikte gider).
async function deleteAccount(userId: string) {
  const groups = await db.all(
    `SELECT g.id, g.name, g."creatorId" FROM "Groups" g JOIN "GroupMembers" gm ON gm."groupId" = g.id WHERE gm."userId" = ?`,
    [userId]
  );
  const pushes: PushMessage[] = [];
  for (const g of groups) {
    if (g.creatorId === userId) {
      const heir = await db.get(
        `SELECT "userId" FROM "GroupMembers" WHERE "groupId" = ? AND "userId" <> ? ORDER BY "isAdmin" DESC, "joinedAt" ASC LIMIT 1`,
        [g.id, userId]
      );
      if (!heir) {
        await db.run('DELETE FROM "Groups" WHERE id = ?', [g.id]);
        continue;
      }
      await db.run('UPDATE "Groups" SET "creatorId" = ? WHERE id = ?', [heir.userId, g.id]);
      await db.run('INSERT INTO "Notifications" (id, "userId", message, type) VALUES (?, ?, ?, ?)', [
        randomUUID(), heir.userId, `${g.name} grubunun kurucusu hesabını sildi; grubun yöneticisi artık sensin.`, 'INFO'
      ]);
      pushes.push({ userId: heir.userId, title: g.name, body: 'Grubun yöneticisi artık sensin.', data: {} });
    }
    await removeFromGroup(g.id, userId);
  }
  await db.run('DELETE FROM "User" WHERE id = ?', [userId]);
  sendPushInBackground(pushes);
}

// Uygulama içinden: şifreyle onaylanır.
app.delete('/api/me', async (req, res) => {
  try {
    const user = await db.get('SELECT id, password FROM "User" WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    if (!(await bcrypt.compare(String(req.body?.password ?? ''), user.password))) {
      return res.status(400).json({ error: 'Şifre hatalı.' });
    }
    await deleteAccount(user.id);
    res.json({ message: 'Hesabın ve tüm verilerin silindi.' });
  } catch (e) {
    console.error('Delete account error:', e);
    res.status(500).json({ error: 'Hesap silinemedi.' });
  }
});

// Web sayfasından (uygulama yüklü değilse): e-posta + şifre ile.
app.post('/api/account/delete', authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim();
    const user = await db.get('SELECT id, password FROM "User" WHERE lower(email) = lower(?)', [email]);
    if (!user || !(await bcrypt.compare(String(req.body?.password ?? ''), user.password))) {
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
    }
    await deleteAccount(user.id);
    res.json({ message: 'Hesabın ve tüm verilerin silindi.' });
  } catch (e) {
    console.error('Delete account (web) error:', e);
    res.status(500).json({ error: 'Hesap silinemedi.' });
  }
});

// Gruptan ayrıl (kurucu ayrılamaz; grubu silebilir).
app.post('/api/groups/:id/leave', async (req, res) => {
  try {
    const { id } = req.params;
    const group = await db.get('SELECT "creatorId" FROM "Groups" WHERE id = ?', [id]);
    if (!group) return res.status(404).json({ error: 'Grup bulunamadı.' });
    if (!(await isGroupMember(id, req.user.id))) return res.status(403).json({ error: 'Bu grubun üyesi değilsin.' });
    if (group.creatorId === req.user.id) {
      return res.status(400).json({ error: 'Grubu kuran kişi ayrılamaz. İstersen grubu silebilirsin.' });
    }
    await removeFromGroup(id, req.user.id);
    res.json({ message: 'Gruptan ayrıldın.' });
  } catch (e) {
    console.error('Leave group error:', e);
    res.status(500).json({ error: 'Gruptan ayrılırken hata oluştu.' });
  }
});

// Şifresini unutan üyeye kurucu geçici şifre verir. Üye bununla girince yeni şifre belirlemek zorunda.
const TEMP_WORDS = ['saha', 'gol', 'pas', 'kale', 'forvet', 'top', 'korner', 'penalti'];
app.post('/api/groups/:id/members/:userId/reset-password', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const group = await db.get('SELECT "creatorId" FROM "Groups" WHERE id = ?', [id]);
    if (!group) return res.status(404).json({ error: 'Grup bulunamadı.' });
    if (group.creatorId !== req.user.id) return res.status(403).json({ error: 'Geçici şifreyi sadece grubu kuran kişi verebilir.' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Kendi şifreni profil sayfasından değiştirebilirsin.' });
    if (!(await isGroupMember(id, userId))) return res.status(404).json({ error: 'Bu kişi grupta değil.' });

    const word = TEMP_WORDS[randomInt(TEMP_WORDS.length)];
    const tempPassword = `${word}-${String(randomInt(10000)).padStart(4, '0')}`;
    const hash = await bcrypt.hash(tempPassword, BCRYPT_SALT_ROUNDS);
    await db.run('UPDATE "User" SET password = ?, "mustChangePassword" = true WHERE id = ?', [hash, userId]);
    const u = await db.get('SELECT name, email FROM "User" WHERE id = ?', [userId]);
    res.json({ tempPassword, name: u?.name, email: u?.email });
  } catch (e) {
    console.error('Reset password error:', e);
    res.status(500).json({ error: 'Geçici şifre oluşturulamadı.' });
  }
});

// Kurucu bir üyeyi yönetici yapar ya da yöneticiliğini alır.
app.post('/api/groups/:id/members/:userId/admin', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const makeAdmin = Boolean(req.body?.isAdmin);
    if ((await groupRole(id, req.user.id)) !== 'founder') return res.status(403).json({ error: 'Yönetici atamayı sadece grubun kurucusu yapabilir.' });
    const target = await groupRole(id, userId);
    if (target === null) return res.status(404).json({ error: 'Bu kişi grupta değil.' });
    if (target === 'founder') return res.status(400).json({ error: 'Kurucu zaten tüm yetkilere sahip.' });
    await db.run('UPDATE "GroupMembers" SET "isAdmin" = ? WHERE "groupId" = ? AND "userId" = ?', [makeAdmin, id, userId]);
    if (makeAdmin !== (target === 'admin')) {
      const g = await db.get('SELECT name FROM "Groups" WHERE id = ?', [id]);
      const text = makeAdmin
        ? `${g?.name}: artık grubun yöneticisisin. Maçları düzenleyebilir, iptal edebilir, takımları bölüp skoru girebilirsin.`
        : `${g?.name}: yöneticilik yetkin kaldırıldı.`;
      await db.run('INSERT INTO "Notifications" (id, "userId", message, type) VALUES (?, ?, ?, ?)', [randomUUID(), userId, text, 'INFO']);
      if (makeAdmin) sendPushInBackground([{ userId, title: g?.name || 'SporArea', body: 'Artık grubun yöneticisisin 🛡️', data: {} }]);
    }
    res.json({ message: makeAdmin ? 'Yönetici yapıldı.' : 'Yöneticilik kaldırıldı.', isAdmin: makeAdmin });
  } catch (e) {
    console.error('Set admin error:', e);
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

// Kurucu, kuruculuğu başka bir üyeye devreder; kendisi yönetici olarak kalır.
app.post('/api/groups/:id/transfer', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = String(req.body?.userId ?? '');
    if ((await groupRole(id, req.user.id)) !== 'founder') return res.status(403).json({ error: 'Kuruculuğu sadece kurucu devredebilir.' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Zaten kurucu sensin.' });
    if ((await groupRole(id, userId)) === null) return res.status(404).json({ error: 'Bu kişi grupta değil.' });
    await tx(async (t) => {
      await t.run('UPDATE "Groups" SET "creatorId" = ? WHERE id = ?', [userId, id]);
      await t.run('UPDATE "GroupMembers" SET "isAdmin" = false WHERE "groupId" = ? AND "userId" = ?', [id, userId]);
      await t.run('UPDATE "GroupMembers" SET "isAdmin" = true WHERE "groupId" = ? AND "userId" = ?', [id, req.user.id]);
      const g = await t.get('SELECT name FROM "Groups" WHERE id = ?', [id]);
      await t.run('INSERT INTO "Notifications" (id, "userId", message, type) VALUES (?, ?, ?, ?)', [
        randomUUID(), userId, `${g?.name}: grubun kurucusu artık sensin. Yönetici atayabilir, grubu yönetebilirsin.`, 'INFO',
      ]);
    });
    sendPushInBackground([{ userId, title: 'Grubun kurucusu artık sensin 👑', body: 'Grup yönetimi sana devredildi.', data: {} }]);
    res.json({ message: 'Kuruculuk devredildi. Sen yönetici olarak devam ediyorsun.' });
  } catch (e) {
    console.error('Transfer error:', e);
    res.status(500).json({ error: 'Devredilemedi.' });
  }
});

// Kurucu ya da yönetici bir üyeyi gruptan çıkarır.
app.delete('/api/groups/:id/members/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const myRole = await groupRole(id, req.user.id);
    if (myRole === null) return res.status(404).json({ error: 'Grup bulunamadı.' });
    if (myRole !== 'founder' && myRole !== 'admin') return res.status(403).json({ error: 'Üyeleri sadece grubun kurucusu ya da yöneticiler çıkarabilir.' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Kendini çıkaramazsın.' });
    const targetRole = await groupRole(id, userId);
    if (targetRole === null) return res.status(404).json({ error: 'Bu kişi grupta değil.' });
    if (myRole === 'admin' && targetRole !== 'member') return res.status(403).json({ error: 'Yöneticiler kurucuyu ya da başka bir yöneticiyi çıkaramaz.' });
    await removeFromGroup(id, userId);
    res.json({ message: 'Üye gruptan çıkarıldı.' });
  } catch (e) {
    console.error('Remove member error:', e);
    res.status(500).json({ error: 'Üye çıkarılamadı.' });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const group = await db.get('SELECT "creatorId" FROM "Groups" WHERE id = ?', [id]);
    if (!group) return res.status(404).json({ error: 'Grup bulunamadı.' });
    if (group.creatorId !== req.user.id) return res.status(403).json({ error: 'Bu grubu silme yetkiniz yok.' });

    // Üyeler ve grup mesajları otomatik silinir; grubun maçları genel maça dönüşür (veritabanı kuralı).
    await db.run('DELETE FROM "Groups" WHERE id = ?', [id]);

    res.json({ message: 'Grup başarıyla iptal edildi ve silindi.' });
  } catch (error) {
    res.status(500).json({ error: 'Grup iptal edilirken hata oluştu.' });
  }
});

// Lakap (boş = kaldır). Görünen ad: lakap, yoksa "Ahmet Y."
app.put('/api/me/profile', async (req, res) => {
  try {
    const nickname = String(req.body?.nickname ?? '').trim().replace(/\s+/g, ' ');
    if (nickname.length > 20) return res.status(400).json({ error: 'Lakap en fazla 20 karakter olabilir.' });
    await db.run('UPDATE "User" SET nickname = ? WHERE id = ?', [nickname || null, req.user.id]);
    res.json({ message: nickname ? 'Lakabın kaydedildi.' : 'Lakap kaldırıldı.', nickname: nickname || null });
  } catch (e) {
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

// Avatar: galeriden küçültülmüş JPEG (data URL), "emoji:⚽" biçiminde emoji ya da null (kaldır).
const validAvatar = (a: any) =>
  a === null || a === '' ||
  (typeof a === 'string' && a.startsWith('data:image/') && a.length <= 400_000) ||
  (typeof a === 'string' && a.startsWith('emoji:') && a.length <= 20);

app.post('/api/users/:id/avatar', async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: 'Yetkisiz erişim' });
  try {
    const { id } = req.params;
    const avatar = req.body?.avatar ?? null;
    if (!validAvatar(avatar)) return res.status(400).json({ error: 'Geçersiz avatar.' });
    await db.run('UPDATE "User" SET avatar = ? WHERE id = ?', [avatar || null, id]);
    res.json({ message: 'Avatar başarıyla güncellendi!' });
  } catch (error) {
    res.status(500).json({ error: 'Avatar güncellenirken hata oluştu.' });
  }
});

app.post('/api/users/:id/position', async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: 'Yetkisiz erişim' });
  try {
    const { id } = req.params;
    const { position } = req.body;
    await db.run('UPDATE "User" SET position = ? WHERE id = ?', [position, id]);
    res.json({ message: 'Mevki güncellendi!' });
  } catch (error) {
    res.status(500).json({ error: 'Mevki güncellenirken hata oluştu.' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    // ?groupId=... ile sadece o grubun üyeleri ve o grubun maçları.
    const groupId = req.query.groupId ? String(req.query.groupId) : null;
    if (groupId) {
      if (!(await isGroupMember(groupId, req.user.id))) return res.status(403).json({ error: 'Bu grubun üyesi değilsin.' });
      const rows = await db.all(`
        SELECT u.id, u.name, u.nickname, u.avatar, u.position,
               COALESCE(mp.matches, 0) AS matches,
               COALESCE(mp.goals, 0) AS goals,
               COALESCE(v.mvp, 0) AS mvp,
               r.avg_all, COALESCE(r.c, 0) AS rating_count
        FROM "GroupMembers" gm
        JOIN "User" u ON u.id = gm."userId"
        LEFT JOIN (
          SELECT mp."userId", COUNT(*) AS matches, SUM(mp.goals) AS goals
          FROM "MatchPlayers" mp JOIN "Matches" m ON m.id = mp."matchId"
          WHERE m."groupId" = ? AND m.status = 'COMPLETED' AND mp.status = 'ACTIVE'
          GROUP BY mp."userId"
        ) mp ON mp."userId" = u.id
        LEFT JOIN (
          SELECT v."votedId", COUNT(*) AS mvp
          FROM "MvpVotes" v JOIN "Matches" m ON m.id = v."matchId"
          WHERE m."groupId" = ?
          GROUP BY v."votedId"
        ) v ON v."votedId" = u.id
        LEFT JOIN (
          SELECT "ratedId", (AVG(speed) + AVG(shoot) + AVG(pass) + AVG(physique)) / 4 AS avg_all, COUNT(*) AS c
          FROM "Ratings" GROUP BY "ratedId"
        ) r ON r."ratedId" = u.id
        WHERE gm."groupId" = ?
      `, [groupId, groupId, groupId]);
      return res.json(rows.map((u: any) => {
        let score = u.rating_count > 0 ? Math.round(u.avg_all) : 60;
        score += (u.matches > 5 ? 2 : 0) + (u.goals > 10 ? 3 : 0);
        return {
          id: u.id, name: u.name, nickname: u.nickname, avatar: u.avatar, position: u.position,
          matches: u.matches, goals: u.goals, mvp: u.mvp, score: Math.min(score, 99),
        };
      }));
    }

    const rows = await db.all(`
      SELECT u.id, u.name, u.nickname, u.avatar, u.position,
             COALESCE(mp.matches, 0) AS matches,
             COALESCE(mp.goals, 0) AS goals,
             r.avg_all, COALESCE(r.c, 0) AS rating_count
      FROM "User" u
      LEFT JOIN (
        -- Sadece oynanmış (tamamlanmış) maçlar sayılır; yedekte kalanlar hariç.
        SELECT mp."userId", COUNT(*) AS matches, SUM(mp.goals) AS goals
        FROM "MatchPlayers" mp JOIN "Matches" m ON m.id = mp."matchId"
        WHERE m.status = 'COMPLETED' AND mp.status = 'ACTIVE'
        GROUP BY mp."userId"
      ) mp ON mp."userId" = u.id
      LEFT JOIN (
        SELECT "ratedId", (AVG(speed) + AVG(shoot) + AVG(pass) + AVG(physique)) / 4 AS avg_all, COUNT(*) AS c
        FROM "Ratings" GROUP BY "ratedId"
      ) r ON r."ratedId" = u.id
      -- Sadece benimle en az bir grubu paylaşanlar (uygulamadaki yabancılar görünmez).
      WHERE EXISTS (
        SELECT 1 FROM "GroupMembers" a JOIN "GroupMembers" b ON a."groupId" = b."groupId"
        WHERE a."userId" = ? AND b."userId" = u.id
      )
    `, [req.user.id]);

    const results = rows.map((u: any) => {
      let score = u.rating_count > 0 ? Math.round(u.avg_all) : 60;
      score += (u.matches > 5 ? 2 : 0) + (u.goals > 10 ? 3 : 0);
      return {
        id: u.id, name: u.name, nickname: u.nickname, avatar: u.avatar, position: u.position,
        matches: u.matches, goals: u.goals, score: score > 99 ? 99 : score
      };
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Liderlik tablosu alınamadı' });
  }
});

// GROUP LEADERBOARD API
app.get('/api/leaderboard/groups', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT g.id, g.name,
        (SELECT COUNT(*) FROM "Matches" m WHERE m."groupId" = g.id AND m.status = 'COMPLETED') AS matches,
        (SELECT COALESCE(SUM(mp.goals), 0) FROM "MatchPlayers" mp
           JOIN "Matches" m ON mp."matchId" = m.id
          WHERE m."groupId" = g.id AND m.status = 'COMPLETED') AS goals
      FROM "Groups" g
      JOIN "GroupMembers" gm ON gm."groupId" = g.id
      WHERE gm."userId" = ?
    `, [req.user.id]);

    res.json(rows.map((g: any) => ({ ...g, score: g.matches * 10 + g.goals * 3 })));
  } catch (e) {
    res.status(500).json({ error: 'Liderlik tablosu alınamadı' });
  }
});

// NOTIFICATIONS API
app.get('/api/notifications', async (req, res) => {
  try {
    // Artık cevap verilemeyecek davetleri (maç geçti, bitti ya da silindi) gösterme.
    const notifications = await db.all(`
      SELECT n.* FROM "Notifications" n
      WHERE n."userId" = ?
        AND NOT (
          n.type = 'MATCH_INVITE' AND NOT EXISTS (
            SELECT 1 FROM "Matches" m
            WHERE m.id = n.metadata::jsonb ->> 'matchId' AND m.status = 'OPEN' AND m."matchTimestamp" > ?
          )
        )
      ORDER BY n."createdAt" DESC LIMIT 30`, [req.user.id, Date.now()]);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Bildirimler getirilemedi' });
  }
});

app.post('/api/notifications/read', async (req, res) => {
  try {
    await db.run('UPDATE "Notifications" SET "isRead" = true WHERE "userId" = ?', [req.user.id]);
    res.json({ message: 'Tümü okundu' });
  } catch (error) {
    res.status(500).json({ error: 'Okundu işaretlenemedi' });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const r = await db.run('DELETE FROM "Notifications" WHERE id = ? AND "userId" = ?', [req.params.id, req.user.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Bildirim bulunamadı.' });
    res.json({ message: 'Bildirim silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Bildirim silinemedi' });
  }
});

// PUSH TOKENS
// Telefon, bildirim izni verince Expo push token'ını buraya kaydeder.
// Aynı telefonla başka hesaba geçilirse token yeni hesaba taşınır.
app.post('/api/push-token', async (req, res) => {
  try {
    const token = String(req.body?.token ?? '').trim();
    if (!/^(Exponent|Expo)PushToken\[.+\]$/.test(token)) return res.status(400).json({ error: 'Geçersiz token.' });
    const platform = String(req.body?.platform ?? '').slice(0, 20) || null;
    await db.run(
      `INSERT INTO "PushTokens" (token, "userId", platform) VALUES (?, ?, ?)
       ON CONFLICT (token) DO UPDATE SET "userId" = EXCLUDED."userId", platform = EXCLUDED.platform, "updatedAt" = now()`,
      [token, req.user.id, platform]
    );
    res.json({ message: 'Bildirimler açık.' });
  } catch (e) {
    console.error('Push token error:', e);
    res.status(500).json({ error: 'Token kaydedilemedi.' });
  }
});

// Çıkış yaparken: bu telefona artık bu hesabın bildirimleri gelmesin.
app.delete('/api/push-token', async (req, res) => {
  try {
    const token = String(req.body?.token ?? '').trim();
    await db.run('DELETE FROM "PushTokens" WHERE token = ? AND "userId" = ?', [token, req.user.id]);
    res.json({ message: 'Tamam' });
  } catch (e) {
    res.status(500).json({ error: 'Silinemedi.' });
  }
});

// ZAMANLAYICI
// Supabase'deki pg_cron saatte bir bu adresi çağırır (Render uyuyor olsa bile uyandırır).
// Gizli anahtar veritabanında (sportarea."AppConfig") duruyor; zamanlayıcı da oradan okuyor.
// Böylece Render'a ayrıca ortam değişkeni eklemek gerekmiyor.
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const FINISH_REMINDER_AFTER_MS = 2 * 60 * 60 * 1000;

async function runCronTick() {
  // 0) Maçı silinmiş, hiçbir maçta kaydı kalmamış misafirleri temizle.
  await db.run(`DELETE FROM "User" u WHERE u.role = 'GUEST' AND NOT EXISTS (SELECT 1 FROM "MatchPlayers" mp WHERE mp."userId" = u.id)`);
  // 1) Haftalık maçı olan her grupta sıradaki maç açık olsun (kimse uygulamayı açmasa da).
  const scheduled = await db.all(`SELECT id FROM "Groups" WHERE "weeklyDay" IS NOT NULL`);
  let opened = 0;
  for (const g of scheduled) {
    try { if (await ensureUpcomingMatch(g.id)) opened++; } catch (err) { console.error('Cron weekly error:', err); }
  }

  // 2) Maça 24 saatten az kalmışsa: cevap vermeyenlere ve "Belki" diyenlere bir kez hatırlat.
  //    reminderSentAt'i önce işaretleyip ("claim") sonra gönderiyoruz, böylece iki tetikleme çift göndermez.
  const now = Date.now();
  const due = await db.all(
    `UPDATE "Matches" SET "reminderSentAt" = now()
     WHERE status = 'OPEN' AND "groupId" IS NOT NULL AND "reminderSentAt" IS NULL
       AND "matchTimestamp" > ? AND "matchTimestamp" <= ?
     RETURNING id, "groupId", location, "matchTimestamp", "maxPlayers"`,
    [now, now + REMINDER_WINDOW_MS]
  );

  const pushes: PushMessage[] = [];
  for (const m of due) {
    const g = await db.get('SELECT name FROM "Groups" WHERE id = ?', [m.groupId]);
    const active = await db.get(`SELECT COUNT(*) AS c FROM "MatchPlayers" WHERE "matchId" = ? AND status = 'ACTIVE'`, [m.id]);
    const people = await db.all(
      `SELECT gm."userId", r.response
       FROM "GroupMembers" gm
       LEFT JOIN "MatchResponses" r ON r."matchId" = ? AND r."userId" = gm."userId"
       WHERE gm."groupId" = ?
         AND NOT EXISTS (SELECT 1 FROM "MatchPlayers" mp WHERE mp."matchId" = ? AND mp."userId" = gm."userId")
         AND (r.response IS NULL OR r.response = 'MAYBE')`,
      [m.id, m.groupId, m.id]
    );
    const when = friendlyMatchTime(Number(m.matchTimestamp));
    const spots = Math.max(0, m.maxPlayers - active.c);
    for (const p of people) {
      const maybe = p.response === 'MAYBE';
      const body = maybe
        ? `"Belki" demiştin. Kesinleştirir misin? ${spots > 0 ? `Kadroda ${spots} yer var.` : 'Kadro dolu, yedeğe girebilirsin.'}`
        : `Henüz cevap vermedin. ${spots > 0 ? `Kadroda ${spots} yer var.` : 'Kadro dolu, yedeğe girebilirsin.'}`;
      await db.run('INSERT INTO "Notifications" (id, "userId", message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
        randomUUID(), p.userId, `${g?.name || 'Maç'} · ${when} (${m.location}): ${body}`, 'MATCH_INVITE', JSON.stringify({ matchId: m.id })
      ]);
      pushes.push({ userId: p.userId, title: `${g?.name || 'Maç'} · ${when}`, body, data: { matchId: m.id } });
    }
  }
  const reminders = pushes.length;

  // 3) Maç saatinden 2 saat geçti ama "Maçı Bitir" denmedi: maçı yönetene bir kez hatırlat.
  //    (Bir haftadan eski maçlar için hatırlatma yapılmaz.)
  const unfinished = await db.all(
    `UPDATE "Matches" m SET "finishReminderSentAt" = now()
     WHERE m.status = 'OPEN' AND m."finishReminderSentAt" IS NULL
       AND m."matchTimestamp" > 0 AND m."matchTimestamp" <= ? AND m."matchTimestamp" > ?
     RETURNING m.id, m.location, m."matchTimestamp", m."creatorId",
       (SELECT g."creatorId" FROM "Groups" g WHERE g.id = m."groupId") AS "groupCreatorId"`,
    [now - FINISH_REMINDER_AFTER_MS, now - 7 * 24 * 3600 * 1000]
  );
  for (const m of unfinished) {
    const to = m.creatorId || m.groupCreatorId;
    if (!to) continue;
    const when = friendlyMatchTime(Number(m.matchTimestamp));
    await db.run('INSERT INTO "Notifications" (id, "userId", message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
      randomUUID(), to,
      `${when} · ${m.location} maçı hâlâ açık görünüyor. Oynandıysa "Maçı Bitir" deyip skoru gir, oynanmadıysa iptal et.`,
      'INFO', JSON.stringify({ matchId: m.id }),
    ]);
    pushes.push({
      userId: to,
      title: 'Maç bitti mi? 🏁',
      body: `${when} · ${m.location}: skoru gir ya da oynanmadıysa iptal et.`,
      data: { matchId: m.id },
    });
  }

  const { sent } = await sendPush(pushes);
  return { opened, remindedMatches: due.length, reminders, finishReminders: unfinished.length, pushSent: sent };
}

app.post('/api/cron/tick', async (req, res) => {
  try {
    const cfg = await db.get(`SELECT value FROM "AppConfig" WHERE key = 'cron_secret'`);
    const given = String(req.headers['x-cron-secret'] ?? '');
    if (!cfg?.value || given.length < 16 || given !== cfg.value) return res.status(401).json({ error: 'Yetkisiz.' });
    const result = await runCronTick();
    console.log('Cron tick:', JSON.stringify(result));
    res.json(result);
  } catch (e) {
    console.error('Cron tick error:', e);
    res.status(500).json({ error: 'Zamanlayıcı çalışırken hata oluştu.' });
  }
});

// MATCHES API
// Her maç kartı için: giriş yapan kişinin cevabı (myStatus) ve kadrodaki kişi sayısı.
// myStatus: ACTIVE (varım), RESERVE (varım, yedekte), MAYBE (belki), DECLINED (yokum), null (cevap yok)
const MATCH_LIST_EXTRAS = `
  COALESCE(
    (SELECT mp.status FROM "MatchPlayers" mp WHERE mp."matchId" = m.id AND mp."userId" = ?),
    (SELECT CASE r.response WHEN 'NO' THEN 'DECLINED' ELSE 'MAYBE' END
       FROM "MatchResponses" r WHERE r."matchId" = m.id AND r."userId" = ?)
  ) AS "myStatus",
  (SELECT COUNT(*) FROM "MatchPlayers" mp WHERE mp."matchId" = m.id AND mp.status = 'ACTIVE') AS "activeCount",
  (SELECT mp.paid FROM "MatchPlayers" mp WHERE mp."matchId" = m.id AND mp."userId" = ?) AS "myPaid"
`;

// Maçlar sadece gruplar üzerinden görünür (herkese açık "Keşfet" listesi kaldırıldı).
app.get('/api/matches', async (req, res) => {
  try {
    const userId = req.user.id;
    if (req.query.type === 'public') return res.json([]); // eski uygulama sürümleri için

    // Haftalık ayarı olan gruplarda sıradaki maç henüz açılmadıysa şimdi açılır.
    await ensureUpcomingMatchesForUser(userId);

    const matches = await db.all(`
      SELECT m.*, g.name AS "groupName", g."creatorId" AS "groupCreatorId", ${MATCH_LIST_EXTRAS}
      FROM "Matches" m
      LEFT JOIN "Groups" g ON m."groupId" = g.id
      WHERE EXISTS (SELECT 1 FROM "MatchPlayers" mp WHERE mp."matchId" = m.id AND mp."userId" = ?)
         OR EXISTS (SELECT 1 FROM "GroupMembers" gm WHERE gm."groupId" = m."groupId" AND gm."userId" = ?)
      ORDER BY m."matchTimestamp" ASC
    `, [userId, userId, userId, userId, userId]);
    res.json(matches);
  } catch (error) {
    console.error('List matches error:', error);
    res.status(500).json({ error: 'Maçlar getirilirken hata oluştu.' });
  }
});

app.post('/api/matches', async (req, res) => {
  try {
    const { groupId, date, time, location, maxPlayers, teamAName, teamBName, matchTimestamp, lockoutHours } = req.body;
    const creatorId = req.user.id;
    const pitchFee = parseFee(req.body.pitchFee);
    if (pitchFee === undefined) return res.status(400).json({ error: 'Saha ücreti 0 ile 100.000 ₺ arasında bir tam sayı olmalı.' });
    if (!date || !time || !location || !(Number(maxPlayers) > 0)) {
      return res.status(400).json({ error: 'Tarih, saat, yer ve kontenjan gerekli.' });
    }
    if (!groupId) return res.status(400).json({ error: 'Maç bir gruba bağlı olmalı.' });
    if (!(await isGroupMember(groupId, creatorId))) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz.' });
    const id = randomUUID();
    const pushes: PushMessage[] = [];

    await tx(async (t) => {
      await t.run(
        `INSERT INTO "Matches" (id, "groupId", "creatorId", date, time, location, "maxPlayers", "teamAName", "teamBName", "matchTimestamp", "lockoutHours", "pitchFee")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, groupId, creatorId, date, time, location, Number(maxPlayers), teamAName || 'A Takımı', teamBName || 'B Takımı', Number(matchTimestamp) || 0, lockoutHours ?? 3, pitchFee]
      );

      await t.run('INSERT INTO "MatchPlayers" ("matchId", "userId") VALUES (?, ?)', [id, creatorId]);

      {
        const groupData = await t.get('SELECT name FROM "Groups" WHERE id = ?', [groupId]);
        const members = await t.all('SELECT "userId" FROM "GroupMembers" WHERE "groupId" = ? AND "userId" <> ?', [groupId, creatorId]);
        for (const m of members) {
          await t.run('INSERT INTO "Notifications" (id, "userId", message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
            randomUUID(),
            m.userId,
            `${groupData?.name || 'Grubun'}: yeni maç (${date}, ${location}). Geliyor musun?`,
            'MATCH_INVITE',
            JSON.stringify({ matchId: id })
          ]);
          pushes.push({
            userId: m.userId,
            title: `${groupData?.name || 'Yeni maç'} · ${friendlyMatchTime(Number(matchTimestamp)) || date}`,
            body: `Yeni maç kuruldu (${location}). Geliyor musun?`,
            data: { matchId: id },
          });
        }
      }
    });
    sendPushInBackground(pushes);

    res.json({ message: 'Maç oluşturuldu', match: { id, date, time, location, maxPlayers } });
  } catch (error) {
    console.error('Create match error:', error);
    res.status(500).json({ error: 'Maç oluşturulurken hata oluştu.' });
  }
});

app.get('/api/matches/:id', async (req, res) => {
  try {
    const match = await db.get(
      `SELECT m.*, g.name AS "groupName", g."creatorId" AS "groupCreatorId"
       FROM "Matches" m LEFT JOIN "Groups" g ON g.id = m."groupId" WHERE m.id = ?`,
      [req.params.id]
    );
    if (!match) return res.status(404).json({ error: 'Maç bulunamadı.' });
    const perm = await canManageMatch(match.id, req.user.id);
    res.json({ ...match, canManage: perm.allowed });
  } catch (error) {
    res.status(500).json({ error: 'Maç bilgisi alınamadı.' });
  }
});

// Maçı düzenle (saha, gün/saat, kişi sayısı, kilit süresi). Sadece maçı yöneten, maç bitmeden.
// Haftalık otomatik maçta sadece o haftanın maçı değişir; grubun haftalık ayarı aynı kalır.
const matchDateLabel = (ts: number) => {
  const d = new Date(ts + TR_OFFSET_MS);
  const h = d.getUTCHours();
  const day = new Date(d.getTime() - (h < 6 ? 86400000 : 0));
  const hhmm = `${String(h).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return { label: `${day.getUTCDate()}/${day.getUTCMonth() + 1} ${DAY_SHORT[day.getUTCDay()]}, ${hhmm}`, time: hhmm };
};

app.put('/api/matches/:id', async (req, res) => {
  try {
    const matchId = req.params.id;
    const perm = await canManageMatch(matchId, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Maçı sadece kuran kişi ya da grup kurucusu düzenleyebilir.' });

    const location = String(req.body?.location ?? '').trim().replace(/\s+/g, ' ');
    const ts = Number(req.body?.matchTimestamp);
    const maxPlayers = Number(req.body?.maxPlayers);
    const lockoutHours = Number(req.body?.lockoutHours);
    if (location.length < 2 || location.length > 80) return res.status(400).json({ error: 'Saha adını yaz (2-80 karakter).' });
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 50) return res.status(400).json({ error: 'Kişi sayısı 2 ile 50 arasında olmalı.' });
    if (!Number.isInteger(lockoutHours) || lockoutHours < 0 || lockoutHours > 48) return res.status(400).json({ error: 'Kilit süresi 0 ile 48 saat arasında olmalı.' });
    if (!Number.isFinite(ts) || ts <= 0) return res.status(400).json({ error: 'Geçerli bir gün ve saat seç.' });

    const pushes: PushMessage[] = [];
    const result = await tx(async (t) => {
      const m = await t.get(
        `SELECT m.*, g.name AS "groupName" FROM "Matches" m LEFT JOIN "Groups" g ON g.id = m."groupId" WHERE m.id = ? FOR UPDATE OF m`,
        [matchId]
      );
      if (m.status === 'COMPLETED') return { status: 400, body: { error: 'Tamamlanmış maç düzenlenemez.' } };
      if (m.status === 'CANCELLED') return { status: 400, body: { error: 'İptal edilmiş maç düzenlenemez; önce iptali geri al.' } };
      const timeChanged = Number(m.matchTimestamp) !== ts;
      if (timeChanged && ts < Date.now()) return { status: 400, body: { error: 'Seçtiğin gün ve saat geçmişte kalıyor.' } };

      const active = await t.get(`SELECT COUNT(*) AS c FROM "MatchPlayers" WHERE "matchId" = ? AND status = 'ACTIVE'`, [matchId]);
      if (maxPlayers < active.c) {
        return { status: 400, body: { error: `Kadroda şu an ${active.c} kişi var; kişi sayısını bundan aza düşüremezsin.` } };
      }

      const { label, time } = matchDateLabel(ts);
      await t.run(
        `UPDATE "Matches" SET location = ?, "matchTimestamp" = ?, date = ?, time = ?, "maxPlayers" = ?, "lockoutHours" = ?,
           "reminderSentAt" = CASE WHEN ? THEN NULL ELSE "reminderSentAt" END
         WHERE id = ?`,
        [location, ts, label, time, maxPlayers, lockoutHours, timeChanged, matchId]
      );

      // Kişi sayısı arttıysa yedekler sırayla kadroya geçer.
      const updated = { ...m, location, matchTimestamp: ts };
      const reserves = await t.get(`SELECT COUNT(*) AS c FROM "MatchPlayers" WHERE "matchId" = ? AND status = 'RESERVE'`, [matchId]);
      const toPromote = Math.min(maxPlayers - active.c, reserves.c);
      for (let i = 0; i < toPromote; i++) await promoteFirstReserve(t, matchId, updated, pushes);

      // Saha ya da zaman değiştiyse gruptaki herkese haber ver.
      const placeChanged = m.location !== location;
      if ((timeChanged || placeChanged) && m.groupId) {
        const what = [timeChanged ? friendlyMatchTime(ts) : null, placeChanged ? location : null].filter(Boolean).join(' · ');
        const members = await t.all('SELECT "userId" FROM "GroupMembers" WHERE "groupId" = ? AND "userId" <> ?', [m.groupId, req.user.id]);
        for (const mem of members) {
          await t.run('INSERT INTO "Notifications" (id, "userId", message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
            randomUUID(), mem.userId,
            `${m.groupName || 'Grubun'}: maç bilgisi değişti → ${what}`,
            'INFO', JSON.stringify({ matchId }),
          ]);
          pushes.push({
            userId: mem.userId,
            title: `Maç değişti · ${m.groupName || 'SporArea'}`,
            body: `Yeni bilgi: ${what}`,
            data: { matchId },
          });
        }
      }
      return { status: 200, body: { message: 'Maç güncellendi.' } };
    });
    sendPushInBackground(pushes);
    res.status(result.status).json(result.body);
  } catch (e) {
    console.error('Edit match error:', e);
    res.status(500).json({ error: 'Maç güncellenemedi.' });
  }
});

// İPTAL: maç silinmez; durumu CANCELLED olur, kadrosuyla birlikte kayıtlı kalır ve "İptal" olarak görünür.
// Gruptaki herkese haber gider. Maç saati geçmediyse yöneten kişi iptali geri alabilir.
async function setCancelled(matchId: string, byUserId: string, cancel: boolean) {
  const pushes: PushMessage[] = [];
  const result = await tx(async (t) => {
    const m = await t.get(
      `SELECT m.*, g.name AS "groupName" FROM "Matches" m LEFT JOIN "Groups" g ON g.id = m."groupId" WHERE m.id = ? FOR UPDATE OF m`,
      [matchId]
    );
    if (cancel) {
      if (m.status === 'COMPLETED') return { status: 400, body: { error: 'Tamamlanmış maç iptal edilemez.' } };
      if (m.status === 'CANCELLED') return { status: 200, body: { message: 'Maç zaten iptal edilmiş.' } };
    } else {
      if (m.status !== 'CANCELLED') return { status: 400, body: { error: 'Bu maç iptal edilmemiş.' } };
      if (!(Number(m.matchTimestamp) > Date.now())) return { status: 400, body: { error: 'Maç saati geçtiği için iptal geri alınamaz.' } };
    }
    await t.run('UPDATE "Matches" SET status = ? WHERE id = ?', [cancel ? 'CANCELLED' : 'OPEN', matchId]);

    if (m.groupId) {
      const when = friendlyMatchTime(Number(m.matchTimestamp));
      const text = cancel
        ? `${m.groupName || 'Grubun'}: ${when} · ${m.location} maçı iptal edildi.`
        : `${m.groupName || 'Grubun'}: ${when} · ${m.location} maçı tekrar açıldı.`;
      const members = await t.all('SELECT "userId" FROM "GroupMembers" WHERE "groupId" = ? AND "userId" <> ?', [m.groupId, byUserId]);
      for (const mem of members) {
        await t.run('INSERT INTO "Notifications" (id, "userId", message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
          randomUUID(), mem.userId, text, 'INFO', JSON.stringify({ matchId }),
        ]);
        pushes.push({
          userId: mem.userId,
          title: cancel ? `Maç iptal ❌ · ${m.groupName || 'SporArea'}` : `Maç tekrar açıldı · ${m.groupName || 'SporArea'}`,
          body: `${when} · ${m.location}`,
          data: { matchId },
        });
      }
    }
    return { status: 200, body: { message: cancel ? 'Maç iptal edildi.' : 'İptal geri alındı, maç tekrar açık.' } };
  });
  sendPushInBackground(pushes);
  return result;
}

app.delete('/api/matches/:id', async (req, res) => {
  try {
    const perm = await canManageMatch(req.params.id, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Bu maçı iptal etme yetkiniz yok.' });
    const r = await setCancelled(req.params.id, req.user.id, true);
    res.status(r.status).json(r.body);
  } catch (error) {
    console.error('Cancel match error:', error);
    res.status(500).json({ error: 'Maç iptal edilirken hata oluştu.' });
  }
});

app.post('/api/matches/:id/restore', async (req, res) => {
  try {
    const perm = await canManageMatch(req.params.id, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Bu maçı sadece yöneten kişi geri açabilir.' });
    const r = await setCancelled(req.params.id, req.user.id, false);
    res.status(r.status).json(r.body);
  } catch (error) {
    console.error('Restore match error:', error);
    res.status(500).json({ error: 'İptal geri alınamadı.' });
  }
});

app.get('/api/matches/:id/players', async (req, res) => {
  try {
    const { id } = req.params;
    const players: any[] = await db.all(`
      SELECT u.id, u.name, u.nickname, u.avatar, u.position, mp.team, mp.goals, mp.status, mp.paid,
             (u.role = 'GUEST') AS "isGuest", mp."invitedBy", inv.name AS "invitedByName", inv.nickname AS "invitedByNickname"
      FROM "MatchPlayers" mp
      JOIN "User" u ON mp."userId" = u.id
      LEFT JOIN "User" inv ON inv.id = mp."invitedBy"
      WHERE mp."matchId" = ?
      ORDER BY mp."joinedAt" ASC
    `, [id]);

    const matchRow = await db.get('SELECT "groupId", "creatorId" FROM "Matches" WHERE id = ?', [id]);
    if (matchRow && matchRow.groupId) {
      // Gruptaki, "Varım" demeyen üyeler: verdikleri cevaba göre DECLINED (yokum), MAYBE (belki)
      // ya da hiç cevap vermediyse PENDING.
      const others = await db.all(`
        SELECT u.id, u.name, u.nickname, u.avatar, u.position, r.response
        FROM "GroupMembers" gm
        JOIN "User" u ON gm."userId" = u.id
        LEFT JOIN "MatchResponses" r ON r."matchId" = ? AND r."userId" = u.id
        WHERE gm."groupId" = ?
          AND NOT EXISTS (SELECT 1 FROM "MatchPlayers" mp WHERE mp."matchId" = ? AND mp."userId" = u.id)
        ORDER BY u.name
      `, [id, matchRow.groupId, id]);

      for (const gm of others) {
        players.push({
          id: gm.id,
          name: gm.name,
          nickname: gm.nickname,
          avatar: gm.avatar,
          position: gm.position,
          team: 'NONE',
          goals: 0,
          status: gm.response === 'NO' ? 'DECLINED' : gm.response === 'MAYBE' ? 'MAYBE' : 'PENDING'
        });
      }
    }

    res.json(players);
  } catch (error) {
    res.status(500).json({ error: 'Oyuncular getirilirken hata oluştu.' });
  }
});

// VARIM / YOKUM / BELKİ
// Tek giriş noktası: oyuncunun bir maça cevabını değiştirir.
//  YES   -> kadroya girer (yer yoksa yedeğe)
//  NO    -> kadrodaysa çıkar (ilk yedek kadroya yükselir), "Yokum" olarak işaretlenir
//  MAYBE -> kadrodaysa çıkar, "Belki" olarak işaretlenir
type MatchAnswer = 'YES' | 'NO' | 'MAYBE';
type RespondResult = { status: number; body: any };

// Kadrodan biri çıkınca ilk yedeği kadroya alır. Yedek bir misafirse haber onu getirene gider.
async function promoteFirstReserve(t: any, matchId: string, matchRow: any, pushes: PushMessage[]) {
  const first = await t.get(
    `SELECT mp."userId", mp."invitedBy", u.name, u.role FROM "MatchPlayers" mp JOIN "User" u ON u.id = mp."userId"
     WHERE mp."matchId" = ? AND mp.status = 'RESERVE' ORDER BY mp."joinedAt" ASC LIMIT 1`,
    [matchId]
  );
  if (!first) return;
  await t.run(`UPDATE "MatchPlayers" SET status = 'ACTIVE' WHERE "matchId" = ? AND "userId" = ?`, [matchId, first.userId]);
  const when = friendlyMatchTime(Number(matchRow.matchTimestamp));
  const isGuest = first.role === 'GUEST';
  const to = isGuest ? first.invitedBy : first.userId;
  if (!to) return;
  const message = isGuest
    ? `Misafirin ${first.name}, ${matchRow.location} maçında yedekten kadroya girdi.`
    : `Müjde! ${matchRow.location} maçında bir kişilik yer açıldı ve yedeğe alındığın listede AS KADROYA yükseldin!`;
  await t.run('INSERT INTO "Notifications" (id, "userId", message, type) VALUES (?, ?, ?, ?)', [randomUUID(), to, message, 'INFO']);
  pushes.push({
    userId: to,
    title: isGuest ? 'Misafirin kadroya girdi ⚽' : 'Kadroya girdin! ⚽',
    body: isGuest
      ? `${when} · ${matchRow.location}: ${first.name} artık as kadroda.`
      : `${when} · ${matchRow.location} maçında yer açıldı, artık as kadrodasın.`,
    data: { matchId },
  });
}

async function respondToMatch(matchId: string, userId: string, response: MatchAnswer): Promise<RespondResult> {
  const pushes: PushMessage[] = [];
  const result = await tx(async (t): Promise<RespondResult> => {
    // Aynı anda gelen cevaplar kontenjanı bozmasın diye maç satırını kilitliyoruz.
    const matchRow = await t.get(
      'SELECT "groupId", "creatorId", location, "maxPlayers", "matchTimestamp", "lockoutHours", status FROM "Matches" WHERE id = ? FOR UPDATE',
      [matchId]
    );
    if (!matchRow) return { status: 404, body: { error: 'Maç bulunamadı' } };
    if (matchRow.status === 'COMPLETED') return { status: 400, body: { error: 'Bu maç tamamlandı.' } };
    if (matchRow.status === 'CANCELLED') return { status: 400, body: { error: 'Bu maç iptal edildi.' } };

    if (matchRow.groupId) {
      const member = await t.get('SELECT 1 FROM "GroupMembers" WHERE "groupId" = ? AND "userId" = ?', [matchRow.groupId, userId]);
      if (!member) return { status: 403, body: { error: 'Bu maç sadece grup üyelerine açık.' } };
    }

    const current = await t.get('SELECT status FROM "MatchPlayers" WHERE "matchId" = ? AND "userId" = ?', [matchId, userId]);
    const locked = isLockedOut(matchRow);

    // Cevap verildiyse, bu maç için bekleyen davet bildirimi artık gereksiz.
    const clearInvite = () => t.run(
      `DELETE FROM "Notifications" WHERE "userId" = ? AND type = 'MATCH_INVITE' AND metadata::jsonb ->> 'matchId' = ?`,
      [userId, matchId]
    );

    if (response === 'YES') {
      if (current) {
        await clearInvite();
        return { status: 200, body: { message: current.status === 'RESERVE' ? 'Zaten yedek listesindesin.' : 'Zaten kadrodasın.', myStatus: current.status } };
      }
      if (locked) {
        return { status: 403, body: { error: `Bu maç için değişiklik süresi dolmuştur (Maça son ${matchRow.lockoutHours} saat kala kilitlendi).` } };
      }

      const activeCount = await t.get(`SELECT COUNT(*) as c FROM "MatchPlayers" WHERE "matchId" = ? AND status = 'ACTIVE'`, [matchId]);
      const isReserve = activeCount.c >= matchRow.maxPlayers;
      const playerStatus = isReserve ? 'RESERVE' : 'ACTIVE';

      await t.run('INSERT INTO "MatchPlayers" ("matchId", "userId", status) VALUES (?, ?, ?)', [matchId, userId, playerStatus]);
      await t.run('DELETE FROM "MatchResponses" WHERE "matchId" = ? AND "userId" = ?', [matchId, userId]);
      await clearInvite();

      if (matchRow.creatorId && matchRow.creatorId !== userId) {
        const who = await t.get('SELECT name, nickname FROM "User" WHERE id = ?', [userId]);
        await t.run('INSERT INTO "Notifications" (id, "userId", message, type) VALUES (?, ?, ?, ?)', [
          randomUUID(),
          matchRow.creatorId,
          `${displayName(who) || 'Bir oyuncu'} ${matchRow.location} maçına ${isReserve ? 'yedek olarak ' : ''}katıldı!`,
          'JOIN'
        ]);
      }

      return {
        status: 200,
        body: { message: isReserve ? 'Kadro doluydu, yedeğe alındın.' : 'Maça katılım başarılı!', myStatus: playerStatus }
      };
    }

    // NO veya MAYBE
    if (current) {
      if (locked) {
        return { status: 403, body: { error: `İptal süresi doldu! Maça son ${matchRow.lockoutHours} saat kala kadrodan çıkış yapılamaz.` } };
      }
      await t.run('DELETE FROM "MatchPlayers" WHERE "matchId" = ? AND "userId" = ?', [matchId, userId]);

      if (current.status === 'ACTIVE') await promoteFirstReserve(t, matchId, matchRow, pushes);
    }

    await t.run(
      `INSERT INTO "MatchResponses" ("matchId", "userId", response) VALUES (?, ?, ?)
       ON CONFLICT ("matchId", "userId") DO UPDATE SET response = EXCLUDED.response, "updatedAt" = now()`,
      [matchId, userId, response]
    );
    await clearInvite();

    return {
      status: 200,
      body: {
        message: response === 'NO' ? 'Bu hafta yoksun, not edildi.' : 'Belki olarak işaretlendin.',
        myStatus: response === 'NO' ? 'DECLINED' : 'MAYBE'
      }
    };
  });
  sendPushInBackground(pushes);
  return result;
}

app.post('/api/matches/:id/respond', async (req, res) => {
  const response = String(req.body?.response ?? '').toUpperCase();
  if (response !== 'YES' && response !== 'NO' && response !== 'MAYBE') {
    return res.status(400).json({ error: 'Cevap YES, NO ya da MAYBE olmalı.' });
  }
  try {
    const result = await respondToMatch(req.params.id, req.user.id, response);
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Respond error:', error);
    res.status(500).json({ error: 'Cevabın kaydedilemedi.' });
  }
});

// Eski uygulama sürümleriyle uyumluluk: katıl = Varım, çık = Yokum
app.post('/api/matches/:id/join', async (req, res) => {
  try {
    const result = await respondToMatch(req.params.id, req.user.id, 'YES');
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: 'Maça katılırken hata oluştu.' });
  }
});

app.post('/api/matches/:id/leave', async (req, res) => {
  try {
    const result = await respondToMatch(req.params.id, req.user.id, 'NO');
    if (result.status === 200) result.body.message = 'Maçtan çıkıldı.';
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({ error: 'Maçtan çıkarken hata oluştu.' });
  }
});


// MİSAFİR OYUNCU
// Grubun bir üyesi, uygulamayı kullanmayan birini sadece adıyla maça ekler (yanında getirdiği arkadaşı).
// Misafir, giriş yapamayan bir kullanıcı kaydıdır (role = 'GUEST'): kadroda yer tutar, saha ücretinden
// pay alır, takımlara dağıtılır; grup üyesi olmadığı için liderlik tablosunda görünmez.
const MAX_GUESTS_PER_PERSON = 5;

app.post('/api/matches/:id/guests', async (req, res) => {
  const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Misafirin adını yaz (2-40 karakter).' });
  try {
    const matchId = req.params.id;
    const hostId = req.user.id;
    const guestId = randomUUID();
    const hash = await bcrypt.hash(randomUUID(), 4); // kimse bilmez; misafir hiçbir zaman giriş yapamaz
    const result = await tx(async (t) => {
      const m = await t.get(
        'SELECT "groupId", "creatorId", location, "maxPlayers", "matchTimestamp", "lockoutHours", status FROM "Matches" WHERE id = ? FOR UPDATE',
        [matchId]
      );
      if (!m) return { status: 404, body: { error: 'Maç bulunamadı.' } };
      if (m.status === 'COMPLETED') return { status: 400, body: { error: 'Bu maç tamamlandı.' } };
      if (m.status === 'CANCELLED') return { status: 400, body: { error: 'Bu maç iptal edildi.' } };
      if (m.groupId) {
        const member = await t.get('SELECT 1 FROM "GroupMembers" WHERE "groupId" = ? AND "userId" = ?', [m.groupId, hostId]);
        if (!member) return { status: 403, body: { error: 'Misafiri sadece grup üyeleri ekleyebilir.' } };
      }
      const mine = await t.get(`SELECT COUNT(*) AS c FROM "MatchPlayers" WHERE "matchId" = ? AND "invitedBy" = ?`, [matchId, hostId]);
      if (mine.c >= MAX_GUESTS_PER_PERSON) return { status: 400, body: { error: `Bir maça en fazla ${MAX_GUESTS_PER_PERSON} misafir getirebilirsin.` } };

      const active = await t.get(`SELECT COUNT(*) AS c FROM "MatchPlayers" WHERE "matchId" = ? AND status = 'ACTIVE'`, [matchId]);
      const full = active.c >= m.maxPlayers;
      // Kilitli maçta boş yer varsa misafirle doldurulabilir (eksik kadroyu tamamlamak için); yedek eklenmez.
      if (full && isLockedOut(m)) return { status: 403, body: { error: 'Kadro dolu ve maç kilitli, misafir eklenemez.' } };
      const status = full ? 'RESERVE' : 'ACTIVE';

      await t.run(
        `INSERT INTO "User" (id, name, email, password, role, position) VALUES (?, ?, ?, ?, 'GUEST', NULL)`,
        [guestId, name, `misafir-${guestId}@misafir.invalid`, hash]
      );
      await t.run('INSERT INTO "MatchPlayers" ("matchId", "userId", status, "invitedBy") VALUES (?, ?, ?, ?)', [matchId, guestId, status, hostId]);

      if (m.creatorId && m.creatorId !== hostId) {
        const host = await t.get('SELECT name, nickname FROM "User" WHERE id = ?', [hostId]);
        await t.run('INSERT INTO "Notifications" (id, "userId", message, type) VALUES (?, ?, ?, ?)', [
          randomUUID(), m.creatorId,
          `${displayName(host) || 'Bir oyuncu'}, ${m.location} maçına misafir ekledi: ${name}${full ? ' (yedek)' : ''}`,
          'JOIN',
        ]);
      }
      return {
        status: 200,
        body: { message: full ? `Kadro dolu, ${name} yedeğe yazıldı.` : `${name} kadroya eklendi.`, guest: { id: guestId, name, status } },
      };
    });
    res.status(result.status).json(result.body);
  } catch (e) {
    console.error('Add guest error:', e);
    res.status(500).json({ error: 'Misafir eklenemedi.' });
  }
});

// Misafiri getiren kişi ya da maçı yöneten çıkarabilir. Kadrodaysa ilk yedek yukarı çıkar.
app.delete('/api/matches/:id/guests/:guestId', async (req, res) => {
  try {
    const { id: matchId, guestId } = req.params;
    const perm = await canManageMatch(matchId, req.user.id);
    const pushes: PushMessage[] = [];
    const result = await tx(async (t) => {
      const m = await t.get(
        'SELECT location, "matchTimestamp", status FROM "Matches" WHERE id = ? FOR UPDATE',
        [matchId]
      );
      if (!m) return { status: 404, body: { error: 'Maç bulunamadı.' } };
      const g = await t.get(
        `SELECT mp.status, mp."invitedBy" FROM "MatchPlayers" mp JOIN "User" u ON u.id = mp."userId"
         WHERE mp."matchId" = ? AND mp."userId" = ? AND u.role = 'GUEST'`,
        [matchId, guestId]
      );
      if (!g) return { status: 404, body: { error: 'Bu maçta böyle bir misafir yok.' } };
      if (g.invitedBy !== req.user.id && !perm.allowed) return { status: 403, body: { error: 'Misafiri sadece getiren kişi ya da maçı yöneten çıkarabilir.' } };
      if (m.status === 'COMPLETED') return { status: 400, body: { error: 'Tamamlanmış maçtan misafir çıkarılamaz.' } };

      await t.run('DELETE FROM "MatchPlayers" WHERE "matchId" = ? AND "userId" = ?', [matchId, guestId]);
      if (g.status === 'ACTIVE') await promoteFirstReserve(t, matchId, m, pushes);
      await t.run(`DELETE FROM "User" WHERE id = ? AND role = 'GUEST'`, [guestId]);
      return { status: 200, body: { message: 'Misafir çıkarıldı.' } };
    });
    sendPushInBackground(pushes);
    res.status(result.status).json(result.body);
  } catch (e) {
    console.error('Remove guest error:', e);
    res.status(500).json({ error: 'Misafir çıkarılamadı.' });
  }
});

async function balanceTeams(players: any[]) {
  const ids = players.map((p) => p.id);
  const ratingRows = await db.all(
    `SELECT "ratedId", (AVG(speed) + AVG(shoot) + AVG(pass) + AVG(physique)) / 4 AS overall
     FROM "Ratings" WHERE "ratedId" = ANY(?) GROUP BY "ratedId"`,
    [ids]
  );
  const ratingMap = new Map(ratingRows.map((r: any) => [r.ratedId, Math.round(r.overall)]));
  for (const p of players) {
    p.overall = ratingMap.get(p.id) ?? 65; // default average
  }

  const goalkeepers = players.filter((p: any) => (p.position || '').toLowerCase().includes('kaleci')).sort((a: any, b: any) => b.overall - a.overall);
  const others = players.filter((p: any) => !(p.position || '').toLowerCase().includes('kaleci')).sort((a: any, b: any) => b.overall - a.overall);

  const teamA: any[] = [];
  const teamB: any[] = [];
  let sumA = 0;
  let sumB = 0;

  const assignToTeam = (p: any) => {
    if (teamA.length === teamB.length) {
      if (sumA <= sumB) { teamA.push(p); sumA += p.overall; }
      else { teamB.push(p); sumB += p.overall; }
    } else if (teamA.length < teamB.length) {
      teamA.push(p); sumA += p.overall;
    } else {
      teamB.push(p); sumB += p.overall;
    }
  };

  goalkeepers.forEach((p: any) => assignToTeam(p));
  others.forEach((p: any) => assignToTeam(p));

  return {
    teamA,
    teamB,
    stats: {
      teamA_overall: teamA.length > 0 ? Math.round(sumA / teamA.length) : 0,
      teamB_overall: teamB.length > 0 ? Math.round(sumB / teamB.length) : 0
    }
  };
}

const saveTeams = (matchId: string, teamA: string[], teamB: string[]) =>
  tx(async (t) => {
    await t.run(`UPDATE "MatchPlayers" SET team = 'UNASSIGNED' WHERE "matchId" = ?`, [matchId]);
    await t.run(`UPDATE "MatchPlayers" SET team = 'A' WHERE "matchId" = ? AND "userId" = ANY(?)`, [matchId, teamA]);
    await t.run(`UPDATE "MatchPlayers" SET team = 'B' WHERE "matchId" = ? AND "userId" = ANY(?)`, [matchId, teamB]);
  });

const activePlayers = (matchId: string) => db.all(`
  SELECT u.id, u.name, u.nickname, u.avatar, u.position
  FROM "MatchPlayers" mp
  JOIN "User" u ON mp."userId" = u.id
  WHERE mp."matchId" = ? AND mp.status = 'ACTIVE'
`, [matchId]);

app.post('/api/matches/:id/divide', async (req, res) => {
  try {
    const { id } = req.params;
    const perm = await canManageMatch(id, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Takımları sadece maçı kuran kişi belirleyebilir.' });

    const players = await activePlayers(id);
    if (players.length < 2) return res.status(400).json({ error: 'Takım kurmak için yeterli oyuncu yok.' });

    const { teamA, teamB, stats } = await balanceTeams(players);
    await saveTeams(id, teamA.map((p) => p.id), teamB.map((p) => p.id));

    res.json({ message: 'Takımlar zekice kalibre edildi!', stats });
  } catch (error) {
    res.status(500).json({ error: 'Bölme hatası' });
  }
});

app.get('/api/matches/:id/suggest-teams', async (req, res) => {
  try {
    const players = await activePlayers(req.params.id);
    if (players.length < 2) return res.status(400).json({ error: 'Takım kurmak için yeterli oyuncu yok.' });

    res.json(await balanceTeams(players));
  } catch (error) {
    res.status(500).json({ error: 'Öneri oluşturma hatası' });
  }
});

app.post('/api/matches/:id/save-teams', async (req, res) => {
  try {
    const { id } = req.params;
    const { teamA, teamB } = req.body;

    if (!Array.isArray(teamA) || !Array.isArray(teamB)) {
      return res.status(400).json({ error: 'Geçersiz takım listeleri.' });
    }
    const perm = await canManageMatch(id, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Takımları sadece maçı kuran kişi belirleyebilir.' });

    await saveTeams(id, teamA.map(String), teamB.map(String));

    res.json({ message: 'Takımlar başarıyla kaydedildi!' });
  } catch (error) {
    res.status(500).json({ error: 'Takımları kaydetme hatası' });
  }
});

// SAHA ÜCRETİ
// Maçı yöneten kişi ücreti girer / değiştirir (boş ya da 0 = ücret yok).
app.put('/api/matches/:id/fee', async (req, res) => {
  try {
    const { id } = req.params;
    const perm = await canManageMatch(id, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Saha ücretini sadece maçı kuran kişi girebilir.' });
    const fee = parseFee(req.body.fee);
    if (fee === undefined) return res.status(400).json({ error: 'Saha ücreti 0 ile 100.000 ₺ arasında bir tam sayı olmalı.' });
    await db.run('UPDATE "Matches" SET "pitchFee" = ? WHERE id = ?', [fee, id]);
    res.json({ message: fee ? 'Saha ücreti kaydedildi.' : 'Saha ücreti kaldırıldı.', pitchFee: fee });
  } catch (e) {
    res.status(500).json({ error: 'Saha ücreti kaydedilemedi.' });
  }
});

// Maçı yöneten kişi bir oyuncunun payını ödedi / ödemedi olarak işaretler.
app.post('/api/matches/:id/paid', async (req, res) => {
  try {
    const { id } = req.params;
    const perm = await canManageMatch(id, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Ödemeleri sadece maçı kuran kişi işaretleyebilir.' });
    const userId = String(req.body.userId ?? '');
    const r = await db.run(
      `UPDATE "MatchPlayers" SET paid = ? WHERE "matchId" = ? AND "userId" = ? AND status = 'ACTIVE'`,
      [Boolean(req.body.paid), id, userId]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'Bu kişi bu maçta oynamıyor.' });
    res.json({ message: 'Kaydedildi.' });
  } catch (e) {
    res.status(500).json({ error: 'Kaydedilemedi.' });
  }
});

app.post('/api/matches/:id/finish', async (req, res) => {
  try {
    const { id } = req.params;
    const { score, scorers } = req.body;

    const perm = await canManageMatch(id, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Maçı sadece kuran kişi bitirebilir.' });
    const cur = await db.get('SELECT status FROM "Matches" WHERE id = ?', [id]);
    if (cur?.status === 'CANCELLED') return res.status(400).json({ error: 'İptal edilmiş maç bitirilemez.' });

    await tx(async (t) => {
      await t.run(`UPDATE "Matches" SET status = 'COMPLETED', score = ? WHERE id = ?`, [score || null, id]);

      if (Array.isArray(scorers)) {
        for (const s of scorers) {
          const goals = Number(s.goals);
          if (goals > 0) {
            await t.run('UPDATE "MatchPlayers" SET goals = ? WHERE "matchId" = ? AND "userId" = ?', [goals, id, s.userId]);
          }
        }
      }

      const matchRow = await t.get('SELECT location FROM "Matches" WHERE id = ?', [id]);
      await t.run(
        `INSERT INTO "Notifications" (id, "userId", message, type)
         SELECT gen_random_uuid()::text, mp."userId", ?, 'MATCH_RESULT' FROM "MatchPlayers" mp
         JOIN "User" u ON u.id = mp."userId" WHERE mp."matchId" = ? AND u.role <> 'GUEST'`,
        [`${matchRow?.location || 'Maç'} tamamlandı! İstatistiklerin işlendi. Hemen detaylara göz atabilir ve oyuncuları puanlayabilirsin.`, id]
      );
    });

    // Sadece sahada oynayanlara: MVP oyu ve puanlama hatırlatması
    const played = await db.all(`SELECT "userId" FROM "MatchPlayers" WHERE "matchId" = ? AND status = 'ACTIVE' AND "userId" <> ?`, [id, req.user.id]);
    const feeRow = await db.get(`SELECT "pitchFee", (SELECT COUNT(*) FROM "MatchPlayers" WHERE "matchId" = ? AND status = 'ACTIVE') AS n FROM "Matches" WHERE id = ?`, [id, id]);
    const share = sharePerPerson(feeRow?.pitchFee ?? null, feeRow?.n ?? 0);
    sendPushInBackground(played.map((p: any) => ({
      userId: p.userId,
      title: score ? `Maç bitti: ${score}` : 'Maç bitti',
      body: share
        ? `Saha payın: ${share} ₺. MVP oyunu ver, takım arkadaşlarını puanla.`
        : 'MVP oyunu ver, takım arkadaşlarını puanla.',
      data: { matchId: id },
    })));

    res.json({ message: 'Maç başarıyla tamamlandı.' });
  } catch (error) {
    console.error('FINISH MATCH ERROR:', error);
    res.status(500).json({ error: 'Maç bitirilirken hata oluştu.' });
  }
});

// Maç sonrası (MVP, puanlama): maç bitmiş olmalı, hem oy veren hem oy alan o maçta sahada (ACTIVE) olmalı.
async function postMatchCheck(matchId: string, fromId: string, toId: string): Promise<string | null> {
  const match = await db.get('SELECT status FROM "Matches" WHERE id = ?', [matchId]);
  if (!match) return 'Maç bulunamadı.';
  if (match.status !== 'COMPLETED') return 'Bu işlem maç bittikten sonra yapılabilir.';
  const rows = await db.all(
    `SELECT "userId" FROM "MatchPlayers" WHERE "matchId" = ? AND status = 'ACTIVE' AND "userId" = ANY(?)`,
    [matchId, [fromId, toId]]
  );
  const played = new Set(rows.map((r: any) => r.userId));
  if (!played.has(fromId)) return 'Sadece bu maçta oynayanlar oy verebilir.';
  if (!played.has(toId)) return 'Seçtiğin kişi bu maçta oynamadı.';
  return null;
}

// MVP API
app.get('/api/matches/:id/mvp', async (req, res) => {
  try {
    const top = await db.get(`
      SELECT u.id, u.name, u.nickname, u.avatar, u.position, COUNT(*) AS "voteCount"
      FROM "MvpVotes" v JOIN "User" u ON u.id = v."votedId"
      WHERE v."matchId" = ?
      GROUP BY u.id
      ORDER BY "voteCount" DESC
      LIMIT 1
    `, [req.params.id]);
    const mine = await db.get(`
      SELECT u.id, u.name, u.nickname FROM "MvpVotes" v JOIN "User" u ON u.id = v."votedId"
      WHERE v."matchId" = ? AND v."voterId" = ?
    `, [req.params.id, req.user.id]);
    res.json({ mvp: top ?? null, myVote: mine ?? null });
  } catch (error) {
    res.status(500).json({ error: 'MVP alınamadı.' });
  }
});

app.post('/api/matches/:id/mvp', async (req, res) => {
  try {
    const { id } = req.params;
    const { votedId } = req.body;
    const voterId = req.user.id; // oy veren her zaman giriş yapan kişi

    if (!votedId) return res.status(400).json({ error: 'Oy verilecek oyuncu seçilmedi.' });
    if (votedId === voterId) return res.status(400).json({ error: 'Kendine oy veremezsin.' });
    const problem = await postMatchCheck(id, voterId, String(votedId));
    if (problem) return res.status(403).json({ error: problem });

    await db.run('INSERT INTO "MvpVotes" (id, "matchId", "voterId", "votedId") VALUES (?, ?, ?, ?)', [randomUUID(), id, voterId, votedId]);
    res.json({ message: 'MVP oyunuz kaydedildi!' });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ error: 'Zaten MVP oyu kullandınız!' });
    }
    res.status(500).json({ error: 'MVP oyu kaydedilemedi.' });
  }
});

app.post('/api/matches/:id/rate', async (req, res) => {
  try {
    const { id } = req.params;
    const { ratedId, speed, shoot, pass, physique } = req.body;
    const raterId = req.user.id; // puanlayan her zaman giriş yapan kişi

    if (raterId === ratedId) return res.status(400).json({ error: 'Kendinizi puanlayamazsınız.' });
    const scores = [speed, shoot, pass, physique].map(Number);
    if (scores.some((x) => !Number.isInteger(x) || x < 1 || x > 99)) {
      return res.status(400).json({ error: 'Puanlar 1 ile 99 arasında olmalı.' });
    }
    const problem = await postMatchCheck(id, raterId, String(ratedId));
    if (problem) return res.status(403).json({ error: problem });

    // Aynı oyuncuyu aynı maçta tekrar puanlarsa eski puan güncellenir.
    await db.run(`
      INSERT INTO "Ratings" (id, "matchId", "raterId", "ratedId", speed, shoot, pass, physique)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT ("matchId", "raterId", "ratedId")
      DO UPDATE SET speed = EXCLUDED.speed, shoot = EXCLUDED.shoot, pass = EXCLUDED.pass, physique = EXCLUDED.physique
    `, [randomUUID(), id, raterId, ratedId, speed, shoot, pass, physique]);

    res.json({ message: 'Puan basariyla kaydedildi!' });
  } catch (error) {
    res.status(500).json({ error: 'Puan kaydedilirken hata.' });
  }
});


app.get('/api/users/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const s = await db.get(`
      SELECT
        (SELECT COUNT(*) FROM "MatchPlayers" mp JOIN "Matches" m ON m.id = mp."matchId"
          WHERE mp."userId" = ? AND m.status = 'COMPLETED' AND mp.status = 'ACTIVE') AS matches,
        (SELECT COALESCE(SUM(goals), 0) FROM "MatchPlayers" WHERE "userId" = ?) AS goals,
        (SELECT COUNT(*) FROM "MvpVotes" WHERE "votedId" = ?) AS mvp,
        r."avgSpeed", r."avgShoot", r."avgPass", r."avgPhysique", r."ratingCount"
      FROM (
        SELECT AVG(speed) AS "avgSpeed", AVG(shoot) AS "avgShoot", AVG(pass) AS "avgPass",
               AVG(physique) AS "avgPhysique", COUNT(*) AS "ratingCount"
        FROM "Ratings" WHERE "ratedId" = ?
      ) r
    `, [id, id, id, id]);

    const numMatches = s.matches;
    const realGoals = s.goals;
    const mvpVotes = s.mvp;
    const ratingCount = s.ratingCount;
    const hasRatings = ratingCount > 0;

    const speed = hasRatings ? Math.round(s.avgSpeed) : 60;
    const shoot = hasRatings ? Math.round(s.avgShoot) : 60;
    const pass = hasRatings ? Math.round(s.avgPass) : 60;
    const physique = hasRatings ? Math.round(s.avgPhysique) : 60;
    const overallScore = Math.round((speed + shoot + pass + physique) / 4) + (numMatches > 5 ? 2 : 0) + (realGoals > 10 ? 3 : 0);

    // Generate profile badges dynamically
    const badges = [];

    // Core achievements
    if (realGoals >= 5) badges.push({ id: 'top_scorer', icon: '⚽', title: 'Gol Makinesi', bg: 'rgba(0, 230, 118, 0.15)' });
    if (numMatches >= 10) badges.push({ id: 'veteran', icon: '🌟', title: 'Müdavim', bg: 'rgba(56, 189, 248, 0.15)' });
    if (mvpVotes > 0) badges.push({ id: 'mvp', icon: '🏆', title: 'Yıldız Oyuncu', bg: 'rgba(255, 193, 7, 0.15)' });
    if (overallScore >= 75) badges.push({ id: 'pro', icon: '🔥', title: 'Pro Kariyer', bg: 'rgba(239, 68, 68, 0.15)' });

    // Fun and dynamic badges
    if (realGoals >= 15) badges.push({ id: 'golden_boot', icon: '👑', title: 'Altın Ayakkabı', bg: 'rgba(250, 204, 21, 0.15)' });
    if (numMatches >= 25) badges.push({ id: 'legend', icon: '🪐', title: 'Halı Saha Efsanesi', bg: 'rgba(251, 146, 60, 0.15)' });
    if (physique >= 78) badges.push({ id: 'defense_minister', icon: '🛡️', title: 'Savunma Bakanı', bg: 'rgba(148, 163, 184, 0.15)' });
    if (pass >= 78) badges.push({ id: 'maestro', icon: '🪄', title: 'Sihirbaz', bg: 'rgba(168, 85, 247, 0.15)' });
    if (speed >= 78) badges.push({ id: 'lightning', icon: '⚡', title: 'Fırtına', bg: 'rgba(56, 189, 248, 0.15)' });
    if (shoot >= 78) badges.push({ id: 'sniper', icon: '🎯', title: 'Keskin Nişancı', bg: 'rgba(244, 63, 94, 0.15)' });
    if (ratingCount >= 5) badges.push({ id: 'people_hero', icon: '🤝', title: 'Halk Kahramanı', bg: 'rgba(20, 184, 166, 0.15)' });
    if (physique >= 82 && pass < 65) badges.push({ id: 'gladiator', icon: '⚔️', title: 'Gladyatör (Gattuso)', bg: 'rgba(220, 38, 38, 0.15)' });

    res.json({
      matches: numMatches,
      score: overallScore > 99 ? 99 : overallScore,
      goals: realGoals,
      mvp: mvpVotes,
      badges,
      skills: {
        speed,
        shoot,
        pass,
        physique
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'İstatistikler getirilemedi.' });
  }
});

// Bilinmeyen /api adresleri JSON 404 dönsün; diğer her adres web uygulamasını açsın.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Bulunamadı.' });
});
if (hasWeb) {
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  });
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
