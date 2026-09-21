# 047 — The DarwinCore classification comes from the register, except its kingdom

**Status:** accepted · **Decided:** 2026-09-21 · **Extends:** [033](033-register-names-the-animals.md) · **Answers:** `salish-53t.2`

## Decision

**`dwc.taxa_classification` reads the register's NCBI excerpt for `phylum`, `class`, `order`, `family` and `genus`, and keeps taking `kingdom` from iNaturalist.**

For every animal we export that means `Animalia`. The register says `Metazoa`, and we decline to publish that one value knowingly, because GBIF's own backbone taxonomy uses `Animalia` and this column exists to be matched against that backbone. Every other rank is the register's.

(`kingdom` is taken from iNaturalist rather than hard-coded to the literal `Animalia`, because the view spans the whole taxa mirror and not only the animals we export — production holds 10 taxa under `Viruses` and one with no kingdom. None reach an occurrence, and none should acquire a kingdom they do not have.)

**Where the register has no entity for a taxon, the previous behaviour stands**: the recursive walk up `inaturalist.taxa.parent_id` still supplies the lineage. That fallback is load-bearing rather than defensive — see Consequences.

## Why

[033](033-register-names-the-animals.md) moved names to the register on the grounds that [008](008-source-schemas-are-upstream-mirrors.md) forbids a mirror's vocabulary reaching our UI. The same argument applies with more force to the DwC-A: a classification published to GBIF is an *external contract*, and it was being assembled by walking a hierarchy we do not control and cannot stabilize. Animals [ADR-0022](https://github.com/salish-sea/animals/blob/main/decisions/0022-taxonomic-hierarchy-is-ncbis-excerpted.md) gives us the alternative — NCBI's lineage, excerpted by script into `dist/classification.tsv`, curating nothing.

### This changes nothing a consumer receives, and that is worth stating plainly

Measured against production before the change, across all 513 rows of `dwc.taxa_classification`:

- **511 rows are byte-identical.** For every one of the 18 taxa actually exported, `phylum` through `genus` already agreed between iNaturalist and NCBI.
- **0 rows change in the archive.** The two rows that differ are not exported, and would only ever be if someone recorded a *Kogia*.

So this record buys **provenance, not accuracy**. Nobody should merge it expecting the archive to improve, and nobody should revert it expecting the archive to change back. It is worth doing because "where did this claim come from" now has one answer for names and classification alike; it is not worth doing twice.

### The two rows that differ, and the one place NCBI is worse

| taxon | iNaturalist | NCBI (the register) | exported rows |
|---|---|---|---|
| *Kogia breviceps* | Kogiidae | **Physeteridae** | 0 |
| *Kogia sima* | Kogiidae | **Physeteridae** | 0 |

NCBI lumps the pygmy and dwarf sperm whales into the sperm whale family. iNaturalist separates Kogiidae, and so does the Society for Marine Mammalogy's *List of Marine Mammal Species and Subspecies* — the same authority whose equation of the two killer whale ecotypes licensed [033's Amendment](033-register-names-the-animals.md#amendment-2026-09-20). On this point the register's answer is the less current one.

**It is accepted anyway, and the reason is the same one that makes the register worth adopting at all.** ADR-0022 delegates taxonomy to NCBI and reports it verbatim; correcting NCBI here would be minting a third opinion in the export, which is what [033](033-register-names-the-animals.md) and animals [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md) exist to prevent. If the family is wrong, the fix belongs upstream — in the register, or in NCBI — not in a `CASE` statement here.

Zero records are affected today and the corpus holds no *Kogia* observation at all. This is recorded because it is **latent**: the first pygmy sperm whale anyone reports would be published under a family most authorities no longer use, and nothing would flag it.

### Kingdom is the exception, on purpose

`Metazoa` is correct and it is NCBI's own word. It is also not the word GBIF's backbone indexes, and a DwC-A exists to be harvested. Publishing `Metazoa` would be a faithful reading of the register that made 20,952 records harder to match against the taxonomy they are published into — a purity that costs the reader something and gains them nothing.

This is the only value where we take iNaturalist's answer over the register's, and it is taken from `inaturalist.taxa` rather than hard-coded, so no literal sits in the view that no authority stands behind.

## Consequences

- **The iNaturalist fallback cannot be removed.** Both branches of `dwc.occurrences` **INNER JOIN** this view, so a taxon missing from it does not lose its classification columns — the occurrence **disappears from the archive**. The register covers 12 of the 18 exported taxa, so a register-only implementation — one that replaced the walk outright rather than falling back to it — would have silently dropped **4,955 of 20,952 records (23.6%)**, and a smaller archive would have passed every check we have. Those 4,955 are not records the fallback rescues from nothing: 4,951 of them reach the register through the subspecies-to-species hop below, and only 4 depend on the iNaturalist walk itself.
- **A subspecies resolves to its species before lookup.** The register holds species and ecotypes, not subspecies, so *Orcinus orca ater* (4,707 records), *O. o. rectipinnus* (222), *Phoca vitulina richardii* (20) and *Eumetopias jubatus monteriensis* (2) have no entity of their own. Their species does, and a subspecies' lineage above genus is its species' by construction. `inaturalist.species_id()` is asked rather than reimplemented, so "which id counts as the species" has one definition.
- **Two taxa reach no register entity at all** — *Delphinapterus leucas* (1 record) and *Eubalaena* (3). The register scopes itself to the Salish Sea's animals; these are strays. 4 records that exist only because of the fallback.
- **The `genus` gate is unchanged and now covers the register's genus too.** A record identified only to a family emits no genus, whichever authority supplied the lineage.
- **Two register tables are loaded with no consumer**: `register.taxonomic_parent` and `register.taxon_ancestor`. They are one artefact of one edition, and a loader that takes part of a publication is harder to reason about than one that takes all of it.
- **The nightly DwC-A build now depends on `register.*` being loaded.** An empty register no longer means "fall back everywhere" silently — it does, but `scripts/register/verify.ts` runs in `register-refresh` and will have reported the register missing first.

## Rejected alternatives

- **Publish `Metazoa`, faithfully.** Rejected above: correct, and worse for the only reader this column has.
- **Correct *Kogia* to Kogiidae in the view.** Rejected: a third opinion in the export is exactly what adopting the register was meant to end. Upstream or nowhere.
- **Drop the iNaturalist fallback and let the register be the only source.** Rejected on measurement — it removes 23.6% of the archive, silently, because the join is inner.
- **Keep the recursive walk and do nothing.** Genuinely tempting, since the output is identical. Rejected because the argument in 033 does not stop at names: if the mirror must not name our animals in the UI, it should not classify them in a public archive either. But the case is provenance, and this record says so rather than implying a data improvement that does not exist.

## Reference

The migration: [`20260921020000_dwc_classification_from_register.sql`](../../supabase/migrations/20260921020000_dwc_classification_from_register.sql). The tables it reads: [`20260921015000_register_lineage.sql`](../../supabase/migrations/20260921015000_register_lineage.sql). The loader: [`scripts/register/load.ts`](../../scripts/register/load.ts).

Upstream: animals [ADR-0022](https://github.com/salish-sea/animals/blob/main/decisions/0022-taxonomic-hierarchy-is-ncbis-excerpted.md) (hierarchy is NCBI's, excerpted), [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md).

Related: [033](033-register-names-the-animals.md) (the register names the animals), [008](008-source-schemas-are-upstream-mirrors.md) (mirror discipline), [032](032-retired-taxa-resolved-on-read.md) (retired taxa, resolved in the walk this keeps), [003](003-dwc-export-pipeline.md) (the export pipeline).
