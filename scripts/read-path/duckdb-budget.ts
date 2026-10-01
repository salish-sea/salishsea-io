/**
 * How a read-path script's DuckDB stays inside the 1 GB Fly machine (decisions 056 and 061).
 *
 * DuckDB's default memory limit is 80% of the machine, and it keeps what a query or an
 * uncommitted transaction holds until it is done, so left alone a step grows to whatever
 * its data asks for. Capped, it spills to a directory beside the snapshot instead (and
 * removes it when done), and one that truly can't fit fails with "Out of Memory": this
 * step fails, loudly, rather than the machine thrashing until Caddy stops answering.
 *
 * One thread, as the Fly machine has one CPU: DuckDB gives each thread its own buffers,
 * so a cap that holds there holds on a laptop only if this does too.
 *
 * Each caller's limit is the measured floor for its work with room above it; the
 * measurements are in its comment.
 */

import type { DuckDBConnection } from '@duckdb/node-api';

export async function budget(conn: DuckDBConnection, snapshot: string, memoryLimit: string): Promise<void> {
    await conn.run(`SET memory_limit = '${memoryLimit}'`);
    await conn.run('SET threads = 1');
    await conn.run(`SET temp_directory = '${`${snapshot}.tmp`.replaceAll("'", "''")}'`);
}
