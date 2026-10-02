/**
 * The read-path snapshot's catalogue documents, as the profile scripts read them
 * (decision 057). Each script names the tables it reads and gets only those, so the
 * Stelis task running it can declare exactly its inputs.
 */

import { DuckDBInstance } from '@duckdb/node-api';

// Snapshot documents, as Postgres serialized them. Loosely typed here and narrowed by
// what assembly builds from them, which the pages' types check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc = Record<string, any>;

const TABLES = [
    'individuals', 'designations', 'nicknames', 'parties', 'social_groups', 'group_parents',
    'matriline_members', 'animal_names', 'individual_occurrences', 'group_occurrences', 'ecotype_occurrences',
    'haulouts', 'haulout_occurrences',
] as const;
export type Table = (typeof TABLES)[number];
export type Tables = Record<Table, Doc[]>;

/** What a script reads from an attached snapshot: the tables it names, and the year if it asks. */
export interface Snapshot {
    /** The named tables and no others. */
    tables<T extends Table>(names: readonly T[]): Promise<Pick<Tables, T>>;
    /** The Pacific year the snapshot was taken in: a page's "current year", never the clock's. */
    year(): Promise<number>;
}

/**
 * Attaches the snapshot once, read-only, for the duration of `read`. One instance per
 * script: DuckDB's Node API says two in one process must not attach the same file.
 */
export async function readSnapshot<R>(snapshot: string, read: (s: Snapshot) => Promise<R>): Promise<R> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        return await read({
            async tables<T extends Table>(names: readonly T[]) {
                const tables = {} as Pick<Tables, T>;
                for (const name of names) {
                    const reader = await conn.runAndReadAll(`SELECT doc FROM store.snapshot.${name}`);
                    tables[name] = (reader.getRows() as [string][]).map(([doc]) => JSON.parse(doc));
                }
                return tables;
            },
            async year() {
                // Written by snapshot.ts beside snapshot.meta, so a page reads the year and
                // not the moment, and a build in the same year leaves the pages' inputs be.
                const reader = await conn.runAndReadAll('SELECT year FROM store.snapshot.year');
                return (reader.getRows() as [number][])[0]![0];
            },
        });
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}
