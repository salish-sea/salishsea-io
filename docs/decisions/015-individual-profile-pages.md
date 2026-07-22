# 015 — Individual profile pages

**Status:** accepted (2026-07-07)
**Context:** GitHub [#49](https://github.com/salish-sea/salishsea-io/issues/49); builds on the catalog (decision 014, migrations `20260707200852` / `20260707220211`).

## Decision

Give every catalog individual a full page at **`/individuals/<primary_designation>`**
(e.g. `/individuals/T065A`), rendered client-side from a third Vite HTML entry
(`individual.html` + `<individual-page>`), following the `about.html` precedent —
no client-side router.

### URL scheme: path-based, resolved at the edge

CloudFront/S3 has no object at `/individuals/*`, so the existing viewer-request
Lambda@Edge (`infra/lib/edge-handler`) rewrites those paths to `/individual.html`
for humans and synthesizes catalog-driven OG meta for crawler user-agents (same
fail-open contract as `?o=`; unknown designations get the generic site card).
Fail-open only works if the handler's code sees the failure: the viewer-request
Lambda is hard-killed at 5s and CloudFront then serves a 503 (observed on the
2026-07-22 smoke run, bd `salishsea-io-g9e`), so every SSM and Supabase call in
the handler carries an `AbortSignal` deadline sized to keep the worst-case cold
chain under the kill — slowness degrades to the shell, never a 503.
The Vite dev/preview servers mirror the rewrite via a small middleware in
`vite.config.js`.

*Rejected:* `individual.html?id=T065A` (no infra change, but unattractive and
weaker for sharing/SEO — the whole point of the page is to be a reason to visit).

### Read path: one view, live resolution

A new `public.individual_occurrences` view flattens `occurrence_identifications`
to one row per (individual, occurrence, location), reaching every **current
member** of a group named in a group claim (`via_group` labels the weaker
inference). One PostgREST filter on `individual_id` powers the whole sightings
section: a presence-by-month grid plus a **static map** of everywhere the
animal has been reported (most recent emphasized; dots click through to the
main map on that day). Re-rendering `<obs-summary>` rows was tried and
rejected — a wall of borrowed sighting cards read poorly on a profile.
Resolution was initially **live** (regex over sighting text at read time,
~2s/query on prod). Migration `20260708000104` (bd `salishsea-io-be4`) moved
extraction + resolution into the `occurrence_identifier_candidates`
materialized view, refreshed by pg_cron a minute after each 5-minute ingest
tick and by the catalog seed script; per-individual reads dropped to
milliseconds. Stored claims (curation) still read live so a curator's edit
takes effect immediately; candidates lag ingest by ≤6 minutes.

### Honesty invariant carried to the UI

Per decisions 008/014 and the rights policy, the sightings section states that
its counts are mostly **unverified mentions** in sighting text (with "as
`<group>`" when the latest link is a via-group inference). Absence claims and
`rejected` identifications are excluded from the page. Identifier codes in
sighting text site-wide become links to profile pages
(`injectIndividualLinks`) — a navigation aid, never an identification claim;
matriline (`…s`) and non-catalog codes stay plain text.

Per **D-21** (rights-policy §7.1), nickname *stories* and `individuals.notes`
are verbatim Bigg's-sheet cells, a minority of which are creative prose — they
are **not rendered**, and the `nicknames.story` column is revoked from the
anon/authenticated API roles (column-level GRANT). Naming *facts* (name,
namer, year, theme, status) remain public. Restoring stories requires either
restating them as facts or securing permission.

## Consequences / follow-ups

- Matriline & pod (social-group) pages don't exist yet; group codes are
  deliberately unlinked until they do.
- Individual pages are not in `sitemap.xml` (it's built statically at deploy
  time; the catalog lives in the DB).
- Only Bigg's individuals are seeded; SRKW pages await the J/K/L catalog
  ingest (bd `salishsea-io-lzi`).
- Life events (births, deaths, notable sightings) have no schema — the page
  shows `life_status` and birth-year ranges only.
