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

---

## Community uptake / Orca Network partnership

**Surfaced:** 2026-06-29 (`/gsd-explore` session on community uptake — see
`.planning/notes/community-uptake-orca-network-partnership.md`)

**Why these matter:** the whole uptake strategy (win the shore regular by making
SalishSea.io the tool Orca Network uses) rests on a partner we don't yet
understand well enough. These need answering — largely via a discovery
conversation with Howard Garrett & Susan Berta — *before* committing engineering.

**Answer needed before:** scoping a community-uptake milestone / choosing the
lead offer to Orca Network.

### What is Orca Network's actual sighting-curation workflow, and where's the pain?

How exactly do sightings move from a Facebook post / web form / phone / email
into their daily sightings transcription? How manual is it, who does it, how many
hours/day, and what's the most painful part? (This validates or kills the "#1
delete-the-chore" offer.)

### Would they value a map-first structured field tool — and would they advocate for it?

Would a real-time, mapped, trajectory-aware sighting tool actually fit how their
regulars work, or is the Facebook feed's social/low-friction nature the point?
And critically: would Orca Network point their ~15k-subscriber email list and
~140k+ Facebook followers at it?

### What is the current Acartia data-flow granularity, and where does SalishSea.io add value vs. duplicate it?

Orca Network already feeds Acartia (our own org) → WRAS → Conserve.io. What
exactly flows, at what granularity/latency, and what does it *not* capture that a
community-facing surface would? Avoid rebuilding what Acartia already does.

### What would make them say no?

Threat perception (competitor vs. amplifier), data ownership/control concerns,
co-branding expectations, effort to change habits, dependence on a volunteer
org's bandwidth. Surface the objections before pitching.

**Pointers:**
- [Orca Network — Report Sightings](https://www.orcanetwork.org/report-sightings)
- [Orca Network — Whale Sighting Network](https://www.orcanetwork.org/sightings-network)
- [Acartia (our org)](https://github.com/salish-sea/acartia)
- [Ocean Wise WRAS](https://ocean.org/whales/wras/)
