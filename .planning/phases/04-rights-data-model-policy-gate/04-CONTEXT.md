# Phase 4: Rights & Data-Model Policy (gate) - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase produces the single authoritative **rights & data-model-gap policy document** — the resolution (or explicit framing) of every licensing, attribution, and data-gap decision — so the downstream `dwc` schema (Phase 5) and generator (Phase 6) have one authoritative policy to encode and nothing left to silently fudge. **This phase writes decisions, not code.**

**Key reframe (drives everything below):** Most third-party sources have **no clear redistribution policy**. Rather than assert settled policy where none exists, this milestone *builds the full archive* and uses it to **clarify and frame the open questions**, while **gating public exposure** of third-party records on direct conferral with those organizations. The real gate is organizational conferral, not a ToS guess.

Requirements covered: GAP-01, GAP-02, GAP-03, GAP-04.
</domain>

<decisions>
## Implementation Decisions

### Redistribution gate (reframed: conferral, not ToS guess)
- **D-01:** Build at **full scope** — Maplify/Whale Alert records are included in the `dwc` projection, archive, and GeoParquet. Engineering does not wait on the rights questions.
- **D-02:** Technical default for what goes *into* the archive is **include-and-attribute** (full native + Whale Alert scope with structured attribution/provenance). Retreat from a source only on explicit prohibition or a "no" during conferral.
- **D-03:** **Per-`source` drop granularity.** If a nested Whale Alert sub-source (maplify `source` column: Orca Network, Cascadia, rwsas, …) declines or has prohibitive terms, drop *only* that sub-source — not the whole feed. The `dwc` projection must support filtering by `maplify.source`.
- **D-04:** The Phase 4 policy document **frames open questions for conferral** rather than asserting resolutions: it records that most sources have no clear redistribution stance and lists the specific question(s) to take to each organization (Whale Alert / Orca Network / Cascadia) before their records are publicly exposed.

### Public exposure / hold policy
- **D-05:** During the pre-conferral hold, the archive is **hosted but unlinked** — the nightly job publishes to the stable `/dwca/` URL as designed; only the **frontend download link is suppressed**. State = "unlisted," not private. (No new access-control infra; keeps v1.2's "no new AWS infra" constraint.)
- **D-06:** **Native records may be publicly linked independently** of third-party conferral (we own those records, subject to D-08's consent notice being in place). The **third-party-inclusive** public download link waits until conferral clears.
- **D-07 (open implementation question for planner):** D-06 implies a possible **native-only public archive variant** distinct from the full (third-party-inclusive) held archive. Planner to decide whether this is one archive held + one native-only variant, a build-time flag, or another mechanism. Flagged, not resolved here.

### Native contributor consent basis
- **D-08:** Consent basis for publishing native contributions under CC-BY-NC 4.0 = **platform-policy assertion for existing records**, **plus** an explicit license/consent notice added to the **submission form going forward**. The submission-form notice is **in scope for v1.2** (see Deferred/Roadmap ripples — it touches the app runtime and needs a roadmap home).

### Attribution & provenance model
- **D-09:** **Native** records: `rightsHolder` = **the individual contributor** (per-record); `recordedBy` = the same contributor's display name. (Note: this exposes contributor identity as the rights holder — accepted.)
- **D-10:** **Provenance carrying** for third-party (Whale Alert via Maplify): `recordedBy` = original observer/username where present; `datasetName` = the sub-source (e.g., "Orca Network"); the full aggregator chain (Whale Alert → sub-source) carried as a **structured `dynamicProperties`** string. Use real DwC terms where they fit, `dynamicProperties` for the rest.
- **D-11:** **Third-party `rightsHolder`** = the **originating sub-source** (Orca Network, Cascadia, …) when known, falling back to Whale Alert/Maplify when not.

### Count / occurrenceStatus gap
- **D-12:** Emit `occurrenceStatus = present` on **every** in-scope record (all are positive sightings; GBIF-recommended for observation data). Constant column.
- **D-13:** Emit `individualCount` **only when a real count exists** (`observations.count`, `maplify.number_sighted`). Sparse column.
- **D-14:** Where a count is a known **lower-bound / min-count** (maplify `min_count`), emit it as `individualCount` **but flag the minimum/range in `dynamicProperties`** so the integer is not read as exact. (Emit-available, flag-minimums — not omit, not silently exact.)

### Already locked upstream (do NOT re-decide — carried from REQUIREMENTS.md)
These are pre-answered and flow into the policy doc as-is:
- License = **CC-BY-NC 4.0** as a resolvable CC URI; per-photo license codes mapped to canonical CC URIs via one shared converter; license-less photos **excluded**.
- `basisOfRecord` = `HumanObservation`; `geodeticDatum` = WGS84 (EPSG:4326) constant.
- `coordinateUncertaintyInMeters`: real meters when known, **omit when unknown — never 0**.
- `eventDate`: ISO-8601 at honest per-source precision; Maplify report-time at **date precision** (or flagged), never a false second-level sighting time.
- `occurrenceID`: stable/deterministic across nightly runs (source-prefixed surrogate keys).
- `travelDirection` → `dynamicProperties` (no core term). Regex-extracted whale identifiers (e.g., `T065S`) **excluded** from identity terms — at most labeled-unverified in `dynamicProperties`, never `organismID`/`catalogNumber`.

### Claude's Discretion
- Exact `dynamicProperties` key/value structure (provenance chain, min-count flag) — propose during planning, consistent with DwC conventions.
- Document format/layout of the gaps-and-policy artifact, as long as it records a resolution **or** an explicit conferral-question for every audited gap.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope, policy, and requirements
- `.planning/REQUIREMENTS.md` — v1.2 scope, the locked policy decisions block, and GAP-01..04 requirement text (the gaps this phase must resolve/frame).
- `.planning/ROADMAP.md` §"Phase 4" — phase goal and the four success criteria this document must satisfy.
- `.planning/PROJECT.md` — milestone scope decisions (native + Maplify/Whale Alert only; iNaturalist & Happywhale excluded), Key Decisions table.
- `.planning/STATE.md` §Blockers/Concerns — pre-existing Phase 4/7 concerns (redistribution terms as external legal question; CloudFront `/dwca/*` passthrough; possible new `production` GitHub secret).

### Data model (source tables the policy describes)
- `supabase/migrations/20250903172708_initial_schema.sql` — base schema: `observations` (incl. `count`, `source varchar(50)`), `observation_photos`, `contributors`, license/`travel_direction` enums.
- `supabase/migrations/20250915170256_fix-inat-photos.sql` — count/`number_sighted`/`min_count` handling across sources (grounds D-12..D-14).
- `supabase/migrations/20250919034327_fix_maplify_taxon_mapping.sql` (and `…_fix_maplify_taxa_harder.sql`, `…_maplify_photo_url.sql`) — `maplify.sightings` shape incl. the `source` column carrying nested provenance (grounds D-03, D-10, D-11).
- `database.types.ts` — generated DB types (enums incl. `license`, `travel_direction`; composite types `lat_lng`, `lon_lat`, `taxon`).

### Codebase maps (background)
- `.planning/codebase/INTEGRATIONS.md` — data sources, Supabase tables/views, storage, deployment shape.

### External standards (no local copy — for researcher)
- DarwinCore term definitions (TDWG) and GBIF DwC-A requirements — for `recordedBy`/`rightsHolder`/`datasetName`/`occurrenceStatus`/`individualCount` semantics.
- Creative Commons CC-BY-NC 4.0 canonical URI form.
- **Whale Alert / Maplify / Orca Network / Cascadia redistribution terms** — the external legal/ToS question; researcher should surface what's publicly stated and what must be asked directly in conferral (most expected to be unstated → frame as conferral questions per D-04).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `maplify.sightings.source` — already distinguishes nested sub-sources; the lever for per-`source` drop (D-03) and `datasetName` mapping (D-10).
- `observations.count` + `maplify.number_sighted` / `min_count` — count data exists for some records, so `individualCount` is populatable (D-13/D-14), not merely absent.
- `contributors` table — backs native `rightsHolder`/`recordedBy` (D-09).
- Existing `license` enum + per-photo license codes — feed the shared CC-URI converter (carried-forward GAP-02 decision).

### Established Patterns
- DwC contract lives in a dedicated read-only `dwc` Postgres schema over source tables (Phase 5) — NOT app-code mapping over `public.occurrences`. Phase 4 decisions are SQL-encodable predicates/columns, not runtime logic.
- v1.2 is additive and read-only: existing app runtime and source tables untouched — **except** the D-08 submission-form notice, which is a deliberate, flagged exception.

### Integration Points
- Phase 5 (`dwc` schema) encodes D-01..D-03, D-09..D-14 as auditable SQL.
- Phase 7 (nightly hosting) implements D-05 (publish-to-`/dwca/` unlinked).
- Phase 8 (download link) implements D-06 (hidden third-party link; native-only link possibly eligible per D-07).
</code_context>

<specifics>
## Specific Ideas

- The milestone is explicitly a vehicle to **clarify and frame** the rights questions with partner organizations, not to unilaterally settle them. The archive's existence is the artifact that makes conferral concrete.
- "Hide any download link from the public until we've conferred" — the hold is about **public discoverability/linking**, satisfied by hosted-but-unlinked (D-05), with native records as a permissible interim public release (D-06).
</specifics>

<deferred>
## Deferred Ideas / Roadmap Ripples

These came out of discussion and need a home in the roadmap (do not lose — not blocking Phase 4):

- **Submission-form consent/license notice (D-08)** — in scope for v1.2 per user decision, but touches the live app runtime, which Phases 5–8 were scoped to leave untouched. Needs a roadmap entry (new small frontend task or an extension of Phase 8). Flag to `/gsd-phase` after this phase.
- **DOWNLOAD-01 ships hidden + native-only variant (D-06, D-07)** — Phase 8 must ship the third-party download link suppressed, and the planner must resolve whether a separate native-only public archive variant is produced. Adds nuance to Phase 8's scope; note when planning Phase 7/8.
- **Organizational conferral itself** — an out-of-band, non-engineering task (contact Whale Alert / Orca Network / Cascadia). Tracked as the gate that un-hides third-party records; not a code phase.

</deferred>

---

*Phase: 4-rights-data-model-policy-gate*
*Context gathered: 2026-06-10*
