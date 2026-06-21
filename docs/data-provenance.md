# Data provenance & attribution

How a sighting reaches SalishSea.io, and how its provenance is expressed in the
public **DarwinCore Archive (DwC-A)** that we regenerate nightly and publish at
**<https://salishsea.io/dwca/>** (linked from the site's About modal, with a
GeoParquet sidecar and sha256 checksums).

This document is for **people who consume that archive** — researchers,
aggregators, and anyone deciding how to credit or cite our records. It explains
what each attribution field *means*. For the exact, current definitions it links
to the source of truth (SQL views, the field list, the EML builder) rather than
restating volatile specifics that drift over time.

> SalishSea.io aggregates cetacean sightings for the Salish Sea from several
> upstream sources. We are an **aggregator/publisher**, not the originator of
> most records — the model below exists so that credit lands in the right place.

## The aggregator pattern

Every exported record carries the same publisher identity:

- `institutionCode = "SalishSea"`
- `rightsHolder = "SalishSea.io"`

This is the standard pattern for community aggregators on GBIF (e.g.
Happywhale→OBIS-SEAMAP, iNaturalist, eBird). **Upstream organizations and
observers are credited elsewhere** (see the mapping below) — never by overwriting
`institutionCode` or `rightsHolder`. Treating SalishSea.io as the publisher is
what lets the archive be indexed without duplicating records that upstream
sources already publish themselves.

## Four provenance concepts

We model four independent things about every sighting. They answer different
questions and must not be conflated:

| Concept | Question | Notes |
|---|---|---|
| **Provider** | *How did this record reach us?* (the ingest API/pipeline) | Internal provenance. One per sighting. **Not** exported — GBIF treats SalishSea.io as the publisher. |
| **Collection** | *What channel did the observation come through?* (the venue/source) | One per sighting; **stable** even if the same channel were re-sourced through a different provider. Drives `datasetName`. |
| **Organization** | *What institution backs the channel?* | Optional, reached via the collection. Credited in EML, never via `institutionCode`. |
| **Contributor** | *Who observed it?* | Optional, per sighting. Drives `recordedBy`. |

**Why provider ≠ collection.** Consider `Orca Network Facebook group → Maplify /
conserve.io → SalishSea.io`: *Maplify* is the **provider** (how it reached us),
and *Orca Network* is the **collection** (the channel it came through). If that
same group were entered into SalishSea.io directly, the collection would be
unchanged and only the provider would flip. Provider is per-record provenance;
it is never a property of the collection.

The reference tables (`providers`, `organizations`, `collections`) and their seed
data are defined in
[`supabase/migrations/20260619184037_reference_tables.sql`](../supabase/migrations/20260619184037_reference_tables.sql).

## How provenance appears in the DarwinCore Archive

This is the consumer-facing contract. The exact column list and term URIs live in
[`scripts/dwca/fields.ts`](../scripts/dwca/fields.ts); the projection that fills
them is the `dwc.occurrences` view in
[`supabase/migrations/20260621000000_dwc_view_rebuild.sql`](../supabase/migrations/20260621000000_dwc_view_rebuild.sql);
the dataset-level metadata (`eml.xml`) is built by
[`scripts/dwca/eml.ts`](../scripts/dwca/eml.ts).

| DwC term | Value | Meaning |
|---|---|---|
| `institutionCode` | `SalishSea` (constant) | SalishSea.io is the publisher. |
| `rightsHolder` | `SalishSea.io` (constant) | Rights holder for the aggregated record — **not** the observer. |
| `datasetName` | `SalishSea.io — {collection}` | The channel the observation came through (e.g. `SalishSea.io — Orca Network`). Records with a known-trusted channel but no resolved collection fall back to a generic Whale Alert label. |
| `recordedBy` | observer's **name** (a human-readable string) | Who observed it. For aggregated records this is parsed from the source text where a name is present, and is **empty when no observer name is available** — it is never an opaque source code. |
| `occurrenceID` | `{source}:{id}` (e.g. `salishsea:…`, `maplify:…`) | Stable per-record identifier; its prefix also encodes which source the row came from. |
| `license` | per record | Native records: **CC-BY-NC 4.0**. Maplify / Whale Alert records: **CC-BY 4.0** via the Acartia data cooperative. The dataset-level license in `eml.xml` is CC-BY-NC 4.0; the per-record `license` column is authoritative. |
| `coordinateUncertaintyInMeters` | present, often empty | Emitted where a defensible value is known; **left empty (NULL) rather than guessed** when it isn't. Most current records have no captured accuracy, so this is frequently empty by design. |

**Upstream organizations** are credited in the archive's dataset metadata
(`eml.xml`) as `<associatedParty>` entries with role `contentProvider` — and
**only** for organizations that actually have exported rows. They never appear in
`institutionCode`.

## What is included, and what is excluded

The archive exports **only** the sources SalishSea.io is the canonical publisher
for:

- **Included:** native SalishSea.io submissions (`public.observations`) and
  Maplify / conserve.io records (`maplify.sightings`), the latter restricted to
  trusted records.
- **Excluded:** **iNaturalist** and **HappyWhale**. Both already publish their
  records to GBIF through their own canonical datasets; re-exporting them here
  would duplicate records. They are still modeled internally (for on-site credit,
  filtering, and linking) but emit nothing to the archive.

This exclusion is enforced **by construction** — the export view is the union of
exactly the two included branches, and a row-count gate in the nightly build
fails if the export ever exceeds that baseline. (See the `dwc.occurrences` view
and [`scripts/dwca/guard.ts`](../scripts/dwca/guard.ts).)

## How a record's provenance is resolved

When a record is ingested, its provider and collection are resolved by the first
signal that matches, in this order:

1. **`source_url`** — a URL-pattern registry maps a known domain/path to a
   provider + collection (the preferred signal where a record carries a URL).
2. **Leading bracket tag** in the source text — e.g. `[Orca Network] …`.
3. **Trailing attribution line** — e.g. `… Submitted by a Cascadia Trusted
   Observer`. This names an *organization/channel*, never a person, so it
   resolves a collection/organization — never a contributor.
4. **Structured source code** on the source record.
5. Otherwise **unresolved** (the collection is left empty).

Matching is **exact** (a curated dictionary, including known misspellings of
channel names) — not fuzzy — so attribution never silently guesses. The resolver
is [`scripts/ingest/resolve-provider.ts`](../scripts/ingest/resolve-provider.ts).

## Known limitations

- **`recordedBy` is sometimes empty** for aggregated records where the source
  text carries no observer name. This is intentional — we do not fabricate names.
- **Cross-provider contributor identity is not unified.** The same person
  observing through two sources may appear as two contributors; we do not yet
  assert a shared identity across providers.
- **`recordedByID` / ORCID** are not yet populated; observer identifiers are a
  future enhancement.
- **Individual-animal identity (`organismID`)** is out of scope — these are
  occurrence records, not a cetacean catalog.

---

## Maintaining this document

This is a living document. When the export contract changes, update it here in
the same change:

- Attribution mapping or new DwC terms → keep the table above in sync with
  [`scripts/dwca/fields.ts`](../scripts/dwca/fields.ts) and the `dwc.occurrences`
  view (latest definition in the most recent `*_dwc_*` migration under
  [`supabase/migrations/`](../supabase/migrations/)).
- Dataset metadata / `associatedParty` / contacts → track
  [`scripts/dwca/eml.ts`](../scripts/dwca/eml.ts).
- Included/excluded sources → track the export view's branches and
  [`scripts/dwca/guard.ts`](../scripts/dwca/guard.ts).
- Resolution rules → track
  [`scripts/ingest/resolve-provider.ts`](../scripts/ingest/resolve-provider.ts).

Prefer linking to those source files over copying their specifics here — counts,
collection lists, and column indices drift; the concepts above do not.
