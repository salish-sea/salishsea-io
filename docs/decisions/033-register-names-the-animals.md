# 033 — The register names the animals, we compose the display

**Status:** accepted · **Decided:** 2026-08-29

## Decision

The [salish-sea/animals](https://github.com/salish-sea/animals) register is the source of an animal's **name**. `public.occurrences` resolves `vernacular_name` through `register.inaturalist_taxon_name`, falling back to `inaturalist.taxa` only where the register has no exact match, and carries the register's `SSA:` identifier alongside it.

We compose the **display** from that name. Capitalisation, truncation, sort order and disambiguation are ours — animals [ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md) makes the register's label "input to display, not display", and names truncation as a consumer concern by name.

Neither side does the other's job. We do not mint a name the register has not asserted, and the register does not supply a string for a map pin.

## Why

Every branch of `public.occurrences` read `vernacular_name` from `inaturalist.taxa` — including the Maplify branch and the branch for our own native submissions, neither of which iNaturalist has anything to do with. [008](008-source-schemas-are-upstream-mirrors.md) forbids exactly that: a mirror's vocabulary must not surface in the UI as if it were ours. The mirror's own RLS policy is called *"Ingest worker may maintain the taxa mirror"* (migration `20260706130000_ingest_role.sql`), which is the whole argument in the object's name. It is why the map said "North American River Otter" for an animal the register calls a **River otter**, and it is the most visible surface we have.

The register already held the answer, curated and crosswalked to the exact iNaturalist id our mirror keys on:

```
SSA:0000906  taxon  Lontra canadensis  NCBITaxon:76717
SSA:0000906  River otter  common  en
SSA:0000906  skos:exactMatch  inaturalist.taxon:41777
```

Adopting it is not a new coupling. Animals [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md) already decides that this repository "stops holding independent identity and becomes a materialization of it". This record is that decision reaching the display layer, which is the smallest slice of it that stands alone.

**Matching is by exact iNaturalist taxon id, and only exact.** The register's ecotypes are deliberately `skos:broadMatch` to their species; resolving through a broader match would put a wider claim on the map than the data supports. In production today that resolves 91.5% of occurrences (58,669 of 64,097, edition 2026.08.1). The residue is almost entirely killer-whale subspecies, whose qualifier is the ecotype the map most wants to show and which get their label from the pod branch instead — salish-0gb.

### Decision 008 does not govern the register

`inaturalist`, `maplify` and `happywhale` are anti-corruption layers because we do not control their vocabulary and cannot stabilize it. The register is the opposite case: the same author's own data tier, under a defined change process, with opaque permanent identifiers ([ADR-0002](https://github.com/salish-sea/animals/blob/main/decisions/0002-opaque-permanent-identifiers.md)) and deprecation semantics. There is no foreign vocabulary to be protected from, and its names are precisely what we intend to display.

So `public.*` carries `SSA:` identifiers directly — no `animals` mirror schema, no translation layer. 008 stands unchanged for the sources it was written about. ADR-0012 asks that this be recorded on our side rather than only on the register's; this is that record.

Both are loaded from elsewhere. Only one is allowed to be believed.

## Consequences

- **We ship currently-uncurated names.** The animals README says "Nothing here is ratified. No row in `data/` has been verified by a curator", and ADR-0012 itself is *Proposed*. This is tolerable for "River otter" and much less so for an ecotype label, which is part of why the ecotypes are excluded above rather than merely unmapped.
- **A short form is keyed on `SSA:`, never on a name.** `SHORT_MAP_FORMS` in [`src/symbology.ts`](../../src/symbology.ts) holds five entries. The identifier is opaque and therefore permanent, while the name it shortens may be revised edition to edition; an override keyed on the string it overrides silently stops applying the moment the register improves the name.
- **Every short form is a truncation, not a substitution.** Dropping a regional qualifier that separates our records from nothing is presentation. Choosing a *different* name is minting a second opinion. Which is why an unattributed killer whale reads "Killer whale" and not "Orca": the register holds `orca` as a `hidden` name — evidence the string is in use, explicitly not one it offers for display — and composing our way to that string would route around the register's judgement.
- **Shortening is not a general rule.** "Humpback whale" → "Humpback" works because the head word is a noun; "Gray whale" → "Gray" does not, so Gray whale is absent from the table and displays in full.
- **The edition is recorded, because the register is a publication and not a service** ([ADR-0014](https://github.com/salish-sea/animals/blob/main/decisions/0014-a-publication-not-a-service.md)). `register.edition` holds the release tag and the SHA-256 the loader verified, so "which claims are these?" is answerable when a name later changes. We load a pinned release artefact, never a working tree.
- **The fallback is graceful, which means the failure is silent.** An empty `register.*` reads exactly like a register with no name for the animal: the map quietly reverts to iNaturalist's names. Nothing yet asserts that the load happened — salish-1g8.
- The Lambda@Edge OG card renderer reads `taxon.vernacular_name` too, so link-preview cards change; cached cards show the old names until their TTL expires. The DwC-A export emits no `vernacularName` and is unaffected.

## Rejected alternatives

- **A local `public.taxon_names` override table.** The first proposal, and wrong. It would mint a second opinion about what animals are called, which is the precise outcome ADR-0012 exists to prevent — recorded here so it is not proposed a third time.
- **Hand-editing `inaturalist.taxa.vernacular_name`.** Rejected on three grounds. It violates 008 outright. It survived ingest only by an accident of implementation — the taxa insert is `ON CONFLICT (id) DO NOTHING` ([`scripts/ingest/persist.ts`](../../scripts/ingest/persist.ts)), so an edit persisted because nothing ever updated an existing row, one reasonable bugfix away from reverting every display name with no test to catch it. And that same `DO NOTHING` was why the mirror was stale in the first place. The third ground has since become concrete rather than hypothetical: [`.github/workflows/taxa-refresh.yml`](../../.github/workflows/taxa-refresh.yml) now refreshes the mirror weekly and its UPDATE sets `vernacular_name`, so a hand-edit would be reverted within seven days.
- **Resolving through `skos:broadMatch` to cover the remaining subspecies.** Rejected: it would assert a wider claim than the record supports — *Orcinus orca ater* is the resident subspecies generally, which includes Northern and Alaskan residents, and Southern Resident is one population within it. The honest predicate is a curator's call, not a view's.
- **Taking the register's `label` as the display string.** Rejected by ADR-0011 itself: a register cannot know whether a consumer needs a dropdown entry, a map pin or twenty characters on a phone. We read the `common` name for display and key on the identifier; nothing joins or matches on a label.

## Not scoped here: names in local languages

[#156](https://github.com/salish-sea/salishsea-io/issues/156) asks for animal names in the languages of the Salish Sea — *qwe'lhol'mechen*, Max'inux, Ska-ana. This decision is why that will not need a parallel mechanism: `names.tsv` already carries a `language` column and can record such names today, and [ADR-0020](https://github.com/salish-sea/animals/blob/main/decisions/0020-localised-preferred-names-are-name-rows.md) makes a localised preferred name a sparse `names.tsv` row, with display defined as a fallback — show the row in the viewer's language, else the label. i18n rides the register the same way English does. Nothing here implements it.

## Reference

Mirror discipline: [008](008-source-schemas-are-upstream-mirrors.md). What the map does with these names: [029](029-map-symbology.md). Whale-centric identity: [027](027-marine-mammal-scope-whale-centric-identity.md). Read-time taxon resolution, which the register join hops through: [032](032-retired-taxa-resolved-on-read.md).

The materialization: migrations `20260828100000_register_schema.sql` (schema and crosswalk view), `20260828110000_occurrences_register_names.sql` (the name), `20260828120000_subspecies_show_species_name.sql`, `20260829000000_taxon_register_entity_id.sql` (the identifier). The loader: [`scripts/register/load.ts`](../../scripts/register/load.ts). The presentation layer: [`src/symbology.ts`](../../src/symbology.ts).

Upstream: animals [ADR-0008](https://github.com/salish-sea/animals/blob/main/decisions/0008-species-identity-is-delegated.md) (species identity delegated), [ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md), [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md), [ADR-0013](https://github.com/salish-sea/animals/blob/main/decisions/0013-distribution.md), [ADR-0014](https://github.com/salish-sea/animals/blob/main/decisions/0014-a-publication-not-a-service.md).
