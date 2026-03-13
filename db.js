import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'radarloto.sqlite');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL CHECK (game IN ('primitiva','euromillones')),
  mode TEXT NOT NULL,
  numbers_json TEXT NOT NULL,
  stars_json TEXT,
  reintegro INTEGER,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','checked','won','lost')),
  draw_date TEXT,
  main_hits INTEGER DEFAULT 0,
  star_hits INTEGER DEFAULT 0,
  reintegro_hit INTEGER DEFAULT 0,
  outcome_label TEXT,
  outcome_detail TEXT,
  prize_amount TEXT
);

CREATE TABLE IF NOT EXISTS draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL CHECK (game IN ('primitiva','euromillones')),
  draw_date TEXT NOT NULL,
  numbers_json TEXT NOT NULL,
  stars_json TEXT,
  reintegro INTEGER,
  source_url TEXT,
  source_name TEXT,
  imported_at TEXT NOT NULL,
  UNIQUE(game, draw_date)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  ran_at TEXT NOT NULL
);
`);