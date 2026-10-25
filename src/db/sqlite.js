import * as SQLite from "expo-sqlite";

let dbPromise = null;

export async function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const db = await SQLite.openDatabaseAsync("studyflow.db");
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        user_id TEXT DEFAULT 'guest',
        synced INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        subject_id INTEGER,
        completed INTEGER NOT NULL DEFAULT 0,
        priority TEXT NOT NULL DEFAULT 'Medium',
        due_at TEXT,
        notes TEXT,
        user_id TEXT DEFAULT 'guest',
        synced INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS study_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id INTEGER,
        duration_seconds INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        date_key TEXT NOT NULL,
        note TEXT,
        user_id TEXT DEFAULT 'guest',
        synced INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        user_id TEXT DEFAULT 'guest'
      );
    `);

    // Migrations
    for (const stmt of [
      "ALTER TABLE tasks ADD COLUMN notes TEXT",
      "ALTER TABLE tasks ADD COLUMN user_id TEXT DEFAULT 'guest'",
      "ALTER TABLE tasks ADD COLUMN synced INTEGER DEFAULT 0",
      "ALTER TABLE subjects ADD COLUMN user_id TEXT DEFAULT 'guest'",
      "ALTER TABLE subjects ADD COLUMN synced INTEGER DEFAULT 0",
      "ALTER TABLE study_sessions ADD COLUMN note TEXT",
      "ALTER TABLE study_sessions ADD COLUMN user_id TEXT DEFAULT 'guest'",
      "ALTER TABLE study_sessions ADD COLUMN synced INTEGER DEFAULT 0",
    ]) {
      try { await db.execAsync(stmt); } catch {}
    }

    const count = await db.getFirstAsync("SELECT COUNT(*) as count FROM subjects");
    if (!count || count.count === 0) {
      const defaults = [
        ["Physics", "#5B4BFF"],
        ["Chemistry", "#14B87E"],
        ["Higher Math", "#FF9B3D"],
        ["Biology", "#E85A98"],
      ];
      for (const [name, color] of defaults) {
        await db.runAsync(
          "INSERT OR IGNORE INTO subjects (name, color, user_id) VALUES (?, ?, 'guest')",
          name, color
        );
      }
    }
    return db;
  })();
  return dbPromise;
}

export function resetDB() {
  dbPromise = null;
}