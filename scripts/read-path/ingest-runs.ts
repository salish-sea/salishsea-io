/**
 * The build's record of each ingest run (decision 061, salish-xv35.9), as ingest.runs
 * was Postgres's (decisions 011, 012): a row when a run starts, its outcome when it
 * ends, and whether a failure was the source's fault (decision 042's classifier).
 *
 * Two things rest on it. The build keeps publishing while a source is down: a run that
 * can't reach its source leaves the mirror as it was, says so here, and lets the build
 * go on with the last good copy, so an iNaturalist maintenance window doesn't freeze
 * the map. And the heartbeat (scripts/ingest/heartbeat.ts) reads it, from the JSON this
 * publishes beside the mirrors, to ask what it asked of ingest.runs: is our side
 * running, and is the source reachable.
 *
 * An operational log, not data: it is no Stelis artifact, and nothing derived reads it.
 * runs.sqlite keeps a week; ingest-runs.json, which Caddy serves at
 * /status/ingest-runs.json, the last two days and each source's last success.
 */

import { renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { isTransientUpstream } from '../ingest/retry.ts';

export type Source = 'maplify' | 'inaturalist' | 'orcasound';
/** A scheduled build's run, or a backfill run by hand, which fails loudly instead. */
export type Trigger = 'cron' | 'manual';

export type Run = {
    id: number,
    source: Source,
    trigger: Trigger,
    started_at: string,
    finished_at: string | null,
    outcome: 'success' | 'failed' | null,
    transient: boolean | null,
    rows_changed: number | null,
    error: string | null,
};

/** What ingest-runs.json holds. */
export type RunsFile = {
    version: 1,
    written_at: string,
    runs: Run[],
    last_success: Partial<Record<Source, string>>,
};

const KEEP_DAYS = 7;
const PUBLISH_HOURS = 48;

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY, source TEXT NOT NULL, trigger TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, outcome TEXT, transient INTEGER,
        rows_changed INTEGER, error TEXT
    );
    CREATE INDEX IF NOT EXISTS runs_started_at ON runs (started_at);`;

/** The run log beside a mirror, and the JSON published from it. */
export function runsPaths(mirror: string): {db: string, json: string} {
    const dir = dirname(mirror);
    return {db: join(dir, 'runs.sqlite'), json: join(dir, 'ingest-runs.json')};
}

/**
 * What the build is told about this run — Stelis's boundary receipt (its st-8bj;
 * the unreachable arm is st-ml9.9). On success, whether the source moved and by how
 * much: `records` is what changed since the last fetch, not the corpus's size, and
 * `since` is how far back the fetch reached. On failure, that the source could not be
 * reached, so the build's own history and its operator log never read an outage as a
 * quiet day; the mirror the build goes on with is the last good copy either way.
 */
export function boundaryReceipt(
    run: {ok: true, changed: number} | {ok: false, error: unknown},
    since: string | null,
): string {
    if (!run.ok) {
        const message = run.error instanceof Error ? run.error.message : String(run.error);
        return JSON.stringify({unreachable: true, error: message.slice(0, 300)});
    }
    return JSON.stringify({unchanged: run.changed === 0, records: run.changed, since});
}

/**
 * Run one ingest, recording it. On success, the rows it changed; on failure the error,
 * recorded and not thrown, so the caller can keep its last good mirror and let the
 * build go on. `now` is for tests.
 */
export async function recordedRun(
    mirror: string,
    source: Source,
    trigger: Trigger,
    work: () => Promise<number>,
    now: () => Date = () => new Date(),
): Promise<{ok: true, changed: number} | {ok: false, error: unknown}> {
    const paths = runsPaths(mirror);
    const id = withDb(paths.db, db => {
        const at = now().toISOString();
        // A run that never recorded its outcome was killed, by a deploy restarting the
        // machine or by running out of memory. The next run says so, so an unfinished
        // row the heartbeat sees means nothing has run since: our side has stopped.
        db.prepare(
            `UPDATE runs SET finished_at = ?, outcome = 'failed', transient = 0,
                 error = 'interrupted: no outcome recorded before the next run started'
             WHERE source = ? AND finished_at IS NULL`,
        ).run(at, source);
        return Number(db.prepare('INSERT INTO runs (source, trigger, started_at) VALUES (?, ?, ?)')
            .run(source, trigger, at).lastInsertRowid);
    });
    publish(paths, now());
    try {
        const changed = await work();
        withDb(paths.db, db => db.prepare(
            `UPDATE runs SET finished_at = ?, outcome = 'success', rows_changed = ? WHERE id = ?`,
        ).run(now().toISOString(), changed, id));
        return {ok: true, changed};
    } catch (error) {
        // Published as-is at /status/ingest-runs.json. Fine while every source is read
        // without credentials; a source that needs a token must not let it into its
        // error text (a URL with a key in it, say), because this is a public page.
        const message = error instanceof Error ? error.message : String(error);
        withDb(paths.db, db => db.prepare(
            `UPDATE runs SET finished_at = ?, outcome = 'failed', transient = ?, error = ? WHERE id = ?`,
        ).run(now().toISOString(), isTransientUpstream(error) ? 1 : 0, message.slice(0, 2000), id));
        return {ok: false, error};
    } finally {
        publish(paths, now());
    }
}

function withDb<T>(file: string, use: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(file);
    try {
        db.exec(SCHEMA);
        return use(db);
    } finally {
        db.close();
    }
}

/** Prune the log to a week and write the JSON the heartbeat reads, atomically. */
function publish(paths: {db: string, json: string}, at: Date): void {
    const keepFrom = new Date(at.getTime() - KEEP_DAYS * 86_400_000).toISOString();
    const publishFrom = new Date(at.getTime() - PUBLISH_HOURS * 3_600_000).toISOString();
    const file = withDb(paths.db, db => {
        // An unfinished run is kept whatever its age: it is what the heartbeat calls stuck.
        db.prepare('DELETE FROM runs WHERE started_at < ? AND finished_at IS NOT NULL').run(keepFrom);
        const runs = (db.prepare(
            'SELECT * FROM runs WHERE started_at >= ? OR finished_at IS NULL ORDER BY started_at',
        ).all(publishFrom) as Record<string, unknown>[]).map(row => ({
            ...row,
            transient: row['transient'] === null ? null : row['transient'] === 1,
        })) as Run[];
        const last = db.prepare(
            `SELECT source, max(finished_at) AS at FROM runs WHERE outcome = 'success' GROUP BY source`,
        ).all() as {source: Source, at: string}[];
        return {
            version: 1,
            written_at: at.toISOString(),
            runs,
            last_success: Object.fromEntries(last.map(r => [r.source, r.at])),
        } satisfies RunsFile;
    });
    const temp = `${paths.json}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file)}\n`);
    renameSync(temp, paths.json);
}
