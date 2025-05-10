import Database from 'better-sqlite3';
import fs from 'node:fs';

const testDatabase = () => {
  const db = new Database();
  const sql = fs.readFileSync('schema.sql', 'utf8');
  db.exec(sql);
  return db;
}

export const db = process.env.VITEST ? testDatabase() : new Database('salish-sea.sqlite3');
db.pragma('journal_mode = WAL');
