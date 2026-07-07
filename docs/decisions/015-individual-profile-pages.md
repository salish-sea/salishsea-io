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
The Vite dev/preview servers mirror the rewrite via a small middleware in
`vite.config.js`.

*Rejected:* `individual.html?id=T065A` (no infra change, but unattractive and
weaker for sharing/SEO — the whole point of the page is to be a reason to visit).

### Read path: one view, live resolution

A new `public.individual_occurrences` view flattens `occurrence_identifications`
to one row per (individual, occurrence), reaching every **current member** of a
group named in a group claim (`via_group` labels the weaker inference). One
PostgREST filter on `individual_id` powers both the recent-sightings list and
the presence-by-month grid. Resolution stays **live** (regex over sighting text
at read time, ~2s/query on prod) — acceptable for an async page section today;
indexing candidates ahead of time is deliberately deferred until the live path
actually hurts (bd `salishsea-io-*`, see follow-ups).

### Honesty invariant carried to the UI

Per decisions 008/014 and the rights policy, regex-derived links are presented
as **"unverified mention"** (with "mentioned as `<group>`" for via-group rows);
only `validated` claims render as verified. Absence claims and `rejected`
identifications are excluded from the page. Identifier codes in sighting text
site-wide become links to profile pages (`injectIndividualLinks`) — a
navigation aid, never an identification claim; matriline (`…s`) and
non-catalog codes stay plain text.

## Consequences / follow-ups

- Matriline & pod (social-group) pages don't exist yet; group codes are
  deliberately unlinked until they do.
- Individual pages are not in `sitemap.xml` (it's built statically at deploy
  time; the catalog lives in the DB).
- Only Bigg's individuals are seeded; SRKW pages await the J/K/L catalog
  ingest (bd `salishsea-io-lzi`).
- Life events (births, deaths, notable sightings) have no schema — the page
  shows `life_status` and birth-year ranges only.
