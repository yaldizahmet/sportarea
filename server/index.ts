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
      CREATE TABLE IF NOT EXISTS GroupMessages (
        id TEXT PRIMARY KEY,
        groupId TEXT NOT NULL,
        userId TEXT NOT NULL,
        message TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
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
    const { groupId, creatorId, date, time, location, maxPlayers, teamAName, teamBName } = req.body;
    const id = Date.now().toString();
    
    await db.run(
      'INSERT INTO Matches (id, groupId, creatorId, date, time, location, maxPlayers, teamAName, teamBName) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', 
      [id, groupId || null, creatorId, date, time, location, maxPlayers, teamAName || 'A Takımı', teamBName || 'B Takımı']
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

app.get('/api/matches/:id/players', async (req, res) => {
   try {
     const { id } = req.params;
     const players = await db.all(`
       SELECT User.id, User.name, User.avatar, User.role as position, MatchPlayers.team, MatchPlayers.goals 
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
    
    // Maç sahibine veya gruba kurucuya bildirim
    const matchRow = await db.get('SELECT creatorId, location FROM Matches WHERE id = ?', [id]);
    if (matchRow && matchRow.creatorId && matchRow.creatorId !== userId) {
       await db.run('INSERT INTO Notifications (id, userId, message, type) VALUES (?, ?, ?, ?)', [
         Date.now().toString() + Math.random(),
         matchRow.creatorId,
         `Bir oyuncu ${matchRow.location} maçına katıldı! Kadroya göz at.`,
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
    await db.run('DELETE FROM MatchPlayers WHERE matchId = ? AND userId = ?', [id, userId]);
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
      WHERE MatchPlayers.matchId = ?
    `, [id]);

    if(players.length < 2) return res.status(400).json({ error: 'Takım kurmak için yeterli oyuncu yok.' });

    // Mevkilere göre ayır
    const goalkeepers = players.filter((p: any) => (p.position || '').toLowerCase().includes('kaleci'));
    const others = players.filter((p: any) => !(p.position || '').toLowerCase().includes('kaleci'));

    // Grupları rastgele karıştır
    goalkeepers.sort(() => 0.5 - Math.random());
    others.sort(() => 0.5 - Math.random());

    const teamA: any[] = [];
    const teamB: any[] = [];

    // Önce kalecileri eşit dağıt
    goalkeepers.forEach((p: any, idx: number) => {
      if (idx % 2 === 0) teamA.push(p);
      else teamB.push(p);
    });

    // Sonra diğerlerini kalan boşluklara göre dağıt
    others.forEach((p: any) => {
      if (teamA.length <= teamB.length) teamA.push(p);
      else teamB.push(p);
    });

    await db.run('UPDATE MatchPlayers SET team = "UNASSIGNED" WHERE matchId = ?', [id]);
    
    for (const p of teamA) await db.run('UPDATE MatchPlayers SET team = "A" WHERE matchId = ? AND userId = ?', [id, p.id]);
    for (const p of teamB) await db.run('UPDATE MatchPlayers SET team = "B" WHERE matchId = ? AND userId = ?', [id, p.id]);

    res.json({ message: 'Takımlar mevkilere göre dengeli şekilde dağıtıldı!' });
  } catch (error) {
    res.status(500).json({ error: 'Bölme hatası' });
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
    
    const speed = hasRatings ? Math.round(ratings.avgSpeed) : 60;
    const shoot = hasRatings ? Math.round(ratings.avgShoot) : 60;
    const pass = hasRatings ? Math.round(ratings.avgPass) : 60;
    const physique = hasRatings ? Math.round(ratings.avgPhysique) : 60;
    const overallScore = Math.round((speed + shoot + pass + physique) / 4) + (numMatches > 5 ? 2 : 0) + (realGoals > 10 ? 3 : 0);
    
    res.json({
        matches: numMatches,
        score: overallScore > 99 ? 99 : overallScore, 
        goals: realGoals,
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
