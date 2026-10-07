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
app.use(express.json());

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

const timeToMinutes = (t: string): number | null => {
  if (typeof t !== 'string' || !t.trim()) return null;
  const p = t.trim().split(':');
  const h = parseInt(p[0] ?? '0', 10);
  const m = parseInt((p[1] ?? '0').replace(/\D.*/, '').slice(0, 2) || '0', 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

const isMinutesInWindow = (matchMin: number, start: string, end: string): boolean => {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null) return false;
  if (s <= e) {
    return matchMin >= s && matchMin <= e;
  }
  return matchMin >= s || matchMin <= e;
};

const matchDayAndMinutesFromRow = (match: any): { dayOfWeek: number; matchMinutes: number } | null => {
  let dayOfWeek: number;
  if (match.matchTimestamp && Number(match.matchTimestamp) > 0) {
    const d = new Date(Number(match.matchTimestamp));
    if (Number.isNaN(d.getTime())) return null;
    dayOfWeek = d.getDay();
  } else {
    const d = new Date(String(match.date));
    if (Number.isNaN(d.getTime())) return null;
    dayOfWeek = d.getDay();
  }
  const matchMinutes = timeToMinutes(String(match.time ?? '12:00'));
  if (matchMinutes === null) return null;
  return { dayOfWeek, matchMinutes };
};

const isLockedOut = (match: any) => {
  if (!(Number(match.matchTimestamp) > 0) || match.lockoutHours === null) return false;
  const lockoutMs = match.lockoutHours * 60 * 60 * 1000;
  return Date.now() > Number(match.matchTimestamp) - lockoutMs;
};

// Maçı yönetme yetkisi: maçı kuran kişi ya da ORGANIZER rolündeki kullanıcı
// (mobil arayüzdeki kuralın aynısı).
const canManageMatch = async (matchId: string, userId: string) => {
  const row = await db.get(
    `SELECT m."creatorId", u.role FROM "Matches" m LEFT JOIN "User" u ON u.id = ? WHERE m.id = ?`,
    [userId, matchId]
  );
  if (!row) return { exists: false, allowed: false };
  return { exists: true, allowed: row.creatorId === userId || row.role === 'ORGANIZER' };
};

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

app.get('/api/groups/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const members = await db.all(`
      SELECT u.id, u.name, u.avatar, u.position
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

app.get('/api/groups/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await db.all(`
      SELECT m.*, u.name as "userName", u.avatar
      FROM "GroupMessages" m
      JOIN "User" u ON m."userId" = u.id
      WHERE m."groupId" = ?
      ORDER BY m."createdAt" ASC
    `, [id]);
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: 'Mesajlar alınamadı' });
  }
});

app.post('/api/groups/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const message = String(req.body.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'Mesaj boş olamaz.' });
    await db.run('INSERT INTO "GroupMessages" (id, "groupId", "userId", message) VALUES (?, ?, ?, ?)', [
      randomUUID(), id, req.user.id, message
    ]);
    res.json({ message: 'Mesaj gönderildi' });
  } catch (e) {
    res.status(500).json({ error: 'Mesaj gönderilemedi' });
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

// USER AVAILABILITY (müsaitlik) API
app.get('/api/users/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.get('SELECT id FROM "User" WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    const includeInactive = String(req.query.includeInactive) === '1';
    const rows = includeInactive
      ? await db.all('SELECT * FROM "UserAvailability" WHERE "userId" = ? ORDER BY "dayOfWeek", "startTime"', [id])
      : await db.all(
          'SELECT * FROM "UserAvailability" WHERE "userId" = ? AND "isActive" = 1 ORDER BY "dayOfWeek", "startTime"',
          [id]
        );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Müsaitlikler alınamadı.' });
  }
});

app.post('/api/users/:id/availability', async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: 'Yetkisiz erişim' });
  try {
    const { id } = req.params;
    const { dayOfWeek, startTime, endTime } = req.body;
    const user = await db.get('SELECT id FROM "User" WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    if (
      dayOfWeek === undefined ||
      dayOfWeek === null ||
      startTime == null ||
      endTime == null
    ) {
      return res.status(400).json({ error: 'dayOfWeek, startTime ve endTime gerekli.' });
    }
    const d = Number(dayOfWeek);
    if (!Number.isInteger(d) || d < 0 || d > 6) {
      return res.status(400).json({ error: 'dayOfWeek 0 (Pazar) ile 6 (Cumartesi) arası olmalı.' });
    }
    if (timeToMinutes(String(startTime)) === null || timeToMinutes(String(endTime)) === null) {
      return res.status(400).json({ error: 'startTime ve endTime HH:mm formatında olmalı.' });
    }
    const availId = randomUUID();
    await db.run(
      'INSERT INTO "UserAvailability" (id, "userId", "dayOfWeek", "startTime", "endTime", "isActive") VALUES (?, ?, ?, ?, ?, 1)',
      [availId, id, d, String(startTime).trim(), String(endTime).trim()]
    );
    const row = await db.get('SELECT * FROM "UserAvailability" WHERE id = ?', [availId]);
    res.status(201).json({ message: 'Müsaitlik kaydedildi.', availability: row });
  } catch (error) {
    res.status(500).json({ error: 'Müsaitlik kaydedilemedi.' });
  }
});

app.delete('/api/users/:id/availability/:availabilityId', async (req, res) => {
  if (req.params.id !== req.user.id) return res.status(403).json({ error: 'Yetkisiz erişim' });
  try {
    const { id, availabilityId } = req.params;
    const r = await db.run(
      'DELETE FROM "UserAvailability" WHERE id = ? AND "userId" = ?',
      [availabilityId, id]
    );
    if (r.changes === 0) {
      return res.status(404).json({ error: 'Kayıt bulunamadı.' });
    }
    res.json({ message: 'Müsaitlik silindi.' });
  } catch (error) {
    res.status(500).json({ error: 'Müsaitlik silinemedi.' });
  }
});

// LEADERBOARD API
app.get('/api/leaderboard', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT u.id, u.name, u.avatar, u.position,
             COALESCE(mp.matches, 0) AS matches,
             COALESCE(mp.goals, 0) AS goals,
             r.avg_all, COALESCE(r.c, 0) AS rating_count
      FROM "User" u
      LEFT JOIN (
        SELECT "userId", COUNT(*) AS matches, SUM(goals) AS goals
        FROM "MatchPlayers" GROUP BY "userId"
      ) mp ON mp."userId" = u.id
      LEFT JOIN (
        SELECT "ratedId", (AVG(speed) + AVG(shoot) + AVG(pass) + AVG(physique)) / 4 AS avg_all, COUNT(*) AS c
        FROM "Ratings" GROUP BY "ratedId"
      ) r ON r."ratedId" = u.id
    `);

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

app.get('/api/matches', async (req, res) => {
  try {
    const userId = req.user.id;
    if (req.query.type === 'public') {
      const matches = await db.all(`
        SELECT m.*, NULL AS "groupName", ${MATCH_LIST_EXTRAS}
        FROM "Matches" m
        WHERE m."groupId" IS NULL
        ORDER BY m."matchTimestamp" ASC
      `, [userId, userId]);
      return res.json(matches);
    }

    const onlyMine = req.query.type === 'my';
    const matches = await db.all(`
      SELECT m.*, g.name AS "groupName", ${MATCH_LIST_EXTRAS}
      FROM "Matches" m
      LEFT JOIN "Groups" g ON m."groupId" = g.id
      WHERE EXISTS (SELECT 1 FROM "MatchPlayers" mp WHERE mp."matchId" = m.id AND mp."userId" = ?)
         OR EXISTS (SELECT 1 FROM "GroupMembers" gm WHERE gm."groupId" = m."groupId" AND gm."userId" = ?)
         ${onlyMine ? '' : 'OR m."groupId" IS NULL'}
      ORDER BY m."matchTimestamp" ASC
    `, [userId, userId, userId, userId]);
    res.json(matches);
  } catch (error) {
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
    if (groupId) {
      const member = await db.get('SELECT 1 FROM "GroupMembers" WHERE "groupId" = ? AND "userId" = ?', [groupId, creatorId]);
      if (!member) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz.' });
    }
    const id = randomUUID();

    await tx(async (t) => {
      await t.run(
        `INSERT INTO "Matches" (id, "groupId", "creatorId", date, time, location, "maxPlayers", "teamAName", "teamBName", "matchTimestamp", "lockoutHours")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, groupId || null, creatorId, date, time, location, Number(maxPlayers), teamAName || 'A Takımı', teamBName || 'B Takımı', Number(matchTimestamp) || 0, lockoutHours ?? 1]
      );

      await t.run('INSERT INTO "MatchPlayers" ("matchId", "userId") VALUES (?, ?)', [id, creatorId]);

      if (groupId) {
        const groupData = await t.get('SELECT name FROM "Groups" WHERE id = ?', [groupId]);
        const members = await t.all('SELECT "userId" FROM "GroupMembers" WHERE "groupId" = ? AND "userId" <> ?', [groupId, creatorId]);
        for (const m of members) {
          await t.run('INSERT INTO "Notifications" (id, "userId", message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
            randomUUID(),
            m.userId,
            `${groupData?.name || 'Bir grup'} grubuna yeni bir maç daveti geldi! Kabul ediyor musun?`,
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

// Must be before /api/matches/:id/players so "suggested-players" is not captured as :id
app.get('/api/matches/:id/suggested-players', async (req, res) => {
  try {
    const { id: matchId } = req.params;
    const match = await db.get('SELECT * FROM "Matches" WHERE id = ?', [matchId]);
    if (!match) {
      return res.status(404).json({ error: 'Maç bulunamadı.' });
    }
    if (!match.groupId) {
      return res.json({
        message: 'Grupsuz maçlarda grup üyeliği tabanı olmadığından öneri listelenmez.',
        dayOfWeek: null,
        matchMinutes: null,
        suggested: [],
        notInSlot: []
      });
    }
    const slot = matchDayAndMinutesFromRow(match);
    if (!slot) {
      return res.status(400).json({ error: 'Maç tarihi veya saat bilgisi okunamadı. date/time veya matchTimestamp girin.' });
    }
    const { dayOfWeek, matchMinutes } = slot;

    const members = await db.all(
      `SELECT u.id, u.name, u.avatar, u.position
       FROM "User" u
       JOIN "GroupMembers" gm ON u.id = gm."userId"
       WHERE gm."groupId" = ?
         AND NOT EXISTS (SELECT 1 FROM "MatchPlayers" mp WHERE mp."matchId" = ? AND mp."userId" = u.id)`,
      [match.groupId, matchId]
    );

    const availability = await db.all(
      `SELECT ua."userId", ua."startTime", ua."endTime"
       FROM "UserAvailability" ua
       JOIN "GroupMembers" gm ON gm."userId" = ua."userId" AND gm."groupId" = ?
       WHERE ua."dayOfWeek" = ? AND ua."isActive" = 1`,
      [match.groupId, dayOfWeek]
    );

    const recentPlayers = await db.all(
      `SELECT DISTINCT mp."userId" FROM "MatchPlayers" mp
       WHERE mp."matchId" IN (
         SELECT id FROM "Matches"
         WHERE "groupId" = ? AND status = 'COMPLETED'
         ORDER BY COALESCE("matchTimestamp", 0) DESC, "createdAt" DESC
         LIMIT 2
       )`,
      [match.groupId]
    );
    const recentSet = new Set(recentPlayers.map((r: any) => r.userId));

    const suggested: { id: any; name: any; avatar: any; position: any; playedRecentGroupMatch: boolean }[] = [];
    const notInSlot: { id: any; name: any; avatar: any; position: any }[] = [];

    for (const u of members) {
      const inSlot = availability.some((row: any) =>
        row.userId === u.id && isMinutesInWindow(matchMinutes, row.startTime, row.endTime)
      );
      if (inSlot) {
        suggested.push({ ...u, playedRecentGroupMatch: recentSet.has(u.id) });
      } else {
        notInSlot.push(u);
      }
    }

    suggested.sort((a, b) => {
      if (a.playedRecentGroupMatch !== b.playedRecentGroupMatch) {
        return a.playedRecentGroupMatch ? 1 : -1;
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'tr', { sensitivity: 'base' });
    });

    res.json({
      dayOfWeek,
      matchMinutes,
      suggested,
      notInSlot
    });
  } catch (error) {
    res.status(500).json({ error: 'Öneri listesi alınamadı.' });
  }
});

app.get('/api/matches/:id', async (req, res) => {
  try {
    const match = await db.get('SELECT * FROM "Matches" WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: 'Maç bulunamadı.' });
    res.json(match);
  } catch (error) {
    res.status(500).json({ error: 'Maç bilgisi alınamadı.' });
  }
});

app.delete('/api/matches/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const match = await db.get('SELECT "creatorId" FROM "Matches" WHERE id = ?', [id]);
    if (!match) return res.status(404).json({ error: 'Maç bulunamadı.' });
    if (match.creatorId !== req.user.id) return res.status(403).json({ error: 'Bu maçı silme yetkiniz yok.' });

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

// CHAT API
app.get('/api/matches/:id/messages', async (req, res) => {
  try {
    const messages = await db.all(`
      SELECT mm.id, mm.message, mm."createdAt", u.name, u.avatar
      FROM "MatchMessages" mm
      JOIN "User" u ON mm."userId" = u.id
      WHERE mm."matchId" = ?
      ORDER BY mm."createdAt" ASC
    `, [req.params.id]);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Mesajlar alınamadı.' });
  }
});

app.post('/api/matches/:id/messages', async (req, res) => {
  try {
    const message = String(req.body.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'Mesaj boş olamaz.' });
    await db.run('INSERT INTO "MatchMessages" (id, "matchId", "userId", message) VALUES (?, ?, ?, ?)', [randomUUID(), req.params.id, req.user.id, message]);
    res.json({ message: 'Mesaj gönderildi' });
  } catch (error) {
    res.status(500).json({ error: 'Mesaj gönderilemedi.' });
  }
});

// RATINGS API
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
        (SELECT COUNT(*) FROM "MatchPlayers" WHERE "userId" = ?) AS matches,
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
