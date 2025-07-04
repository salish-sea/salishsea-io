import Database from 'better-sqlite3';
import fs from 'node:fs';
import { Temporal } from 'temporal-polyfill';

export type Timestamp = number; // epoch time in milliseconds

const testDatabase = () => {
  const db = new Database();
  const sql = fs.readFileSync('schema.sql', 'utf8');
  db.exec(sql);
  return db;
}

export const db = process.env.VITEST ? testDatabase() : new Database('salish-sea.sqlite3');
db.pragma('journal_mode = WAL');

// This is a stand-in for a monotonic change counter (causal time) in the database, a la Datomic.
export const makeT = () => {
  return Temporal.Now.instant().epochMilliseconds;
}
