import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-sporarea-2026';

const app = express();
app.use(cors());
app.use(express.json());

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
    await db.run('INSERT INTO User (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)', [id, name, email, password, 'ORGANIZER']);
    
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
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ message: 'Giriş başarılı!', user, token });
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
    
    res.json({ user });
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
    const { name, creatorId } = req.body;
    const id = Date.now().toString();
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    await db.run('INSERT INTO Groups (id, name, inviteCode, creatorId) VALUES (?, ?, ?, ?)', [id, name, inviteCode, creatorId]);
    await db.run('INSERT INTO GroupMembers (groupId, userId) VALUES (?, ?)', [id, creatorId]);
    
    res.json({ message: 'Grup oluşturuldu', group: { id, name, inviteCode } });
  } catch (error) {
    res.status(500).json({ error: 'Grup oluşturulurken hata oluştu.' });
  }
});

app.post('/api/groups/join', async (req, res) => {
  try {
    const { inviteCode, userId } = req.body;
    const group = await db.get('SELECT * FROM Groups WHERE inviteCode = ?', [inviteCode]);
    if (!group) return res.status(404).json({ error: 'Geçersiz davet kodu.' });

    await db.run('INSERT OR IGNORE INTO GroupMembers (groupId, userId) VALUES (?, ?)', [group.id, userId]);
    res.json({ message: 'Gruba katılım başarılı!', group });
  } catch (error) {
    res.status(500).json({ error: 'Gruba katılırken hata oluştu.' });
  }
});

app.get('/api/groups/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const members = await db.all(`
      SELECT User.id, User.name, 
             (SELECT COUNT(*) FROM MatchPlayers WHERE MatchPlayers.userId = User.id) as matches
      FROM GroupMembers
      JOIN User ON GroupMembers.userId = User.id
      WHERE GroupMembers.groupId = ?
    `, [id]);
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: 'Grup üyeleri getirilirken hata oluştu.' });
  }
});

// MATCHES API
app.get('/api/matches', async (req, res) => {
  try {
    const matches = await db.all('SELECT * FROM Matches');
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: 'Maçlar getirilirken hata oluştu.' });
  }
});

app.post('/api/matches', async (req, res) => {
  try {
    const { groupId, creatorId, date, time, location, maxPlayers } = req.body;
    const id = Date.now().toString();
    
    await db.run(
      'INSERT INTO Matches (id, groupId, creatorId, date, time, location, maxPlayers) VALUES (?, ?, ?, ?, ?, ?, ?)', 
      [id, groupId || null, creatorId, date, time, location, maxPlayers]
    );

    if (creatorId) {
      await db.run('INSERT INTO MatchPlayers (matchId, userId) VALUES (?, ?)', [id, creatorId]);
    }
    
    res.json({ message: 'Maç oluşturuldu', match: { id, date, time, location, maxPlayers } });
  } catch (error) {
    res.status(500).json({ error: 'Maç oluşturulurken hata oluştu.' });
  }
});

app.get('/api/matches/:id/players', async (req, res) => {
  try {
    const { id } = req.params;
    const players = await db.all(`
      SELECT User.id, User.name, User.role as position, MatchPlayers.team, MatchPlayers.joinedAt 
      FROM MatchPlayers 
      JOIN User ON MatchPlayers.userId = User.id 
      WHERE MatchPlayers.matchId = ?
    `, [id]);
    res.json(players);
  } catch (error) {
    res.status(500).json({ error: 'Oyuncular getirilirken hata oluştu.' });
  }
});

app.post('/api/matches/:id/join', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    await db.run('INSERT OR IGNORE INTO MatchPlayers (matchId, userId) VALUES (?, ?)', [id, userId]);
    res.json({ message: 'Maça katılım başarılı!' });
  } catch (error) {
    res.status(500).json({ error: 'Maça katılırken hata oluştu.' });
  }
});

app.post('/api/matches/:id/leave', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    await db.run('DELETE FROM MatchPlayers WHERE matchId = ? AND userId = ?', [id, userId]);
    res.json({ message: 'Maçtan çıkıldı.' });
  } catch (error) {
    res.status(500).json({ error: 'Maçtan çıkarken hata oluştu.' });
  }
});

app.post('/api/matches/:id/divide', async (req, res) => {
  try {
    const { id } = req.params;
    const players = await db.all('SELECT * FROM MatchPlayers WHERE matchId = ?', [id]);
    
    if (players.length < 2) {
      return res.status(400).json({ error: 'Takım bölmek için yeterli oyuncu yok.' });
    }

    const shuffled = players.sort(() => 0.5 - Math.random());
    const mid = Math.ceil(shuffled.length / 2);
    const teamA = shuffled.slice(0, mid);
    const teamB = shuffled.slice(mid);

    for (const p of teamA) {
      await db.run('UPDATE MatchPlayers SET team = ? WHERE matchId = ? AND userId = ?', ['A', id, p.userId]);
    }
    for (const p of teamB) {
      await db.run('UPDATE MatchPlayers SET team = ? WHERE matchId = ? AND userId = ?', ['B', id, p.userId]);
    }

    res.json({ message: 'Takımlar başarıyla oluşturuldu!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Takımları bölerken hata oluştu.' });
  }
});

app.get('/api/users/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const matchesCount = await db.get('SELECT COUNT(*) as count FROM MatchPlayers WHERE userId = ?', [id]);
    const numMatches = matchesCount ? matchesCount.count : 0;
    
    const idNum = parseInt(id.slice(-4)) || Math.floor(Math.random() * 100);
    const mockGoals = (idNum % 5) * numMatches + (idNum % 3);
    const mockScore = mockGoals * 3 + numMatches * 5 + 40;
    
    res.json({
        matches: numMatches,
        score: mockScore, 
        goals: mockGoals,
        skills: {
            speed: Math.min(99, 60 + (idNum % 30) + (numMatches * 2)),
            shoot: Math.min(99, 50 + (idNum % 40) + mockGoals),
            pass: Math.min(99, 65 + (idNum % 25) + numMatches),
            physique: Math.min(99, 55 + (idNum % 35))
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
