# 033 — The register names the animals, we compose the display

**Status:** accepted · **Decided:** 2026-08-29 ·
**Amended:** 2026-09-20 — the crosswalk admits coextensive `skos:closeMatch`, not `skos:exactMatch` alone, and we no longer compose a name for any animal (see [Amendment](#amendment-2026-09-20))

## Decision

The [salish-sea/animals](https://github.com/salish-sea/animals) register is the source of an animal's **name**. `public.occurrences` resolves `vernacular_name` through `register.inaturalist_taxon_name`, falling back to `inaturalist.taxa` only where the crosswalk reaches no register entity **that has a `common` name**, and carries the register's `SSA:` identifier alongside it.

We compose the **display** from that name. Capitalisation, truncation, sort order and disambiguation are ours — animals [ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md) makes the register's label "input to display, not display", and names truncation as a consumer concern by name.

Neither side does the other's job. Where the register has asserted a name, we do not mint or substitute a different one, and the register does not supply a string for a map pin.

**The fallback is a knowing exception, not a second source.** Where it reaches none — 5,428 of 64,097 occurrences, 8.5%, measured in production on 2026-08-29 against edition 2026.08.1; 183 of 62,980, 0.29%, after the [Amendment](#amendment-2026-09-20) — the map still shows iNaturalist's vernacular, which is a mirror's vocabulary surfacing in UI and therefore exactly what [008](008-source-schemas-are-upstream-mirrors.md) forbids. It is tolerated because the alternative is a blank label, and because every remaining case is a known one that the register can close by asserting a name (salish-0gb). The exception shrinks as the register grows; it is not a standing licence to read names from the mirror, and no new code may depend on it.

## Why

Every branch of `public.occurrences` read `vernacular_name` from `inaturalist.taxa` — including the Maplify branch and the branch for our own native submissions, neither of which iNaturalist has anything to do with. [008](008-source-schemas-are-upstream-mirrors.md) forbids exactly that: a mirror's vocabulary must not surface in the UI as if it were ours. The mirror's own RLS policy is called *"Ingest worker may maintain the taxa mirror"* (migration `20260706130000_ingest_role.sql`), which is the whole argument in the object's name. It is why the map said "North American River Otter" for an animal the register calls a **River otter**, and it is the most visible surface we have.

The register already held the answer, curated and crosswalked to the exact iNaturalist id our mirror keys on:

```text
SSA:0000906  taxon  Lontra canadensis  NCBITaxon:76717
SSA:0000906  River otter  common  en
SSA:0000906  skos:exactMatch  inaturalist.taxon:41777
```

Adopting it is not a new coupling. Animals [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md) already decides that this repository "stops holding independent identity and becomes a materialization of it". This record is that decision reaching the display layer, which is the smallest slice of it that stands alone.

**Matching is by iNaturalist taxon id, and only through a predicate that does not widen the claim.** The register's ecotypes are deliberately `skos:broadMatch` to their species; resolving through a broader match would put a wider claim on the map than the data supports.

> *Amended 2026-09-20 — this paragraph is superseded in one word and restated above; the original read "**by exact iNaturalist taxon id, and only exact**". A coextensive `skos:closeMatch` is admitted now too, on an authority's equation and not on our judgement; `broadMatch` is still refused, for exactly the reason given here, which is the part that was load-bearing all along. The measurements below are likewise superseded: coverage is 99.71%, and the residue they describe is gone. See the [Amendment](#amendment-2026-09-20).*

~~Measured in production on 2026-08-29, that resolves 91.5% of occurrences (58,669 of 64,097, edition 2026.08.1). The residue is almost entirely killer-whale subspecies, whose qualifier is the ecotype the map most wants to show and which get their label from the pod branch instead — salish-0gb.~~

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
- **Resolving through `skos:broadMatch` to cover the remaining subspecies.** Rejected: it would assert a wider claim than the record supports — *Orcinus orca ater* is the resident subspecies generally, which includes Northern and Alaskan residents, and Southern Resident is one population within it. The honest predicate is a curator's call, not a view's. *Still rejected after the [Amendment](#amendment-2026-09-20), and the sentence above is why: the curator made the call, and the predicate they chose was `closeMatch` against a newly minted `Resident` ecotype rather than `broadMatch` against `Southern Resident`.*
- **Taking the register's `label` as the display string.** Rejected by ADR-0011 itself: a register cannot know whether a consumer needs a dropdown entry, a map pin or twenty characters on a phone. We read the `common` name for display and key on the identifier; nothing joins or matches on a label.

## Amendment (2026-09-20)

**The crosswalk admits a coextensive `skos:closeMatch`, and `SUBSPECIES_FORMS` is deleted.** Coverage in production goes from 90.42% to 99.71% (62,797 of 62,980), and this repository no longer composes a display name for any animal.

### What licenses it

Not our judgement. The Society for Marine Mammalogy's *List of Marine Mammal Species and Subspecies* (April 2026), declining species rank for now, says:

> the two ecotypes are considered here provisionally as distinct subspecies of *Orcinus orca*

An authority equating the two concepts is the entire basis for the change. Without it the register's mapping rows would be a second opinion and the body of this record would forbid reading them. Animals edition 2026.09.2 records that equation as `SSA:0000003 skos:closeMatch inaturalist.taxon:1602531` (*O. o. ater*) and `SSA:0000002 skos:closeMatch inaturalist.taxon:1602533` (*O. o. rectipinnus*) — close rather than exact because the register calls one an ecotype and iNaturalist calls the other a subspecies, so they are different *kinds* of thing with the same *extension*.

**The rank dispute is deliberately not resolved by this.** SMM holds the two as provisional subspecies; Bain, Morin, ITIS and Catalogue of Life carry them at species rank. Nothing here picks a side, and nothing here needs to: coextension is all the crosswalk asks for, and both readings agree on which animals are meant. Animals [ADR-0008](https://github.com/salish-sea/animals/blob/main/decisions/0008-species-identity-is-delegated.md) is where that question lives.

### The rule is restated, not relaxed

Migration `20260828100000` filtered `predicate_id = 'skos:exactMatch'` and gave as its reason that a broader match "would put a wider claim on the map than the data supports". That reason describes a **deny-list of widening predicates**; it was *written* as an allow-list of one only because exactMatch was the only predicate the register then had that could be honoured. Between coextensive concepts the reason does not apply.

So `broadMatch`, `narrowMatch` and `relatedMatch` are refused by name, and any predicate the register invents later is refused by default — failing closed is what forces the next such predicate to be adjudicated here rather than reaching a map pin unnoticed. That last property is the one that distinguishes this from the obvious `NOT IN ('skos:broadMatch')`, and it is tested: [`supabase/register-crosswalk.test.ts`](../../supabase/register-crosswalk.test.ts) fails against both the old allow-list and the naive deny-list.

### One admitted match is not coextensive, knowingly

`SSA:0000938` *Pinnipedia* is a close match of iNaturalist's `372843`, which strictly names **Phocoidea** — the true-seal superfamily — and is therefore *narrower* than the register's entity. It is admitted anyway, because iNaturalist's taxon is a misnomer in practice: it is labelled "Pinnipeds" and returns Otariidae beneath it, so an observer who picks it means "a seal or a sea lion", which is Pinnipedia exactly. [027](027-marine-mammal-scope-whale-centric-identity.md) records the same misnomer from our side and the register's own entity note records it from theirs.

189 occurrences; the visible effect is that a label loses a plural, "Pinnipeds" → "Pinniped". It is recorded here rather than excluded by identifier in SQL, because an exclusion keyed on an `SSA:` identifier would be our second opinion about a register row and would go stale in silence if the register ever revised it.

### Composing a name was only ever defensible while the register was silent

`SUBSPECIES_FORMS` in [`src/symbology.ts`](../../src/symbology.ts) mapped `'Orcinus orca ater'` to `'Resident killer whale'` and its sibling to `"Bigg's killer whale"`. It was the only table in that file keyed on a scientific name rather than an identifier, because those two animals had no identifier to key on, and its comment gave the reason as permanent — animals ADR-0008 requires an external authority to reference, and neither NCBI nor WoRMS holds a child of *Orcinus orca*.

The register found the other route: it crosswalked its **ecotypes** instead of minting taxa. Admitting close matches was therefore not enough on its own — `SSA:0000003` had only the label `Resident`, which is the ecotype's designation and not a name for an animal, and this view reads `type = 'common'`. Measured against production, admitting `closeMatch` with that row missing reaches only 92.00%; the remaining 7.7 points are the 4,856 *ater* occurrences alone. [animals#39](https://github.com/salish-sea/animals/pull/39) asserts the name, symmetric with `SSA:0000002` and `SSA:0000010`, which already had theirs.

**No displayed string changes.** What changes is who asserts it — which is the whole of this record's Decision section, finally true without exception.

### Ordering, because getting it backwards regresses the map

Deleting `SUBSPECIES_FORMS` before the register carries the name drops those 4,856 records to iNaturalist's Title Case "Resident Killer Whale", beside the register's "Killer whale" on one screen — the exact complaint salish-0gb opens with. So: tag the animals release, run [`register-refresh`](../../.github/workflows/register-refresh.yml) (daily at 11:00 UTC, or dispatched), *then* merge here. Within the deploy itself the order is already safe, since migrations apply before the frontend flips and an unshortened register name passes straight through.

## Not scoped here: names in local languages

[#156](https://github.com/salish-sea/salishsea-io/issues/156) asks for animal names in the languages of the Salish Sea — *qwe'lhol'mechen*, Max'inux, Ska-ana. This decision is why that will not need a parallel mechanism: `names.tsv` already carries a `language` column and can record such names today, and [ADR-0020](https://github.com/salish-sea/animals/blob/main/decisions/0020-localised-preferred-names-are-name-rows.md) makes a localised preferred name a sparse `names.tsv` row, with display defined as a fallback — show the row in the viewer's language, else the label. i18n rides the register the same way English does. Nothing here implements it.

## Reference

Mirror discipline: [008](008-source-schemas-are-upstream-mirrors.md). What the map does with these names: [029](029-map-symbology.md). Whale-centric identity: [027](027-marine-mammal-scope-whale-centric-identity.md). Read-time taxon resolution, which the register join hops through: [032](032-retired-taxa-resolved-on-read.md).

The materialization: migrations `20260828100000_register_schema.sql` (schema and crosswalk view), `20260828110000_occurrences_register_names.sql` (the name), `20260828120000_subspecies_show_species_name.sql`, `20260829000000_taxon_register_entity_id.sql` (the identifier), and [`20260920220000_crosswalk_admits_closematch.sql`](../../supabase/migrations/20260920220000_crosswalk_admits_closematch.sql) (the Amendment's deny-list). Its test: [`supabase/register-crosswalk.test.ts`](../../supabase/register-crosswalk.test.ts). The loader: [`scripts/register/load.ts`](../../scripts/register/load.ts). The presentation layer: [`src/symbology.ts`](../../src/symbology.ts).

Upstream: animals [ADR-0008](https://github.com/salish-sea/animals/blob/main/decisions/0008-species-identity-is-delegated.md) (species identity delegated), [ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md), [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md), [ADR-0013](https://github.com/salish-sea/animals/blob/main/decisions/0013-distribution.md), [ADR-0014](https://github.com/salish-sea/animals/blob/main/decisions/0014-a-publication-not-a-service.md).
