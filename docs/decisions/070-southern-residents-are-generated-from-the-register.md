# 070 — The catalogue's rows are generated from the register edition, not checked in: the Southern Residents now, the Bigg's when they're ready

**Status:** accepted · **Decided:** 2026-10-07 · **Applies:** [051](051-group-hierarchy-is-the-registers.md) (whatever the register holds, we read from it) · **Amends:** [064](064-what-users-do-not-write-leaves-postgres-first.md) (the catalogue is no longer only checked-in files) · **Context:** GitHub [#511](https://github.com/salish-sea/salishsea-io/issues/511), bd `salish-lzi`

## Context

The animals register has held the Southern Residents since edition [2026.10.1](https://github.com/salish-sea/animals/releases/tag/2026.10.1), imported from NOAA NWFSC's census file ([animals ADR-0023](https://github.com/salish-sea/animals/blob/6a5b325f88af25ca6f73cee1d672fbc478b6f7b4/decisions/0023-southern-residents-from-noaas-census-file.md); what we may show from it is [rights policy D-22](../rights-policy.md#72-noaa-nwfsc-southern-resident-census-file-d-22)). It has 227 individuals across J, K and L pods, 69 matrilines with the matriarch each is named for, the mothers of 184 of them, the three pods, and the Southern Resident community. The build fetches the newest register release itself and has held this one since it shipped.

None of them has a page. A profile page is rendered for each row of our catalogue ([`profiles.ts`](../../scripts/read-path/profiles.ts)), and the catalogue is the checked-in files under [`data/catalogue/`](../../data/catalogue/) (064), seeded once from the Bigg's sheet. J31, for example, is `SSA:0020030` in the register, and `/individuals/0020030/J31` is a 404.

So the Southern Residents need catalogue rows, which could come from either of two places: generated from the register, or curated by hand into `data/catalogue/` the way the Bigg's rows were.

## Decision

**The build generates the Southern Residents' catalogue rows from the register edition it holds, on every build, and none of them is checked in.** For them the register already holds everything a page needs: who each whale is and her designation, her mother, the matriline she is in and the matriarch it is named for, and her sex, birth year and status. Under 051's rule, a copy of any of that would be ours only to drift.

- **Generated:** the individuals, each with her primary designation; the matrilines, each with its matriarch; and the group the matrilines sit in, which is what the ecotype page reads.
- **Keyed by the register identifier.** Any internal id a generated row needs is derived from the register's `entity_id`, so a row is the same row from one edition to the next and cannot collide with a checked-in Bigg's row.
- **Not generated, because the register doesn't hold it:** nicknames (#511's names step, which needs a source and its own rights entry), alternate designations, and the reading lists. When one of these arrives, it comes as checked-in data keyed by register identifier, beside the generated rows rather than inside them.
- **A wrong fact is fixed in the register.** There is no local override for a generated row: the correction goes upstream and arrives with the next edition. That is what [animals ADR-0012](https://github.com/salish-sea/animals/blob/6a5b325f88af25ca6f73cee1d672fbc478b6f7b4/decisions/0012-relationship-to-the-salishsea-io-catalogue.md) makes this repository: a materialization of the register, not a second opinion.

**The Bigg's rows follow, when we're ready.** The direction is decided; the timing isn't. They stay checked in until the facts that only our copy holds have somewhere else to live, each in one of two places:

- **Offered upstream to the register**, where the fact is the register's kind of fact, and whether it takes them is the register's call: their parentage (the register holds no Bigg's mother links; ours came from the Bigg's sheet), the superseded and alternate designations old links redirect from (`T046A`, the `CA` and `AO` codes, decision [034](034-profile-urls-key-on-the-register-identifier.md)), and the matriarch of each matriline, which the register now names for 162 Bigg's matrilines (bd `salish-o3gx`).
- **Checked-in data keyed by register identifier**, beside the generated rows, where the fact is ours by 051's own terms: what a nickname means to us (its status, who gave it and when).

When nothing is left in the Bigg's rows that the register couldn't regenerate, they are generated the same way and their files go (bd `salish-1deu`).

## Rejected

- **Curate them into `data/catalogue/` by hand, as the Bigg's rows were.** Every fact would be copied from the register and then have to be reconciled with it whenever the register changes. NOAA's file changes with every birth and death, so that would happen every season, by hand, for 227 animals. 051 exists to stop exactly this.
- **Generate them once into `data/catalogue/` with a script, and check the result in.** This starts out correct but drifts the same way, only more slowly. It also makes a pull request out of every register release that touches a Southern Resident, when the build already adopts the release unaided.

## What this doesn't decide

- **When the Bigg's rows move.** That waits on the steps above, none of them scheduled.
- **Which group the Southern Residents' ecotype page is for.** The register puts the Southern Resident community inside the Resident ecotype, while our Bigg's page is for an ecotype. Whether the new page is the community's or the ecotype's is left to the work on #511.
