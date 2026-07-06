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
 * Scope: Maplify only in this slice; source:'inaturalist' is rejected (405) until
 * salishsea-io-89d.2. Wiring pg_cron→pg_net is the cutover (salishsea-io-89d.3).
 */

import postgres from 'postgres';
import { z } from 'zod';
import { parseMaplifyResponse, isIngestable, reconcile } from '../../../scripts/ingest/maplify.ts';
import { persistMaplify, fetchWindowIds, type IngestWindow } from '../../../scripts/ingest/persist.ts';
import { fetchMaplify } from './fetch-maplify.ts';

const TRIGGER_SECRET = Deno.env.get('INGEST_TRIGGER_SECRET') ?? '';
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

const log = (msg: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: 'info', fn: 'ingest', msg, ...extra }));

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

Deno.serve(async (req) => {
    const provided = req.headers.get('x-ingest-secret') ?? '';
    if (!secretsMatch(provided, TRIGGER_SECRET)) {
        return jsonResponse({ error: 'unauthorized' }, 401);
    }

    let rawBody: unknown = {};
    try { rawBody = await req.json(); } catch { /* empty/invalid body → defaults */ }
    const parsed = RequestSchema.safeParse(rawBody ?? {});
    if (!parsed.success) return jsonResponse({ error: z.prettifyError(parsed.error) }, 400);

    const { source, dry_run: dryRun = false, trigger = 'manual' } = parsed.data;
    if (source !== 'maplify') {
        return jsonResponse({ error: `source '${source}' not yet implemented (salishsea-io-89d.2)` }, 405);
    }
    const window: IngestWindow =
        parsed.data.start && parsed.data.end
            ? { start: parsed.data.start, end: parsed.data.end }
            : defaultWindow();

    const sql = postgres(DB_URL, { prepare: false, max: 2 });
    let runId: number | undefined;
    try {
        // `started` row OUTSIDE the data txn (orphan on crash).
        const started = await sql<{ id: number }[]>`
            INSERT INTO ingest.runs (source, trigger, dry_run, window_start, window_end)
            VALUES (${source}, ${trigger}, ${dryRun}, ${window.start}, ${window.end})
            RETURNING id`;
        runId = started[0]!.id;

        const raw = await fetchMaplify(window, log);
        const result = parseMaplifyResponse(raw);
        if (!result.ok) throw new Error(`maplify parse failed: ${result.error}`);

        const ingestable = result.sightings.filter(isIngestable);
        const existing = await fetchWindowIds(sql, window);
        const plan = reconcile(ingestable, existing);
        const { upserted, deleted } = await persistMaplify(sql, plan, window, { dryRun });

        await sql`
            UPDATE ingest.runs SET
                finished_at = now(), outcome = 'success', pages_fetched = 1,
                total_results = ${result.sightings.length},
                rows_upserted = ${upserted}, rows_deleted = ${deleted}
            WHERE id = ${runId}`;

        log('ingest ok', { source, window, dryRun, upserted, deleted });
        return jsonResponse({ ok: true, runId, source, window, dryRun, upserted, deleted }, 200);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log('ingest failed', { source, window, error: message });
        if (runId != null) {
            await sql`UPDATE ingest.runs SET finished_at = now(), outcome = 'failed', error = ${message} WHERE id = ${runId}`
                .catch(() => { /* best-effort; do not mask the original error */ });
        }
        return jsonResponse({ ok: false, error: message }, 500);
    } finally {
        await sql.end({ timeout: 5 });
    }
});
