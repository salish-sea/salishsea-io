# 029 — Map symbology: colour carries the taxon, labels carry the specifics

**Status:** accepted
**Date:** 2026-08-27
**Issue:** bd `salish-fll` (epic), `salish-fll.1` (findings)
**Depends on:** bd `salish-ayb` — adopting the [animals register](https://github.com/salish-sea/animals). See "Sequencing" below; this record cannot be implemented well before it lands.
**Prototype:** branch `prototype/map-symbology` (four variants behind `?variant=`), retained as the primary source.

## Problem

`symbolFor()` renders each occurrence as a single letter inside a bubble. Outside killer whales it fails, and not merely by being opaque — it is **ambiguous**. Across 61,411 occurrences the scheme collapses to 18 glyphs. The five carrying the most records:

| Glyph | Occurrences | Distinct taxa | Worst collision |
|---|---|---|---|
| `H` | 18,579 | 3 | **Humpback Whale / Harbor Porpoise** |
| `S` | 8,030 | 10 | Harbor Seal / Sea Otter / Sperm Whale / Steller Sea Lion / Striped Dolphin |
| `G` | 6,978 | 4 | Gray Whale / Guadalupe Fur Seal |
| `C` | 4,506 | 8 | California Sea Lion / Cetaceans / Common Minke Whale |
| `N` | 3,189 | 7 | River Otter / N. Pacific Humpback / N. Elephant Seal |

A 15 m whale and a 1.5 m porpoise share the most common glyph on the map. Two further defects: iNaturalist's inconsistent casing leaks through as `c` ("common seals") and `s` ("sea otters"), so case is load-bearing by accident; and `T` means Biggs pod in the orca branch but "Toothed Whales" in the fallback, so the collision reaches the part of the scheme that works.

The trigger was "N" for a river otter. The scheme's real failure is that it cannot say what an animal is.

## Decision

**Colour carries the taxon group. The label carries the specifics. The track is supporting, not the subject.**

1. **Every occurrence is a uniform dot**, filled by taxon group from a colourblind-safe palette. No letters.
2. **Each segment head carries a label.** Because a singleton is a segment of one, that means in practice every occurrence is labelled — see "Why labelling everything is affordable".
3. **The label is up to two lines in one box**: identity on line one, and for multi-point tracks only, a track summary on line two.
4. **Killer whales keep their pod letter** — `J pod`, `Biggs`, `SRKW`. That part of the existing scheme is real information to the audience and survives.
5. **Location uncertainty is not encoded.** See "Rejected".

## Why labelling everything is affordable

The obvious economy — label the segment, not its points — was measured and does almost nothing, because **a singleton is a segment of one**:

| Day | Occurrences | Segments | Multi-point tracks | Singletons | Ineligible for a track |
|---|---|---|---|---|---|
| 2026-07-20 | 55 | 52 | 3 | 49 | 37 (67%) |
| 2026-07-22 | 77 | 59 | 6 | 53 | 48 (62%) |
| 2026-07-25 | 83 | 73 | 6 | 67 | 54 (65%) |
| 2026-07-26 | 61 | 56 | 3 | 53 | 37 (61%) |
| 2026-06-15 | 106 | 74 | 10 | 64 | 53 (50%) |

"Ineligible" is a taxon outside the six species in `travelSpeedKmH`, which can never chain
however it is sighted ([027](027-marine-mammal-scope-whale-centric-identity.md)). It is a
larger group than the singletons it overlaps: an eligible animal seen once is also a
singleton.

Hoisting labels to segment heads turns 83 labels into 73. On 2026-07-25 exactly **one** segment carries an identifier at all.

A variant was built that labelled only multi-point tracks — 6 labels instead of 73 — and it was not needed. The prototype showed that the "wall of labels" objection was a **name-length problem, not a label-count problem**: the map drew "North American River Otter" six times. With the register's curated common names and our short map forms — `River otter`, `Harbour seal`, `Humpback` — the same 73 labels read cleanly.

That is the finding this record most wants to preserve: *the fix for a cluttered map was shorter names, not fewer labels.*

## Sequencing: this depends on the register

The short names are not ours to invent. `River otter` is `SSA:0000906`'s `common` row in the [animals register](https://github.com/salish-sea/animals), and today every display name on our map comes from `inaturalist.taxa` — an upstream mirror, which [008](008-source-schemas-are-upstream-mirrors.md) forbids surfacing in UI.

So **`salish-ayb` (register adoption) is a prerequisite, not a parallel track.** Implementing this record against iNaturalist's vernaculars would reproduce the clutter it exists to remove.

The division of labour follows animals ADR-0011: the register asserts the canonical name; **we compose the presentation.** ADR-0011 names truncation and capitalisation as consumer concerns in as many words. So `Humpback` rather than `Humpback whale` is legitimately ours, and it is a *different* change from adopting `River otter` over `North American River Otter` — the latter fixes a wrong name, the former composes a short form. Short forms live here, keyed by `SSA:` identifier, and are never written back to the register.

Shortening is not a general rule: `Humpback whale` → `Humpback` works because the modifier is a noun; `Gray whale` → `Gray` does not. It is a curated per-taxon form.

## The label

```text
Gray whale · CRC53
Seen 3× over 10h
```

Line two appears only for multi-point tracks — 2 of ~20 labels on a busy day.

**The unit is named deliberately.** An earlier form read `Gray Whale (3) · CRC53`, and a bare number beside an animal's name reads as a count of *animals* — which is exactly what `count` (number sighted) means elsewhere on the same record. On a map whose job is reporting how many animals are where, that is a misreading with consequences.

Implementation note: OpenLayers' rich-text form (an array of alternating text and font) does **not** honour `\n`; it lays every chunk out inline. A plain string with a newline breaks correctly, at the cost of a per-line font. One `Text` is also preferable to two stacked styles because it stays a single declutter unit and a single background box, so the lines cannot be separated or half-hidden.

## Decluttering

Labels are hand-positioned today with `declutterMode: 'obstacle'` and pixel offsets, and still overprint — two identifier labels collide near Victoria on an ordinary day. Layer-level `declutter: true` resolves it without the hand-tuning.

This does **not** solve cross-layer collision: decluttering is per-layer, so an occurrence label can still overprint a hydrophone icon. That is tracked separately, along with the related defect that infrastructure markers (hydrophones, viewing locations, salmon counting sites) currently render at the same size and shape as occurrence markers and so read as sightings.

## Rejected

- **Sizing markers by location uncertainty.** Cannot be built on the data we hold, and would assert the wrong thing if it could.

  | Provider | n | With `accuracy` | Distribution |
  |---|---|---|---|
  | maplify | 34,791 | **0** | hardcoded `NULL` in the view |
  | direct | 438 | **0** | — |
  | happywhale | 5,601 | 5,601 | three discrete values: 2, 16, 161 m |
  | inaturalist | 20,581 | 16,410 | p50 **31 m**, p90 2.9 km, p99 28.7 km, max **7,313 km** |

  **64% of records carry no value at all** (39,400 of 61,411): every Maplify and native record, since those two providers store none, plus the 4,171 iNaturalist records that have none. HappyWhale's three buckets are coordinate-precision artefacts, not uncertainty estimates. At zoom 10 (~100 m/px at 48°N) the median iNaturalist circle is 0.3 px while the p99 is a 287 px disc — no transfer function serves both.

  The deeper objection is that **`accuracy` describes where the reporter was, not where the animal was.** For shore-based whale sighting the dominant error is range-to-animal, which we capture in `observed_from` — populated on 100 records, all native submissions. A 31 m circle drawn around an orca reported from Lime Kiln would be a confident, precise, wrong claim. Worse than the letter it replaced.

  Revisit if `observed_from` gains real coverage. It is a different field answering the honest question.

- **Species icons instead of colour** ([#79](https://github.com/salish-sea/salishsea-io/issues/79)). Not rejected, deferred: two-letter group codes proved legible and unambiguous at 22 px in the prototype, which demotes the icon library from blocker to polish. The concern raised on #79 — that icons stop working at density — is unaddressed and remains the open question.

- **Labelling only multi-point tracks.** Built and measured; unnecessary once names were short, and it silences the 50–67% of a typical day's map that can never form a track. [027](027-marine-mammal-scope-whale-centric-identity.md) gates segments to six cetacean species, so every pinniped and otter sighting is a singleton by construction.

- **A local override table for display names.** The first proposal, and wrong: it would mint a second opinion about animal names, which animals ADR-0012 exists to prevent. Recorded so it is not proposed again.

## Consequences

- `symbolFor()` in `src/identifiers.ts` is retired for everything except the killer-whale pod branch, which moves into the label composition.
- `src/style.ts` gains a taxon-group palette and loses the per-marker letter `Text`.
- The occurrence layer takes `declutter: true`; the hand-tuned `offsetX`/`declutterMode: 'obstacle'` positioning goes away.
- Travel lines get a casing stroke. [#271](https://github.com/salish-sea/salishsea-io/issues/271) reports them as faint; part of that is that `travelStyle` returns early above resolution 100, so they do not draw at all at the default zoom — absent rather than faint.
- A defect surfaced while measuring: `Megaptera novaeangliae kuzira` (319 records) is missing from `travelSpeedKmH`, so North Pacific Humpbacks silently never seed a segment though `Megaptera novaeangliae` does. Unlike the empty entries [027](027-marine-mammal-scope-whale-centric-identity.md) records as intentional, this one is an accident of exact-string matching.

## Open

- **What makes a track worth drawing.** A 2-point, sub-hour segment is a thin claim to render as a journey. The threshold probably wants 3+ points or a minimum distance; unresolved.
- **Density beyond a typical day.** The measurements above cover 33–106 occurrences. The busiest day on record is 185, and the historical view ([#31](https://github.com/salish-sea/salishsea-io/issues/31)) would exceed that by orders of magnitude. Nothing here has been tested at that scale.
