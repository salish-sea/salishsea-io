import Database from 'better-sqlite3';
import fs from 'node:fs';
import { readFromINaturalist } from './inaturalist_taxonomy.ts';
import { importTaxa } from './taxa.ts';

export function loadSchema(db: Database.Database, file = 'schema.sql') {
  const sql = fs.readFileSync(file, 'utf-8');
  db.exec(sql);
}

// See README to get these files.
export function loadTaxa(db: Database.Database, taxonFile= 'taxa.csv', nameFile = 'VernacularNames-english.csv') {
  const taxaCsv = fs.readFileSync(taxonFile, 'utf-8');
  const namesCsv = fs.readFileSync(nameFile, 'utf-8');
  const taxa = readFromINaturalist(taxaCsv, namesCsv);
  importTaxa(taxa, db);
}

export const db = process.env.VITEST ? new Database() : new Database('salish-sea.sqlite3');
db.pragma('journal_mode = WAL');

if (process.env.VITEST) {
  loadSchema(db);
  loadTaxa(db, 'test/taxa.csv', 'test/VernacularNames-english.csv');
}
