import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { db, tx, initDB } from './db';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';

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
  max: 10, // Limit each IP to 10 requests per windowMs
  message: { error: 'Çok fazla deneme yaptınız, lütfen 15 dakika sonra tekrar deneyin.' }
});

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

// Maçı yönetme yetkisi (takım kurma, bitirme, iptal): maçı kuran kişi ya da grubun kurucusu.
// Haftalık otomatik maçlarda maçı "kuran" grup kurucusudur.
const canManageMatch = async (matchId: string, userId: string) => {
  const row = await db.get(
    `SELECT m."creatorId", g."creatorId" AS "groupCreatorId"
     FROM "Matches" m LEFT JOIN "Groups" g ON g.id = m."groupId"
     WHERE m.id = ?`,
    [matchId]
  );
  if (!row) return { exists: false, allowed: false };
  return { exists: true, allowed: row.creatorId === userId || row.groupCreatorId === userId };
};

// ---- Haftalık maç zamanlaması ----
// Türkiye yıl boyu UTC+3; sunucu (Render) UTC çalıştığı için hesaplar sabit +3 ile yapılır.
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

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
async function ensureUpcomingMatch(groupId: string) {
  return tx(async (t) => {
    // Aynı anda iki istek gelirse aynı maç iki kez açılmasın.
    await t.run('SELECT pg_advisory_xact_lock(hashtext(?))', [groupId]);

    const g = await t.get(
      `SELECT id, name, "creatorId", "weeklyDay", "weeklyTime", "weeklyLocation", "weeklyMaxPlayers", "weeklyLockoutHours"
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
      `INSERT INTO "Matches" (id, "groupId", "creatorId", date, time, location, "maxPlayers", "matchTimestamp", "lockoutHours")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [matchId, groupId, g.creatorId, next.label, g.weeklyTime, g.weeklyLocation, maxPlayers, next.ts, g.weeklyLockoutHours ?? 3]
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
      } else {
        await t.run('INSERT INTO "Notifications" (id, "userId", message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
          randomUUID(), m.userId,
          `${g.name}: haftalık maç açıldı (${next.label}, ${g.weeklyLocation}). Geliyor musun?`,
          'MATCH_INVITE', JSON.stringify({ matchId })
        ]);
      }
    }
    return matchId;
  });
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

app.get('/', (req, res) => {
  res.send('SporArea API Çalışıyor!');
});

// Authentication Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  if (req.path === '/login' || req.path === '/register' || req.path === '/me') {
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
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
    }

    const existing = await db.get('SELECT id FROM "User" WHERE lower(email) = lower(?)', [email]);
    if (existing) {
      return res.status(400).json({ error: 'Bu e-posta zaten kullanımda.' });
    }

    const id = randomUUID();
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    await db.run('INSERT INTO "User" (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)', [id, name, email, hashedPassword, 'PLAYER']);

    const user = { id, name, email, role: 'PLAYER' };
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
      SELECT g.* FROM "Groups" g
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

    await db.run('INSERT INTO "GroupMembers" ("groupId", "userId") VALUES (?, ?) ON CONFLICT DO NOTHING', [group.id, userId]);
    res.json({ message: 'Gruba katılım başarılı!' });
  } catch (error) {
    res.status(500).json({ error: 'Gruba katılırken hata oluştu.' });
  }
});

const isGroupMember = async (groupId: string, userId: string) =>
  Boolean(await db.get('SELECT 1 FROM "GroupMembers" WHERE "groupId" = ? AND "userId" = ?', [groupId, userId]));

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
    res.json(group);
  } catch (e) {
    res.status(500).json({ error: 'Grup bilgisi alınamadı.' });
  }
});

app.get('/api/groups/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await isGroupMember(id, req.user.id))) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz.' });
    const members = await db.all(`
      SELECT u.id, u.name, u.avatar, u.position, gm."alwaysIn",
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
    if (group.creatorId !== req.user.id) return res.status(403).json({ error: 'Haftalık maçı sadece grup kurucusu ayarlayabilir.' });

    if (req.body.enabled === false) {
      await db.run(
        `UPDATE "Groups" SET "weeklyDay" = NULL, "weeklyTime" = NULL, "weeklyLocation" = NULL, "weeklyMaxPlayers" = NULL, "weeklyLockoutHours" = NULL WHERE id = ?`,
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

    await db.run(
      `UPDATE "Groups" SET "weeklyDay" = ?, "weeklyTime" = ?, "weeklyLocation" = ?, "weeklyMaxPlayers" = ?, "weeklyLockoutHours" = ? WHERE id = ?`,
      [day, time, location, maxPlayers, lockoutHours, id]
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

app.post('/api/users/:id/avatar', async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: 'Yetkisiz erişim' });
  try {
    const { id } = req.params;
    const { avatar } = req.body;
    await db.run('UPDATE "User" SET avatar = ? WHERE id = ?', [avatar, id]);
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
    const rows = await db.all(`
      SELECT u.id, u.name, u.avatar, u.position,
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
        id: u.id, name: u.name, avatar: u.avatar, position: u.position,
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
    const notifications = await db.all('SELECT * FROM "Notifications" WHERE "userId" = ? ORDER BY "createdAt" DESC LIMIT 20', [req.user.id]);
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

// MATCHES API
// Her maç kartı için: giriş yapan kişinin cevabı (myStatus) ve kadrodaki kişi sayısı.
// myStatus: ACTIVE (varım), RESERVE (varım, yedekte), MAYBE (belki), DECLINED (yokum), null (cevap yok)
const MATCH_LIST_EXTRAS = `
  COALESCE(
    (SELECT mp.status FROM "MatchPlayers" mp WHERE mp."matchId" = m.id AND mp."userId" = ?),
    (SELECT CASE r.response WHEN 'NO' THEN 'DECLINED' ELSE 'MAYBE' END
       FROM "MatchResponses" r WHERE r."matchId" = m.id AND r."userId" = ?)
  ) AS "myStatus",
  (SELECT COUNT(*) FROM "MatchPlayers" mp WHERE mp."matchId" = m.id AND mp.status = 'ACTIVE') AS "activeCount"
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
    `, [userId, userId, userId, userId]);
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
    if (!date || !time || !location || !(Number(maxPlayers) > 0)) {
      return res.status(400).json({ error: 'Tarih, saat, yer ve kontenjan gerekli.' });
    }
    if (!groupId) return res.status(400).json({ error: 'Maç bir gruba bağlı olmalı.' });
    if (!(await isGroupMember(groupId, creatorId))) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz.' });
    const id = randomUUID();

    await tx(async (t) => {
      await t.run(
        `INSERT INTO "Matches" (id, "groupId", "creatorId", date, time, location, "maxPlayers", "teamAName", "teamBName", "matchTimestamp", "lockoutHours")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, groupId, creatorId, date, time, location, Number(maxPlayers), teamAName || 'A Takımı', teamBName || 'B Takımı', Number(matchTimestamp) || 0, lockoutHours ?? 3]
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
        }
      }
    });

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
    res.json(match);
  } catch (error) {
    res.status(500).json({ error: 'Maç bilgisi alınamadı.' });
  }
});

app.delete('/api/matches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const perm = await canManageMatch(id, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Bu maçı silme yetkiniz yok.' });

    // Oyuncular, MVP oyları, mesajlar ve puanlar otomatik silinir (veritabanı kuralı).
    await db.run('DELETE FROM "Matches" WHERE id = ?', [id]);

    res.json({ message: 'Maç başarıyla iptal edildi.' });
  } catch (error) {
    res.status(500).json({ error: 'Maç iptal edilirken hata oluştu.' });
  }
});

app.get('/api/matches/:id/players', async (req, res) => {
  try {
    const { id } = req.params;
    const players: any[] = await db.all(`
      SELECT u.id, u.name, u.avatar, u.position, mp.team, mp.goals, mp.status
      FROM "MatchPlayers" mp
      JOIN "User" u ON mp."userId" = u.id
      WHERE mp."matchId" = ?
      ORDER BY mp."joinedAt" ASC
    `, [id]);

    const matchRow = await db.get('SELECT "groupId", "creatorId" FROM "Matches" WHERE id = ?', [id]);
    if (matchRow && matchRow.groupId) {
      // Gruptaki, "Varım" demeyen üyeler: verdikleri cevaba göre DECLINED (yokum), MAYBE (belki)
      // ya da hiç cevap vermediyse PENDING.
      const others = await db.all(`
        SELECT u.id, u.name, u.avatar, u.position, r.response
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

async function respondToMatch(matchId: string, userId: string, response: MatchAnswer): Promise<RespondResult> {
  return tx(async (t) => {
    // Aynı anda gelen cevaplar kontenjanı bozmasın diye maç satırını kilitliyoruz.
    const matchRow = await t.get(
      'SELECT "groupId", "creatorId", location, "maxPlayers", "matchTimestamp", "lockoutHours", status FROM "Matches" WHERE id = ? FOR UPDATE',
      [matchId]
    );
    if (!matchRow) return { status: 404, body: { error: 'Maç bulunamadı' } };
    if (matchRow.status === 'COMPLETED') return { status: 400, body: { error: 'Bu maç tamamlandı.' } };

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
        const who = await t.get('SELECT name FROM "User" WHERE id = ?', [userId]);
        await t.run('INSERT INTO "Notifications" (id, "userId", message, type) VALUES (?, ?, ?, ?)', [
          randomUUID(),
          matchRow.creatorId,
          `${who?.name || 'Bir oyuncu'} ${matchRow.location} maçına ${isReserve ? 'yedek olarak ' : ''}katıldı!`,
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

      if (current.status === 'ACTIVE') {
        const firstReserve = await t.get(`SELECT "userId" FROM "MatchPlayers" WHERE "matchId" = ? AND status = 'RESERVE' ORDER BY "joinedAt" ASC LIMIT 1`, [matchId]);
        if (firstReserve) {
          await t.run(`UPDATE "MatchPlayers" SET status = 'ACTIVE' WHERE "matchId" = ? AND "userId" = ?`, [matchId, firstReserve.userId]);
          await t.run('INSERT INTO "Notifications" (id, "userId", message, type) VALUES (?, ?, ?, ?)', [
            randomUUID(),
            firstReserve.userId,
            `Müjde! ${matchRow.location} maçında bir kişilik yer açıldı ve yedeğe alındığın listede AS KADROYA yükseldin!`,
            'INFO'
          ]);
        }
      }
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
  SELECT u.id, u.name, u.avatar, u.position
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

app.post('/api/matches/:id/finish', async (req, res) => {
  try {
    const { id } = req.params;
    const { score, scorers } = req.body;

    const perm = await canManageMatch(id, req.user.id);
    if (!perm.exists) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (!perm.allowed) return res.status(403).json({ error: 'Maçı sadece kuran kişi bitirebilir.' });

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
         SELECT gen_random_uuid()::text, "userId", ?, 'MATCH_RESULT' FROM "MatchPlayers" WHERE "matchId" = ?`,
        [`${matchRow?.location || 'Maç'} tamamlandı! İstatistiklerin işlendi. Hemen detaylara göz atabilir ve oyuncuları puanlayabilirsin.`, id]
      );
    });

    res.json({ message: 'Maç başarıyla tamamlandı.' });
  } catch (error) {
    console.error('FINISH MATCH ERROR:', error);
    res.status(500).json({ error: 'Maç bitirilirken hata oluştu.' });
  }
});

// MVP API
app.get('/api/matches/:id/mvp', async (req, res) => {
  try {
    const top = await db.get(`
      SELECT u.id, u.name, u.avatar, u.position, COUNT(*) AS "voteCount"
      FROM "MvpVotes" v JOIN "User" u ON u.id = v."votedId"
      WHERE v."matchId" = ?
      GROUP BY u.id
      ORDER BY "voteCount" DESC
      LIMIT 1
    `, [req.params.id]);
    res.json({ mvp: top ?? null });
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
