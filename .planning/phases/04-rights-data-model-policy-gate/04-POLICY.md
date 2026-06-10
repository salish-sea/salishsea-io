# Rights & Data-Model Policy

**Authored by:** Phase 4 (Rights & Data-Model Policy gate)
**Encoded by:** Phase 5 (DB Projection), Phase 6 (Archive Generation), Phase 7 (Nightly Hosting), Phase 8 (Download Link)
**Requirements closed:** GAP-01, GAP-02, GAP-03, GAP-04
**Date:** 2026-06-10

This document is the single authoritative source for every rights, licensing, attribution, and data-model-gap decision that downstream phases must encode. Each gap has an explicit resolution or a precisely framed conferral question — none is silently defaulted. Phases 5–8 encode these decisions; they do not re-decide them.

---

## 1. License & Rights

*Closes GAP-02. Operationalizes the upstream decision recorded in REQUIREMENTS.md policy block.*

### 1.1 Occurrence-Record License URI

Every in-scope occurrence record carries the following constant `license` field value:

```
https://creativecommons.org/licenses/by-nc/4.0/legalcode
```

This is the canonical `/legalcode` URI required by GBIF's occurrence license parser (not the human-readable deed URL `/4.0/`). It applies as a constant column on all records emitted by the `dwc.occurrences` view in Phase 5 and serialized verbatim by the archive generator in Phase 6.

This URI is the operationalization of the upstream decision "occurrence-record license = CC-BY-NC 4.0" recorded in REQUIREMENTS.md. It is not re-decided here.

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

**Note on NULL license:** The `ALTER COLUMN license DROP NOT NULL` migration allows `NULL` values in `public.sighting_photos.license_code`. NULL license is treated identically to `none` — the photo is excluded from the Multimedia extension. Cross-reference Section 3 (gap table row for `observation_photos`) and Section 1.4.

### 1.3 Native Contributor Consent Basis (D-08)

The consent basis for publishing native SalishSea.io contributions under CC-BY-NC 4.0 is a two-part assertion per **D-08**:

1. **Platform-policy assertion for existing records:** Contributions already submitted to SalishSea.io are published under the platform's stated policy that sighting data is shared for conservation purposes. This is the consent basis for records in the database at the time of DwC-A publication.

2. **Submission-form license/consent notice going forward:** New contributions submitted after the v1.2 rollout must be accompanied by an explicit notice on the submission form that the data will be published in a DarwinCore Archive under CC-BY-NC 4.0. This notice is in scope for v1.2 but touches the live app runtime, which Phases 5–8 do not modify. It is flagged as a roadmap item — a small frontend task or Phase 8 extension — to be addressed before the public download link goes live (see Section 4, hosted-but-unlinked hold). See also the Deferred section of 04-CONTEXT.md.

### 1.4 License-Less Photo Exclusion (GAP-04 intersection)

Photos lacking a redistributable license are excluded from the Multimedia extension:

- **Native photos with `license_code = 'none'`** (the enum value): excluded.
- **Native photos with `license_code = NULL`**: excluded (same treatment as `none`).
- **Maplify `photo_url`**: the `maplify.sightings` table stores a photo URL but no license code. Per assumption A3 (no implied license for Maplify photos), all Maplify photos are excluded from the Multimedia extension until conferral with Conserve.IO explicitly grants a redistributable license.

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
| `license` | (none) | Not stored | Constant: `https://creativecommons.org/licenses/by-nc/4.0/legalcode` (GAP-02, Section 1.1). |
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
| `license` | (none) | Not stored | Constant: `https://creativecommons.org/licenses/by-nc/4.0/legalcode` (GAP-02, Section 1.1). |
| `geodeticDatum` | (none) | Not stored | Constant: `WGS84`. |

### 3.3 Gap Table: `public.sighting_photos` (Native Photos — Multimedia Extension)

| DwC Term | Source Column | Gap | Resolution |
|----------|--------------|-----|------------|
| `identifier` | `href` (varchar) | None | Photo URL. Emit verbatim. |
| `license` (Multimedia) | `license_code` (varchar NOT NULL) | Short code; needs URI mapping; `none` and NULL excluded | Apply per-photo converter (Section 1.2). Exclude `none` and NULL. |
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

*Closes GAP-04 (redistribution policy component). Per D-04, this section frames conferral questions — it does not assert permission where none exists.*

### 4.1 Holding Rule (D-01, D-02, D-05, D-06)

**Build stance (D-01):** The `dwc` schema (Phase 5), archive generator (Phase 6), and nightly job (Phase 7) are built at full scope — native + Maplify/Whale Alert records. Engineering does not wait on the rights questions.

**Default for archive contents (D-02):** The technical default is **include-and-attribute**. Maplify/Whale Alert records are included in the archive with structured attribution and provenance (Sections 2.2–2.3). Retreat from a source only on:
- Explicit prohibition found in publicly stated terms, **or**
- A "no" response received during direct conferral with the source organization.

**Per-source drop granularity (D-03):** If a nested sub-source (identified by `maplify.sightings.source`) declines or has prohibitive terms, only that sub-source's records are dropped — not the entire Maplify/Whale Alert feed. The `dwc` projection in Phase 5 must support filtering by `maplify.source` to enable this.

**Hosted-but-unlinked hold (D-05):** During the pre-conferral period:
- The nightly job (Phase 7) **publishes** the archive to the stable `/dwca/` URL as designed. The archive is reachable at the URL if you know it.
- Only the **frontend download link** (Phase 8) is suppressed. State = "unlisted," not private. No new access-control infrastructure is created (consistent with the v1.2 "no new AWS infra" constraint).

**Native-only public eligibility (D-06):** Native SalishSea.io records may be publicly linked — via the frontend download link — independently of third-party conferral, subject to the D-08 consent notice (Section 1.3) being in place. The third-party-inclusive public download link waits until conferral clears.

**Open question — D-07 (flagged for Phase 7/8 planner):** D-06 implies a possible native-only public archive variant distinct from the held full archive. The implementation question — one held archive plus one native-only variant, a build-time filter flag, or another mechanism — is NOT resolved here. This is an open implementation decision for the Phase 7/8 planner. The policy records only that the native-only-eligible-for-public-linking principle (D-06) implies this downstream implementation choice needs to be made.

### 4.2 Whale Alert / Conserve.IO (Maplify data platform operator)

**Important disambiguation:** There are two unrelated services named "Whale Alert":
- **`whale-alert.io` / `developer.whale-alert.io`** — a cryptocurrency blockchain transaction tracking service. Its prohibitive Terms & Conditions belong to this crypto service and are **irrelevant to this project**. Do not use these ToS when assessing redistribution rights.
- **`whalealert.org` / Conserve.IO** — the marine mammal whale sighting app operated by Conserve.IO (partnered with IFAW, NOAA). This is the entity that operates the WASEAK API from which SalishSea.io fetches `maplify.sightings` data.

**What is publicly stated:** Conserve.IO's privacy policy states that "non-personal data associated with marine mammal sightings — such as species, number observed, animal status, and sighting date, time, and location — are generally retained for scientific and conservation purposes." This describes internal retention policy, not a redistribution grant. The Maplify WASEAK registration requires users to use data "solely for situational awareness and avoiding whales" and not share credentials — no data licensing or redistribution terms are stated.

**What is NOT stated:** Whether downstream redistribution of Maplify sighting records as part of a DarwinCore Archive is permitted, prohibited, or subject to conditions. Absence of prohibition is not permission (avoiding Pitfall 6 per D-04).

**Contact surface:** `info@whalealert.org` (Conserve.IO / Whale Alert marine mammal app). Identified via IFAW as the contact for scientific data requests.

**Conferral question:** "SalishSea.io fetches whale sighting records from your WASEAK API (maplify.com/waseak) as part of our citizen science platform. We plan to publish these records in a DarwinCore Archive under CC-BY-NC 4.0, with attribution to the originating source (e.g., `datasetName = 'Orca Network'` for records tagged with that source). Do you grant permission for this redistribution? Are there specific attribution requirements or conditions we should follow?"

**Current status:** No redistribution policy found. **Hold applies** (D-05): archive built and hosted but third-party-inclusive public link suppressed pending this conferral.

### 4.3 Orca Network

**What is publicly stated:** Orca Network collects cetacean sighting reports from a PNW volunteer network. Their site notes that "collated sightings data provides invaluable and ongoing insight" and that data is shared "with researchers and natural resource managers." Orca Network is a named sub-source in `maplify.sightings.source` and a partner in the Whale Alert ecosystem. No formal data use policy, data sharing license, API documentation, or redistribution terms were found on the Orca Network website.

**What is NOT stated:** Whether sighting records attributed to Orca Network (submitted to Whale Alert / Maplify and appearing with `source = 'orca_network'` or equivalent) may be redistributed by third parties as part of a DwC-A archive.

**Contact surface:** `orcanetwork.org` — no direct data-use contact found. The organization is a small PNW-based nonprofit; direct inquiry may require a general contact form.

**Conferral question:** "SalishSea.io receives sighting records attributed to Orca Network via the Maplify/Whale Alert WASEAK feed. We plan to republish these records in a public DarwinCore Archive (CC-BY-NC 4.0) with `datasetName = 'Orca Network'` and `rightsHolder = 'Orca Network'`. Do you grant permission? Are there conditions or preferred attribution language we should follow?"

**Current status:** No redistribution policy found. **Hold applies** (D-05).

### 4.4 Cascadia Research Collective

**What is publicly stated:** Cascadia Research is a Washington-state nonprofit focused on cetacean and marine mammal research. Their publicly available Hawaii OASIS dataset on OBIS-SEAMAP is published under **CC-BY-NC 4.0** — demonstrating awareness of and willingness to use open data licensing. This is a positive signal for conferral. Their main website (`cascadiaresearch.org`) has no publicly stated data sharing, redistribution, or API policy specifically for sightings reported through Whale Alert.

**What is NOT stated:** Whether sighting records attributed to Cascadia Research (appearing in `maplify.sightings` with `source = 'cascadia'` or equivalent) may be redistributed in a DwC-A archive.

**Contact surface:** `strandings@cascadiaresearch.org`; phone 360-943-7325.

**Conferral question:** "We receive sightings attributed to Cascadia Research via the Maplify/Whale Alert WASEAK feed. We plan to republish them in a public DarwinCore Archive under CC-BY-NC 4.0, with `datasetName = 'Cascadia Research Collective'` and `rightsHolder = 'Cascadia Research Collective'`. Given that Cascadia's own published datasets (e.g., the OBIS-SEAMAP Hawaii OASIS dataset) use CC-BY-NC 4.0, do you grant permission for this downstream use? Are there conditions we should meet?"

**Current status:** No explicit redistribution policy found; own datasets use matching license (positive signal). **Hold applies** (D-05) until explicit conferral response received.

### 4.5 Organizational Conferral as an Out-of-Band Gate

Organizational conferral — contacting Whale Alert (Conserve.IO), Orca Network, and Cascadia Research with the questions above — is an **out-of-band, non-engineering task**. It is not a code phase; it is not planned as a GitHub issue or task in this roadmap. It is tracked here as the gate that un-hides third-party records from the public download link. When conferral produces a "yes" for an organization, Phase 8 (or a follow-up) can update the frontend link to include that source's records. When conferral produces a "no" for an organization, Phase 5's per-source filter (D-03) is activated to drop that sub-source.

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

## Decision Index

All D-numbers are cited in the sections above. For reference:

| Decision | Section(s) | Summary |
|----------|-----------|---------|
| D-01 | 4.1 | Build at full scope; engineering does not wait on rights questions |
| D-02 | 4.1 | Include-and-attribute default; retreat only on explicit prohibition or conferral "no" |
| D-03 | 4.1 | Per-`maplify.source` drop granularity |
| D-04 | 4.2, 4.3, 4.4 | Frame conferral questions; do not assert permission |
| D-05 | 4.1 | Hosted-but-unlinked hold; suppress only the frontend link |
| D-06 | 4.1 | Native records may be publicly linked independently of third-party conferral |
| D-07 | 4.1 | OPEN: native-only archive variant question for Phase 7/8 planner |
| D-08 | 1.3 | Native consent basis: platform policy + submission-form notice going forward |
| D-09 | 2.1 | Native `rightsHolder` = `recordedBy` = contributor display name |
| D-10 | 2.2, 3.2 | Third-party `recordedBy` = `usernm`; `datasetName` = sub-source; aggregator chain in `dynamicProperties` |
| D-11 | 2.2, 3.2 | Third-party `rightsHolder` = sub-source org when known; else "Whale Alert / Maplify" |
| D-12 | 3.4 | `occurrenceStatus = present` constant on all in-scope records |
| D-13 | 3.5 | `individualCount` emitted only when a real count exists; sparse column |
| D-14 | 5.2 | Min-count flagging applies to HappyWhale `min_count` only; no-op for v1.2 (HappyWhale excluded); CONTEXT.md D-14 wording corrected |

---

*Policy authored: 2026-06-10*
*Phase: 04-rights-data-model-policy-gate*
*Document home: `.planning/phases/04-rights-data-model-policy-gate/04-POLICY.md`*
