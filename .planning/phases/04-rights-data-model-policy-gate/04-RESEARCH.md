# Phase 4: Rights & Data-Model Policy (gate) - Research

**Researched:** 2026-06-10
**Domain:** DarwinCore standards, Creative Commons licensing, third-party redistribution terms, data-model gap analysis
**Confidence:** HIGH (DwC/GBIF standards), MEDIUM (Maplify/Conserve.IO terms — no policy found), LOW (Orca Network/Cascadia redistribution stance — no policy found)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Redistribution gate (reframed: conferral, not ToS guess)**
- D-01: Build at full scope — Maplify/Whale Alert records included in `dwc` projection, archive, and GeoParquet. Engineering does not wait on rights questions.
- D-02: Technical default is include-and-attribute (full native + Whale Alert scope with structured attribution/provenance). Retreat from a source only on explicit prohibition or a "no" during conferral.
- D-03: Per-`source` drop granularity. If a nested Whale Alert sub-source declines, drop only that sub-source. The `dwc` projection must support filtering by `maplify.source`.
- D-04: Phase 4 policy document frames open questions for conferral rather than asserting resolutions. Lists the specific question(s) to take to each organization before their records are publicly exposed.

**Public exposure / hold policy**
- D-05: Pre-conferral hold: archive hosted but unlinked. Nightly job publishes to stable `/dwca/` URL; only the frontend download link is suppressed. State = "unlisted," not private.
- D-06: Native records may be publicly linked independently of third-party conferral. Third-party-inclusive public download link waits until conferral clears.
- D-07 (open — planner to decide): D-06 implies a possible native-only public archive variant. Planner to decide mechanism (one archive held + one native-only variant, build-time flag, or other).

**Native contributor consent basis**
- D-08: Consent basis = platform-policy assertion for existing records + explicit license/consent notice added to submission form going forward. Submission-form notice is in scope for v1.2.

**Attribution & provenance model**
- D-09: Native records: `rightsHolder` = individual contributor; `recordedBy` = contributor's display name.
- D-10: Third-party (Maplify/Whale Alert): `recordedBy` = original observer/username where present; `datasetName` = sub-source (e.g., "Orca Network"); full aggregator chain (Whale Alert → sub-source) carried as structured `dynamicProperties`.
- D-11: Third-party `rightsHolder` = originating sub-source (Orca Network, Cascadia, …) when known; falls back to Whale Alert/Maplify.

**Count / occurrenceStatus gap**
- D-12: `occurrenceStatus = present` on every in-scope record. Constant column.
- D-13: `individualCount` emitted only when a real count exists (`observations.count`, `maplify.number_sighted`). Sparse column.
- D-14: Where count is a lower-bound / min-count (happywhale `min_count`), emit as `individualCount` but flag minimum/range in `dynamicProperties`.

**Already locked upstream (from REQUIREMENTS.md — do not re-decide)**
- License = CC-BY-NC 4.0 as a resolvable CC URI; per-photo CC license codes mapped to canonical CC URIs via one shared converter; license-less photos excluded.
- `basisOfRecord` = `HumanObservation`; `geodeticDatum` = WGS84 (EPSG:4326) constant.
- `coordinateUncertaintyInMeters`: real meters when known; omit when unknown — never 0.
- `eventDate`: ISO-8601 at honest per-source precision; Maplify report-time at date precision (or flagged), never false second-level sighting time.
- `occurrenceID`: stable/deterministic across nightly runs (source-prefixed surrogate keys).
- `travelDirection` → `dynamicProperties` (no core term). Regex-extracted whale identifiers excluded from identity terms — at most labeled-unverified in `dynamicProperties`, never `organismID`/`catalogNumber`.

### Claude's Discretion
- Exact `dynamicProperties` key/value structure (provenance chain, min-count flag) — propose during planning, consistent with DwC conventions.
- Document format/layout of the gaps-and-policy artifact, as long as it records a resolution or an explicit conferral-question for every audited gap.

### Deferred Ideas (OUT OF SCOPE)
- Submission-form consent/license notice (D-08) touches live app runtime — needs a roadmap entry (new small frontend task or Phase 8 extension). Flag to `/gsd-phase` after this phase.
- DOWNLOAD-01 ships hidden + native-only variant (D-06, D-07) — Phase 8 scope nuance.
- Organizational conferral itself — out-of-band, non-engineering task. Tracked as the gate that un-hides third-party records.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GAP-01 | Data and datatype gaps between the existing model and DarwinCore are audited and documented as explicit findings (not silently fudged) | Data-model audit below; DwC term semantics grounded in TDWG definitions |
| GAP-02 | Occurrence records carry a `license` (CC-BY-NC 4.0) and `rightsHolder` as resolvable URIs; per-photo license codes mapped to canonical CC URIs via one shared converter | Canonical URI confirmed; per-photo mapping rule derived from GBIF guidance |
| GAP-03 | Source attribution and provenance carried into the archive (`recordedBy`, dataset/record provenance for Whale Alert and nested sources) | DwC term semantics for `recordedBy`, `datasetName`, `dynamicProperties` verified; aggregator-chain encoding proposed |
| GAP-04 | Records and fields lacking a usable value handled per documented policy — omit-when-unknown, exclude license-less photos, exclude unvalidated whale identifiers from identity terms | Each rule grounded against GBIF/TDWG guidance and schema audit |
</phase_requirements>

---

## Summary

This phase produces a single authoritative policy document that encodes every rights and data-model-gap resolution (or explicit conferral-framing) that downstream Phases 5–8 will encode in SQL, archive generator logic, and frontend UI. The research grounding falls into four areas: (1) exact DwC term semantics and GBIF-required formats, (2) the canonical CC-BY-NC 4.0 URI string, (3) the redistribution landscape for each third-party source, and (4) the existing data model's alignment with DwC requirements.

**The most important finding for the policy document:** Maplify/Conserve.IO and its sub-sources (Orca Network, Cascadia Research) have **no publicly stated redistribution policy**. The `whale-alert.io` Terms & Conditions that appear in searches belong to a cryptocurrency tracking company, not the marine mammal app. The marine mammal Whale Alert is operated by Conserve.IO, whose privacy policy says only that non-personal sighting data is "retained for scientific and conservation purposes" — no redistribution grant or prohibition. This is the canonical example of the "no clear stance" scenario D-04 was written for. The policy document should frame specific, answerable conferral questions for each organization rather than asserting either permission or prohibition.

**Data-model finding:** The CONTEXT.md decision D-14 refers to "maplify `min_count`" — but inspecting the schema confirms `min_count` is on `happywhale.encounters`, not `maplify.sightings`. Maplify uses `number_sighted` (always an integer, treated as exact). The policy document should record this correction, since D-14's flagging logic applies to HappyWhale records, not Maplify records. (HappyWhale is out of scope for v1.2 — so D-14 may not apply at all in this milestone. The policy document should note this.)

**Primary recommendation:** The Phase 4 deliverable is a structured Markdown policy document with one section per gap/decision, each recording either (a) the confirmed encoding rule (with DwC term URI and format), or (b) a precisely framed conferral question with a holding rule that applies until conferral resolves it.

---

## Architectural Responsibility Map

This phase produces no runtime code. The architectural mapping is for the policy document's downstream consumers.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| License URI emission | Database (`dwc` schema) | Archive generator (Phase 6) | Computed in SQL view; serialized verbatim by generator |
| Rights/attribution fields | Database (`dwc` schema) | — | `rightsHolder`, `recordedBy`, `datasetName` are SQL-computed from source tables |
| `dynamicProperties` encoding | Database (`dwc` schema) | — | JSON string assembled in SQL; policy doc specifies the key/value schema |
| Per-photo license conversion | Database (`dwc` schema) | — | `observation_photos.license_code` enum → CC URI, done in SQL |
| Conferral gate (hold) | Frontend (Phase 8) | Phase 7 hosting | Download link suppressed; archive itself is always published |

---

## DarwinCore Term Semantics Reference

The following is the authoritative encoding reference for each term appearing in the policy document decisions. All definitions are from TDWG's official Darwin Core Quick Reference at `https://dwc.tdwg.org/terms/`.

### Core Required Terms (GBIF minimum for a valid occurrence record)

| Term | URI | Required by GBIF | Definition Summary |
|------|-----|------------------|--------------------|
| `occurrenceID` | `http://rs.tdwg.org/dwc/terms/occurrenceID` | Yes | Globally unique or dataset-scoped identifier for this occurrence instance. |
| `basisOfRecord` | `http://rs.tdwg.org/dwc/terms/basisOfRecord` | Yes | Controlled vocabulary: `HumanObservation`, `MachineObservation`, `PreservedSpecimen`, etc. |
| `scientificName` | `http://rs.tdwg.org/dwc/terms/scientificName` | Yes | Lowest-rank taxon name. |
| `eventDate` | `http://rs.tdwg.org/dwc/terms/eventDate` | Yes | ISO 8601-1:2019 date or date-time. May be a date-only string (e.g., `2024-03-15`). |

[VERIFIED: GBIF IPT manual — https://ipt.gbif.org/manual/en/ipt/latest/occurrence-data]

### Attribution & Rights Terms

| Term | URI | Definition Summary | Format |
|------|-----|--------------------|--------|
| `license` | `http://purl.org/dc/terms/license` | Legal document granting permission. | Full URI to legal license document. |
| `rightsHolder` | `http://purl.org/dc/terms/rightsHolder` | Person or organization owning or managing rights. | Plain text name. |
| `recordedBy` | `http://rs.tdwg.org/dwc/terms/recordedBy` | Names of agents responsible for recording the occurrence. | Pipe-separated list `A | B` for multiple agents. |
| `datasetName` | `http://rs.tdwg.org/dwc/terms/datasetName` | Name of the source dataset. | Plain text (e.g., "Orca Network"). |
| `datasetID` | `http://rs.tdwg.org/dwc/terms/datasetID` | Identifier for the source dataset. | UUID or URI when available. |

[VERIFIED: TDWG Darwin Core Quick Reference — https://dwc.tdwg.org/terms/]

**Key semantic note on `recordedBy` vs `rightsHolder`:** These are independent roles. `recordedBy` = the person who made the observation (collection role). `rightsHolder` = the entity that holds intellectual property rights (legal role). For aggregated third-party data, both may differ from the submitting platform. [VERIFIED: TDWG Darwin Core Quick Reference]

### Occurrence-Level Terms

| Term | URI | Definition Summary | Format |
|------|-----|--------------------|--------|
| `occurrenceStatus` | `http://rs.tdwg.org/dwc/terms/occurrenceStatus` | Whether the organism was present or absent. | Controlled vocabulary: `present` or `absent`. |
| `individualCount` | `http://rs.tdwg.org/dwc/terms/individualCount` | Number of individuals in the occurrence. | Non-negative integer. Sparse — omit when unknown. |
| `dynamicProperties` | `http://rs.tdwg.org/dwc/terms/dynamicProperties` | Additional measurements, facts, or assertions not covered by other terms. | JSON key-value string, e.g., `{"travelDirection":"north","countIsMinimum":true}` |
| `occurrenceRemarks` | `http://rs.tdwg.org/dwc/terms/occurrenceRemarks` | Free-text comments about the occurrence. | Unstructured text. |
| `informationWithheld` | `http://rs.tdwg.org/dwc/terms/informationWithheld` | Description of information that exists but is not shared. | Text description, pipe-separated if multiple. |

[VERIFIED: TDWG Darwin Core Quick Reference — https://dwc.tdwg.org/terms/]

### Spatial Terms

| Term | Encoding Rule (from locked decisions) |
|------|---------------------------------------|
| `coordinateUncertaintyInMeters` | Emit real meters when known; **omit when unknown; zero is invalid**. [VERIFIED: TDWG — "Zero is invalid; leave empty if unknown. Suggested minimums: 30m post-2000 GPS, 100m pre-2000 GPS."] |
| `geodeticDatum` | Constant `WGS84` (EPSG:4326). [VERIFIED: locked upstream] |
| `decimalLatitude` / `decimalLongitude` | Standard decimal degrees. Axis convention: lat=Y (north), lon=X (east/west). |

### Temporal Terms

| Term | Encoding Rule |
|------|---------------|
| `eventDate` | ISO 8601-1:2019. Date-only precision (`2024-03-15`) is valid and preferred over a fabricated timestamp. Maplify `created_at` is report-time (when the record entered the system), not sighting time — emit at date precision only, or omit the time component entirely. |

[VERIFIED: TDWG Darwin Core Quick Reference; GBIF IPT manual]

---

## Creative Commons License URI Reference

### CC-BY-NC 4.0 — Canonical URI for DwC `license` field

The GBIF-required URI for occurrence-record and dataset-level licensing is:

```
https://creativecommons.org/licenses/by-nc/4.0/legalcode
```

[VERIFIED: GBIF Data Blog — https://data-blog.gbif.org/post/gbif-occurrence-license-processing/ — this is the exact string GBIF parses for CC-BY-NC 4.0]

**Important distinctions:**
- The GBIF occurrence license processor accepts three exact strings:
  1. `https://creativecommons.org/publicdomain/zero/1.0/legalcode`
  2. `https://creativecommons.org/licenses/by/4.0/legalcode`
  3. `https://creativecommons.org/licenses/by-nc/4.0/legalcode`
- For records where GBIF cannot parse the license, it defaults to the dataset-level license.
- The `/legalcode` suffix is required for GBIF's parser; the human-readable deed URL (`/4.0/`) is NOT the canonical record-level URI.
- CC-BY-NC is explicitly accepted by GBIF for dataset registration (alongside CC0 and CC-BY).

[VERIFIED: GBIF Data Blog; GBIF IPT Applying a License — https://ipt.gbif.org/manual/en/ipt/latest/applying-license]

### Per-Photo CC License Code → Canonical URI Converter

The existing `license` enum on `public.observation_photos` uses values like `cc-by-nc`, `cc-by`, `cc0`, etc. The shared converter must map these to GBIF-parseable URIs.

| Enum value | Canonical CC URI |
|------------|-----------------|
| `cc0` | `https://creativecommons.org/publicdomain/zero/1.0/legalcode` |
| `cc-by` | `https://creativecommons.org/licenses/by/4.0/legalcode` |
| `cc-by-nc` | `https://creativecommons.org/licenses/by-nc/4.0/legalcode` |
| `cc-by-sa` | `https://creativecommons.org/licenses/by-sa/4.0/legalcode` |
| `cc-by-nd` | `https://creativecommons.org/licenses/by-nd/4.0/legalcode` |
| `cc-by-nc-sa` | `https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode` |
| `cc-by-nc-nd` | `https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode` |
| `none` | (exclude photo — no license to redistribute under) |

[ASSUMED: version pinned at 4.0 for all variants except CC0. The database stores short codes without version numbers. The policy document should explicitly specify version 4.0 as the default assumption for all per-photo license conversions unless a different version is stored.]

**Exclusion rule (GAP-04):** Photos with `license_code = 'none'` (the enum value, not NULL) are excluded from the Multimedia extension. NULL license (from the `ALTER COLUMN license DROP NOT NULL` migration) is also treated as no-license and excluded. [VERIFIED from schema: `20250921045207_photo_licensing.sql` filters `WHERE license IS NOT NULL`]

---

## Third-Party Source Redistribution Landscape

This section documents what is **publicly stated** and what is **not stated** for each organization in the Maplify/Whale Alert aggregation chain. Per D-04, the policy document frames conferral questions, not assertions.

### Maplify / EarthNC / Conserve.IO (the data platform operator)

**What was found:**
- Maplify (`maplify.com`) is branded "Web Mapping Made Easy" and is operated by EarthNC, which redirects to Conserve.IO.
- Conserve.IO also operates the Whale Alert marine mammal app (iOS/Android).
- The Maplify `waseak` (Whale Alert Southeast Alaska) registration page requires users to agree only that they will use data "solely for situational awareness and avoiding whales" and will not share credentials.
- Conserve.IO's privacy policy states that "non-personal data associated with marine mammal sightings — such as species, number observed, animal status, and sighting date, time, and location — are generally retained for scientific and conservation purposes." This describes internal retention, not any external redistribution grant.
- No terms of service, data license, API license, or redistribution policy was found publicly on Maplify.com, EarthNC.com, or Conserve.IO for the WASEAK sightings feed.

**What is NOT stated:** Whether downstream redistribution (as part of a DwC-A archive) is permitted, prohibited, or subject to conditions.

**Contact surface:** info@whalealert.org (Conserve.IO / WhaleAlert) is the contact for scientific data use per their IFAW page.

**Conferral question to frame:** "SalishSea.io fetches whale sighting records from your WASEAK API (maplify.com/waseak) as part of our citizen science platform. We plan to publish these records in a DarwinCore Archive under CC-BY-NC 4.0, with attribution to the originating source. Do you grant permission for this redistribution? Are there specific attribution requirements or conditions?"

[CITED: Conserve.IO privacy policy — https://conserve.io/privacy-policy; Maplify WASEAK registration — https://maplify.com/waseak/register.php]

### Orca Network

**What was found:**
- Orca Network collects cetacean sighting reports from a volunteer network and makes the data available on its website for conservation and research purposes.
- Their site mentions that "collated sightings data provides invaluable and ongoing insight" and that data is shared "with researchers and natural resource managers."
- No formal data use policy, data sharing license, API documentation, or redistribution terms were found on the Orca Network website.
- Orca Network is listed as a partner in the Whale Alert ecosystem (IFAW partner list) and is a named sub-source in `maplify.sightings.source`.

**What is NOT stated:** Whether sighting records submitted to Whale Alert / Maplify and attributed to `source = 'orca_network'` (or similar) may be redistributed by third parties.

**Contact surface:** orcanetwork.org — no direct data-use contact found; the organization appears small (PNW-based nonprofit).

**Conferral question to frame:** "SalishSea.io receives sighting records attributed to Orca Network via the Maplify/Whale Alert WASEAK feed. We plan to republish these records in a public DarwinCore Archive (CC-BY-NC 4.0) with `datasetName = 'Orca Network'` and `rightsHolder = 'Orca Network'`. Do you grant permission? Are there conditions or preferred attribution language?"

[CITED: Orca Network website — https://www.orcanetwork.org/]

### Cascadia Research Collective

**What was found:**
- Cascadia Research is a Washington-state nonprofit focused on cetacean and marine mammal research.
- Their publicly available Hawaii OASIS dataset on OBIS-SEAMAP is published under **CC-BY-NC 4.0** — demonstrating awareness of and willingness to use open data licensing.
- Their main website (cascadiaresearch.org) has no publicly stated data sharing, redistribution, or API policy for sightings reported through Whale Alert.
- Contact: strandings@cascadiaresearch.org; phone 360-943-7325.

**What is NOT stated:** Whether sighting records attributed to Cascadia via Maplify may be redistributed in a DwC-A archive.

**Key signal:** Their own published datasets use CC-BY-NC 4.0 — the same license proposed for the SalishSea.io archive. This increases the likelihood of a cooperative response to conferral.

**Conferral question to frame:** "We receive sightings attributed to Cascadia Research via the Maplify/Whale Alert feed. We plan to republish them in a DarwinCore Archive under CC-BY-NC 4.0 with attribution to Cascadia Research. Given that Cascadia's own published datasets use this license, do you grant permission for this downstream use?"

[CITED: Cascadia Research OBIS-SEAMAP dataset — https://ipt.env.duke.edu/resource?r=zd_467]

### Note on "Whale Alert" nomenclature

There are TWO unrelated services named "Whale Alert":
1. **whale-alert.io / developer.whale-alert.io** — a cryptocurrency blockchain transaction tracking service. Its prohibitive Terms & Conditions (prohibiting redistribution of data) belong to this crypto service, NOT to the marine mammal app. **Disregard these ToS for this project.**
2. **whalealert.org / Conserve.IO** — the marine mammal whale sighting app operated by Conserve.IO (partnered with IFAW, NOAA). This is the entity relevant to this project. Its terms are described above.

[VERIFIED: whale-alert.io crypto context confirmed from site content; NOAA Fisheries confirms Conserve.IO / IFAW operates the marine mammal Whale Alert]

---

## Data-Model Gap Audit

This section maps each existing schema field to its DwC encoding rule, auditing gaps and documenting the resolution per GAP-01.

### Source: `public.observations` (native SalishSea.io records)

| DB Column | DwC Term | Gap / Resolution |
|-----------|----------|-----------------|
| `id` (UUID string) | `occurrenceID` | Prefix with `salishsea:` for globally scoped ID. Format: `salishsea:{id}`. |
| `observed_at` (timestamptz) | `eventDate` | Emit as ISO-8601; full timestamp available (contributor-submitted), so full precision is honest. |
| `subject_location` (geography) | `decimalLatitude`, `decimalLongitude` | Emit ST_Y / ST_X. |
| `accuracy` (integer, nullable) | `coordinateUncertaintyInMeters` | Emit when non-null. Omit (NULL) when absent — never 0. |
| `count` (smallint, nullable, CHECK > 0) | `individualCount` | Emit when non-null (D-13). |
| `body` (text, nullable) | `occurrenceRemarks` | Strip HTML; emit as plain text. |
| `direction` (travel_direction enum, nullable) | `dynamicProperties` | Key: `"travelDirection"`. Not a core DwC term. |
| `taxon_id` (FK) | `scientificName`, `taxonRank`, `kingdom`…`genus` | Resolved by walking `inaturalist.taxa` parent hierarchy (Phase 5 concern). |
| `contributor_id` (FK) | `recordedBy`, `rightsHolder` | `contributors.name` → both fields (D-09). Identity exposure is accepted. |
| `url` (nullable) | `occurrenceDetails` or `references` | Minor — emit if present; no DwC gap. |
| (none) | `basisOfRecord` | Constant: `HumanObservation` (locked upstream). |
| (none) | `occurrenceStatus` | Constant: `present` (D-12). |
| (none) | `license` | Constant: `https://creativecommons.org/licenses/by-nc/4.0/legalcode` (GAP-02). |
| (none) | `geodeticDatum` | Constant: `WGS84` (locked upstream). |

**Gap: No sighting-time precision flag.** Native observations have `observed_at` as a full timestamptz (contributor-entered). This is honest — no gap. The precision concern applies only to Maplify.

### Source: `maplify.sightings` (Whale Alert / Maplify records)

| DB Column | DwC Term | Gap / Resolution |
|-----------|----------|-----------------|
| `id` (integer) | `occurrenceID` | Prefix: `maplify:{id}`. |
| `created_at` (timestamp) | `eventDate` | **Gap (ALIGN-05):** This is the report time, not the sighting time. Emit at **date precision only** (`created_at::date`). Document the reason in the policy. |
| `location` (geography) | `decimalLatitude`, `decimalLongitude` | Emit ST_Y / ST_X. |
| (none) | `coordinateUncertaintyInMeters` | **Gap:** No accuracy stored for Maplify records. **Policy: Omit.** |
| `number_sighted` (integer, NOT NULL) | `individualCount` | The current occurrences view filters to `BETWEEN 1 AND 1000` before emitting count. Apply same filter for DwC. (D-13) |
| `comments` (varchar, nullable) | `occurrenceRemarks` | Strip HTML; emit. |
| `source` (varchar NOT NULL) | `datasetName` | Maps to human-readable sub-source name (D-10). Mapping table needed: `orca_network` → "Orca Network", etc. |
| `usernm` (varchar, nullable) | `recordedBy` | Emit when non-null (D-10). |
| `source` values | `rightsHolder` | Sub-source organization when known; fallback to "Whale Alert / Maplify" (D-11). |
| (none) | `basisOfRecord` | Constant: `HumanObservation`. |
| (none) | `occurrenceStatus` | Constant: `present` (D-12). |
| `photo_url` (varchar, nullable) | Multimedia extension | Single photo URL. **Gap: No license stored for Maplify photos.** Policy per GAP-04: **exclude Maplify photos from Multimedia extension** (no license → cannot redistribute). This is the correct application of the license-less photo exclusion rule. |
| aggregator chain | `dynamicProperties` | Key `"aggregatorChain"` or similar; structured JSON recording the Whale Alert → sub-source path (D-10). |

**Critical data-model note on `min_count`:** D-14 in CONTEXT.md refers to "maplify `min_count`" — but `min_count` does not exist on `maplify.sightings`. It is a column on `happywhale.encounters`. Maplify records use `number_sighted` (always an integer, treated as exact). **HappyWhale is excluded from v1.2 scope.** Therefore D-14's min-count flagging logic has no applicable records in v1.2. The policy document should record this correction explicitly: "D-14 applies to HappyWhale `min_count`; since HappyWhale is out of v1.2 scope, D-14 has no in-scope records to emit and is a no-op for v1.2. Preserve the policy for when HappyWhale is added."

**Known `source` values in `maplify.sightings`:** The fetch function filters `WHERE source != 'rwsas'`, confirming `rwsas` is excluded. Other values are not enumerated in the codebase — the actual distinct values must be queried from the production database to build the `datasetName` / `rightsHolder` mapping. The policy document should note this as a task: "Query `SELECT DISTINCT source FROM maplify.sightings` before writing the mapping table in Phase 5."

### Source: `public.observation_photos` (native photos)

| DB Column | DwC Term | Gap / Resolution |
|-----------|----------|-----------------|
| `href` | `identifier` (Multimedia) | URL of the photo. |
| `license_code` (varchar NOT NULL) | `license` (Multimedia) | Map enum → CC URI via the shared converter. Exclude `none`. |
| `seq` | `Multimedia.index` | Ordering. |
| (none) | `rights` | Derived from `license_code` → CC URI. |
| (none) | `type` | Constant `StillImage` for observation photos. |

**Gap:** No `rightsHolder` stored per photo. The record-level `rightsHolder` (contributor) applies to photos as well.

### Unvalidated whale identifier exclusion (GAP-04)

`extract_identifiers(body)` regex extracts strings like `T065S` from free-text fields. Per the locked upstream decision:
- These are **never** emitted as `organismID`, `catalogNumber`, or any identity term.
- They may appear in `dynamicProperties` as `{"unvalidatedIdentifiers": ["T065S"]}` or similar, clearly labeled.
- `informationWithheld` could optionally note: "Regex-extracted whale identifiers present in source text but excluded from identity terms pending individual validation."

---

## `dynamicProperties` Key/Value Schema Proposal

Per Claude's Discretion, this research proposes a consistent JSON schema for `dynamicProperties`. The planner should confirm or adjust.

```json
{
  "travelDirection": "north",
  "aggregatorSource": "Orca Network",
  "aggregatorChain": "Whale Alert SE Alaska (Maplify) > Orca Network",
  "countIsMinimum": true,
  "unvalidatedIdentifiers": ["T065S", "T002"]
}
```

**Key explanations:**
- `travelDirection`: the `travel_direction` enum value in snake_case. Omit if null.
- `aggregatorSource`: the human-readable `maplify.source` sub-source name. Present on all Maplify records.
- `aggregatorChain`: the full provenance chain. Present on all Maplify records. Encodes D-10's "aggregator chain" requirement.
- `countIsMinimum`: boolean, `true` only when the count is a known lower bound (HappyWhale `min_count`). Present only when applicable; not emitted for exact counts.
- `unvalidatedIdentifiers`: array of regex-extracted whale ID strings. Present only when `extract_identifiers(body)` returns non-empty.

**GBIF note:** `dynamicProperties` is not indexed or searchable by GBIF. It is passed through verbatim. This is appropriate for non-standard fields; use DwC core or extension terms for anything that should be filterable. [CITED: GBIF portal feedback issue #2251 — https://github.com/gbif/portal-feedback/issues/2251]

---

## Policy Document Structure Recommendation

Per Claude's Discretion on document format, the Phase 4 deliverable (`04-POLICY.md`) should have this structure:

```
# Rights & Data-Model Policy

## 1. License & Rights
  1.1 Occurrence-record license URI
  1.2 Per-photo license conversion table
  1.3 Native contributor consent basis (D-08)
  1.4 License-less photo exclusion rule

## 2. Attribution & Provenance Model
  2.1 Native records (recordedBy, rightsHolder)
  2.2 Third-party records (recordedBy, rightsHolder, datasetName)
  2.3 dynamicProperties schema
  2.4 Unvalidated identifier handling

## 3. Data-Model Gaps & Resolutions
  3.1 [Each gap: term, source column, gap description, resolution rule]

## 4. Third-Party Redistribution Status
  4.1 Maplify / Conserve.IO — [status: no policy found; conferral question]
  4.2 Orca Network — [status: no policy found; conferral question]
  4.3 Cascadia Research — [status: no policy found; conferral question]
  4.4 Holding rule (D-02, D-05, D-06): include-and-attribute; unlink; native-only eligible for public exposure

## 5. Scope Clarifications
  5.1 HappyWhale excluded from v1.2
  5.2 min_count / D-14 is a no-op for v1.2
  5.3 iNaturalist / Happywhale excluded (published elsewhere)
```

Each gap in section 3 must record: (a) the DwC term, (b) the source column or absence, (c) the gap description, (d) the resolution rule with justification. "No gap" is a valid resolution for well-populated fields.

---

## Common Pitfalls

### Pitfall 1: Confusing the two "Whale Alert" services
**What goes wrong:** Web searches for "Whale Alert terms of service" return `whale-alert.io` — a cryptocurrency tracking site with strict prohibitive ToS — not the marine mammal app.
**Why it happens:** The cryptocurrency Whale Alert has aggressive SEO and similar branding.
**How to avoid:** The marine mammal Whale Alert is operated by **Conserve.IO** (formerly EarthNC); contact `info@whalealert.org` or look at `whalealert.org` / `conserve.io`.

### Pitfall 2: Using the wrong CC URI format
**What goes wrong:** The human-readable deed URL (`https://creativecommons.org/licenses/by-nc/4.0/`) is NOT what GBIF's occurrence license parser expects.
**How to avoid:** Always use the `/legalcode` suffix: `https://creativecommons.org/licenses/by-nc/4.0/legalcode`. [VERIFIED: GBIF Data Blog]

### Pitfall 3: Assuming D-14 (min-count) applies to Maplify
**What goes wrong:** `min_count` is a HappyWhale column, not a Maplify column. Maplify records always have an exact `number_sighted` count.
**How to avoid:** Verify column existence against schema before emitting. In v1.2, HappyWhale is out of scope so D-14 has no cases to handle.

### Pitfall 4: Emitting Maplify's `created_at` as an event timestamp
**What goes wrong:** `maplify.sightings.created_at` is the time the record was created in the Maplify database (report-received time), not the time the whale was sighted. Emitting it at second precision gives a false impression of sighting-time precision.
**How to avoid:** Emit `created_at::date` (date precision only), and document this in `occurrenceRemarks` or leave `eventDate` at date precision. [VERIFIED: ALIGN-05 requirement; schema inspection]

### Pitfall 5: Omitting occurrenceStatus
**What goes wrong:** GBIF strongly recommends `occurrenceStatus` for all observation records; absence may cause quality flags.
**How to avoid:** Constant `present` on every in-scope record per D-12. [VERIFIED: TDWG definition; GBIF quality guidance]

### Pitfall 6: Asserting redistribution permission where none exists
**What goes wrong:** Framing "no prohibition found = permission" is not the same as "explicit permission granted."
**How to avoid:** Per D-04, the policy document frames conferral questions and records a holding rule (include-and-attribute, hosted-but-unlinked), not a permission assertion.

---

## Environment Availability

Step 2.6: SKIPPED — this phase produces no code and has no external tool dependencies. The policy document is a Markdown file authored in-process.

---

## Validation Architecture

Phase 4 produces a policy document, not executable code or database objects. There are no automated tests for this phase.

**Human verification criteria (from ROADMAP.md success criteria):**

| # | Success Criterion | Verification Method |
|---|-------------------|---------------------|
| 1 | Written gaps-and-policy document records a resolution for every audited data gap | Human review against the gaps listed in this research |
| 2 | Occurrence-record license recorded as CC-BY-NC 4.0 resolvable CC URI, with native-record/contributor-consent stance documented | Confirm URI string matches `https://creativecommons.org/licenses/by-nc/4.0/legalcode` |
| 3 | Attribution/provenance model specified for `recordedBy`, `rightsHolder`, `datasetName` for Whale Alert and nested sources | Policy doc contains section 2 as specified above |
| 4 | Decision recorded on Whale Alert/Maplify redistribution — confirmed permission OR explicit fallback | Policy doc contains section 4 with conferral questions and holding rule |

**Wave 0 gaps:** None — no test infrastructure needed.

---

## Security Domain

This phase produces a policy document with no code execution surface. No ASVS categories apply.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Per-photo CC license codes should all be converted to version 4.0 URIs (no version info stored in the enum) | CC URI converter table | A photo licensed under CC-BY 3.0 would be incorrectly upgraded to 4.0; 4.0 has broader licensor protections but this is generally a safe default |
| A2 | The `maplify.sightings.source` column contains values like `orca_network`, `cascadia` (lowercase/underscore) matching the human-readable organization names | D-10 datasetName mapping | If actual values differ (e.g., `OrcaNetwork`, `orca network`), the mapping table in Phase 5 needs adjustment — query `SELECT DISTINCT source FROM maplify.sightings` before encoding |
| A3 | Maplify photos (`photo_url`) have no stored license and should be excluded from the Multimedia extension | GAP-04 photo exclusion | If Conserve.IO during conferral grants a license for the photos, the exclusion rule would need updating in Phase 5/6 |
| A4 | The `rwsas` source exclusion already in the fetch function (already excluded from ingest) means no `rwsas` records exist in `maplify.sightings` | D-03 per-source drop | If `rwsas` records were ingested before the filter was added, they may exist in the DB; verify before writing the DwC filter |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

---

## Open Questions

1. **Actual `maplify.source` distinct values**
   - What we know: The column exists; `rwsas` is excluded at ingest time; `orca_network` / `cascadia` are expected.
   - What's unclear: The exact values present in the production database, needed to build the `datasetName` / `rightsHolder` mapping.
   - Recommendation: The policy document should include a placeholder mapping table and note "confirm against `SELECT DISTINCT source FROM maplify.sightings`" as a Phase 5 task.

2. **Maplify photo license status**
   - What we know: `photo_url` is a URL string with no license column. The current occurrences view emits photos without license info for Maplify records.
   - What's unclear: Whether Conserve.IO/Maplify has an implied or stated license for photos submitted through their platform that would permit downstream redistribution.
   - Recommendation: Exclude from Multimedia extension unless conferral explicitly grants permission.

3. **D-08 submission-form notice — which phase owns it**
   - What we know: D-08 requires a consent/license notice on the submission form for new records; it's in scope for v1.2 but touches app runtime.
   - What's unclear: Whether this belongs in a new small phase or as an extension of Phase 8.
   - Recommendation: Flag to project owner at end of Phase 4; do not block Phase 4 policy document on this question.

---

## Package Legitimacy Audit

Not applicable — this phase installs no packages.

---

## Sources

### Primary (HIGH confidence)
- TDWG Darwin Core Quick Reference — https://dwc.tdwg.org/terms/ — all term definitions, URIs, recommended formats
- GBIF IPT Manual: Occurrence Data — https://ipt.gbif.org/manual/en/ipt/latest/occurrence-data — required terms (occurrenceID, basisOfRecord, scientificName, eventDate)
- GBIF IPT Manual: Applying a License — https://ipt.gbif.org/manual/en/ipt/latest/applying-license — CC license URI format, supported licenses (CC0/CC-BY/CC-BY-NC)
- GBIF Data Blog: Occurrence License Processing — https://data-blog.gbif.org/post/gbif-occurrence-license-processing/ — exact GBIF-parseable URI strings for all three CC licenses
- GBIF Tech Docs: Multimedia Publishing — https://techdocs.gbif.org/en/data-publishing/multimedia-publishing — Simple Multimedia extension license field

### Secondary (MEDIUM confidence)
- Conserve.IO Privacy Policy — https://conserve.io/privacy-policy — what Maplify/Whale Alert says about sighting data (no redistribution grant or prohibition found)
- Maplify WASEAK Registration — https://maplify.com/waseak/register.php — user agreement (data use for situational awareness only; no data licensing terms)
- Cascadia Research OBIS-SEAMAP dataset — https://ipt.env.duke.edu/resource?r=zd_467 — Cascadia publishes their own data under CC-BY-NC 4.0
- NOAA Fisheries Whale Alert page — https://www.fisheries.noaa.gov/resource/tool-app/whale-alert — confirms Conserve.IO/IFAW operate the marine mammal Whale Alert
- IFAW Whale Alert page — https://www.ifaw.org/international/campaigns/whale-alert — contact info@whalealert.org for scientific data requests
- Orca Network website — https://www.orcanetwork.org/ — no data policy found; data shared with researchers and managers

### Tertiary (LOW confidence)
- GBIF portal feedback issue #2251 — confirms `dynamicProperties` is not indexed/searchable by GBIF

---

## Metadata

**Confidence breakdown:**
- DwC term semantics and URI formats: HIGH — verified against TDWG and GBIF official sources
- CC-BY-NC 4.0 canonical URI: HIGH — exact string confirmed via GBIF data blog
- Maplify/Conserve.IO redistribution terms: MEDIUM — no policy found (absence confirmed, not assumed)
- Orca Network redistribution terms: MEDIUM — no policy found (absence confirmed)
- Cascadia redistribution terms: MEDIUM — no policy found; their own datasets use CC-BY-NC 4.0 (positive signal)
- Data-model gap analysis: HIGH — based on direct schema inspection

**Research date:** 2026-06-10
**Valid until:** 2026-09-10 (90 days — DwC standards are stable; Conserve.IO terms could change)
