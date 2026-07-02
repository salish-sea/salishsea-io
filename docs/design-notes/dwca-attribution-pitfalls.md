# Pitfalls Research

**Domain:** Adding a provenance/attribution graph + Maplify backfill to a multi-schema biodiversity database that publishes a DarwinCore Archive to GBIF/OBIS
**Researched:** 2026-06-19
**Confidence:** HIGH — grounded in the actual production schema, the existing dwc migration, fields.ts, and the v1.3 executive summary. Counts and signal inventories are from the live prod sample cited in EXECUTIVE-SUMMARY.md.

---

## How to read this file

Severities:

- **GBIF-BLOCKER** — breaks the GBIF export or causes duplicate records in GBIF. Must prevent or SRC-01 / attribution is wrong publicly.
- **DATA-LOSS** — silently drops correct resolution or corrupts assignment at scale. Hard to detect after backfill commits.
- **IRREVERSIBLE** — once applied to prod, rolling back requires a new migration + another backfill pass.
- **SCHEMA-BREAK** — breaks view compilation, the nightly archive, or the TS pipeline the moment the migration runs.
- **SILENT** — does not error but produces wrong data; hardest class to catch.

---

## Critical Pitfalls

### Pitfall 1: Accidentally re-exporting iNaturalist or HappyWhale rows (SRC-01 violation → GBIF duplication) — GBIF-BLOCKER

**What goes wrong:**
iNat (8,759 rows) and HappyWhale (5,601 rows) self-publish to GBIF via their own canonical datasets. If either provider's rows flow into `dwc.occurrences` — even via a stale WHERE clause, a new JOIN path, or a provider_id that was never filtered — GBIF will index them twice: once from SalishSea.io, once from the canonical source. GBIF deduplication is imperfect (it matches on coordinates + date, not occurrenceID across datasets); duplicates appear as inflated occurrence counts for the species.

**Why it happens:**
The current `dwc.occurrences` excludes iNat/HappyWhale by construction (they are simply not in the UNION). Adding `provider_id`, `collection_id`, etc. as FKs to source tables requires touching `dwc._maplify_occurrences` and `dwc._native_occurrences`. Any migration that accidentally widens the UNION (e.g. to add a third branch for "all providers") or drops a filter will let excluded rows in. Likewise, a URL-pattern resolver that resolves `inaturalist.org` URLs and then surfaces those rows in the export is a trap.

**How to avoid:**
- Keep the UNION as exactly two branches: `_native_occurrences` (public.observations) and `_maplify_occurrences` (maplify.sightings). Never add a third branch pointing at `inaturalist.*` or `happywhale.*` even "just to see." The exclusion is by construction, not by a WHERE filter that could be removed.
- After each migration that touches `dwc.*`, run a row-count assertion: `SELECT COUNT(*) FROM dwc.occurrences` must not exceed `(SELECT COUNT(*) FROM public.observations) + (SELECT COUNT(*) FROM maplify.sightings WHERE NOT is_test AND number_sighted BETWEEN 1 AND 1000 AND source != 'rwsas')`. Any surplus signals a third source leaked in.
- The URL-pattern resolver must map `inaturalist.org` and `happywhale.com` patterns to their provider entries in the new `providers` table, but those providers must never appear in the DwC export. Resolve collection, record in DB — but the export filter stays on source table identity, not provider_id.

**Warning signs:**
Row count in dwc.occurrences jumps by ~8k or ~5k after a migration. GeoParquet or CSV record count exceeds prior nightly baseline by more than daily new sightings. GBIF shows the same sighting from two different datasets.

**Phase to address:** Schema phase (define providers table + SRC-01 invariant as a migration-time assertion). DwC view modification phase (verify the UNION branches are unchanged). Archive generation phase (add the row-count gate to the nightly guard).

---

### Pitfall 2: institutionCode / rightsHolder / datasetName misuse in the new projection — GBIF-BLOCKER + SILENT

**What goes wrong:**
The current `dwc._maplify_occurrences` emits `rightsHolder = dn.display_name` (the per-source name, e.g. "Orca Network") and `datasetName = dn.display_name`. After v1.3 the plan is `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, and `datasetName="SalishSea.io — {collection.name}"`. Three failure modes:

1. **Setting `institutionCode` to the upstream org name** (e.g. `institutionCode="Orca Network"`) — GBIF treats `institutionCode` as the publisher. Publishing with an org's code you don't represent misidentifies you to GBIF and can create a false institutional dataset entry.
2. **Keeping `rightsHolder` as the contributor/org** after switching to the aggregator pattern — conflicts with CC license assertion. For the aggregator pattern, SalishSea.io holds the rights (by agreement or by operating as the publisher); per-contributor credit goes in `recordedBy`, not `rightsHolder`.
3. **Mismatch between `datasetName` in `_native_occurrences` and in `dwc.datasets.title`** — the v1.2 migration hardcodes `'SalishSea.io Cetacean Occurrences (v1.2)'` as both the native branch datasetName and the dwc.datasets title. After v1.3, native rows will emit `'SalishSea.io — Direct'` as datasetName while the EML title presumably stays the archive-level name. These are different semantic levels and must not be conflated. The EML title describes the whole archive; per-row `datasetName` describes the collection.

**How to avoid:**
- `institutionCode` = `"SalishSea"` (fixed, our aggregator code) on all exported rows. Never propagate upstream `dwc_institution_code` values from `organizations` to `institutionCode`.
- `rightsHolder` = `"SalishSea.io"` on all exported rows. Upstream org credit goes in `samplingProtocol` or `bibliographicCitation`, not `rightsHolder`.
- `datasetName` = `"SalishSea.io — {collection.name}"` per row, joining from the new `collections` table. The EML `<title>` is separately managed.
- Add a migration assertion: `SELECT DISTINCT "institutionCode" FROM dwc.occurrences` must return only `'SalishSea'`. Zero tolerance for upstream org codes leaking here.

**Warning signs:**
GBIF dataset page lists an institution other than SalishSea.io. `rightsHolder` column contains person names or org names. `SELECT DISTINCT "institutionCode"` returns more than one value.

**Phase to address:** DwC view modification phase (the phase that rewrites `_native_occurrences` and `_maplify_occurrences` to join to collections).

---

### Pitfall 3: Backfill typo-variant dedup collapses distinct rows or misses variants — DATA-LOSS + IRREVERSIBLE

**What goes wrong:**
Four typo variants of "Orca Network" are documented in prod: `" Orca Network"` (leading space), `"Orca Networ"`, `"Orca Networks"`, `"Orca Neteork"`. The backfill dictionary must map all four to the canonical `collections.id` for Orca Network. Failure modes:

1. **Missing a variant** — those rows get `collection_id = NULL`, which is wrong and invisible unless you count the resolved vs unresolved rows after backfill.
2. **Fuzzy matching a variant to the wrong collection** — e.g. a Levenshtein-distance match that treats "Orca Network" and "Orca Networks" as equivalent (correct) but also catches "Orca Sound" and maps it to Orca Network (wrong).
3. **Treating the dictionary as closed before doing a final `SELECT DISTINCT` audit** — the executive summary documents the *known* variants but the description says "human-eyeballed"; the prod sample may not be complete. New variants may exist that weren't in the sample.

**Why it happens:**
The milestone explicitly decided on exact-match-only resolution (no alias table, no runtime fuzzy matching). That decision prevents ongoing maintenance complexity but it means the one-time backfill dictionary must be exhaustively correct. Human-eyeball resolution over a small prod sample is vulnerable to sampling gaps.

**How to avoid:**
- Before writing the backfill, run `SELECT DISTINCT TRIM(regexp_match(comments, '^\[([^\]]*)\]')[1]) AS tag, COUNT(*) FROM maplify.sightings WHERE comments ~ '^\[' GROUP BY 1 ORDER BY 2 DESC` against prod to get the complete tag universe, not just the sample.
- Build the backfill as a `collection_aliases` migration table (even if the runtime system doesn't use aliases), or as a SQL CASE mapping that is reviewable in a migration diff, not a script that runs once and is gone.
- After the backfill runs, run a verification query: `SELECT COUNT(*) FROM maplify.sightings WHERE comments ~ '^\[' AND collection_id IS NULL` — any non-zero result means the dictionary is incomplete.
- Do not use UPDATE ... WHERE comments ILIKE '%orca network%' — that is fuzzy and will catch rows it should not (e.g. a comment that mentions Orca Network in passing, not as a bracket tag).

**Warning signs:**
Post-backfill NULL count for bracket-tagged rows is non-zero. A collection_id is assigned to rows where the bracket tag references a different collection. The "Orca Neteork" spelling appears in a post-backfill audit as still-unresolved.

**Phase to address:** Backfill phase. Run the complete-universe audit query in the phase plan before writing any UPDATE statements.

---

### Pitfall 4: Dual-signal collision — bracket tag and trailing attribution disagree, or both resolve to different collections — SILENT

**What goes wrong:**
The resolution order is: `source_url` pattern → bracket tag → trailing attribution → `source` code → NULL. But for ~2,740 rows the trailing attribution IS the only collection signal (Cascadia / Whale Alert / TMMC rows have no bracket tag). And some rows may have BOTH signals that disagree — e.g. a bracket tag `[Orca Network]` on a row that also has `Submitted by a Cascadia Trusted Observer`. If the resolution naively takes both and writes `collection_id` to the first match only, the second signal is silently discarded and the wrong collection wins.

**Why it happens:**
The signals were designed for different collection populations (bracket tags for community FB groups; trailing attribution for aggregator trust-tier networks). They don't conflict in the normal case, but nothing prevents a single Maplify row from having both — and there is no documented precedence rule for the intra-comment collision case.

**How to avoid:**
- Define the precedence rule explicitly in code: bracket tag wins over trailing attribution for the same row (it is the stronger signal — it was intentionally placed). Emit a warning log for any row where both signals are present and they resolve to *different* collections.
- Before running the backfill, run an audit query: `SELECT id, comments FROM maplify.sightings WHERE comments ~ '^\[' AND comments ~ 'Submitted by a .* Trusted Observer'` to size the collision set. If it is large or has unexpected patterns, revisit the precedence rule.
- The trailing "Submitted by" line must NOT be parsed for contributor names — the executive summary explicitly corrects the earlier note: it names an org/trust-tier, not a person. Parsing it as a contributor is a category error.

**Warning signs:**
Post-backfill sanity query shows rows with collection_id pointing to "Cascadia Research Collective" that also have a bracket tag for a different collection. Any row where `contributor_id` was set from a "Submitted by ... Trusted Observer" line.

**Phase to address:** Backfill design phase (define collision precedence rule before writing SQL). Backfill verification (audit query for dual-signal rows).

---

### Pitfall 5: Backfill modifies comments column, destroying the audit trail — IRREVERSIBLE

**What goes wrong:**
The design note (collections-and-contributors-model.md) specifies that the backfill "sets `collection_id`, leaves `comments` untouched." The bracket tag and trailing attribution lines are the only evidence linking a row to its resolved collection. If a future step strips them from `comments` — even by accident in a regex-replace meant to clean up display text — the audit trail is gone. You cannot verify whether `collection_id = 3` on a row is correct without the original comment.

**How to avoid:**
- Make it a hard rule in the backfill phase plan: `comments` is read-only during the backfill. The UPDATE statement sets only `collection_id` (and `contributor_id`, `provider_id`, `source_url` where applicable). It never modifies `comments`.
- The DwC projection strips bracket tags and attribution lines in `occurrenceRemarks` via `regexp_replace(s.comments, '<[^>]+>', '', 'g')` (HTML stripping). After v1.3, if attribution lines need to be removed from the public-facing `occurrenceRemarks`, do it in the view definition (read-time transformation), not as a backfill UPDATE.
- Add a migration-level comment on `maplify.sightings.comments`: "Audit trail — never UPDATE this column post-ingestion."

**Warning signs:**
Any migration that contains `UPDATE maplify.sightings SET comments = ...`. Any script that runs after backfill and touches the comments column.

**Phase to address:** Backfill phase (explicit constraint in the plan: comments is immutable).

---

### Pitfall 6: Making collection_id NOT NULL on source tables before backfill completes — SCHEMA-BREAK + IRREVERSIBLE

**What goes wrong:**
The design specifies `collection_id` as required (NOT NULL) on sighting rows. If the NOT NULL constraint is added before the backfill runs (or partway through), any existing row without a `collection_id` fails the constraint check, the migration aborts, and you are left with a half-migrated schema. Alternatively, if NOT NULL is enforced on new-ingest code paths before a default collection exists for Maplify's unresolved rows, new Maplify ingest breaks immediately.

**Why it happens:**
NOT NULL is the correct long-term constraint. Developers often add it in the same migration as the column, which is correct for new tables but wrong for backfilling existing data.

**How to avoid:**
- Add `collection_id` as nullable (`NULL` allowed) in the schema migration. Run the backfill. Then, only after verifying zero-NULL counts for in-scope rows, add the NOT NULL constraint in a subsequent migration — or leave it nullable with an application-layer required validation if truly optional for some providers.
- The executive summary is clear that iNat and HappyWhale have single collections ("iNaturalist" and "HappyWhale" respectively) — their rows can be filled immediately. Maplify requires the backfill. Native rows join to `public.contributors` and already have structured provenance, so they can be filled in the schema migration.
- For new Maplify ingest going forward: set `collection_id` from the URL-pattern resolver or bracket-tag exact match at ingest time; unmatched rows get NULL collection_id (not an error). A Supabase check constraint can enforce "if source = native then collection_id IS NOT NULL" but not globally.

**Warning signs:**
Migration fails with `ERROR: column "collection_id" of relation contains null values` when adding NOT NULL. New Maplify ingest rejects rows because collection_id has no default.

**Phase to address:** Schema phase (add nullable column) → Backfill phase → (optional) constraint hardening phase.

---

### Pitfall 7: False contributor identity unification across providers — SILENT + IRREVERSIBLE

**What goes wrong:**
`jmaughn` (iNaturalist, 277 observations) is "almost certainly" James Maughn (native contributor). If the implementation unifies them — creating a shared `contributors.id` across providers — it makes a probabilistic claim as a factual FK. Consequences: the wrong person is credited for observations, `recordedBy` in the DwC export is wrong for unified rows, and the error is invisible because there is no source-of-truth to validate against.

**Why it happens:**
Name similarity + matching handle-to-name patterns feel like strong evidence. The pressure to "clean up" contributor fragmentation is real. But display names are not unique identifiers and cross-provider evidence (username similarity, overlap in observation dates/locations) is not equivalent to verified identity.

**How to avoid:**
- The executive summary says "v1.3 models contributors per provider; unification may be deferred." Enforce this as a schema-level constraint: `contributors` rows carry a `provider_id` FK (or a source-provider scope marker). Cross-provider unification requires an explicit, human-confirmed link table (e.g. `contributor_links`) — not a shared primary key.
- The iNat `jmaughn` example should be documented as a known probable match but left un-merged until a human confirms it (or until a separate identity-resolution phase explicitly addresses it).
- Do not use email address or display name as a cross-provider unique key.

**Warning signs:**
A `contributors.id` is assigned to observations from two different providers in `public.observations` and `inaturalist.observations` simultaneously. `recordedBy` in the DwC export shows the same person credited for both native and iNat rows.

**Phase to address:** Schema phase (define contributors-per-provider model; no shared FK across providers). Open question carried into design explicitly.

---

### Pitfall 8: view-parity breakage when adding institutionCode to dwc.occurrences — SCHEMA-BREAK

**What goes wrong:**
The existing `dwc.occurrences` UNION ALL enforces a strict 25-column parity contract at view-creation time in Postgres: if `_native_occurrences` and `_maplify_occurrences` differ in column count, type, or order, `CREATE VIEW dwc.occurrences` fails. Adding `institutionCode` (a new 26th column) requires updating ALL of:

1. `dwc._native_occurrences` — add the column with explicit cast
2. `dwc._maplify_occurrences` — add the column in the same ordinal position with the same cast
3. `dwc.occurrences` — recompiled via `CREATE OR REPLACE VIEW` or a new `DROP + CREATE`
4. `scripts/dwca/fields.ts` `OCCURRENCE_FIELDS` array — add the entry at the matching index
5. `scripts/dwca/fields.test.ts` — update the count assertion (currently expects 25)
6. The `meta.xml` descriptor that `meta-xml.ts` generates from `OCCURRENCE_FIELDS` — index 25 must be added

If any of these six sites is out of sync, the result is either a compile-time view error (caught at migration time) or a silent column-index shift in the archive (not caught until `fields.test.ts` runs or the archive is validated).

**Why it happens:**
The 25-column contract is a deliberate design choice (RESEARCH Pitfall 4 in the v1.2 file). Adding a column looks like a simple `ALTER VIEW` but there is no `ALTER VIEW ADD COLUMN` in Postgres — views must be dropped and recreated. The TS file is in a separate artifact and is only linked by convention (the OCCURRENCE_FIELDS comment says "order MUST match"). There is no build-time type check between the SQL and the TS.

**How to avoid:**
- In the migration that adds `institutionCode`, recreate both branch views and the UNION view in one migration file, in the correct order (branch views first, then union). Do not attempt to ADD to an existing view.
- Simultaneously open `fields.ts` in the same PR and add the `institutionCode` entry at the correct ordinal. Run `npm test` for the fields test before merging.
- Check whether `institutionCode` belongs in `OCCURRENCE_FIELDS` at all — GBIF reads it from the EML `<publishingOrganization>` metadata, not necessarily as a per-row field. If it belongs in EML only (not as a per-row column), do not add it to `OCCURRENCE_FIELDS` or the view. Confirm this against GBIF guidance before modifying the view.
- The v1.2 migration comments say the `datasetName` for the Maplify branch is the sub-source name, not the parent title. After v1.3, `datasetName` changes to `"SalishSea.io — {collection}"`. Verify that the `dwc.datasets` view title and the per-row `datasetName` values are semantically distinct and that the EML generator does not conflate them.

**Warning signs:**
`CREATE VIEW dwc.occurrences` raises `ERROR: each UNION query must have the same number of columns`. `fields.test.ts` fails with column-count assertion mismatch. Archive nightly job produces a CSV with 26 columns but meta.xml declares 25 fields.

**Phase to address:** DwC view modification phase (must be a coordinated SQL + TS change in the same PR with a test gate).

---

### Pitfall 9: URL-pattern resolver false matches or overly-broad patterns — SILENT

**What goes wrong:**
The resolver maps domain/path patterns to provider + collection. Overly-broad patterns produce false matches:

- `facebook.com/*` → "Facebook Group" is not a valid collection because many FB URLs are profile pages, not group posts. Pattern must be `facebook.com/groups/{slug}/posts/*` or similar.
- `inaturalist.org/*` → maps to iNat provider. But iNat has multiple URL patterns: `inaturalist.org/observations/{id}`, `www.inaturalist.org/observations/{id}`, `inaturalist.ca/...` (Canada instance). Matching only the first misses the others. Matching `inaturalist.*/` is too broad.
- A `source_url` that happens to contain a domain substring but is not a record URL (e.g. a description field containing a hyperlink) matches incorrectly.

**How to avoid:**
- Pattern registry should use exact domain + path-prefix matching, not substring or regex on the full URL string. The registry should enumerate supported patterns explicitly.
- For iNat: match both `inaturalist.org/observations/` and `www.inaturalist.org/observations/`. For Facebook: require `/groups/` in the path.
- Apply the resolver only to `source_url` values that are well-formed HTTP/HTTPS URLs. Validate with `regexp_match(source_url, '^https?://')` before pattern matching.
- The resolver should have a fallthrough to NULL (no match) rather than a default collection. A NULL result from the resolver triggers the next signal (bracket tag), not an assignment to a catch-all collection.
- After resolver runs on the full prod dataset, audit: `SELECT COUNT(*), collection_id FROM maplify.sightings WHERE source_url IS NOT NULL GROUP BY 2` — the count for any unexpected collection_id flags a false match.

**Warning signs:**
A Maplify row with no URL-like source_url gets a collection assigned from the resolver. iNat rows with `.ca` domains remain unresolved. Facebook profile URLs (non-group) get assigned to a group collection.

**Phase to address:** URL-resolver implementation phase (define the pattern registry with explicit path-prefix matching before wiring it into the backfill).

---

### Pitfall 10: RLS on new tables blocks the nightly DwC export job — SCHEMA-BREAK (silent operational failure)

**What goes wrong:**
New tables (`providers`, `organizations`, `collections`) will get default Supabase RLS behavior. If `ENABLE ROW LEVEL SECURITY` is set without a permissive policy for the `service_role` or the DuckDB ATTACH connection, the nightly archive generation job (which reads `dwc.occurrences`, which JOINs to these new tables) will silently return zero rows for collection-joined columns, or the JOIN itself will return no rows, emptying the export.

**Why it happens:**
Supabase's default is RLS-enabled on new tables, with no policies = no rows for non-service-role connections. The DuckDB ATTACH uses the Postgres connection (service role inherits), but if RLS is enabled and no policy exists, even service_role may be blocked depending on how the role is configured.

**How to avoid:**
- Add explicit RLS policies at migration time: these tables are read-only reference data — `GRANT SELECT ON providers, organizations, collections TO anon, authenticated` and a permissive SELECT policy for all roles if RLS is enabled.
- Or, if these are internal-only tables not exposed via PostgREST, do NOT add them to `supabase/config.toml:api.schemas`, and leave RLS disabled (consistent with the dwc schema treatment). Verify by running the DwC view locally after migration and confirming row counts match expectations.
- Add to the migration test suite: `SELECT COUNT(*) FROM dwc.occurrences` after the new JOIN is added must return the same count as before the migration.

**Warning signs:**
Post-migration: `SELECT COUNT(*) FROM dwc.occurrences` returns 0 or fewer rows than expected. Nightly archive has 0 records but no error. The DuckDB job completes but the archive is empty (tripped by the existing empty-result guard).

**Phase to address:** Schema phase (include RLS/grant decisions in the table-creation migration, not as a follow-up).

---

### Pitfall 11: Maplify `source` code and bracket tag disagree; source code treated as higher-priority than comment signals — SILENT

**What goes wrong:**
The resolution order puts `source_url` pattern first, then bracket tag, then trailing attribution, then `maplify.sightings.source` code last. But the existing `dwc._maplify_occurrences` view built its entire `display_name` LATERAL CASE on the `source` code (arms: `orca_network`, `cascadia`, else `Whale Alert / Maplify`). The `source` code is a coarse signal — the `cascadia` code applies to Cascadia Research Collective rows, but the trailing attribution distinguishes "Cascadia Trusted Observer" from "Whale Alert Alaska Trusted Observer" (both might have the same source code). If the v1.3 backfill uses `source` as a fallback that overwrites a more-specific trailing-attribution resolution, coarser attribution wins.

**How to avoid:**
- Treat `maplify.sightings.source` as the lowest-priority signal — a fallback only when comments carry no bracket tag AND no trailing attribution.
- Before writing the backfill, audit: `SELECT source, COUNT(*) FROM maplify.sightings WHERE comments !~ '^\[' AND comments !~ 'Trusted Observer' GROUP BY 1` — this is the population where the source code is the only signal. The backfill for this population assigns collections based on the source code map.
- After backfill, verify that no row where a trailing-attribution was parsed has its collection_id set to a collection that maps to the source code but not the attribution text.

**Warning signs:**
All "Whale Alert Alaska" rows (which should resolve to `collection = 'Whale Alert (Alaska)'`) are instead assigned to the generic "Whale Alert (Global)" collection because the Alaska source code maps to the same bucket as global.

**Phase to address:** Backfill design phase (signal-precedence specification must precede any SQL).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use fuzzy matching (pg_trgm) for bracket-tag backfill | No manual dictionary needed | Incorrect merges across similar-but-distinct org names; hard to audit | Never — the milestone explicitly decided exact-match |
| Set collection_id NOT NULL immediately (before backfill) | Schema correctness at rest | Migration fails or leaves broken schema; Maplify ingest breaks | Never — add nullable, backfill, then constrain |
| Unify jmaughn → James Maughn now, while adding contributors table | Cleaner data immediately | Incorrect attribution if guess is wrong; hard to undo | Never — leave as open question; document as probable match |
| Add institutionCode to dwc.occurrences without updating fields.ts simultaneously | Gets the SQL right faster | Silent column-count mismatch in archive until test catches it | Only as a draft commit — never merge without TS + test update |
| Strip bracket tags from `comments` during backfill | Cleaner display | Destroys audit trail; can't verify collection_id assignments later | Never — strip at view/read time only |
| Map `maplify.sightings.source` code directly to collection_id without consulting comment signals | Simple one-pass backfill | Coarse attribution for ~2,740 trailing-attribution rows that have finer resolution available | Never for initial backfill — use full signal stack |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| dwc.occurrences UNION + new JOIN to collections | Adding a new column to only one branch view, leaving the other unchanged | Update both `_native_occurrences` and `_maplify_occurrences` in the same migration, then recreate the UNION view |
| fields.ts OCCURRENCE_FIELDS + new SQL column | Adding column to SQL migration without matching fields.ts update | Treat as a coupled change — same PR, same review, `npm test` gate |
| Maplify bracket-tag backfill | Running UPDATE on partial prod sample; not auditing full tag universe | Run `SELECT DISTINCT tag` on full prod table before writing the dictionary |
| URL-pattern resolver + SRC-01 | Resolving iNat/HappyWhale URLs to their providers, then accidentally exporting those providers | Resolver assigns provider_id/collection_id in DB; export filter stays on source-table identity, not provider_id |
| Supabase RLS on reference tables | New tables inherit default RLS = no rows | Explicitly grant SELECT or disable RLS for internal reference tables at migration time |
| Trailing "Submitted by ... Trusted Observer" line | Parsing as contributor (person) rather than collection/org signal | This line names a trust-tier/org, not a human — use for collection resolution only, never contributor |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Backfill running as a single UPDATE against all 6,827 Maplify rows at once | Table lock for minutes; replication lag; timeout on Supabase managed Postgres | Batch by id range (1000 rows at a time); run in off-peak window | All sizes — Supabase has statement timeouts |
| JOIN from dwc.occurrences to collections on collection_id without an index | Nightly archive generation slows as collection table grows | Index `maplify.sightings.collection_id` and `public.observations.collection_id` at column-creation time | When the export view must join >5k rows to the collections table |
| Full URL-pattern resolver running per-row regex in the view | view evaluation cost multiplies with regex complexity | Resolve at ingest/backfill time, store in `source_url` FK column; don't run resolver in the view | Any scale — regex in a view with 15k rows is measurably slow |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing `organizations.url` or `collections.url` via PostgREST without sanitization | Link injection / open redirect if URLs are contributor-supplied | These are seed/admin data (not user-submitted), but still: do not add to `api.schemas` unless explicitly needed for UI; validate URLs in migrations |
| Granting broad INSERT/UPDATE on providers/collections/organizations to `authenticated` role | Any logged-in user can add collections, polluting the reference table | These are admin/seed tables — `authenticated` gets SELECT only; INSERT/UPDATE/DELETE to `service_role` only |

---

## "Looks Done But Isn't" Checklist

- [ ] **Backfill completeness:** `SELECT COUNT(*) FROM maplify.sightings WHERE comments ~ '^\[' AND collection_id IS NULL` returns 0 after backfill.
- [ ] **Trailing-attribution completeness:** `SELECT COUNT(*) FROM maplify.sightings WHERE comments ~ 'Trusted Observer' AND collection_id IS NULL` returns 0 (or a known-unresolved count with a logged reason).
- [ ] **SRC-01 invariant:** `SELECT COUNT(*) FROM dwc.occurrences` does not exceed native + Maplify row counts after any migration touching the dwc schema.
- [ ] **institutionCode uniformity:** `SELECT DISTINCT "institutionCode" FROM dwc.occurrences` returns exactly `{'SalishSea'}` and nothing else.
- [ ] **rightsHolder uniformity:** `SELECT DISTINCT "rightsHolder" FROM dwc.occurrences` returns exactly `{'SalishSea.io'}` — not contributor names, not org names.
- [ ] **datasetName per-collection:** `SELECT DISTINCT "datasetName" FROM dwc.occurrences` returns `~10+ distinct values` (one per collection), all prefixed `'SalishSea.io — '`.
- [ ] **fields.ts column count:** `OCCURRENCE_FIELDS.length` in fields.ts equals the number of columns in `dwc._native_occurrences` SELECT list.
- [ ] **Trailing "Submitted by" not parsed as contributor:** `SELECT COUNT(*) FROM <target_table> WHERE contributor_id IS NOT NULL AND source_description ~ 'Trusted Observer'` returns 0.
- [ ] **comments column unchanged:** `SELECT COUNT(*) FROM maplify.sightings WHERE comments != original_comments_snapshot` — run a before/after hash check on a sample.
- [ ] **URL resolver no false iNat/HappyWhale export:** No row in dwc.occurrences has an occurrenceID prefixed `'inaturalist:'` or `'happywhale:'`.
- [ ] **RLS/grants:** `SET ROLE anon; SELECT COUNT(*) FROM providers` returns >0 if providers should be accessible, or fails predictably if not.
- [ ] **New FKs don't break existing ingest:** Run the Maplify ingest script against local DB after migration; confirm rows with no matching collection still insert (collection_id nullable).

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| SRC-01 violated — iNat/HappyWhale in export | HIGH — GBIF dedup is imperfect; must notify GBIF | Immediately take down archive, fix UNION branches, regenerate, republish; contact GBIF to flag the bad dataset publication |
| institutionCode published with wrong org code | MEDIUM — reputational; requires archive re-issue | Fix view, regenerate archive, re-issue; update EML; if GBIF-registered, update dataset metadata there |
| Backfill dictionary missing variants → collection_id NULL | LOW (if caught pre-prod) / MEDIUM (if in prod) | Add missing aliases to dictionary, re-run UPDATE for affected rows only; verify with completeness query |
| comments column modified by backfill | HIGH — audit trail gone | Restore from pre-backfill snapshot (Supabase PITR); rewrite backfill to be comments-read-only; re-run |
| False contributor identity unification | MEDIUM — requires correcting FK assignments | Add `contributor_links` table for cross-provider claims; unset the incorrect shared FK; re-run DwC export |
| fields.ts + SQL column count mismatch published | MEDIUM — archive consumers get wrong columns | Rollback fields.ts to 25 entries, regenerate archive immediately; then fix in coordinated PR |
| collection_id NOT NULL added before backfill | LOW (migration rejected) / MEDIUM (if on prod) | New migration to drop NOT NULL; apply backfill; re-add constraint |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 SRC-01 / GBIF duplication | Schema phase (providers table) + DwC view modification phase | Row-count assertion gate in nightly job; `SELECT DISTINCT occurrenceID prefix` |
| 2 institutionCode/rightsHolder/datasetName misuse | DwC view modification phase | `SELECT DISTINCT "institutionCode"` = `{'SalishSea'}` only |
| 3 Backfill typo-variant dedup | Backfill phase (full-universe audit query first) | Zero-NULL count for bracket-tagged rows after backfill |
| 4 Dual-signal collision | Backfill design phase (precedence rule spec) | Audit query for rows with both signals; no contributor_id from "Trusted Observer" |
| 5 Backfill modifies comments | Backfill phase (explicit constraint in plan) | Before/after hash check on sample; no UPDATE on comments column |
| 6 collection_id NOT NULL premature | Schema phase (nullable column first) | Migration sequence: nullable → backfill → constraint |
| 7 False contributor identity unification | Schema phase (per-provider contributor model) | No shared contributor_id across provider boundaries without explicit link table |
| 8 view-parity / fields.ts breakage | DwC view modification phase (coordinated SQL + TS PR) | `npm test` gate; `fields.test.ts` column-count assertion |
| 9 URL-pattern false matches | URL-resolver implementation phase | Post-resolver audit query on collection_id distribution; null fallthrough for non-matches |
| 10 RLS/grants on new tables | Schema phase (include in table-creation migration) | `SET ROLE anon; SELECT COUNT(*)` smoke test after migration |
| 11 `source` code overrides finer trailing-attribution resolution | Backfill design phase (signal-precedence spec) | Verify Whale Alert Alaska rows resolve to correct collection, not generic Whale Alert |

---

## Sources

- Production schema: `supabase/migrations/20250903172708_initial_schema.sql` (maplify.sightings definition)
- DwC projection: `supabase/migrations/20260617203900_dwc_schema.sql` (25-column contract, UNION ALL, LATERAL CASE)
- TS field list: `scripts/dwca/fields.ts` (OCCURRENCE_FIELDS ordinal contract)
- v1.3 Executive Summary: `.planning/v1.3-EXECUTIVE-SUMMARY.md` (prod counts, signal inventory, resolution order)
- Design note: `.planning/notes/collections-and-contributors-model.md` (graph model, Maplify-bias note)
- v1.2 Requirements: `.planning/milestones/v1.2-REQUIREMENTS.md` (SRC-01 definition, ALIGN requirements)
- GBIF occurrence issues: https://techdocs.gbif.org/en/data-use/occurrence-issues-and-flags
- GBIF aggregator pattern: confirmed via Happywhale→OBIS-SEAMAP (zd_1764) and iNaturalist Research-grade Observations on GBIF (cited in design note)

---
*Pitfalls research for: v1.3 Providers, Collections & Contributors — attribution graph + Maplify backfill*
*Researched: 2026-06-19*
