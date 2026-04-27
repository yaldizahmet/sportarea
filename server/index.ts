import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required.');
}
const BCRYPT_SALT_ROUNDS = 12;

const app = express();
app.use(cors());
app.use(express.json());

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

// Initialize Native SQLite DB
let db: any;
(async () => {
  db = await open({
    filename: path.join(__dirname, 'sports.db'),
    driver: sqlite3.Database
  });
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS User (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'PLAYER',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      inviteCode TEXT UNIQUE NOT NULL,
      creatorId TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS GroupMembers (
      groupId TEXT,
      userId TEXT,
      joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (groupId, userId)
    );

    CREATE TABLE IF NOT EXISTS Matches (
      id TEXT PRIMARY KEY,
      groupId TEXT,
      creatorId TEXT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      location TEXT NOT NULL,
      maxPlayers INTEGER NOT NULL,
      status TEXT DEFAULT 'OPEN',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

      CREATE TABLE IF NOT EXISTS MatchPlayers (
        matchId TEXT,
        userId TEXT,
        team TEXT DEFAULT 'UNASSIGNED', 
        joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (matchId, userId)
      );

      CREATE TABLE IF NOT EXISTS MatchMessages (
        id TEXT PRIMARY KEY,
        matchId TEXT,
        userId TEXT,
        message TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS Ratings (
        id TEXT PRIMARY KEY,
        matchId TEXT,
        raterId TEXT,
        ratedId TEXT,
        speed INTEGER,
        shoot INTEGER,
        pass INTEGER,
        physique INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    try {
      await db.exec(`ALTER TABLE User ADD COLUMN avatar TEXT;`);
    } catch (e) {}

    try {
      await db.exec(`ALTER TABLE User ADD COLUMN position TEXT DEFAULT 'Orta Saha';`);
    } catch (e) {}

    try {
      await db.exec(`ALTER TABLE Matches ADD COLUMN status TEXT DEFAULT 'OPEN';`);
    } catch (e) {}

    try {
      await db.exec(`ALTER TABLE Matches ADD COLUMN score TEXT;`);
    } catch (e) {}

    try {
      await db.exec(`ALTER TABLE MatchPlayers ADD COLUMN goals INTEGER DEFAULT 0;`);
    } catch (e) {}

    try {
      await db.exec(`ALTER TABLE Matches ADD COLUMN teamAName TEXT DEFAULT 'A Takımı';`);
      await db.exec(`ALTER TABLE Matches ADD COLUMN teamBName TEXT DEFAULT 'B Takımı';`);
    } catch (e) {}
    try {
      await db.exec(`ALTER TABLE Notifications ADD COLUMN metadata TEXT;`);
    } catch (e) {}

    try {
      await db.exec(`ALTER TABLE Matches ADD COLUMN matchTimestamp INTEGER;`);
      await db.exec(`ALTER TABLE Matches ADD COLUMN lockoutHours INTEGER DEFAULT 1;`);
    } catch (e) {}
    
    try {
      await db.exec(`ALTER TABLE MatchPlayers ADD COLUMN status TEXT DEFAULT 'ACTIVE';`);
    } catch (e) {}

    await db.exec(`
      CREATE TABLE IF NOT EXISTS Notifications (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'INFO',
        isRead BOOLEAN DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS MvpVotes (
        id TEXT PRIMARY KEY,
        matchId TEXT NOT NULL,
        voterId TEXT NOT NULL,
        votedId TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS GroupMessages (
        id TEXT PRIMARY KEY,
        groupId TEXT NOT NULL,
        userId TEXT NOT NULL,
        message TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS UserAvailability (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        dayOfWeek INTEGER NOT NULL,
        startTime TEXT NOT NULL,
        endTime TEXT NOT NULL,
        isActive INTEGER NOT NULL DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_user_availability_user_day
        ON UserAvailability (userId, dayOfWeek);
    `);

    console.log('Database connected and schemas initialized.');
})();

app.get('/', (req, res) => {
  res.send('SporArea API Çalışıyor!');
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Lütfen tüm alanları doldurun.' });
    }

    const existing = await db.get('SELECT * FROM User WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ error: 'Bu e-posta zaten kullanımda.' });
    }

    const id = Date.now().toString();
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    await db.run('INSERT INTO User (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)', [id, name, email, hashedPassword, 'ORGANIZER']);
    
    const user = { id, name, email, role: 'ORGANIZER' };
    const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({ message: 'Kayıt başarılı!', user, token });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ error: 'Kayıt olurken bir hata oluştu.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Lütfen E-posta ve şifrenizi girin.' });
    }

    const user = await db.get('SELECT * FROM User WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
    }

    // Backward compatibility: upgrade old plaintext passwords on successful login.
    let isPasswordValid = false;
    if (typeof user.password === 'string' && user.password.startsWith('$2')) {
      isPasswordValid = await bcrypt.compare(password, user.password);
    } else {
      isPasswordValid = user.password === password;
      if (isPasswordValid) {
        const upgradedHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        await db.run('UPDATE User SET password = ? WHERE id = ?', [upgradedHash, user.id]);
      }
    }

    if (!isPasswordValid) {
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
    const user = await db.get('SELECT * FROM User WHERE id = ?', [decoded.id]);
    
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    
    res.json({ user: toSafeUser(user) });
  } catch (err) {
    res.status(401).json({ error: 'Geçersiz token.' });
  }
});

// GROUPS API
app.get('/api/groups', async (req, res) => {
  try {
    const { userId } = req.query;
    if (userId) {
      const groups = await db.all(`
        SELECT Groups.* FROM Groups 
        JOIN GroupMembers ON Groups.id = GroupMembers.groupId 
        WHERE GroupMembers.userId = ?
      `, [userId]);
      return res.json(groups);
    }
    const groups = await db.all('SELECT * FROM Groups');
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: 'Gruplar getirilirken hata oluştu.' });
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const { creatorId, name } = req.body;
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const groupId = Date.now().toString();

    await db.run('INSERT INTO Groups (id, name, inviteCode, creatorId) VALUES (?, ?, ?, ?)', [groupId, name, inviteCode, creatorId]);
    await db.run('INSERT INTO GroupMembers (groupId, userId) VALUES (?, ?)', [groupId, creatorId]);
    
    res.status(201).json({ message: 'Grup oluşturuldu', inviteCode });
  } catch (error) {
    res.status(500).json({ error: 'Grup oluşturulamadı.' });
  }
});

app.post('/api/groups/join', async (req, res) => {
  try {
    const { userId, inviteCode } = req.body;
    const group = await db.get('SELECT id FROM Groups WHERE inviteCode = ?', [inviteCode]);
    
    if (!group) return res.status(404).json({ error: 'Geçersiz davet kodu' });

    await db.run('INSERT OR IGNORE INTO GroupMembers (groupId, userId) VALUES (?, ?)', [group.id, userId]);
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
       FROM User u
       JOIN GroupMembers gm ON u.id = gm.userId
       WHERE gm.groupId = ?
     `, [id]);
     res.json(members);
  } catch(e) {
     res.status(500).json({ error: 'Üyeler alınamadı' });
  }
});

app.get('/api/groups/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await db.all(`
      SELECT m.*, u.name as userName, u.avatar 
      FROM GroupMessages m
      JOIN User u ON m.userId = u.id
      WHERE m.groupId = ?
      ORDER BY m.createdAt ASC
    `, [id]);
    res.json(messages);
  } catch(e) {
    res.status(500).json({ error: 'Mesajlar alınamadı' });
  }
});

app.post('/api/groups/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, message } = req.body;
    await db.run('INSERT INTO GroupMessages (id, groupId, userId, message) VALUES (?, ?, ?, ?)', [
      Date.now().toString(), id, userId, message
    ]);
    res.json({ message: 'Mesaj gönderildi' });
  } catch(e) {
    res.status(500).json({ error: 'Mesaj gönderilemedi' });
  }
});

app.post('/api/users/:id/avatar', async (req, res) => {
  try {
    const { id } = req.params;
    const { avatar } = req.body;
    await db.run('UPDATE User SET avatar = ? WHERE id = ?', [avatar, id]);
    res.json({ message: 'Avatar başarıyla güncellendi!' });
  } catch (error) {
    res.status(500).json({ error: 'Avatar güncellenirken hata oluştu.' });
  }
});

app.post('/api/users/:id/position', async (req, res) => {
  try {
    const { id } = req.params;
    const { position } = req.body;
    await db.run('UPDATE User SET position = ? WHERE id = ?', [position, id]);
    res.json({ message: 'Mevki güncellendi!' });
  } catch (error) {
    res.status(500).json({ error: 'Mevki güncellenirken hata oluştu.' });
  }
});

// USER AVAILABILITY (müsaitlik) API
app.get('/api/users/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.get('SELECT id FROM User WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    const includeInactive = String(req.query.includeInactive) === '1';
    const rows = includeInactive
      ? await db.all('SELECT * FROM UserAvailability WHERE userId = ? ORDER BY dayOfWeek, startTime', [id])
      : await db.all(
          'SELECT * FROM UserAvailability WHERE userId = ? AND isActive = 1 ORDER BY dayOfWeek, startTime',
          [id]
        );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Müsaitlikler alınamadı.' });
  }
});

app.post('/api/users/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;
    const { dayOfWeek, startTime, endTime } = req.body;
    const user = await db.get('SELECT id FROM User WHERE id = ?', [id]);
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
      'INSERT INTO UserAvailability (id, userId, dayOfWeek, startTime, endTime, isActive) VALUES (?, ?, ?, ?, ?, 1)',
      [availId, id, d, String(startTime).trim(), String(endTime).trim()]
    );
    const row = await db.get('SELECT * FROM UserAvailability WHERE id = ?', [availId]);
    res.status(201).json({ message: 'Müsaitlik kaydedildi.', availability: row });
  } catch (error) {
    res.status(500).json({ error: 'Müsaitlik kaydedilemedi.' });
  }
});

app.delete('/api/users/:id/availability/:availabilityId', async (req, res) => {
  try {
    const { id, availabilityId } = req.params;
    const user = await db.get('SELECT id FROM User WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    const r = await db.run(
      'DELETE FROM UserAvailability WHERE id = ? AND userId = ?',
      [availabilityId, id]
    );
    if (r && r.changes === 0) {
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
     const users = await db.all('SELECT id, name, avatar, position FROM User');
     const results = [];
     for(const u of users) {
        const stats = await db.get('SELECT COUNT(*) as count, SUM(goals) as totalGoals FROM MatchPlayers WHERE userId = ?', [u.id]);
        const m = stats ? stats.count : 0;
        const g = (stats && stats.totalGoals) ? stats.totalGoals : 0;
        
        const ratings = await db.get('SELECT AVG(speed) as avgSpeed, AVG(shoot) as avgShoot, AVG(pass) as avgPass, AVG(physique) as avgPhysique, COUNT(*) as c FROM Ratings WHERE ratedId = ?', [u.id]);
        
        let score = 60;
        if(ratings && ratings.c > 0) {
           score = Math.round((ratings.avgSpeed + ratings.avgShoot + ratings.avgPass + ratings.avgPhysique) / 4);
        }
        score += (m > 5 ? 2 : 0) + (g > 10 ? 3 : 0);
        
        results.push({
           id: u.id, name: u.name, avatar: u.avatar, position: u.position,
           matches: m, goals: g, score: score > 99 ? 99 : score
        });
     }
     
     res.json(results);
  } catch(error) {
     res.status(500).json({error: 'Liderlik tablosu alınamadı'});
  }
});

// GROUP LEADERBOARD API
app.get('/api/leaderboard/groups', async (req, res) => {
   try {
     const { userId } = req.query;
     if(!userId) return res.status(400).json({error: 'userId is required'});

     const userGroups = await db.all('SELECT groupId FROM GroupMembers WHERE userId = ?', [userId]);
     if(userGroups.length === 0) return res.json([]);

     const groupIds = userGroups.map((g: any) => g.groupId);
     const placeholders = groupIds.map(() => '?').join(',');

     const groups = await db.all(`SELECT id, name, inviteCode FROM Groups WHERE id IN (${placeholders})`, groupIds);
     
     const results = [];
     for(const g of groups) {
       const matchCountRes = await db.get("SELECT COUNT(*) as count FROM Matches WHERE groupId = ? AND status = 'COMPLETED'", [g.id]);
       const matches = matchCountRes ? matchCountRes.count : 0;
       
       const goalCountRes = await db.get(`
         SELECT SUM(MatchPlayers.goals) as totalGoals 
         FROM MatchPlayers 
         JOIN Matches ON MatchPlayers.matchId = Matches.id 
         WHERE Matches.groupId = ? AND Matches.status = 'COMPLETED'
       `, [g.id]);
       const goals = goalCountRes && goalCountRes.totalGoals ? goalCountRes.totalGoals : 0;
       
       const score = matches * 10 + goals * 3;
       
       results.push({
         id: g.id,
         name: g.name,
         matches,
         goals,
         score
       });
     }
     
     res.json(results);
   } catch(e) {
     res.status(500).json({error: 'Liderlik tablosu alınamadı'});
   }
});

// NOTIFICATIONS API
app.get('/api/notifications', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'User ID gerekli' });
    const notifications = await db.all('SELECT * FROM Notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 20', [userId]);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Bildirimler getirilemedi' });
  }
});

app.post('/api/notifications/read', async (req, res) => {
  try {
    const { userId } = req.body;
    await db.run('UPDATE Notifications SET isRead = 1 WHERE userId = ?', [userId]);
    res.json({ message: 'Tümü okundu' });
  } catch (error) {
    res.status(500).json({ error: 'Okundu işaretlenemedi' });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.run('DELETE FROM Notifications WHERE id = ?', [id]);
    res.json({ message: 'Bildirim silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Bildirim silinemedi' });
  }
});

// MATCHES API
app.get('/api/matches', async (req, res) => {
  try {
    const { userId } = req.query;
    if (userId) {
      const matches = await db.all(`
        SELECT DISTINCT m.*, g.name as groupName 
        FROM Matches m
        LEFT JOIN Groups g ON m.groupId = g.id
        LEFT JOIN MatchPlayers mp ON m.id = mp.matchId
        LEFT JOIN GroupMembers gm ON m.groupId = gm.groupId
        WHERE mp.userId = ? OR gm.userId = ? OR m.groupId IS NULL
      `, [userId, userId]);
      return res.json(matches);
    }
    const matches = await db.all('SELECT Matches.*, Groups.name as groupName FROM Matches LEFT JOIN Groups ON Matches.groupId = Groups.id');
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: 'Maçlar getirilirken hata oluştu.' });
  }
});

app.post('/api/matches', async (req, res) => {
  try {
    const { groupId, creatorId, date, time, location, maxPlayers, teamAName, teamBName, matchTimestamp, lockoutHours } = req.body;
    const id = Date.now().toString();
    
    await db.run(
      'INSERT INTO Matches (id, groupId, creatorId, date, time, location, maxPlayers, teamAName, teamBName, matchTimestamp, lockoutHours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
      [id, groupId || null, creatorId, date, time, location, maxPlayers, teamAName || 'A Takımı', teamBName || 'B Takımı', matchTimestamp || 0, lockoutHours || 1]
    );

    if (creatorId) {
      await db.run('INSERT INTO MatchPlayers (matchId, userId) VALUES (?, ?)', [id, creatorId]);
    }
    
    if (groupId) {
      const groupData = await db.get('SELECT name FROM Groups WHERE id = ?', [groupId]);
      const members = await db.all('SELECT userId FROM GroupMembers WHERE groupId = ? AND userId != ?', [groupId, creatorId || '']);
      for (const m of members) {
         await db.run('INSERT INTO Notifications (id, userId, message, type, metadata) VALUES (?, ?, ?, ?, ?)', [
           Date.now().toString() + Math.random(),
           m.userId,
           `${groupData?.name || 'Bir grup'} grubuna yeni bir maç daveti geldi! Kabul ediyor musun?`,
           'MATCH_INVITE',
           JSON.stringify({ matchId: id })
         ]);
      }
    }

    res.json({ message: 'Maç oluşturuldu', match: { id, date, time, location, maxPlayers } });
  } catch (error) {
    res.status(500).json({ error: 'Maç oluşturulurken hata oluştu.' });
  }
});

// Must be before /api/matches/:id/players so "suggested-players" is not captured as :id
app.get('/api/matches/:id/suggested-players', async (req, res) => {
  try {
    const { id: matchId } = req.params;
    const match = await db.get('SELECT * FROM Matches WHERE id = ?', [matchId]);
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
       FROM User u
       JOIN GroupMembers gm ON u.id = gm.userId
       WHERE gm.groupId = ?`,
      [match.groupId]
    );
    const inMatchRows = await db.all('SELECT userId FROM MatchPlayers WHERE matchId = ?', [matchId]);
    const inMatchSet = new Set(inMatchRows.map((r: { userId: string }) => r.userId));

    const lastCompleted = await db.all(
      `SELECT id FROM Matches
       WHERE groupId = ? AND status = 'COMPLETED'
       ORDER BY COALESCE(matchTimestamp, 0) DESC, createdAt DESC
       LIMIT 2`,
      [match.groupId]
    );
    const lastMatchIds = lastCompleted.map((r: { id: string }) => r.id);
    const idPlaceholders = lastMatchIds.length > 0 ? lastMatchIds.map(() => '?').join(',') : '';

    const suggested: { id: any; name: any; avatar: any; position: any; playedRecentGroupMatch: boolean }[] = [];
    const notInSlot: { id: any; name: any; avatar: any; position: any }[] = [];

    for (const u of members) {
      if (inMatchSet.has(u.id)) continue;
      const rows = await db.all(
        'SELECT * FROM UserAvailability WHERE userId = ? AND dayOfWeek = ? AND isActive = 1',
        [u.id, dayOfWeek]
      );
      const inSlot = rows.some((row: { startTime: string; endTime: string }) =>
        isMinutesInWindow(matchMinutes, row.startTime, row.endTime)
      );

      let playedRecentGroupMatch = false;
      if (idPlaceholders) {
        const c = await db.get(
          `SELECT COUNT(*) as c FROM MatchPlayers WHERE userId = ? AND matchId IN (${idPlaceholders})`,
          [u.id, ...lastMatchIds]
        );
        playedRecentGroupMatch = Boolean(c && Number(c.c) > 0);
      }

      if (inSlot) {
        suggested.push({ ...u, playedRecentGroupMatch });
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

app.get('/api/matches/:id/players', async (req, res) => {
   try {
     const { id } = req.params;
     const players = await db.all(`
        SELECT User.id, User.name, User.avatar, User.role as position, MatchPlayers.team, MatchPlayers.goals, MatchPlayers.status 
        FROM MatchPlayers 
        JOIN User ON MatchPlayers.userId = User.id 
        WHERE MatchPlayers.matchId = ?
      `, [id]);
      
      const matchRow = await db.get('SELECT groupId, creatorId FROM Matches WHERE id = ?', [id]);
      if (matchRow && matchRow.groupId) {
         const groupMembers = await db.all(`
            SELECT User.id, User.name, User.avatar, User.role as position 
            FROM GroupMembers 
            JOIN User ON GroupMembers.userId = User.id 
            WHERE GroupMembers.groupId = ?
         `, [matchRow.groupId]);
         
         const allNotifications = await db.all("SELECT userId, metadata FROM Notifications WHERE type = 'MATCH_INVITE'");
         
         for (const gm of groupMembers) {
            const hasJoined = players.some((p: any) => p.id === gm.id);
            if (!hasJoined && gm.id !== matchRow.creatorId) {
               // Check if they have a notification pending
               const hasNotification = allNotifications.some((n: any) => {
                  if (n.userId !== gm.id) return false;
                  try {
                     const meta = JSON.parse(n.metadata);
                     return meta.matchId === id;
                  } catch(e) { return false; }
               });
               
               players.push({
                 id: gm.id,
                 name: gm.name,
                 avatar: gm.avatar,
                 position: gm.position,
                 team: 'NONE',
                 goals: 0,
                 status: hasNotification ? 'PENDING' : 'DECLINED'
               });
            }
         }
      }
      
      res.json(players);
   } catch (error) {
    res.status(500).json({ error: 'Oyuncular getirilirken hata oluştu.' });
  }
});

app.post('/api/matches/:id/join', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    
    const matchRow = await db.get('SELECT creatorId, location, maxPlayers, matchTimestamp, lockoutHours FROM Matches WHERE id = ?', [id]);
    if (!matchRow) return res.status(404).json({error: 'Maç bulunamadı'});

    if (matchRow.matchTimestamp > 0 && matchRow.lockoutHours !== null) {
       const lockoutMs = matchRow.lockoutHours * 60 * 60 * 1000;
       if (Date.now() > (matchRow.matchTimestamp - lockoutMs)) {
         return res.status(403).json({ error: `Bu maç için değişiklik süresi dolmuştur (Maça son ${matchRow.lockoutHours} saat kala kilitlendi).` });
       }
    }

    const activeCount = await db.get("SELECT COUNT(*) as c FROM MatchPlayers WHERE matchId = ? AND status = 'ACTIVE'", [id]);
    const isReserve = activeCount.c >= matchRow.maxPlayers;
    const playerStatus = isReserve ? 'RESERVE' : 'ACTIVE';

    await db.run('INSERT OR IGNORE INTO MatchPlayers (matchId, userId, status) VALUES (?, ?, ?)', [id, userId, playerStatus]);
    
    res.json({ message: isReserve ? 'Kadro doluydu, yedeğe alındınız.' : 'Maça katılım başarılı!' });
    
    // Bildirim
    if (matchRow.creatorId && matchRow.creatorId !== userId) {
       await db.run('INSERT INTO Notifications (id, userId, message, type) VALUES (?, ?, ?, ?)', [
         Date.now().toString() + Math.random(),
         matchRow.creatorId,
         `Bir oyuncu ${matchRow.location} maçına ${isReserve ? 'yedek olarak ' : ''}katıldı!`,
         'JOIN'
       ]);
    }

  } catch (error) {
    res.status(500).json({ error: 'Maça katılırken hata oluştu.' });
  }
});

app.post('/api/matches/:id/leave', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const matchRow = await db.get('SELECT matchTimestamp, lockoutHours, location FROM Matches WHERE id = ?', [id]);
    if (!matchRow) return res.status(404).json({error: 'Maç bulunamadı'});
    
    if (matchRow.matchTimestamp > 0 && matchRow.lockoutHours !== null) {
       const lockoutMs = matchRow.lockoutHours * 60 * 60 * 1000;
       if (Date.now() > (matchRow.matchTimestamp - lockoutMs)) {
         return res.status(403).json({ error: `İptal süresi doldu! Maça son ${matchRow.lockoutHours} saat kala kadrodan çıkış yapılamaz.` });
       }
    }
    
    const leavingPlayer = await db.get('SELECT status FROM MatchPlayers WHERE matchId = ? AND userId = ?', [id, userId]);
    await db.run('DELETE FROM MatchPlayers WHERE matchId = ? AND userId = ?', [id, userId]);
    
    if (leavingPlayer && leavingPlayer.status === 'ACTIVE') {
      const firstReserve = await db.get("SELECT userId FROM MatchPlayers WHERE matchId = ? AND status = 'RESERVE' ORDER BY joinedAt ASC LIMIT 1", [id]);
      if (firstReserve) {
         await db.run("UPDATE MatchPlayers SET status = 'ACTIVE' WHERE matchId = ? AND userId = ?", [id, firstReserve.userId]);
         
         await db.run('INSERT INTO Notifications (id, userId, message, type) VALUES (?, ?, ?, ?)', [
           Date.now().toString() + Math.random(),
           firstReserve.userId,
           `Müjde! ${matchRow?.location} maçında bir kişilik yer açıldı ve yedeğe alındığın listede AS KADROYA yükseldin!`,
           'INFO'
         ]);
      }
    }

    res.json({ message: 'Maçtan çıkıldı.' });
  } catch (error) {
    res.status(500).json({ error: 'Maçtan çıkarken hata oluştu.' });
  }
});

app.post('/api/matches/:id/divide', async (req, res) => {
  try {
    const { id } = req.params;
    const players = await db.all(`
      SELECT User.id, User.position
      FROM MatchPlayers 
      JOIN User ON MatchPlayers.userId = User.id 
      WHERE MatchPlayers.matchId = ? AND MatchPlayers.status = 'ACTIVE'
    `, [id]);

    if(players.length < 2) return res.status(400).json({ error: 'Takım kurmak için yeterli oyuncu yok.' });

    // Her oyuncunun overall rating'ini hesapla
    for (const p of players) {
       const ratings = await db.get('SELECT AVG(speed) as s, AVG(shoot) as sh, AVG(pass) as pa, AVG(physique) as ph FROM Ratings WHERE ratedId = ?', [p.id]);
       p.overall = 65; // default average
       if (ratings && ratings.s !== null) {
          p.overall = (ratings.s + ratings.sh + ratings.pa + ratings.ph) / 4;
       }
    }

    // Mevkilere ayırıp yeteneğe göre büyükten küçüğe sırala
    const goalkeepers = players.filter((p: any) => (p.position || '').toLowerCase().includes('kaleci')).sort((a: any,b: any) => b.overall - a.overall);
    const others = players.filter((p: any) => !(p.position || '').toLowerCase().includes('kaleci')).sort((a: any,b: any) => b.overall - a.overall);

    const teamA: any[] = [];
    const teamB: any[] = [];
    let sumA = 0;
    let sumB = 0;

    const assignToTeam = (p: any, forceBalance = false) => {
       if (teamA.length === teamB.length) {
          if (sumA <= sumB) { teamA.push(p); sumA += p.overall; }
          else { teamB.push(p); sumB += p.overall; }
       } else if (teamA.length < teamB.length) {
          teamA.push(p); sumA += p.overall;
       } else {
          teamB.push(p); sumB += p.overall;
       }
    };

    // Önce kalecileri akıllı dağıt
    goalkeepers.forEach((p: any) => assignToTeam(p));
    // Sonra kalanları dağıt
    others.forEach((p: any) => assignToTeam(p));

    await db.run('UPDATE MatchPlayers SET team = "UNASSIGNED" WHERE matchId = ?', [id]);
    
    for (const p of teamA) await db.run('UPDATE MatchPlayers SET team = "A" WHERE matchId = ? AND userId = ?', [id, p.id]);
    for (const p of teamB) await db.run('UPDATE MatchPlayers SET team = "B" WHERE matchId = ? AND userId = ?', [id, p.id]);

    res.json({ 
       message: 'Takımlar zekice kalibre edildi!', 
       stats: { teamA_overall: Math.round(sumA/teamA.length), teamB_overall: Math.round(sumB/teamB.length) }
    });
  } catch (error) {
    res.status(500).json({ error: 'Bölme hatası' });
  }
});

app.post('/api/matches/:id/finish', async (req, res) => {
  try {
    const { id } = req.params;
    const { score, playerGoals } = req.body; // playerGoals: { [userId]: number }
    
    await db.run("UPDATE Matches SET status = 'COMPLETED', score = ? WHERE id = ?", [score, id]);
    
    if (playerGoals) {
      for (const [userId, goals] of Object.entries(playerGoals)) {
         if ((goals as number) > 0) {
            await db.run("UPDATE MatchPlayers SET goals = ? WHERE matchId = ? AND userId = ?", [goals, id, userId]);
         }
      }
    }
    
    const players = await db.all('SELECT userId FROM MatchPlayers WHERE matchId = ?', [id]);
    const matchRow = await db.get('SELECT location FROM Matches WHERE id = ?', [id]);
    for(const p of players) {
       await db.run('INSERT INTO Notifications (id, userId, message, type) VALUES (?, ?, ?, ?)', [
         Date.now().toString() + Math.random(),
         p.userId,
         `${matchRow?.location || 'Maç'} tamamlandı! İstatistiklerin işlendi. Hemen detaylara göz atabilir ve oyuncuları puanlayabilirsin.`,
         'MATCH_RESULT'
       ]);
    }
    
    res.json({ message: 'Maç başarıyla tamamlandı.' });
  } catch (error) {
    res.status(500).json({ error: 'Maç bitirilirken hata oluştu.' });
  }
});

// MVP API
app.get('/api/matches/:id/mvp', async (req, res) => {
  try {
    const { id } = req.params;
    const votes = await db.all('SELECT voterId, votedId FROM MvpVotes WHERE matchId = ?', [id]);
    res.json(votes);
  } catch (error) {
    res.status(500).json({ error: 'MVP oyları alınamadı.' });
  }
});

app.post('/api/matches/:id/mvp', async (req, res) => {
  try {
    const { id } = req.params;
    const { voterId, votedId } = req.body;
    
    // Check if ALREADY voted
    const existing = await db.get('SELECT id FROM MvpVotes WHERE matchId = ? AND voterId = ?', [id, voterId]);
    if (existing) {
       return res.status(400).json({ error: 'Zaten MVP oyu kullandınız!' });
    }
    
    const voteId = Date.now().toString() + Math.random().toString().slice(2, 5);
    await db.run('INSERT INTO MvpVotes (id, matchId, voterId, votedId) VALUES (?, ?, ?, ?)', [voteId, id, voterId, votedId]);
    res.json({ message: 'MVP oyunuz kaydedildi!' });
  } catch (error) {
    res.status(500).json({ error: 'MVP oyu kaydedilemedi.' });
  }
});

// CHAT API
app.get('/api/matches/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await db.all(`
      SELECT MatchMessages.id, MatchMessages.message, MatchMessages.createdAt, User.name, User.avatar
      FROM MatchMessages
      JOIN User ON MatchMessages.userId = User.id
      WHERE MatchMessages.matchId = ?
      ORDER BY MatchMessages.createdAt ASC
    `, [id]);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Mesajlar alınamadı.' });
  }
});

app.post('/api/matches/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, message } = req.body;
    const msgId = Date.now().toString();
    await db.run('INSERT INTO MatchMessages (id, matchId, userId, message) VALUES (?, ?, ?, ?)', [msgId, id, userId, message]);
    res.json({ message: 'Mesaj gönderildi' });
  } catch (error) {
    res.status(500).json({ error: 'Mesaj gönderilemedi.' });
  }
});

// RATINGS API
app.post('/api/matches/:id/rate', async (req, res) => {
  try {
    const { id } = req.params;
    const { raterId, ratedId, speed, shoot, pass, physique } = req.body;
    
    // Prevent self-rating just in case
    if(raterId === ratedId) return res.status(400).json({ error: 'Kendinizi puanlayamazsınız.' });

    const ratingId = Date.now().toString();
    await db.run(`
      INSERT INTO Ratings (id, matchId, raterId, ratedId, speed, shoot, pass, physique)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [ratingId, id, raterId, ratedId, speed, shoot, pass, physique]);

    res.json({ message: 'Puan basariyla kaydedildi!' });
  } catch (error) {
    res.status(500).json({ error: 'Puan kaydedilirken hata.' });
  }
});

app.post('/api/matches/:id/finish', async (req, res) => {
   try {
     const { id } = req.params;
     const { score, scorers } = req.body || {};
     await db.run('UPDATE Matches SET status = "COMPLETED", score = ? WHERE id = ?', [score || null, id]);
     
     if (Array.isArray(scorers)) {
        for (const s of scorers) {
           if (s.goals > 0) {
              await db.run('UPDATE MatchPlayers SET goals = ? WHERE matchId = ? AND userId = ?', [s.goals, id, s.userId]);
           }
        }
     }

     // Bildirim at
     const players = await db.all('SELECT userId FROM MatchPlayers WHERE matchId = ?', [id]);
     const msg = `Oynadığınız maç tamamlandı. Skor: ${score}. Puanlama yapabilirsiniz!`;
     for (const p of players) {
        await db.run('INSERT INTO Notifications (id, userId, message, type) VALUES (?, ?, ?, "MATCH_RESULT")', [Date.now().toString() + Math.random(), p.userId, msg]);
     }

     res.json({ message: 'Maç tamamlandı olarak işaretlendi!' });
   } catch (error) {
     res.status(500).json({ error: 'Hata' });
   }
});

app.get('/api/users/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const matchesCount = await db.get('SELECT COUNT(*) as count FROM MatchPlayers WHERE userId = ?', [id]);
    const numMatches = matchesCount ? matchesCount.count : 0;
    
    // Fetch average ratings from the database!
    const ratings = await db.get(`
      SELECT 
        AVG(speed) as avgSpeed, 
        AVG(shoot) as avgShoot, 
        AVG(pass) as avgPass, 
        AVG(physique) as avgPhysique,
        COUNT(*) as ratingCount
      FROM Ratings WHERE ratedId = ?
    `, [id]);

    // Initial defaults if nobody has rated this player yet
    const hasRatings = ratings && ratings.ratingCount > 0;
    
    // Fetch real goals
    const goalsQuery = await db.get('SELECT SUM(goals) as totalGoals FROM MatchPlayers WHERE userId = ?', [id]);
    const realGoals = goalsQuery && goalsQuery.totalGoals ? goalsQuery.totalGoals : 0;
    
    // Fetch MVP votes
    const mvpQuery = await db.get('SELECT COUNT(*) as c FROM MvpVotes WHERE votedId = ?', [id]);
    const mvpVotes = mvpQuery && mvpQuery.c ? mvpQuery.c : 0;
    
    const speed = hasRatings ? Math.round(ratings.avgSpeed) : 60;
    const shoot = hasRatings ? Math.round(ratings.avgShoot) : 60;
    const pass = hasRatings ? Math.round(ratings.avgPass) : 60;
    const physique = hasRatings ? Math.round(ratings.avgPhysique) : 60;
    const overallScore = Math.round((speed + shoot + pass + physique) / 4) + (numMatches > 5 ? 2 : 0) + (realGoals > 10 ? 3 : 0);
    
    // Generate profile badges dynamically
    const badges = [];
    if (realGoals >= 5) badges.push({ id: 'top_scorer', icon: '⚽', title: 'Gol Makinesi', bg: 'rgba(0, 230, 118, 0.15)' });
    if (numMatches >= 10) badges.push({ id: 'veteran', icon: '🌟', title: 'Müdavim', bg: 'rgba(56, 189, 248, 0.15)' });
    if (mvpVotes > 0) badges.push({ id: 'mvp', icon: '🏆', title: 'Yıldız Oyuncu', bg: 'rgba(255, 193, 7, 0.15)' });
    if (overallScore >= 75) badges.push({ id: 'pro', icon: '🔥', title: 'Pro Kariyer', bg: 'rgba(239, 68, 68, 0.15)' });

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

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
