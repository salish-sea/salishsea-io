import Database from 'better-sqlite3';

export const db = process.env.VITEST ? new Database() : new Database('salish-sea.sqlite3');
db.pragma('journal_mode = WAL');
