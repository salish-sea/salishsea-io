# 027 — Marine-mammal scope, whale-centric identity

**Status:** accepted · **Decided:** 2026-08-13 · **Extends:** [009](009-taxonomic-scope-marine-mammals.md) (which stands; this record answers the questions 009 left open)

## Decision

Four related calls, resolved together:

1. **PSEMP defines the boundary; it is not a data source.** The taxonomic scope remains PSEMP's Marine Mammal Working Group remit per 009. We are **not** ingesting PSEMP datasets, now or as planned work.
2. **Product identity stays whale-centric.** Factual claims about the record widen to *marine mammals*; positioning claims stay whale-forward. See below.
3. **The export states marine-mammal coverage**, with prose that explains why the realized archive is almost entirely cetacean.
4. **Travel segments stay species-gated** to the taxa in the travel-speed table. Absence from that table is intent, not an oversight.

## PSEMP publishes no occurrence data to ingest

The [MMWG hub](https://psemp-marinemammalsworkgroup-wa-psp.hub.arcgis.com/) is a workgroup landing page, not a data portal (verified 2026-08-13). It publishes plenty — just nothing occurrence-shaped: its DCAT feed is empty, its site catalog group is private, and the whole `wa-psp` ArcGIS org has two public items matching marine-mammal terms — the hub site itself and a Chinook contaminants map image. What the site actually offers is the `mmwg-psemp.net` mailing list, Box folders of meeting documents, and links to Vital Signs dashboards carrying population-trend rollups rather than occurrence records.

So "don't ingest PSEMP" forgoes nothing. It also moots the CC-BY-NC-SA/ShareAlike concern raised against the CC-BY-NC export contract in [docs/rights-policy.md](../rights-policy.md): with no PSEMP records ingested, there is nothing to redistribute.

## Identity: factual claims widen, positioning stays whale-forward

A quarter of the corpus is not cetacean (2026-08-13 production counts):

| Provider | Total | Cetacean | Pinniped | Otter |
|---|---|---|---|---|
| Maplify / conserve.io | 35,304 | 35,301 | 2 | 1 |
| iNaturalist | 21,123 | 5,683 | 13,835 | 1,605 |
| HappyWhale | 5,601 | 5,601 | — | — |
| SalishSea.io Direct | 461 | 432 | 28 | 1 |

The rule that follows: **statements about what the data contains must be true; statements about what the product is for may name its center of gravity.** "A reliable, comprehensive historical record of marine mammal observations" is a factual claim and widens. "A whale sighting platform" is positioning and does not — whale people are the users, and the deep investment (individual catalogs, matrilines, ecotypes, photo-ID) is cetacean and stays that way.

## Export coverage

The realized export is the mirror image of the corpus: of 27,797 exported records, **31 are non-cetacean** — 29 native submissions and 2 from Whale Alert. [SRC-01](005-export-exclusion-src-01.md) excludes iNaturalist and HappyWhale, and those two carry essentially every pinniped and otter record we hold.

Coverage still widens, because §6.5 of the rights policy states taxonomic coverage as **intentional, not realized**, and because those 31 records are the ones nobody else publishes: iNaturalist's seals reach GBIF through iNaturalist, ours reach it only through us. Narrowing the export to cetaceans would discard our only unique non-cetacean contribution, and that count grows as native submissions grow.

Because a widened block over-claims against a 99.9%-cetacean archive, the explanatory prose is **mandatory, not optional**: `generalTaxonomicCoverage` must state the marine-mammal scope *and* explain that SRC-01 excludes the platforms holding most non-cetacean records, so consumers know to look upstream.

### Published taxon names

The names in `taxonomicClassification` are chosen for **GBIF backbone matchability**, verified 2026-08-13:

| Name | GBIF backbone | Published? |
|---|---|---|
| Cetacea | ORDER, accepted | yes, as Order |
| Phocidae | FAMILY, accepted | yes |
| Otariidae | FAMILY, accepted | yes |
| Pinnipedia | FAMILY-rank **synonym** | no — prose only |
| Phocoidea | **no match** | no |
| Lutrinae | **no match** | yes, as Subfamily |

iNaturalist's `Phocoidea` (taxon `372843`) is a misnomer — strictly the true-seal superfamily, yet iNat labels it "Pinnipeds" and returns Otariidae under it. The ingest query keeps the iNat id, since it is what actually returns sea lions, but published metadata never uses that name. `Pinnipedia` is the clade we mean and appears in the coverage prose, but it is not published as a classification because GBIF carries it only as a synonym at the wrong rank. Declaring `Phocidae` + `Otariidae` is both more precise and matchable: together they are exactly the pinnipeds we hold.

`Lutrinae` is published despite not resolving in the backbone. It is taxonomically correct, and the only matchable alternative — `Mustelidae` — would drag in weasels and badgers we do not carry.

## Segments

`src/segments.ts` looks up `travelSpeedKmH[scientific_name]`; a species absent from `src/constants.ts` yields no speed, the guard fails, and no segment is built. Pinnipeds and otters get no segments, and should not.

The reason is not that seals haul out. It is that they are **too numerous and too hard to identify individually** for a travel chain to mean anything — a segment asserts that sequential sightings are the same animals moving, which requires that "the same animals" be a knowable claim. Should a harbor-seal catalog and photo-ID capability ever make individual identification tractable, the taxon becomes eligible and the gate is a one-line table entry.

## Rejected

- **Ingesting PSEMP's ArcGIS datasets** — there are none to ingest, and the ShareAlike licensing would have conflicted with the CC-BY-NC export contract if there were.
- **Reframing as a marine-mammal platform** ("SalishSea.io is a marine mammal sighting platform") — more literally accurate, but it drops what makes the product legible to the community that actually uses it.
- **Narrowing the export to cetaceans** so `Cetacea (Order)` becomes true — discards the 31 native non-cetacean records, which are precisely the ones no other publisher sends to GBIF.
- **A user-facing coverage caveat in the app** — the sighter in the field cannot act on uneven sourcing; it belongs to the analysis layer, in EML and [docs/data-provenance.md](../data-provenance.md).
- **Adding pinniped travel speeds** to make segments work for seals — would fabricate travel chains from animals that cannot be individually identified.

## Consequences

- [docs/rights-policy.md](../rights-policy.md) §6.5 states the marine-mammal remit and requires the SRC-01 explanation; the `dwc` metadata view follows the policy it cites, and `verify-artifact`'s **SC#4c** gates the built archive on that requirement so the prose cannot quietly drop out of a future migration.
- `scripts/dwca/eml.ts` publishes four `taxonomicClassification` blocks (Cetacea, Phocidae, Otariidae, Lutrinae) and marine-mammal keywords.
- PRODUCT.md, `about.html`, and in-app copy widen factual claims and keep whale-forward positioning.
- [CONTEXT.md](../../CONTEXT.md) records the segment species-gate so the empty table entries read as intent.
- Haul-out clustering — the pinniped-shaped analogue of a segment — is filed as follow-up work, justified by the iNaturalist pinniped volume above.
