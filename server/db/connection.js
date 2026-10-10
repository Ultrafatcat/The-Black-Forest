// server/db/connection.js
//
// Opens (and on first run, creates) the SQLite file, and makes sure every
// table from schema.sql exists. better-sqlite3 is synchronous, so there's
// no await here -- every query just returns.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');

// DATA_FILE will be set by systemd in production (Task 2); falls back to a
// file in the repo's data/ folder for local development.
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT_DIR, 'data', 'black-forest.db');

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

export const db = new Database(DATA_FILE);
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);