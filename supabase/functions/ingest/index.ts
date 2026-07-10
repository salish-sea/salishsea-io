/**
 * Ingest Edge Function — the imperative shell (salishsea-io-89d.1 / decision 011).
 *
 * HTTP entrypoint invoked by pg_cron/pg_net (rolling window, writes on) and by a
 * Curator (explicit window; writes on, or dry_run to preview). Orchestrates:
 *   fetch (retry) → parse+normalize (core) → read window ids → reconcile (core)
 *   → persist in one atomic txn (persist layer) → record ingest.runs.
 *
 * Invariants it enforces (decision 011):
 *   - Gated by a dedicated INGEST_TRIGGER_SECRET (constant-time compare).
 *   - A failed/unparseable fetch throws BEFORE persist → writes nothing, records
 *     a `failed` run. Reconcile only ever runs against a parsed, complete fetch.
 *   - The ingest.runs `started` row is written OUTSIDE the data transaction, so a
 *     crash leaves a visible orphan (outcome NULL).
 *
 * Scope: Maplify and iNaturalist. Wiring pg_cron→pg_net is the cutover
 * (salishsea-io-89d.3).
 */

import * as Sentry from '@sentry/deno';
import postgres, { type Sql } from 'postgres';
import { z } from 'zod';
import { parseMaplifyResponse, isIngestable, reconcile } from '../../../scripts/ingest/maplify.ts';
import { reconcile as reconcileInat } from '../../../scripts/ingest/inaturalist.ts';
import {
    persistMaplify,
    persistInaturalist,
    fetchWindowIds,
    fetchObservationWindowIds,
    type IngestWindow,
} from '../../../scripts/ingest/persist.ts';
import { fetchMaplify } from './fetch-maplify.ts';
import { fetchAllObservationPages, resolveTaxonClosure } from './fetch-inaturalist.ts';

const TRIGGER_SECRET = Deno.env.get('INGEST_TRIGGER_SECRET') ?? '';
// Server-side Sentry surface (decision 011 / salishsea-io-vif). No DSN (local
// dev) → the SDK disables itself and every Sentry.* call below is a no-op.
// Complements the heartbeat: it catches silent stops; this explains loud
// failures. A failed run is already recorded in ingest.runs either way.
Sentry.init({
    dsn: Deno.env.get('INGEST_SENTRY_DSN'),
    environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
    initialScope: { tags: { service: 'ingest-edge-function', runtime: 'deno' } },
});
// Prefer a dedicated privileged ingest role (INGEST_DB_URL); fall back to the
// platform-provided connection. The dedicated role + grants land in a follow-up.
const DB_URL = Deno.env.get('INGEST_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL') ?? '';

const RequestSchema = z.object({
    source: z.enum(['maplify', 'inaturalist']),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dry_run: z.boolean().optional(),
    trigger: z.enum(['cron', 'manual']).optional(),
});

const jsonResponse = (data: unknown, status: number) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const log = (msg: string, extra?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', fn: 'ingest', msg, ...extra }));
    // Ride the structured log as Sentry breadcrumbs so a captured failure
    // carries the run's fetch/persist trail (decision 011: breadcrumbs per run).
    Sentry.addBreadcrumb({ category: 'ingest', message: msg, data: extra });
};

/** Length-independent constant-time string compare. */
function secretsMatch(a: string, b: string): boolean {
    if (a.length === 0 || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/** Rolling 10-day window ending today (UTC), matching the legacy cron cadence. */
function defaultWindow(): IngestWindow {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const startDate = new Date(now);
    startDate.setUTCDate(startDate.getUTCDate() - 10);
    return { start: startDate.toISOString().slice(0, 10), end };
}

/** Common per-run outcome recorded to ingest.runs and returned to the caller. */
type IngestOutcome = {
    readonly upserted: number;
    readonly deleted: number;
    readonly pagesFetched: number;
    readonly totalResults: number;
};

/** Maplify: single-page fetch → parse → reconcile → persist (one atomic txn). */
async function ingestMaplify(sql: Sql, window: IngestWindow, dryRun: boolean): Promise<IngestOutcome> {
    const raw = await fetchMaplify(window, log);
    const result = parseMaplifyResponse(raw);
    if (!result.ok) throw new Error(`maplify parse failed: ${result.error}`);

    const ingestable = result.sightings.filter(isIngestable);
    const existing = await fetchWindowIds(sql, window);
    const plan = reconcile(ingestable, existing);
    const { upserted, deleted } = await persistMaplify(sql, plan, window, { dryRun });
    return { upserted, deleted, pagesFetched: 1, totalResults: result.sightings.length };
}

/**
 * iNaturalist: paginate to completeness → resolve the full taxon closure (all
 * BEFORE the persist txn) → reconcile → persist observations + photos + taxa in
 * one atomic txn. Any partial page or unresolved taxon threw before this returns.
 */
async function ingestInaturalist(
    sql: Sql,
    window: IngestWindow,
    dryRun: boolean,
    logger: typeof log,
): Promise<IngestOutcome> {
    const { pages, observations, recordCount } = await fetchAllObservationPages(window, logger);
    const taxa = await resolveTaxonClosure(sql, observations, logger);

    const existing = await fetchObservationWindowIds(sql, window);
    const plan = reconcileInat(observations, existing);
    const result = await persistInaturalist(sql, { taxa, plan, window }, { dryRun });

    // rows_upserted / rows_deleted track the observations (the window's unit of
    // reconcile); taxa and photo counts ride along in the structured log.
    logger('inat persist detail', { ...result });
    return {
        upserted: result.observationsUpserted,
        deleted: result.observationsDeleted,
        pagesFetched: pages.length,
        // ingest.runs.total_results now records raw records fetched across the
        // id-keyset sweep (decision 018); iNat's drifting total is no longer used.
        totalResults: recordCount,
    };
}

Deno.serve(async (req) => {
    const provided = req.headers.get('x-ingest-secret') ?? '';
    if (!secretsMatch(provided, TRIGGER_SECRET)) {
        return jsonResponse({ error: 'unauthorized' }, 401);
    }

    let rawBody: unknown = {};
    try { rawBody = await req.json(); } catch { /* empty/invalid body → defaults */ }
    const parsed = RequestSchema.safeParse(rawBody ?? {});
    if (!parsed.success) return jsonResponse({ error: z.prettifyError(parsed.error) }, 400);

    const { source, start, end, dry_run: dryRun = false, trigger = 'manual' } = parsed.data;
    // A custom window needs BOTH bounds; a single bound is almost certainly a
    // mistake, and silently falling back to the default range would ignore the
    // curator's intent. Reject partial windows and inverted ranges.
    if ((start == null) !== (end == null)) {
        return jsonResponse({ error: 'provide both start and end, or neither' }, 400);
    }
    if (start != null && end != null && start > end) {
        return jsonResponse({ error: 'start must be on or before end' }, 400);
    }
    const window: IngestWindow = start != null && end != null ? { start, end } : defaultWindow();

    const sql = postgres(DB_URL, { prepare: false, max: 2 });
    let runId: number | undefined;
    try {
        // `started` row OUTSIDE the data txn (orphan on crash).
        const started = await sql<{ id: number }[]>`
            INSERT INTO ingest.runs (source, trigger, dry_run, window_start, window_end)
            VALUES (${source}, ${trigger}, ${dryRun}, ${window.start}, ${window.end})
            RETURNING id`;
        runId = started[0]!.id;

        // Each branch performs a PROVABLY COMPLETE fetch (any partial/failed
        // fetch throws before persist) and returns a common outcome shape.
        const outcome = source === 'maplify'
            ? await ingestMaplify(sql, window, dryRun)
            : await ingestInaturalist(sql, window, dryRun, log);

        await sql`
            UPDATE ingest.runs SET
                finished_at = now(), outcome = 'success',
                pages_fetched = ${outcome.pagesFetched},
                total_results = ${outcome.totalResults},
                rows_upserted = ${outcome.upserted}, rows_deleted = ${outcome.deleted}
            WHERE id = ${runId}`;

        log('ingest ok', { source, window, dryRun, ...outcome });
        return jsonResponse({ ok: true, runId, source, window, dryRun, ...outcome }, 200);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log('ingest failed', { source, window, error: message });
        Sentry.withScope((scope) => {
            scope.setTags({ source, trigger, dry_run: String(dryRun) });
            scope.setContext('ingest_run', { runId, window, dryRun });
            Sentry.captureException(e);
        });
        // Flush before responding — the isolate may be frozen/killed right after
        // the Response returns, losing any event still in the buffer.
        await Sentry.flush(2000).catch(() => { /* fail-open: never mask ingest */ });
        if (runId != null) {
            await sql`UPDATE ingest.runs SET finished_at = now(), outcome = 'failed', error = ${message} WHERE id = ${runId}`
                .catch(() => { /* best-effort; do not mask the original error */ });
        }
        return jsonResponse({ ok: false, error: message }, 500);
    } finally {
        await sql.end({ timeout: 5 });
    }
});
