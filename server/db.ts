import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

export let db: Database;

export async function initDB() {
  db = await open({
    filename: path.join(__dirname, 'sports.db'),
    driver: sqlite3.Database
  });

  const migrations = [
    // Version 1 (Index 0)
    `
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
    `,
    // Version 2 (Index 1) - Add Avatar & Position
    `
    ALTER TABLE User ADD COLUMN avatar TEXT;
    ALTER TABLE User ADD COLUMN position TEXT DEFAULT 'Orta Saha';
    `,
    // Version 3 (Index 2) - Match Score & Goals
    `
    ALTER TABLE Matches ADD COLUMN score TEXT;
    ALTER TABLE MatchPlayers ADD COLUMN goals INTEGER DEFAULT 0;
    `,
    // Version 4 (Index 3) - Team Names & Match status (if not existing)
    `
    ALTER TABLE Matches ADD COLUMN teamAName TEXT DEFAULT 'A Takımı';
    ALTER TABLE Matches ADD COLUMN teamBName TEXT DEFAULT 'B Takımı';
    `,
    // Version 5 (Index 4) - Notifications
    `
    CREATE TABLE IF NOT EXISTS Notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'INFO',
      isRead BOOLEAN DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE Notifications ADD COLUMN metadata TEXT;
    `,
    // Version 6 (Index 5) - Match timestamp and lockout
    `
    ALTER TABLE Matches ADD COLUMN matchTimestamp INTEGER;
    ALTER TABLE Matches ADD COLUMN lockoutHours INTEGER DEFAULT 1;
    `,
    // Version 7 (Index 6) - MatchPlayers status
    `
    ALTER TABLE MatchPlayers ADD COLUMN status TEXT DEFAULT 'ACTIVE';
    `,
    // Version 8 (Index 7) - MVP, Group Messages, User Availability
    `
    CREATE TABLE IF NOT EXISTS MvpVotes (
      id TEXT PRIMARY KEY,
      matchId TEXT NOT NULL,
      voterId TEXT NOT NULL,
      votedId TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS GroupMessages (
      id TEXT PRIMARY KEY,
      groupId TEXT NOT NULL,
      userId TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS UserAvailability (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      dayOfWeek INTEGER NOT NULL,
      startTime TEXT NOT NULL,
      endTime TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_user_availability_user_day ON UserAvailability (userId, dayOfWeek);
    `
  ];

  const currentVersionResult = await db.get('PRAGMA user_version');
  const currentVersion = currentVersionResult?.user_version || 0;

  console.log(`Current DB Version: ${currentVersion}`);

  // Run migrations
  for (let i = currentVersion; i < migrations.length; i++) {
    console.log(`Running migration v${i + 1}...`);
    const migration = migrations[i];
    if (!migration) continue;
    const statements = migration.split(';').filter(s => s.trim().length > 0);
    
    await db.exec('BEGIN TRANSACTION;');
    try {
      for (const stmt of statements) {
        try {
          await db.exec(stmt + ';');
        } catch (err: any) {
          // Soft-fail for duplicate columns to support migration from legacy unversioned DB
          if (
            !err.message.includes('duplicate column name') && 
            !err.message.includes('already exists')
          ) {
            throw err;
          }
        }
      }
      await db.exec(`PRAGMA user_version = ${i + 1};`);
      await db.exec('COMMIT;');
    } catch (err) {
      await db.exec('ROLLBACK;');
      console.error(`Migration v${i + 1} failed:`, err);
      throw err;
    }
  }

  console.log('Database connected and migrations successfully applied.');
  return db;
}
