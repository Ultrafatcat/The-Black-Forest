// server/db/connection.js
//
// Opens (and on first run, creates) the SQLite file, and makes sure every
// table from schema.sql exists. Uses Node's built-in SQLite module --
// no native compiling, no extra dependency to install.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');

const DATA_FILE = process.env.DATA_FILE || path.join(ROOT_DIR, 'data', 'black-forest.db');

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

export const db = new DatabaseSync(DATA_FILE);
db.exec('PRAGMA journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);