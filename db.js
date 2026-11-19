'use strict';
// 数据层：本地 SQLite，零外部依赖（使用 Node 22 内置 node:sqlite）
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'workbench.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  module TEXT DEFAULT '实习准备',
  priority TEXT DEFAULT 'P1',
  status TEXT DEFAULT 'todo',
  due_date TEXT,
  source TEXT DEFAULT 'manual',
  created_at TEXT,
  updated_at TEXT,
  done_at TEXT
);

CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  tag TEXT DEFAULT '',
  module TEXT DEFAULT '灵感',
  converted INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  position TEXT DEFAULT '',
  stage TEXT DEFAULT '一面',
  date TEXT,
  result TEXT DEFAULT 'pending',
  questions TEXT DEFAULT '',
  reflection TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT DEFAULT '雅思',
  category TEXT DEFAULT '',
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  score REAL,
  duration INTEGER DEFAULT 0,
  date TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  task_title TEXT DEFAULT '',
  module TEXT DEFAULT '',
  content TEXT DEFAULT '',
  learned TEXT DEFAULT '',
  minutes INTEGER DEFAULT 0,
  date TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(date);
CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(date);
`);

/* 兼容老库：给 ideas 加 pinned（置顶），已有库会跳过 */
const ideaCols = db.prepare('PRAGMA table_info(ideas)').all().map((c) => c.name);
if (!ideaCols.includes('pinned')) {
  db.exec('ALTER TABLE ideas ADD COLUMN pinned INTEGER DEFAULT 0');
}

function nowISO() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
    sign + pad(off / 60) + ':' + pad(off % 60)
  );
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

module.exports = { db, nowISO, today, addDays, DATA_DIR };
