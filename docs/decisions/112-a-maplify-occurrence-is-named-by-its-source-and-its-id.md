# 112 — A Maplify occurrence is named by its source and its id, because Maplify's ids are unique only within a source

**Status:** accepted; built · **Decided:** 2026-11-05, by Peter · **Work:** bd `salish-yw6e` · **Amends:** [061](061-ingest-and-derivation-move-into-the-build.md) (what the Maplify mirror is keyed on), [056](056-the-logged-out-read-path-is-built-as-static-files.md) (the id index gains a neighbour for old links) and the occurrenceID rows of [`data-provenance.md`](../data-provenance.md) and [`rights-policy.md`](../rights-policy.md) (ALIGN-06)

## Context

Maplify numbers a sighting within its `source` (`whale_alert`, `wras`, `FARPB`, `CINMS`, …), and the sources' ranges overlap. The number alone does not name a sighting. The mirror was keyed on the number alone and written with `INSERT OR REPLACE`, and the derivation named every occurrence `maplify:<number>`, so a sighting from one source silently replaced a different sighting from another, and the two shared a name on the site.

A worked example. `228809` is a Whale Alert killer whale reported on 2025-07-14 at 19:07 (48.51391, -123.15082), and it is also a WRAS Dall's porpoise from 2026-03-25. On 2026-11-05 an anti-entropy refetch of recent months brought the WRAS rows into the mirror and ten killer whale reports from 2025-07-14 (`228809`, `228814`, `228826`, `228833`, `228839`, `228846`, `228950`, `228951`, `228952`, `228954`) vanished from that day's file. A later refetch of July 2025 would have brought them back and removed the porpoise.

A full refetch of Maplify (152 months, every one answered) measured the damage. 657 numbers are used by exactly two sources and none by three, so 657 sightings were lost to the collisions and nothing was deleted upstream: 301 Whale Alert, 284 WRAS, 57 FARPB and 15 rwsas; 641 of them are dated 2025 or 2026, because that is where the sources' ranges now meet. The mirror held 50,843 sightings where Maplify has 51,501 (50,844 distinct numbers, 657 of them used twice).

There is a second, smaller fault. 216 Whale Alert sightings from 2019 to 2021 appear twice in one month's response: a legacy copy named `Humpback Sighting:` beside the same sighting named `Humpback`, created two to four hours earlier. So even the source and the number together need a rule for a sighting that arrives twice.

The number is also in URLs (`?o=maplify:228809`), in the Darwin Core archive's `occurrenceID`, and in links the register and other sites hold, which is why this was Peter's call and not a repair.

## Decision

**Every Maplify occurrence is named `maplify:<source>:<id>`**, for example `maplify:whale_alert:228809`. The derivation ([`occurrences.sql`](../../scripts/read-path/derive/occurrences.sql), [`dwc.sql`](../../scripts/read-path/derive/dwc.sql), [`readings.ts`](../../scripts/read-path/derive/readings.ts)) forms the name in one way, from the mirror's `source` and `id`. Every Maplify source gets the longer form, the large ones too.

**The mirror is keyed on (source, id).** [`ingest-maplify.ts`](../../scripts/read-path/ingest-maplify.ts) stores `PRIMARY KEY (source, id)`, and a window's reconcile compares, replaces and deletes by that pair. The delete floor of a tenth of a window is unchanged.

**A sighting that a response repeats is kept once, as the copy created earlier.** The earlier copy is the original report; the later one is Maplify's legacy duplicate. On a tie the first in the response is kept. The run logs how many repeats a window had.

**A mirror keyed on the id alone is rebuilt in the new shape the first time the ingest opens it.** In one transaction, carrying every row and `covered_days` over; it does nothing on a mirror already in the new shape, so it runs once. On a mirror of 50,844 rows made from the refetch it took 82 ms. The rows it carries are all genuine; the 657 that collisions overwrote are missing, and a backfill of every month restores them ([the runbook](../runbook/read-path-build.md#backfilling-a-mirror) has the loop).

**An old link keeps working where it is unambiguous.** The build writes `aliases/<shard>.json` beside the id index, from the derived occurrences: `{"maplify:228810": "maplify:wras:228810"}`, sharded by the same hash as the id index, one entry for each number that exactly one source uses. The id index itself is unchanged, so a page cached before this still reads it. A page given `?o=maplify:<digits>` that is not in the id index looks the number up in the aliases, opens that sighting, and rewrites `o` to the new form, so a link shared again carries it; the preview-card renderer and the edge function that serves crawlers do the same lookup. A number two sources use has no alias and resolves to nothing, as any id the build lacks does. The alias is a courtesy: it is not an id, and nothing is ever named by it.

**The Darwin Core archive's `occurrenceID` takes the new form too.** The archive is not registered with GBIF yet, so no one outside holds the old ids, and this is the one time they change. ALIGN-06's promise that ids are stable across runs holds from here on; it never covered an id that named two sightings.

## Rejected

- **Keep `maplify:<id>` for Whale Alert and qualify only the other sources.** It would leave most links and archive rows alone. But the bare form would mean one source for good, a reader could not tell that from the id, and the smaller sources would be renamed anyway. It also treats Whale Alert's ids as safe, which nothing guarantees: if another source's numbers ever reach its range the same fault returns.
- **Key the mirror on (source, id) and keep the bare id in the name, choosing a winner when two collide.** It throws a real sighting away on every collision, which is the bug.
- **Rename silently, with no aliases.** Every shared `?o=maplify:` link, in chats, posts and the register, would open nothing.
- **Alias every old number to its Whale Alert sighting.** That is the guess the old scheme made, and it is wrong for the 657 numbers two sources use.

## Consequences

- The archive's `occurrenceID` for every Maplify record changes once, before registration. Anything outside that cited the old ids (nothing known) would need the alias, which the archive does not offer.
- Every day file and the id index are rewritten by the first build after this ships, since every Maplify id changed. Pages and links already out there reach their sighting through the aliases.
- Until the backfill, the 657 lost sightings are still missing, and the longer form is already in use. The backfill is a manual run of the ingest over every month from 2014-04, with no delete floor, one month at a time.
- An old-form link to a number two sources use opens nothing. 657 numbers are in that case; most are recent.
- Code that parses a Maplify occurrence id must take the source from the middle: `maplify:`, then the source, then the digits after the last colon.
