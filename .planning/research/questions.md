# Open research questions

Questions that surfaced during exploration but didn't need immediate answers.
Re-visit when the relevant work is being planned.

---

## DwC / GBIF publishing

### `parentCollectionIdentifier` — required for our DwC-A or Happywhale-specific?

**Surfaced:** 2026-06-18 (`/gsd-explore` session on collections-and-contributors)

**Context:** Happywhale's OBIS-SEAMAP IPT publishing uses
`parentCollectionIdentifier = "OBIS-SEAMAP"` because OBIS-SEAMAP hosts their
data. SalishSea.io publishes its own DwC-A (no upstream IPT host). Is
`parentCollectionIdentifier` required, recommended, or irrelevant in that case?

**Answer needed before:** the 999.1 phase ships, because DwC field selection
needs to be final.

**Pointers:**
- [GBIF EIA best practices](https://docs.gbif.org/eia-best-practices/1.0/en/)
- [Happywhale on OBIS-SEAMAP IPT (zd_1764)](https://ipt.env.duke.edu/resource?r=zd_1764)
- [Darwin Core Quick Reference](https://dwc.tdwg.org/terms/)
