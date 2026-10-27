// Opens the SQLite database and makes sure the schema exists.
// jobs.js is the only module that should require() this one.

const Database = require("better-sqlite3");
const config = require("./config");

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL"); // safe concurrent reads while a write is in progress

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    mode INTEGER NOT NULL,
    mode_source TEXT NOT NULL,         -- 'auto' | 'manual'
    step_queue TEXT NOT NULL,          -- JSON array of { wordlist, rule } steps, in try-order
    current_step_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued', -- 'queued' | 'running' | 'done' | 'failed'
    result TEXT,                       -- cracked plaintext, once found
    attempts TEXT NOT NULL DEFAULT '[]', -- JSON array: [{ wordlist, rule, outcome, startedAt, finishedAt }]
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

module.exports = db;
