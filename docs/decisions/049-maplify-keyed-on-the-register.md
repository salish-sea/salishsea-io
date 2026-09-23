# 049 — Maplify sightings are identified by the register's names

**Status:** accepted · **Decided:** 2026-09-22 · **Extends:** [048](048-our-sightings-are-keyed-on-the-register.md), [033](033-register-names-the-animals.md) · **Answers:** `salish-53t.3` (the Maplify half; with 048, the whole of it)

## Decision

**A Maplify sighting records the register entity its names identify (`maplify.sightings.entity_id`), resolved by matching both of its names against every name the register publishes, by the register's own fold.** `maplify.sightings.taxon_id` is gone, and with it the two dictionaries in [`scripts/ingest/maplify.ts`](../../scripts/ingest/maplify.ts) that turned Whale Alert's labels into iNaturalist's spellings.

- **Where:** at ingest, in the pure core ([`resolveEntity`](../../scripts/ingest/maplify.ts), [`matchName`](../../scripts/register/name-index.ts)). The fold ([ADR-0019](https://github.com/salish-sea/animals/blob/dc83d7e8bc26f8168e15f87bed4ee518d11974c6/decisions/0019-names-are-compared-by-folding.md)) is implemented once, in [`scripts/register/fold.ts`](../../scripts/register/fold.ts).
- **Kept fresh:** register-refresh re-resolves every stored sighting after each load ([`scripts/register/resolve-maplify.ts`](../../scripts/register/resolve-maplify.ts)). It refuses, turning the job red, if any record would lose the entity it has. The ingest holds the same line for the ten days it re-reads: a record whose names have not changed keeps its entity even if a tick resolves it to nothing, so an empty or damaged index cannot blank recent identities.
- **Precedence, unchanged from salish-7jl:** a placeholder scientific name counts as absent; a common name that names a *different* entity wins, because upstream corrections land there; otherwise the scientific name stands. A name that matches more than one live entity matches none. Individuals and retired identifiers are never candidates.
- **One parse of Whale Alert's formatting stays ours:** "X (Y)" is tried as its two parts, so "Killer Whale (Orca)" resolves through "Orca". Everything else a label needs to resolve belongs in the register as a name. Edition 2026.09.5 ([animals#42](https://github.com/salish-sea/animals/pull/42)) added the four that were missing (`Gray`, `Grey`, `Finback whale`, `Delphinus capensis`) and three vagrant taxa the feed had reported.
- **`register.inaturalist_taxon_for` walks to the nearest crosswalked ancestor.** Wherever iNaturalist's vocabulary is still needed (map symbology, the archive's classification), an entity with no crosswalk of its own reads as its nearest ancestor that has one, not straight as its species.

## Why

Maplify is not an iNaturalist source. Its records arrive as two strings, and the only reason they passed through iNaturalist's taxonomy was to turn a name into an integer — iNaturalist used as a dictionary, which 033 already rejected for display and 048 for our own sightings. The register publishes a name-matching rule and every name it holds precisely so that consumers stop keeping dictionaries of their own.

## What the change measured (production, 28,434 records, edition 2026.09.5)

- **23,854 resolve to the entity they had.**
- **4,571 move, and every one is "Southern Resident Killer Whale".** They were Resident generally (`SSA:0000003`), which was as far as iNaturalist's *Orcinus orca ater* could reach. The register holds the Southern Resident community (`SSA:0000010`), which is what the report says. `symbology.ts` already warns that reading every *ater* record as Southern Resident overclaims; this is the case where the record itself does claim it. Through the nearest-ancestor walk they still classify in the archive as *ater*, so the export does not coarsen.
- **9 gain an identity** they lacked: the five right whales, a beluga, a bottlenose whale and two long-beaked common dolphins.
- **0 lose one.** Checked with the real resolver against the loaded edition before merging.
- About 1,770 stay unidentified: "Unspecified", "Other", "Unknown". As before, they are neither on the map nor in the archive.

## Consequences

- **The map labels a track holding a Southern Resident record "SRKW"** (`src/symbology.ts`), unless the reports name a pod, which is more specific. Added the same day at Peter's request; across all history it changes 37 tracks from "Resident".
- **A record whose names the register does not hold is unidentified until the register holds them.** The fix is a register name, and register-refresh then carries it to every stored record. That is the intended loop, and the refusal rule is its guard.
- **An ambiguous name is not resolved.** "Killer whale" names *Orcinus orca* and the monotypic genus *Orcinus*; "Common dolphin" names *Delphinus delphis* and the six-species genus *Delphinus*, which the register says must not claim a species. Nothing in the names distinguishes the harmless case from the harmful one, so neither is guessed. No record in the feed today is ambiguous.
- **The ingest reads the register on every tick** (about 1,600 names), so a load reaches new records without a redeploy. With no edition loaded, every record is unidentified — which in CI is why `ci-seed.sql` plants one entity.
- **A deploy that lands during an ingest tick can fail that tick.** Deploy ships the Edge Function before `supabase db push`, so for the seconds between them the new function writes a column that does not exist yet. The next tick recovers.

## Rejected alternatives

- **Resolve at read time, in the view.** Always current without a re-resolve step, but the view would have to fold Maplify's strings in SQL — a second implementation of the fold, which is what ADR-0019 exists to prevent.
- **Keep a local alias table for Whale Alert's labels.** Peter's call: the register carries both `Gray` and `Grey` as hidden names instead, so the vocabulary lives in one place.
- **Resolve a name shared down one lineage to the narrowest entity.** Right for *Orcinus*, wrong for *Delphinus*; see Consequences.
