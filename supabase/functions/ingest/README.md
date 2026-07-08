# Ingest endpoint — operator guide

The `ingest` Edge Function is the imperative shell for network ingest (Maplify,
iNaturalist). Design and rationale: [decision 011](../../../docs/decisions/011-ingest-imperative-shell.md).
It runs two ways:

- **Scheduled** — `pg_cron` + `pg_net` call it every 5 minutes with a rolling
  10-day window (see `20260706000000_cutover_ingest_to_edge_function.sql`).
- **Manual** — a curator calls it with an explicit window to **backfill** or
  **preview** a range. This file is about that path.

## Request

`POST` to the function URL with the trigger secret header. The body schema is
the source of truth in [`index.ts`](index.ts) (`RequestSchema`):

| field | values | notes |
|---|---|---|
| `source` | `maplify` \| `inaturalist` | required |
| `start`, `end` | `YYYY-MM-DD` | both or neither; `end` exclusive |
| `dry_run` | boolean | preview: fetch + reconcile, write nothing |
| `trigger` | `cron` \| `manual` | recorded on the run |

Both the URL and the secret live in Supabase **Vault** (`ingest_function_url`,
`ingest_trigger_secret`) and as an Edge Function secret — not in the repo.

## Triggering a backfill without the plaintext secret

The cleanest path reuses the cron mechanism: a Vault-authenticated
`net.http_post` from the database, so you never handle the secret. Run it with
`npx supabase db query --linked` (or any prod SQL console):

```sql
SELECT net.http_post(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='ingest_function_url'),
  headers := jsonb_build_object(
    'content-type','application/json',
    'x-ingest-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='ingest_trigger_secret')),
  body := jsonb_build_object('source','maplify','start','2025-08-01','end','2025-09-01','dry_run',true,'trigger','manual'),
  timeout_milliseconds := 120000
);
```

`net.http_post` is **async** — it enqueues and returns a request id. The function
runs a few seconds later and records the outcome in `ingest.runs`; read it there:

```sql
SELECT window_start, window_end, outcome, dry_run, total_results,
       rows_upserted, rows_deleted, error
FROM ingest.runs
WHERE source='maplify' AND window_start='2025-08-01'
ORDER BY id DESC LIMIT 1;
```

If you have the plaintext secret, a plain `curl` to the function URL with an
`x-ingest-secret` header and the same JSON body works too, and returns the
outcome synchronously.

## The one caveat: reconcile is authoritative per window

Within the fetched window, the function **deletes** any of that source's stored
rows not present in the fetch (decision 011's completeness invariant). So:

- **Safe for filling a gap** — if the window has no rows for that source yet,
  it is pure upsert (verify with `dry_run` first: `rows_deleted` should be 0).
- It only touches the **source's own table** (`maplify.sightings` /
  `inaturalist.observations`); native `SalishSea.io Direct` records are never
  affected.
- **Don't** run a narrow/partial re-fetch over a window you already have good
  data for unless you intend the fetch to be the new source of truth.

## After a backfill

Resolved identifier codes (which power the individual/matriline/ecotype pages)
come from the `occurrence_identifier_candidates` matview, refreshed by cron
within ~5 minutes. To see backfilled sightings immediately:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY public.occurrence_identifier_candidates;
```

## Practical notes

- **Chunk by month.** Maplify fetches a whole window in one request and
  iNaturalist paginates + resolves a taxon closure; month-sized windows keep
  each transaction bounded and give one legible `ingest.runs` row per month.
  Non-overlapping windows can be enqueued together (no reconcile conflict).
- **Coverage reality (2026-07):** live Maplify/iNaturalist ingest began
  2025-09-01; earlier history is only present where it has been manually
  backfilled. The upstream APIs still serve it — the Maplify window is just
  `search-all-sightings.php?start=&end=&BBOX=` (see [`fetch-maplify.ts`](fetch-maplify.ts)).
