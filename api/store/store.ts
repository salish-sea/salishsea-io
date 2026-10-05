/**
 * The store: what salishsea.io's users write, in one SQLite file (decision 065,
 * salish-9uu.3.2). Its schema is the migrations beside this file, applied in order and
 * counted in SQLite's `user_version`, each in a transaction of its own.
 *
 * Opened with foreign keys on (SQLite's default is off) and in WAL mode, so the build can
 * read while the API writes, as the mirrors are.
 */

import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = path.join(import.meta.dirname, 'migrations');

/** The migrations, in order: `NNN-name.sql`. */
export function migrations(): {version: number, name: string, sql: string}[] {
    return readdirSync(MIGRATIONS)
        .filter(f => /^\d{3}-.+\.sql$/.test(f))
        .sort()
        .map((f, i) => {
            const version = Number(f.slice(0, 3));
            if (version !== i + 1) throw new Error(`migrations: ${f} is not number ${i + 1}`);
            return {version, name: f, sql: readFileSync(path.join(MIGRATIONS, f), 'utf8')};
        });
}

/** Open the store at `file`, creating it if need be, and bring its schema up to date. */
export function openStore(file: string): DatabaseSync {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    const current = Number((db.prepare('PRAGMA user_version').get() as {user_version: number}).user_version);
    for (const {version, sql} of migrations().filter(m => m.version > current)) {
        db.exec('BEGIN');
        try {
            db.exec(sql);
            db.exec(`PRAGMA user_version = ${version}`);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
    return db;
}
