/**
 * Backfill a source's history, one ingest window at a time (decision 041).
 *
 * Nothing here talks to the source. Each window is a request to our own
 * ingest function — the same code path and completeness rules the cron uses
 * (decision 011), invoked the way supabase/functions/ingest/README.md
 * describes for a curator — and the function does the fetching from Supabase.
 * What this script adds is the walk: cutting a date range into windows sized
 * so no single query approaches iNat's 10 000-result bulk threshold, pacing
 * the walk under iNat's recommended 60 requests a minute, stopping at the
 * first failure, and refusing to continue if a window deletes anything —
 * a historical window should be pure upsert (README: "safe for filling a gap").
 *
 * The function URL and trigger secret are read from Vault through the
 * Supabase CLI's keychain login, so the operator never handles the secret.
 *
 *   pnpm exec tsx scripts/backfill/inat-history.ts --source inaturalist --from 2014-01-01 --to 2018-01-01 --step year --dry-run
 *   pnpm exec tsx scripts/backfill/inat-history.ts --source inaturalist --from 2021-01-01 --to 2025-01-01 --step month
 *   pnpm exec tsx scripts/backfill/inat-history.ts --source maplify --from 2014-01-01 --to 2022-01-01 --step month
 *
 * Maplify's reconcile compares the UTC created_at its API filters on, so its
 * windows may abut freely; iNaturalist's may too since salish-34s, because the
 * reconcile leaves a window's edge days alone.
 *
 * `--to` is exclusive: the last window ends the day before it.
 */
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
    options: {
        source: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        step: { type: 'string', default: 'month' },
        'dry-run': { type: 'boolean', default: false },
        'max-deleted': { type: 'string', default: '0' },
        'pause-ms': { type: 'string', default: '2000' },
    },
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const source = values.source;
if (source !== 'inaturalist' && source !== 'maplify') {
    console.error('--source must be inaturalist or maplify');
    process.exit(2);
}
if (!values.from || !values.to || !DATE_RE.test(values.from) || !DATE_RE.test(values.to)) {
    console.error('usage: --source inaturalist|maplify --from YYYY-MM-DD --to YYYY-MM-DD [--step decade|year|quarter|month] [--dry-run]');
    process.exit(2);
}
const STEP_MONTHS = { decade: 120, year: 12, quarter: 3, month: 1 }[values.step ?? 'month'];
if (!STEP_MONTHS) { console.error('--step must be decade, year, quarter or month'); process.exit(2); }
const dryRun = values['dry-run'];
const maxDeleted = Number(values['max-deleted']);
const pauseMs = Number(values['pause-ms']);

// iNat asks for at most 60 requests a minute; a window of p pages costs about
// p + 1 requests (pages plus one taxa lookup, usually none), so never let a
// window and its pause take less than that many seconds. Maplify publishes no
// limit; one request a second is a courtesy there.
const MS_PER_REQUEST = 1000;

type Window = { start: string; end: string };

function addMonths(iso: string, months: number): string {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1 + months, d));
    return date.toISOString().slice(0, 10);
}

function windows(from: string, to: string, stepMonths: number): Window[] {
    const out: Window[] = [];
    for (let start = from; start < to; start = addMonths(start, stepMonths)) {
        const next = addMonths(start, stepMonths);
        out.push({ start, end: next < to ? next : to });
    }
    return out;
}

// The two Vault rows the cron reads (migration 20260706000000), via the same
// CLI route a curator uses. Returns the plaintext to this process only.
function vault(): { url: string; secret: string } {
    const out = execFileSync('npx', [
        'supabase', 'db', 'query', '--linked',
        "select name, decrypted_secret from vault.decrypted_secrets where name in ('ingest_function_url','ingest_trigger_secret')",
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const json = out.slice(out.indexOf('{'));
    const rows = (JSON.parse(json) as { rows: { name: string; decrypted_secret: string }[] }).rows;
    const url = rows.find(r => r.name === 'ingest_function_url')?.decrypted_secret;
    const secret = rows.find(r => r.name === 'ingest_trigger_secret')?.decrypted_secret;
    if (!url || !secret) throw new Error('Vault did not return ingest_function_url and ingest_trigger_secret');
    return { url, secret };
}

type Outcome = {
    ok: boolean; runId?: number; upserted?: number; deleted?: number;
    pagesFetched?: number; totalResults?: number; error?: string;
};

async function run(window: Window, creds: { url: string; secret: string }): Promise<Outcome> {
    const res = await fetch(creds.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ingest-secret': creds.secret },
        body: JSON.stringify({ source, start: window.start, end: window.end, dry_run: dryRun, trigger: 'manual' }),
    });
    const body = await res.json().catch(() => ({})) as Outcome;
    return { ...body, ok: res.ok && body.ok === true };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const plan = windows(values.from, values.to, STEP_MONTHS);
console.log(`${dryRun ? 'DRY RUN: ' : ''}${source}: ${plan.length} window(s), ${values.from} to ${values.to} by ${values.step}`);
const creds = vault();
let totalUpserted = 0, totalRequests = 0;
for (const w of plan) {
    const t0 = Date.now();
    const outcome = await run(w, creds);
    const elapsed = Date.now() - t0;
    const requests = (outcome.pagesFetched ?? 0) + 1;
    totalRequests += requests;
    totalUpserted += outcome.upserted ?? 0;
    console.log(`${w.start}..${w.end}  ${outcome.ok ? 'ok ' : 'FAIL'} run=${outcome.runId ?? '-'} results=${outcome.totalResults ?? '-'} pages=${outcome.pagesFetched ?? '-'} upserted=${outcome.upserted ?? '-'} deleted=${outcome.deleted ?? '-'} ${(elapsed / 1000).toFixed(1)}s${outcome.error ? `  ${outcome.error}` : ''}`);
    if (!outcome.ok) { console.error('stopping at the first failed window'); process.exit(1); }
    if ((outcome.deleted ?? 0) > maxDeleted) {
        console.error(`window deleted ${outcome.deleted} row(s), more than --max-deleted ${maxDeleted}; stopping`);
        process.exit(1);
    }
    await sleep(Math.max(0, requests * MS_PER_REQUEST - elapsed) + pauseMs);
}
console.log(`done: ${plan.length} window(s), ${totalUpserted} row(s) upserted, about ${totalRequests} ${source} requests`);
