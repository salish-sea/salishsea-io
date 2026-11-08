/**
 * How a read-path script's DuckDB stays inside the Fly machine's memory (decisions 056, 061
 * and 091): 2 GB, which the services, the ingest build and a derive build share, since the
 * two builds can run at once.
 *
 * DuckDB's default memory limit is 80% of the machine, and it keeps what a query or an
 * uncommitted transaction holds until it is done, so left alone a step grows to whatever
 * its data asks for. Capped, it spills to a directory beside the snapshot instead (and
 * removes it when done), and one that truly can't fit fails with "Out of Memory": this
 * step fails, loudly, rather than the machine thrashing until Caddy stops answering.
 *
 * One thread, as each build is single-threaded: DuckDB gives each thread its own buffers,
 * so a cap that holds there holds on a laptop only if this does too.
 *
 * Each caller's limit is the measured floor for its work with room above it; the
 * measurements are in its comment.
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

/** `text` as a SQL string literal, quotes doubled: for a path in an ATTACH or a SET. */
export const sqlString = (text: string): string => `'${text.replaceAll("'", "''")}'`;

export async function budget(conn: DuckDBConnection, snapshot: string, memoryLimit: string): Promise<void> {
    await conn.run(`SET memory_limit = '${memoryLimit}'`);
    await conn.run('SET threads = 1');
    await conn.run(`SET temp_directory = ${sqlString(`${snapshot}.tmp`)}`);
}

export type SnapshotOptions = {
    /** The step's memory limit: the measured floor for its work, with room above it. */
    readonly memory: string;
    /** Whether the step writes into the snapshot; otherwise it is attached read-only. */
    readonly write?: boolean;
};

/**
 * Run `use` on a fresh in-memory DuckDB with the step's budget and the snapshot attached as
 * `store`, closing both afterwards, whether `use` returns or throws. A step that needs the
 * snapshot as its default catalog, ICU or the register sets that up first thing in `use`.
 */
export async function withSnapshot<T>(
    snapshot: string, {memory, write = false}: SnapshotOptions, use: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, memory);
        await conn.run(`ATTACH ${sqlString(snapshot)} AS store${write ? '' : ' (READ_ONLY)'}`);
        return await use(conn);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}
