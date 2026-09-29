# 057 — Southern Residents come from NOAA's census file, by way of the register

**Status:** proposed · **Drafted:** 2026-09-29 · **Extends:** [051](051-group-hierarchy-is-the-registers.md) · **Unblocks:** the Southern Resident catalogue deferred in [015](015-individual-profile-pages.md) (bd `salish-lzi`) · **Rights:** [rights policy §7.2](../rights-policy.md#72-noaa-nwfsc-southern-resident-census-file-d-22) (D-22)

## Context

We want Southern Resident individual, matriline and pod pages. We also have a curated reading list to hang on them: about 110 dated sources, each tagged with the whales it concerns. Its tags name 61 individuals, several matrilines and all three pods. None of those pages can exist today, because the catalogue has no Southern Residents to hang them on:

- **The animals register has 5 Southern Resident individuals** (J17, J35, J50, J57, L87), 2 matrilines (J17s, L32s) and the three pods. All of them are `SEED` rows, which the register's own `sources.tsv` says "must be replaced or confirmed by a curator before first release".
- **`public.individuals` is filled only by [`scripts/seed/seed-biggs.ts`](../../scripts/seed/seed-biggs.ts)**, so no Southern Resident has a profile page.

The authority is the Center for Whale Research (CWR), which has run the census since 1976. It publishes no open roster. Its ID guide is a paid or members-only PDF, its site reserves all reproduction rights, and the register's `CWR` source row reads "not-yet-requested". We searched for a public, reusable catalogue on 2026-09-29.

## Decision

**The Southern Resident roster, parentage, sex and birth and death years come from `orca.csv` in NOAA NWFSC's [`srkw-status`](https://github.com/noaa-nwfsc/srkw-status) repository. They are imported into the animals register, and this repository reads them from there.** The first import pins commit `ba0b8c40e422aa9f5afcf845a0697b4d7d15701f` (2026-02-03).

The file is the census table behind NOAA's population projections, the 5-year status reviews and the Pacific Fishery Management Council's analyses of how salmon fisheries affect the whales. It has 227 whales (J 66, K 44, L 117), born 1910 to 2025, each with `animal`, `birth`, `death`, `pod`, `matriline`, `mom` and `sexF1M2`. Every `mom` it names is itself in the file. The README says the content is a U.S. government work and is in the public domain (17 U.S.C. §105).

Three rules govern the import. The register holds them as comments in its import script ([ADR-0015](https://github.com/salish-sea/animals/blob/main/decisions/0015-bulk-import.md)); this record states what we rely on:

1. **Parentage comes from `mom`, and matrilines are derived from parentage.** Under [050](050-matriline-membership-is-the-registers.md), a matriline is a female and all her descendants. NOAA's `matriline` column is coarser than that: it is the founding lineage, so J035 is filed under `J009`, not J17s. We use it as a check against the derived tree, never as a membership source. `pod` is a founder code too (`J001` means J pod) and maps to the register's three existing pod entities.
2. **`sexF1M2` 0 means not known,** not a third value (31 whales). A `death` year is recorded as such. The file does not say whether it separates "presumed dead" from confirmed deaths, so a death year becomes `presumed_deceased` unless another source confirms the death.
3. **Disagreements are recorded, not settled.** Where the file and a published account differ, the register keeps NOAA's value with a `note` naming the other claim. For example, NOAA gives K047's mother as K036, and the Puget Sound Institute gives K43. The register does not choose between them by hand.

**What this file does not supply stays open.** It has no nicknames. Names are a separate, later source: The Whale Museum's naming facts under D-21's terms, and Wikidata (CC0) as a crosswalk. The file also has nothing after early 2026, so L129 and L130 are missing. Keeping it current is a refresh cadence, not a one-off load.

**This repository changes nothing about how it reads the catalogue.** Under 051, animals the register gains reach `public.individuals` through the register loader, as Bigg's sex, birth years and status already do. Nothing is added to `seed-biggs.ts`, and there is no Southern Resident seed script.

## Why

It is the only complete, current, reusable roster we found:

| Source | Whales | Mothers | Current to | Reuse |
|---|---|---|---|---|
| [NOAA `srkw-status`](https://github.com/noaa-nwfsc/srkw-status) | 227 (whole census) | 184 | 2025 births | Public domain (US government work) |
| [Wikidata](https://www.wikidata.org/wiki/Q56143220) | 95 | 40 | few born after 2015 | CC0 |
| [The Whale Museum](https://whalemuseum.org/collections/meet-the-whales) | 79 (named whales) | in prose | current | all rights reserved |
| [Orca Network](https://orcanetwork.org/resources/srkw-births-and-deaths/) | living roster; births and deaths since 1990 | in prose | Dec 2025 | all rights reserved; known errors |
| CWR ID guide | whole population | yes | 2025 | paid PDF; reproduction needs written consent |

The NOAA file's living count (J 27, K 15, L 34) agrees with Orca Network's. The census observations behind it are CWR's, made under NOAA contract, so taking the file does not route around the authority. It takes the authority's facts as the government has already published them. We credit CWR as the observer wherever the data is surfaced (§7.2).

The import goes into the register, not here, because 051 says so: whatever the register holds, we read, and a second copy here would drift. The motivating case already shows this. Profile pages need individuals, and bout tagging needs the register's whole Southern Resident tree ([051](051-group-hierarchy-is-the-registers.md), [028](028-salishsea-io-speaks-to-orcasound.md)).

## Rejected alternatives

- **Wait for CWR's permission and import its guide.** That permission has not been requested, and the facts are already public through NOAA. Asking CWR stays worthwhile as a courtesy and for names, photos and the ID guide's other content, but it does not gate the roster.
- **Wikidata as the primary source.** CC0, but it has only 95 whales, mothers for 40, and almost no calves born in the last decade. It is the right crosswalk target (`skos:exactMatch` to Q-ids), not the roster.
- **Scraping The Whale Museum or Orca Network.** Both reserve all rights. The Whale Museum gives ages, not birth years. Orca Network misfiles J61 and omits J60.
- **A `seed-srkw.ts` beside `seed-biggs.ts`.** This is the second copy that 051 retired.

## Consequences

- The register needs a `NOAA-NWFSC` source row, an import script, and replacements for the five `SEED` whales and two `SEED` matrilines. That work happens in [salish-sea/animals](https://github.com/salish-sea/animals), under its ADR-0015.
- Designations arrive zero-padded (`J035`). The register's fold ([052](052-designations-compared-by-the-registers-fold.md)) already treats `J035` and `J35` as the same code, so sighting text and links keep working.
- Southern Resident individual and matriline pages appear once the register loads, with no code change beyond confirming that the pages handle a second ecotype. Pod pages still have to be built (016, 017 follow-ups).
- The reading list can then be attached to those pages. Where it lives and how it rolls up from whale to matriline to pod is a separate decision, still open.
- If this data is exported beyond in-app display (for example as `organismID` to GBIF), it gets its own rights review, as D-21 requires for Bigg's.
