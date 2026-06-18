# Rights & Data-Model Policy

**Authored by:** Phase 4 (Rights & Data-Model Policy gate)
**Encoded by:** Phase 5 (DB Projection), Phase 6 (Archive Generation), Phase 7 (Nightly Hosting), Phase 8 (Download Link)
**Requirements closed:** GAP-01, GAP-02, GAP-03, GAP-04
**Date:** 2026-06-10

This document is the single authoritative source for every rights, licensing, attribution, and data-model-gap decision that downstream phases must encode. Each gap has an explicit resolution or a precisely framed conferral question — none is silently defaulted. Phases 5–8 encode these decisions; they do not re-decide them.

---

## 1. License & Rights

*Closes GAP-02. Operationalizes the upstream decision recorded in REQUIREMENTS.md policy block.*

### 1.1 Occurrence-Record License URI (per-source) (D-20)

The `license` field is **per-source**, not a single constant across the archive (**D-20**). Phase 5's `dwc.occurrences` projection emits one of two canonical `/legalcode` URIs depending on record provenance:

| Source | License URI | Basis |
|--------|-------------|-------|
| Native (`public.observations` via contributors) | `https://creativecommons.org/licenses/by-nc/4.0/legalcode` | REQUIREMENTS.md upstream decision + native contributor consent basis (§1.3, D-08). |
| Maplify / Whale Alert (`maplify.sightings`) | `https://creativecommons.org/licenses/by/4.0/legalcode` | All Maplify records reach SalishSea.io via the Acartia data cooperative (Conserve.IO operates the WASEAK API on Acartia's stack). Contributors to Acartia assert CC-BY at registration (acartia.io/register). The CC-BY assertion is upstream of SalishSea.io and applies transitively to records republished here. |

Both URIs are the canonical `/legalcode` form required by GBIF's occurrence license parser (not the human-readable deed URL `/4.0/`).

**Note on scope of the Acartia CC-BY assertion (Maplify branch):** The CC-BY claim is asserted by *contributors* to Acartia (Whale Alert/Conserve.IO operates the platform; Orca Network, Cascadia Research, and others are sub-source contributors whose records flow through it). Because the assertion is made at contribution time and applies cooperative-wide, it covers all `maplify.sightings` records SalishSea.io fetches from WASEAK — regardless of the `source` value on a given record. This is why §4.2/§4.3/§4.4 conferral shifts from rights-gating to courtesy notification + attribution preference (see §4.1, reframed).

**Reconciliation with §6.6:** §6.2's `dwc.datasets` schema carries `intellectual_rights` per row. In v1.2 there is one row with the native (CC-BY-NC) URI, and per-record `license` diverges for Maplify rows via the lookup in this section. When (if) Maplify is reified as a separate constituent row in `dwc.datasets`, the per-record `license` for Maplify rows joins from the constituent's `intellectual_rights` and this section's table collapses to a description of that join.

**Upstream-decision provenance:** The CC-BY-NC 4.0 native default is the operationalization of REQUIREMENTS.md's "occurrence-record license = CC-BY-NC 4.0" — that decision predates the Acartia finding and applies to native records. The Maplify CC-BY URI is **not** a re-decision; it is the operationalization of the upstream Acartia-cooperative license, recorded here for the first time because the Acartia pathway was not characterized in earlier planning.

### 1.2 Per-Photo License Converter

Native `public.sighting_photos.license_code` values are mapped to canonical CC URIs for the Multimedia extension. The shared converter table (to be encoded as a SQL CASE expression in Phase 5) is:

| `license_code` enum value | Canonical CC URI |
|---------------------------|-----------------|
| `cc0` | `https://creativecommons.org/publicdomain/zero/1.0/legalcode` |
| `cc-by` | `https://creativecommons.org/licenses/by/4.0/legalcode` |
| `cc-by-nc` | `https://creativecommons.org/licenses/by-nc/4.0/legalcode` |
| `cc-by-sa` | `https://creativecommons.org/licenses/by-sa/4.0/legalcode` |
| `cc-by-nd` | `https://creativecommons.org/licenses/by-nd/4.0/legalcode` |
| `cc-by-nc-sa` | `https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode` |
| `cc-by-nc-nd` | `https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode` |
| `none` | **Exclude photo** — no redistributable license |

**Assumption A1 (explicit):** No version number is stored with enum values in the database. All per-photo licenses are pinned at version 4.0 for all CC variants (except `cc0`, which is version 1.0 by definition). If a photo was submitted under an earlier version, it will be mapped to the 4.0 URI. This is generally a safe default (4.0 has broader licensor protections), but it is a known approximation.

**NULL vs `none` semantics (D-19):** The `ALTER COLUMN license DROP NOT NULL` migration allows `NULL` values in `public.observation_photos.license_code`. NULL and `none` are **semantically distinct**, not aliases:

- **`license_code = 'none'`** means **"no redistributable license"** — the contributor (or ingest path) classified the photo as unlicensed. Terminal: no future workflow will change this without contributor action.
- **`license_code = NULL`** means **"license unknown / unclassified"** — the photo has not yet been assigned a license code. Non-terminal: a future workflow (UI prompt to the contributor, an admin classifier, or an ingest backfill) may resolve it to a real code, `cc0`, or `none`.

Both states **exclude the photo from the Multimedia extension** in v1.2 (per §1.4). The distinction matters because it leaves an explicit hook for a future "classify your unclassified photos" workflow without overloading `none` to mean both "no license" and "didn't get around to choosing." Phase 5's CASE expression must therefore emit two separate `WHEN` branches for `none` and `IS NULL` — not a compound predicate — so the encoded distinction is preserved in the projection.

### 1.3 Native Contributor Consent Basis (D-08)

The consent basis for publishing native SalishSea.io contributions under CC-BY-NC 4.0 is a two-part assertion per **D-08**:

1. **Platform-policy assertion for existing records:** Contributions already submitted to SalishSea.io are published under the platform's stated policy that sighting data is shared for conservation purposes. This is the consent basis for records in the database at the time of DwC-A publication.

2. **Submission-form license/consent notice going forward:** New contributions submitted after the v1.2 rollout must be accompanied by an explicit notice on the submission form that the data will be published in a DarwinCore Archive under CC-BY-NC 4.0. This notice is in scope for v1.2 but touches the live app runtime, which Phases 5–8 do not modify. It is flagged as a roadmap item — a small frontend task or Phase 8 extension — to be addressed before the public download link goes live (see Section 4, hosted-but-unlinked hold). See also the Deferred section of 04-CONTEXT.md.

### 1.4 License-Less Photo Exclusion (GAP-04 intersection)

Photos without a redistributable license are excluded from the Multimedia extension. Per §1.2's D-19 distinction, exclusions fall into three semantically distinct cases:

- **Native photos with `license_code = 'none'`** — classified as "no redistributable license." **Excluded.** Terminal state; only a contributor reclassification would change it.
- **Native photos with `license_code IS NULL`** — "license unknown / unclassified." **Excluded** in v1.2. Distinct from `none`: a future classification workflow could resolve these to a real license code and unblock them. Phase 5 emits this as a separate CASE branch from `none` so the distinction is preserved (per §1.2).
- **Maplify `photo_url`** — the `maplify.sightings` table stores a photo URL but no license column. Per assumption A3 (no implied license for Maplify photos), all Maplify photos are excluded from the Multimedia extension until conferral with Conserve.IO explicitly grants a redistributable license. (Semantically closest to "unknown" — but at the source level, not the record level — and resolution depends on conferral, not contributor action.)

This exclusion is a gap resolution for GAP-04. Cross-reference Section 3 (gap table: `maplify.sightings.photo_url`) and Section 2.4 (unvalidated identifier exclusion).

---

## 2. Attribution & Provenance Model

*Closes GAP-03. Specifies the DwC field mappings and `dynamicProperties` schema for Phases 5–6.*

### 2.1 Native Records — `recordedBy` and `rightsHolder` (D-09)

For records from `public.sightings` (SalishSea.io native contributions):

- **`rightsHolder`** = `contributors.name` (the individual contributor's display name). Per-record value. This exposes contributor identity as the rights holder; this is accepted as an intentional design choice per **D-09**.
- **`recordedBy`** = same contributor display name (`contributors.name`).

When the contributor display name is absent (NULL), both fields are omitted from the record rather than filled with a placeholder.

### 2.2 Third-Party Records — `recordedBy`, `rightsHolder`, `datasetName` (D-10, D-11)

For records from `maplify.sightings` (Whale Alert / Maplify via the WASEAK feed):

- **`recordedBy`** = `maplify.sightings.usernm` (the original observer's username), when non-NULL per **D-10**. Omitted when NULL.
- **`datasetName`** = a human-readable sub-source name derived from the `maplify.sightings.source` column per **D-10**. This is a mapping table from source code to display name (e.g., `orca_network` → "Orca Network"). The exact mapping is built in Phase 5 against `SELECT DISTINCT source FROM maplify.sightings` (see Assumption A2). Known values include `orca_network` and `cascadia`; `rwsas` is excluded at ingest and will not appear.
- **`rightsHolder`** = the originating sub-source organization (e.g., "Orca Network", "Cascadia Research Collective") when known from the `source` column mapping, falling back to `"Whale Alert / Maplify"` when the source is unrecognized per **D-11**.
- **`license`** = `https://creativecommons.org/licenses/by/4.0/legalcode` (CC-BY 4.0) for all Maplify records, per §1.1 (D-20). The license is asserted upstream at Acartia (contributor registration) and applies to all records reaching SalishSea.io via the WASEAK feed.

The Whale Alert → sub-source aggregation chain is carried in `dynamicProperties` (see Section 2.3).

**Assumption A2 (explicit):** The `maplify.sightings.source` column is expected to contain values like `orca_network` and `cascadia` (lowercase, underscore-separated). If actual values differ, the mapping table in Phase 5 must be updated after querying the production database. The policy document uses these expected values as provisional labels.

### 2.3 `dynamicProperties` Schema

The `dynamicProperties` field (DwC term `http://rs.tdwg.org/dwc/terms/dynamicProperties`) carries non-standard or context-specific data as a JSON string. This field is passed through verbatim by GBIF and is not indexed or searchable — it is appropriate for fields that do not map to core DwC terms or that carry provenance detail beyond the standard model.

The canonical `dynamicProperties` schema for this archive is:

```json
{
  "travelDirection": "north",
  "aggregatorSource": "Orca Network",
  "aggregatorChain": "Whale Alert SE Alaska (Maplify) > Orca Network",
  "countIsMinimum": true,
  "unvalidatedIdentifiers": ["T065S", "T002"]
}
```

**Key definitions:**

| Key | Type | Source | Present when |
|-----|------|--------|--------------|
| `travelDirection` | string (enum) | `public.sightings.direction` or `maplify.sightings.comments` (via `extract_travel_direction`) | Non-NULL direction. Omitted when NULL. |
| `aggregatorSource` | string | Human-readable value from `maplify.source` mapping | All Maplify records. |
| `aggregatorChain` | string | Structured provenance chain text | All Maplify records. Encodes the full aggregation path: e.g., `"Whale Alert SE Alaska (Maplify) > Orca Network"`. |
| `countIsMinimum` | boolean | `true` when count is a known lower-bound | HappyWhale records only (see D-14, Section 5). Not emitted for exact counts or when HappyWhale is out of scope. |
| `unvalidatedIdentifiers` | array of strings | `extract_identifiers(body)` result | Non-empty identifier extraction only. See Section 2.4. |

Native records without Maplify provenance omit `aggregatorSource` and `aggregatorChain`. All keys are omitted when their value is NULL or inapplicable.

### 2.4 Unvalidated Whale Identifier Handling (GAP-04)

The function `extract_identifiers(body)` extracts identifier-like strings (e.g., `T065S`, `T002`) from free-text observation bodies using regex matching.

These extracted strings are:
- **Never** emitted as `organismID`, `catalogNumber`, or any other DwC identity term. (Locked upstream — confirmed in REQUIREMENTS.md Out of Scope table.)
- **At most** listed in `dynamicProperties.unvalidatedIdentifiers` as an array, clearly labeled as unvalidated regex extractions pending individual validation.
- The `informationWithheld` term may optionally note: "Regex-extracted whale identifiers present in source text but excluded from identity terms pending individual validation."

This is a GAP-04 resolution. Cross-reference Section 1.4 (license-less photo exclusion) as the other GAP-04 exclusion.

---

## 3. Data-Model Gaps & Resolutions

*Closes GAP-01. Every audited gap has an explicit resolution — none is silently defaulted.*

### 3.1 Gap Table: `public.sightings` (Native SalishSea.io Records)

| DwC Term | Source Column | Gap | Resolution |
|----------|--------------|-----|------------|
| `occurrenceID` | `sightings.id` (UUID) | No globally scoped prefix | Prefix with `salishsea:` → `salishsea:{id}`. Stable across runs (ALIGN-06). |
| `eventDate` | `observed_at` (timestamptz) | None — full timestamp available | Emit as ISO-8601 at full precision. Contributor-submitted; honest. |
| `decimalLatitude` / `decimalLongitude` | `subject_location` (geography Point) | None | Emit `ST_Y` / `ST_X`. |
| `coordinateUncertaintyInMeters` | `accuracy` (integer, nullable) | NULL when GPS not recorded | Emit when non-NULL. **Omit when NULL — never 0** (locked upstream; zero is invalid per TDWG). |
| `individualCount` | `count` (smallint, nullable, CHECK > 0) | NULL when count not observed | Emit when non-NULL (D-13). Sparse column; absence means unknown, not zero. |
| `occurrenceRemarks` | `body` (text, nullable) | May contain HTML | Strip HTML; emit as plain text. |
| `dynamicProperties` | `direction` (travel_direction enum, nullable) | No core DwC term for direction | Key: `travelDirection`. Omit when NULL. |
| `recordedBy` / `rightsHolder` | `contributors.name` (via FK) | None | `contributors.name` → both fields (D-09). |
| `scientificName` etc. | `taxon_id` (FK) | Hierarchy walk needed | Resolved by walking `inaturalist.taxa` parent hierarchy (Phase 5). |
| `basisOfRecord` | (none) | Not stored | Constant: `HumanObservation` (locked upstream). |
| `occurrenceStatus` | (none) | Not stored | Constant: `present` (D-12). All in-scope records are positive sightings. |
| `license` | (none) | Not stored | Constant for native branch: `https://creativecommons.org/licenses/by-nc/4.0/legalcode` (CC-BY-NC 4.0, GAP-02, §1.1, D-20). |
| `geodeticDatum` | (none) | Not stored | Constant: `WGS84` (locked upstream). |

### 3.2 Gap Table: `maplify.sightings` (Whale Alert / Maplify Records)

| DwC Term | Source Column | Gap | Resolution |
|----------|--------------|-----|------------|
| `occurrenceID` | `sightings.id` (integer) | No globally scoped prefix | Prefix with `maplify:` → `maplify:{id}`. Stable across runs (ALIGN-06). |
| `eventDate` | `created_at` (timestamp) | **Gap (ALIGN-05): this is report-received time, not sighting time.** Emitting at second precision would falsely imply sighting-time precision. | Emit at **date precision only** (`created_at::date`, e.g., `2024-03-15`). Document the reason: "time reflects report receipt, not observed sighting." Never emit as a false second-level sighting timestamp. |
| `decimalLatitude` / `decimalLongitude` | `location` (geography Point) | None | Emit `ST_Y` / `ST_X`. |
| `coordinateUncertaintyInMeters` | (none) | **Gap: no accuracy stored for Maplify records** | **Omit.** Never emit 0 or a fabricated value. |
| `individualCount` | `number_sighted` (integer, NOT NULL) | The UI view filters `BETWEEN 1 AND 1000` | Apply same filter for DwC (D-13). Emit as exact count (see D-14 correction, Section 5.2). |
| `occurrenceRemarks` | `comments` (varchar, nullable) | May contain HTML | Strip HTML; emit. |
| `recordedBy` | `usernm` (varchar, nullable) | May be NULL | Emit when non-NULL (D-10). Omit when NULL. |
| `datasetName` | `source` (varchar NOT NULL) | Short code; needs human-readable mapping | Map `source` → display name via Phase 5 mapping table (D-10). Query `SELECT DISTINCT source FROM maplify.sightings` before writing the table. |
| `rightsHolder` | `source` (derived) | Not stored explicitly | Sub-source organization when `source` maps to a known org; else `"Whale Alert / Maplify"` (D-11). |
| `dynamicProperties` | `source`, aggregation chain | No core DwC term for aggregator | Keys: `aggregatorSource`, `aggregatorChain` (see Section 2.3). |
| Multimedia `identifier` | `photo_url` (varchar, nullable) | **Gap: no license stored for Maplify photos** | **Exclude all Maplify photos from Multimedia extension** (GAP-04, Section 1.4). |
| `basisOfRecord` | (none) | Not stored | Constant: `HumanObservation`. |
| `occurrenceStatus` | (none) | Not stored | Constant: `present` (D-12). |
| `license` | (none — license is upstream at Acartia) | Asserted at Acartia contributor registration, not on the record | Constant for Maplify branch: `https://creativecommons.org/licenses/by/4.0/legalcode` (CC-BY 4.0, D-20, §1.1). |
| `geodeticDatum` | (none) | Not stored | Constant: `WGS84`. |

### 3.3 Gap Table: `public.observation_photos` (Native Photos — Multimedia Extension)

| DwC Term | Source Column | Gap | Resolution |
|----------|--------------|-----|------------|
| `identifier` | `href` (varchar) | None | Photo URL. Emit verbatim. |
| `license` (Multimedia) | `license_code` (`license` enum, **nullable** since the `DROP NOT NULL` migration) | Short code; needs URI mapping; `none` and NULL excluded with distinct semantics (D-19) | Apply per-photo converter (Section 1.2). Exclude `none` ("no license", terminal) and NULL ("unknown", non-terminal) as separate CASE branches per §1.4. |
| `type` | (none) | Not stored | Constant: `StillImage`. |
| `rightsHolder` | (via sighting → contributor) | Not stored per-photo | Inherit record-level `rightsHolder` (contributor display name). |
| Multimedia `index` | `seq` (smallint) | None | Emit `seq` for ordering. |

### 3.4 Cross-Cutting Resolution: `occurrenceStatus` (D-12)

`occurrenceStatus = present` is a constant column on every in-scope record (both `public.sightings` and `maplify.sightings`). All records in scope are positive sightings — no absence records exist. GBIF strongly recommends this term for observation data; its absence causes quality flags.

This resolves the gap noted in both source tables above. Phase 5 encodes this as a literal string constant in the `dwc.occurrences` view.

### 3.5 Cross-Cutting Resolution: `individualCount` Sparseness (D-13)

`individualCount` is emitted only when a real count exists:
- **Native:** `sightings.count` when non-NULL (`count > 0` CHECK constraint; no fabrication needed).
- **Maplify:** `maplify.number_sighted` when within valid range (`BETWEEN 1 AND 1000`, consistent with the existing UI view filter).

The column is sparse: omitting it means "count unknown," not "count = 0." This is the correct DwC semantics for `individualCount`.

---

## 4. Third-Party Redistribution Status

*Closes GAP-04 (redistribution policy component). Reframed 2026-06-17: per D-20 (§1.1), the rights basis for Maplify records is now resolved upstream via the Acartia data cooperative's CC-BY assertion. The hold-but-unlinked posture (D-05) is preserved but its rationale shifts from rights-gating to data-QA-gating-with-courtesy-notification.*

### 4.1 Holding Rule (D-01, D-02, D-03, D-05, D-06) — Reframed

**Rights basis (D-20, §1.1):** All `maplify.sightings` records reach SalishSea.io via the Acartia cooperative; contributors to Acartia assert CC-BY 4.0 at registration (acartia.io/register). This resolves the redistribution rights question for the entire Maplify branch. The sections below are *not* gated on rights anymore — they're gated on data QA and courtesy.

**Build stance (D-01):** Unchanged. The `dwc` schema (Phase 5), archive generator (Phase 6), and nightly job (Phase 7) are built at full scope — native + Maplify/Whale Alert records. Reinforced by D-20: rights are not a blocker.

**Default for archive contents (D-02), reframed:** Include-and-attribute remains the technical default. The retreat conditions are now narrower:
- Per-source drop activated by a *requested* removal from a sub-source organization (rare; CC-BY does not require pre-clearance, but a source could still ask), **or**
- Per-source drop activated by data QA finding that a sub-source has structural problems (e.g., systematic bad coordinates, incompatible identifier semantics).

**Per-source drop granularity (D-03):** Unchanged mechanism. The `dwc` projection must still support `WHERE maplify.source != …` filtering, now for QA/courtesy use rather than rights use.

**Hosted-but-unlinked hold (D-05), reframed as data-QA gate:** The gate is preserved but its rationale changes:
- **New primary rationale:** A QA pass on the projected Maplify records before public surfacing. The data was fetched for situational awareness (per WASEAK terms-of-use); republishing it as a research-grade archive raises the quality bar. The hold gives time to verify schema mapping, coordinate sanity, identifier handling, and absence of systematic data issues against `dwc.occurrences` output.
- **Secondary rationale:** Courtesy notification to Whale Alert/Conserve.IO, Orca Network, and Cascadia Research — informing them that SalishSea.io will republish their Acartia-licensed records, gathering attribution preferences, surfacing concerns.
- **Mechanism:** Nightly job (Phase 7) publishes the archive to the stable `/dwca/` URL as designed. Only the frontend link (Phase 8) is suppressed. State = "unlisted," not private.
- **Exit criteria:** Both (a) QA pass on Maplify records, and (b) courtesy notifications sent (acknowledgment not required for the secondary rationale — sent + reasonable response window is sufficient).

**Native-only public eligibility (D-06):** Native records may be publicly linked independently of the Maplify QA gate, subject to the D-08 consent notice (§1.3) being in place. Unchanged by D-20.

**Open question — D-07 (flagged for Phase 7/8 planner):** Unchanged. D-06 still implies a possible native-only archive variant; the implementation choice (separate archive vs. build-time filter) is for the Phase 7/8 planner.

### 4.2 Whale Alert / Conserve.IO (Maplify data platform operator)

**Important disambiguation:** There are two unrelated services named "Whale Alert":
- **`whale-alert.io` / `developer.whale-alert.io`** — a cryptocurrency blockchain transaction tracking service. Its prohibitive Terms & Conditions belong to this crypto service and are **irrelevant to this project**. Do not use these ToS when assessing redistribution rights.
- **`whalealert.org` / Conserve.IO** — the marine mammal whale sighting app operated by Conserve.IO (partnered with IFAW, NOAA). This is the entity that operates the WASEAK API from which SalishSea.io fetches `maplify.sightings` data.

**Rights basis (resolved):** Per D-20 / §1.1, Conserve.IO operates the WASEAK API on the Acartia data cooperative stack (acartia.io). Contributors to Acartia (including Conserve.IO-managed feeds and the sub-sources flowing through them) assert CC-BY 4.0 at registration. The rights question is resolved upstream — Conserve.IO does not need to grant additional permission, and SalishSea.io does not need to ask.

**Earlier framing, corrected:** Prior drafts of this section noted Conserve.IO's privacy policy (which describes internal retention) and the WASEAK API ToS (which restricts user behavior to "situational awareness") and concluded no redistribution license was stated. That conclusion was wrong — it missed the Acartia layer. The Acartia CC-BY assertion sits upstream of both the privacy policy and the API ToS and grants the redistribution license those documents don't address.

**Contact surface:** `info@whalealert.org` (Conserve.IO / Whale Alert marine mammal app). Identified via IFAW as the contact for scientific data requests.

**Notification (no longer a "conferral question"):**

> "SalishSea.io fetches whale sighting records from your WASEAK API (maplify.com/waseak) as part of our citizen science platform. We are preparing to republish these records in a DarwinCore Archive under the CC-BY 4.0 terms asserted upstream at Acartia (acartia.io/register), with structured attribution to each sub-source. As a courtesy: we want to flag this before our public link goes live, share attribution language we plan to use (e.g., `datasetName` and `rightsHolder` set to the originating sub-source), and ask whether you have preferences on attribution wording or contact-of-record for the Conserve.IO-managed aggregator surface."

**Current status:** Rights resolved (Acartia CC-BY). **Hold remains** under D-05's reframed rationale — primary gate is now Maplify data QA, secondary is this courtesy notification window.

### 4.3 Orca Network

**Status:** As a contributor to Acartia (via the Conserve.IO / Whale Alert ecosystem), Orca Network's records reach SalishSea.io carrying the cooperative-wide CC-BY assertion. Rights resolved.

**What is publicly stated:** Orca Network collects cetacean sighting reports from a PNW volunteer network. Their site notes that "collated sightings data provides invaluable and ongoing insight" and that data is shared "with researchers and natural resource managers." Orca Network is a named sub-source in `maplify.sightings.source` and a partner in the Whale Alert/Conserve.IO/Acartia ecosystem.

**Contact surface:** `orcanetwork.org` — no direct data-use contact found. The organization is a small PNW-based nonprofit; direct inquiry may require a general contact form.

**Notification (no longer a "conferral question"):**

> "SalishSea.io receives sighting records attributed to Orca Network via the Maplify/Whale Alert WASEAK feed, which is part of the Acartia data cooperative. We are preparing to republish these records in a public DarwinCore Archive under the CC-BY 4.0 terms asserted at Acartia, with `datasetName = 'Orca Network'` and `rightsHolder = 'Orca Network'`. As a courtesy notification: do you have preferred attribution language, a different rightsHolder string, or a contact-of-record we should cite?"

**Current status:** Rights resolved (Acartia CC-BY). **Hold remains** under D-05's reframed rationale.

### 4.4 Cascadia Research Collective

**Status:** As a contributor to Acartia (via Whale Alert/Conserve.IO submissions), Cascadia Research's records carry the cooperative-wide CC-BY assertion. Rights resolved. (This is also consistent with Cascadia's own Hawaii OASIS dataset on OBIS-SEAMAP, which is published openly — they are demonstrably comfortable with open licensing.)

**What is publicly stated:** Cascadia Research is a Washington-state nonprofit focused on cetacean and marine mammal research. Their publicly available Hawaii OASIS dataset on OBIS-SEAMAP is published under CC-BY-NC 4.0.

**Contact surface:** `strandings@cascadiaresearch.org`; phone 360-943-7325.

**Notification (no longer a "conferral question"):**

> "We receive sightings attributed to Cascadia Research via the Maplify/Whale Alert WASEAK feed, which is part of the Acartia data cooperative. We are preparing to republish these records in a public DarwinCore Archive under the CC-BY 4.0 terms asserted at Acartia, with `datasetName = 'Cascadia Research Collective'` and `rightsHolder = 'Cascadia Research Collective'`. As a courtesy: do you have a preferred attribution string, a citable contact-of-record, or any concerns about this republication?"

**Current status:** Rights resolved (Acartia CC-BY). **Hold remains** under D-05's reframed rationale.

### 4.5 Hold Exit — Data QA + Courtesy Window

The hold-but-unlinked posture (D-05, reframed) exits when both conditions are met:

1. **Data QA pass:** A reviewer has examined `dwc.occurrences` output for Maplify records and confirmed it does not have systematic issues that would embarrass a downstream researcher (e.g., bad coordinates, malformed identifiers, schema-mapping errors). Specific QA criteria are out of scope for this policy doc — defined per the Phase 5/6 verification workflow. This is the primary gate.
2. **Courtesy notification window:** Notifications per §4.2/4.3/4.4 have been sent and a reasonable response window has elapsed (defined informally — typically 2–4 weeks). Acknowledgment is welcomed but not required. This is the secondary gate.

Both gates are out-of-band, non-engineering tasks — tracked here, not in the roadmap as code phases. When both clear, the frontend link (Phase 8) is updated to include third-party records. If a sub-source asks to be excluded during the courtesy window, Phase 5's per-source filter (D-03) is activated for that sub-source.

---

## 5. Scope Clarifications

*Addresses remaining scope boundaries and the D-14 correction.*

### 5.1 Sources Excluded from v1.2

The following sources are **excluded from v1.2 scope** per REQUIREMENTS.md Milestone Scope:

- **iNaturalist** (`inaturalist.observations`): Already published to GBIF by iNaturalist as the canonical source. Including these records in the SalishSea.io DwC-A would create duplicate GBIF records. Excluded entirely.
- **HappyWhale** (`happywhale.encounters`): Already published to GBIF by HappyWhale as the canonical source. Same duplication concern. Excluded entirely.

The `public.occurrences` UI view includes iNaturalist and HappyWhale rows — but the `dwc.occurrences` view in Phase 5 is built directly from source tables, not from `public.occurrences`, and filters to native + Maplify only.

### 5.2 D-14 Min-Count Correction (No-Op for v1.2)

**CONTEXT.md D-14** reads: "Where a count is a known lower-bound / min-count (maplify `min_count`), emit it as `individualCount` but flag the minimum/range in `dynamicProperties`."

**This contains a documentation inaccuracy, corrected here per RESEARCH.md:**

The `min_count` column does **not** exist on `maplify.sightings`. Inspecting the schema confirms:
- `maplify.sightings.number_sighted` — integer, NOT NULL. This is always an exact count for Maplify records; it is not a minimum or lower bound.
- `happywhale.encounters.min_count` — integer, nullable. This is the min-count column that D-14 was describing, not a Maplify column.

**Consequence for v1.2:** HappyWhale is excluded from v1.2 scope (Section 5.1). Therefore, D-14's min-count flagging logic applies to **zero in-scope records** in this milestone. D-14 is a no-op for v1.2.

**Preservation of policy:** D-14 (emit `individualCount` from min-count, flag minimum in `dynamicProperties.countIsMinimum`) is preserved in this document for when HappyWhale is added in a future milestone (REQUIREMENTS.md v2 requirement SRC-01). Phase 5 does not need to implement D-14 logic for v1.2; it should be noted as a future extension point.

**Self-contained correction:** This policy document is authoritative; a downstream reader does not need to reconcile CONTEXT.md D-14's "maplify `min_count`" wording with RESEARCH.md. The correct mapping is: D-14 applies to HappyWhale `min_count`; Maplify uses exact `number_sighted`; D-14 has no v1.2-applicable records.

### 5.3 `rwsas` Excluded at Ingest

The `rwsas` source is excluded at the Maplify ingest function level (`WHERE source != 'rwsas'`). This means `rwsas` records may not exist in `maplify.sightings` in the production database (Assumption A4). The `dwc` projection in Phase 5 should apply the same filter. Verify before writing the DwC filter by querying the production database.

### 5.4 `dynamicProperties` Is Not GBIF-Indexed

`dynamicProperties` is passed through verbatim by GBIF and is not indexed, searchable, or parsed as structured data by the GBIF portal. This is intentional and appropriate for the non-standard fields used in this archive (`travelDirection`, `aggregatorChain`, `countIsMinimum`, `unvalidatedIdentifiers`). Any field intended for GBIF filtering or faceting must use a core DwC term or an established extension.

---

## 6. Dataset Identity & EML Content

*Specifies the archive as a dataset: how SalishSea.io identifies itself in EML, what `eml.xml` carries, and the SQL surface (`dwc.datasets`) Phase 6 reads from. Resolves the gap that ROADMAP.md commits Phase 6 to producing `eml.xml` without prior planning ever specifying its content or identity model.*

### 6.1 Reification: `dwc.datasets` (D-15)

Dataset-level metadata is reified as a SQL relation `dwc.datasets` rather than encoded inside the Phase 6 serializer (**D-15**). The serializer reads from this relation and emits `eml.xml`; the relation is the single source of truth.

**Rationale:**
- One source of truth for dataset identity, license, contacts, and coverage. Phase 6 does not duplicate these as string constants.
- Edits are SQL operations — version-controlled, reviewable, reversible.
- Per-record `datasetName` / `datasetID` in `dwc.occurrences` derive via join, eliminating string duplication between record-level attribution and dataset-level EML.

**Form (table vs view):** Decided in Phase 5. A table fits if dataset metadata may be edited without a schema deploy. A view (e.g., over a `VALUES` list or a config-backed source) fits if dataset metadata is treated as source code. Phase 5's planner picks one with a written rationale.

### 6.2 Shape: One Row Now, Many-Row Schema (D-16)

The archive ships as a single GBIF dataset for v1.2, matching the single-dataset pattern used by comparable aggregators (iNaturalist, eBird publish one dataset and distinguish sub-sources per-record) (**D-16**). `dwc.datasets` contains exactly one row in v1.2.

The schema must be sized for future per-source constituents (native, Maplify aggregator, Orca Network, Cascadia Research) so that adding them is a SQL insert plus a Phase 6 EML extension — not a schema migration. Required columns:

- `dataset_id` — primary identifier (URI; see §6.3)
- `parent_dataset_id` — nullable self-FK; NULL for v1.2's single row
- `title`, `abstract`, `pub_date`, `language`
- `intellectual_rights` — license URI per dataset (the single v1.2 row carries the CC-BY-NC 4.0 URI from §1.1)
- `creator_name`, `creator_email`, `creator_role`
- `metadata_provider_name`, `metadata_provider_email`
- `contact_name`, `contact_email`, `contact_role`
- `geographic_coverage`, `temporal_coverage`, `taxonomic_coverage` — see §6.5
- `methods` — free text

Per-record `datasetName` and `datasetID` in `dwc.occurrences` continue to distinguish sub-sources (per §2.2) without requiring multiple `dwc.datasets` rows. The two layers are independent: per-record attribution works with one dataset row; constituent rows can be added later if and when GBIF registration warrants it.

### 6.3 `datasetID` URI Scheme (D-17)

Dataset identifiers use the URI pattern `https://salishsea.io/datasets/{slug}` (**D-17**).

- v1.2 single row: slug chosen in Phase 5 (e.g., `occurrences-v1` — the specific slug is not load-bearing on this document).
- Future constituents would use slugs like `/datasets/native`, `/datasets/orca-network`, `/datasets/cascadia`, `/datasets/maplify`.
- The URI does not need to resolve in v1.2 — it is a stable opaque identifier. A landing page can be added in a later milestone without changing the identifier.

**Per-record `datasetID`:** `dwc.occurrences.datasetID` is populated by joining to `dwc.datasets` — in v1.2 the join collapses to a single constant URI on every row. When constituents are reified, the join key shifts to a sub-source → `dwc.datasets.dataset_id` mapping (the same mapping that already produces `datasetName` per §2.2).

### 6.4 Publisher Identity (D-18)

| EML Role | Value |
|----------|-------|
| `creator` (publisher) | SalishSea.io (organizational) |
| `metadataProvider` | SalishSea.io (organizational) |
| `contact` | Peter Abrahamsen (individual) |

(**D-18**) Hybrid pattern: organizational publisher with a working individual contact. Survives a maintainer handoff without re-issuing the identifier, while keeping the contact actually reachable.

**Email handling:** `contact_email` is populated in `dwc.datasets` (one row in v1.2). The address is **not committed to this policy document** — the planning directory may be open-sourced in the future and the address should not be redacted from history. Phase 5 seeds the value at projection time.

### 6.5 Coverage Fields — Derived vs. Stated

EML coverage fields in v1.2 are populated as follows:

| Field | Source | Notes |
|-------|--------|-------|
| Geographic coverage | Stated bbox for the Salish Sea region | Authored in Phase 6 against a chosen reference (e.g., the Salish Sea Marine Ecoregion bbox). Not derived — dataset *scope* is regional even when realized data omits edges. |
| Temporal coverage | Derived at generation time | `MIN(eventDate)` to `MAX(eventDate)` from `dwc.occurrences`. Phase 6 computes this from the projection; not stored in `dwc.datasets`. |
| Taxonomic coverage | Stated as Cetacea (Order) | Intentional taxonomic scope. The realized `DISTINCT scientificName` list may be appended as a secondary block if useful, but the primary coverage is intentional, not realized. |
| Methods | Free text in `dwc.datasets.methods` | Describes data acquisition (native submissions via SalishSea.io app + Maplify/Whale Alert WASEAK feed). Specific wording authored in Phase 6 against the schema. |

### 6.6 Per-Record vs. Dataset-Level License Reconciliation

§1.1 fixes per-record `license` as a constant CC-BY-NC 4.0 URI. §6.2's `intellectual_rights` column carries the same URI on the single v1.2 row. The redundancy is harmless in v1.2 (one row, one URI, two surfaces).

When constituents are added later and may carry distinct licenses (cf. the Acartia/CC-BY note from the v1.2 UAT against §1.1), the two surfaces diverge:
- Per-record `license` becomes per-constituent (joined from `dwc.datasets.intellectual_rights`).
- §1.1's "constant CC-BY-NC 4.0" becomes "default for native; joined per-constituent for third-party."

This is a future-work note, not a v1.2 action. The schema in §6.2 already supports the future shape; only §1.1's wording and Phase 5's projection logic would need to evolve.

### 6.7 Open Items Owned by Phase 6

Phase 6 picks up these authoring tasks against the §6.2 schema:

- Title, abstract, methods free text
- Geographic bbox values (against a chosen reference)
- Slug for the v1.2 row's `dataset_id`
- Email address for `contact_email` (populated in `dwc.datasets`, not in code)
- Author the EML serializer to read `dwc.datasets` (one row) and compute derived temporal coverage from `dwc.occurrences`

Phase 5 owns:
- Deciding table vs view (§6.1)
- Seeding the single v1.2 row
- Wiring `dwc.occurrences.datasetID` to join `dwc.datasets`

---

## Decision Index

All D-numbers are cited in the sections above. For reference:

| Decision | Section(s) | Summary |
|----------|-----------|---------|
| D-01 | 4.1 | Build at full scope; engineering does not wait on rights questions |
| D-02 | 4.1 | Include-and-attribute default; retreat only on requested removal or QA finding (reframed by D-20 — was: explicit prohibition or conferral "no") |
| D-03 | 4.1 | Per-`maplify.source` drop granularity (now a QA/courtesy switch, not a rights switch, post-D-20) |
| D-04 | 4.2, 4.3, 4.4 | Originally: frame conferral questions, do not assert permission. Reframed by D-20: §4.2–4.4 now contain courtesy notifications, not conferral questions; D-04's "do not assert permission absent" caution no longer binds since CC-BY is asserted upstream. |
| D-05 | 4.1, 4.5 | Hosted-but-unlinked hold preserved; rationale reframed by D-20 from rights-gating to data-QA-gating (primary) + courtesy notification (secondary). Exit: QA pass + notification window. |
| D-06 | 4.1 | Native records may be publicly linked independently of third-party conferral |
| D-07 | 4.1 | OPEN: native-only archive variant question for Phase 7/8 planner |
| D-08 | 1.3 | Native consent basis: platform policy + submission-form notice going forward |
| D-09 | 2.1 | Native `rightsHolder` = `recordedBy` = contributor display name |
| D-10 | 2.2, 3.2 | Third-party `recordedBy` = `usernm`; `datasetName` = sub-source; aggregator chain in `dynamicProperties` |
| D-11 | 2.2, 3.2 | Third-party `rightsHolder` = sub-source org when known; else "Whale Alert / Maplify" |
| D-12 | 3.4 | `occurrenceStatus = present` constant on all in-scope records |
| D-13 | 3.5 | `individualCount` emitted only when a real count exists; sparse column |
| D-14 | 5.2 | Min-count flagging applies to HappyWhale `min_count` only; no-op for v1.2 (HappyWhale excluded); CONTEXT.md D-14 wording corrected |
| D-15 | 6.1 | Dataset metadata reified in `dwc.datasets`; Phase 6 serializer reads from it (no string constants in code) |
| D-16 | 6.2 | One row in `dwc.datasets` for v1.2; schema sized for future parent + constituents (no migration needed to add) |
| D-17 | 6.3 | `datasetID` URI scheme: `https://salishsea.io/datasets/{slug}` |
| D-18 | 6.4 | Publisher = SalishSea.io (organizational); Contact = Peter Abrahamsen (individual); contact email lives in `dwc.datasets`, not this document |
| D-19 | 1.2, 1.4 | `license_code = 'none'` and `IS NULL` are semantically distinct (`none` = "no license" terminal; NULL = "unknown" non-terminal); both excluded in v1.2; Phase 5 emits separate CASE branches |
| D-20 | 1.1, 2.2, 3.2, 4.1–4.5 | Per-record `license` is per-source: native = CC-BY-NC 4.0; Maplify = CC-BY 4.0 (asserted upstream at Acartia cooperative). Resolves the rights gate for the Maplify branch; reframes §4 conferral as courtesy + reframes D-05 hold as data-QA gate. |

---

*Policy authored: 2026-06-10*
*§6 (Dataset Identity & EML Content) added: 2026-06-17*
*D-19 (NULL ≠ none semantics) and D-20 (per-source license, Acartia CC-BY for Maplify) added: 2026-06-17*
*Phase: 04-rights-data-model-policy-gate*
*Document home: `.planning/phases/04-rights-data-model-policy-gate/04-POLICY.md`*
