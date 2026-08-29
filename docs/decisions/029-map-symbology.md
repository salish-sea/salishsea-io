# 029 — Map symbology: colour carries the taxon, labels carry the specifics

**Status:** accepted
**Date:** 2026-08-27
**Issue:** bd `salish-fll` (epic), `salish-fll.1` (findings)
**Depends on:** bd `salish-ayb` — adopting the [animals register](https://github.com/salish-sea/animals). See "Sequencing" below; this record cannot be implemented well before it lands. **Satisfied 2026-08-29**: adoption landed in #398 and its reasoning is [033](033-register-names-the-animals.md).
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

![Taxon-group palette, segment head and tail, and the two-line label](images/029-symbology-legend.png)


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

> **The two paragraphs below are satisfied as of 2026-08-29, and are kept as the state at decision time.** Register adoption landed in #398, and its reasoning is now [033](033-register-names-the-animals.md). Display names come from the register wherever it has an exact iNaturalist crosswalk — 58,669 of 64,097 occurrences, 91.5%, against edition 2026.08.1 — and from `inaturalist.taxa` only for the remainder, which is almost entirely killer-whale subspecies (`salish-0gb`). The prerequisite was met before this record was implemented, which is what the sequencing asked for.
>
> ~~The short names are not ours to invent. `River otter` is `SSA:0000906`'s `common` row in the [animals register](https://github.com/salish-sea/animals), and today every display name on our map comes from `inaturalist.taxa` — an upstream mirror, which [008](008-source-schemas-are-upstream-mirrors.md) forbids surfacing in UI.~~
>
> ~~So **`salish-ayb` (register adoption) is a prerequisite, not a parallel track.** Implementing this record against iNaturalist's vernaculars would reproduce the clutter it exists to remove.~~

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

- `symbolFor()` in `src/identifiers.ts` is retired for everything except the killer-whale pod branch, which moves into the label composition — including in the observation list, whose badge becomes the same coloured dot as the marker.
- A taxon-group palette appears (in `src/symbology.ts`, see below) and `src/style.ts` loses the per-marker letter `Text`.
- The occurrence layer takes `declutter: true`; ~~the hand-tuned `offsetX`/`declutterMode: 'obstacle'` positioning goes away.~~ **Amended after building it:** `declutterMode: 'obstacle'` went away, but a fixed `offsetX` remains and has to — see the implementation note on obstacles below.
- Travel lines get a casing stroke. [#271](https://github.com/salish-sea/salishsea-io/issues/271) reports them as faint; part of that is that `travelStyle` returned early above resolution 100, so they did not draw at all at the default zoom — absent rather than faint. **Both fixed in #401** (`salish-fll.4`): the line has no resolution gate, only its annotations do.
- A defect surfaced while measuring: `Megaptera novaeangliae kuzira` (319 records) is missing from `travelSpeedKmH`, so North Pacific Humpbacks silently never seed a segment though `Megaptera novaeangliae` does. Unlike the empty entries [027](027-marine-mammal-scope-whale-centric-identity.md) records as intentional, this one is an accident of exact-string matching.

## Implementation notes

Added after building it (`salish-ayb.6`); the decision above is unchanged.

![The map at 112 occurrences — synthetic data shaped like 2026-06-15, the busiest day measured above](images/029-symbology-map.png)

A synthetic day, not a real one: the taxa, register names and `SSA:` identifiers are real, the
positions are generated, and it over-produces multi-point tracks compared with the 10 that
2026-06-15 actually had. It is here to show density and decluttering, not to report a day.

- **The palette lives in `src/symbology.ts`, not `src/style.ts`.** Two things that
  look alike live there and are not alike: the *group* is ours outright, a rendering
  bucket invented so a whale is distinguishable from a porpoise; the *name* is the
  register's, and we only ever compose a shorter form of what it asserts. `style.ts`
  stayed about OpenLayers.

- **Short forms are truncations, never substitutions — and never lifted from a
  `hidden` name.** The register turns out to carry `orca`, `humpback`, `elephant seal`,
  `bottlenose dolphin` and `right whale dolphin` as `hidden` rows: evidence those
  strings are in use, explicitly *not* names it offers for display. So an unattributed
  killer whale reads `Killer whale`, not `Orca`, though `Orca` is the commoner word —
  composing our way to a string the register declined to offer would route around its
  judgement. Dropping a qualifier that separates our records from nothing is a different
  act, and is the one ADR-0011 delegates.

  Only five entries were needed. The clutter this record set out to fix was
  "North American River Otter", and adopting the register (`salish-ayb.5`) fixed that on
  its own; most of its names are already the right length for a map pin.

- **Keyed on `SSA:` via a new `taxon.entity_id`** (migration `20260829000000`). Keying on
  the register's *name* would drop the override the moment the name is revised; keying on
  `scientific_name` would drop it when iNaturalist reclassifies an animal, which
  `20260828000000` exists because they do.

- **Travel lines are slate, not `#ffcc33`.** Once colour carries the taxon, yellow is no
  longer neutral: it sits between the seal and sea-lion oranges and beside the yellow that
  means *selected*. The track is the one thing on the map drawn in no hue at all — which
  is what "supporting, not the subject" turns out to mean once the palette exists. The
  direction arrows moved with it.

- **Similar colours mean coarse kinship, and that is worth protecting — but it is not
  systematic.** Measured with CIEDE2000 over the nine group colours, the two closest pairs
  are seal / sea lion (ΔE 22.2, the orange pair) and baleen whale / dolphin (ΔE 22.3, the
  blue pair). Both pair animals that really are related: Phocidae with Otariidae, and two
  cetaceans. That reads as a scheme and mostly is not one — the prototype chose Okabe–Ito
  for separation, and only orca's near-black was reasoned about ("that is what an orca
  looks like").

  The proximity of `#0072B2` and `#56B4E9` is **structural in Okabe–Ito** and cannot be
  permuted away; all a reassignment does is choose which two groups are allowed to look
  related. Swapping the sky blue onto otter was tried and measured: it leaves the minimum
  separation identical (22.2 normal, 12.1 worst-case dichromacy) while putting a mustelid
  in a whale's hue family. So the current assignment is the best available use of that
  pair, and swapping it is a regression that looks like a tidy-up.

  Where the property does *not* hold: porpoise is green though it is the dolphin's sister
  family, and orca is black though it is a dolphin. Both are deliberate — the whole point
  is that a 1.5 m porpoise must not read as a whale, and orcas are the map's main subject.
  Kinship is a happy secondary reading, never the encoding.

  No pair collapses under simulated deuteranopia or protanopia (minimum ΔE 12.1), which is
  Okabe–Ito doing the job it was chosen for.

- **The label keeps a fixed `offsetX`, and that is not the hand-tuning the decision
  retired.** What went away is `declutterMode: 'obstacle'` — labels negotiating space by
  always drawing and blocking each other, which is why two overprinted near Victoria. The
  11 px offset is not collision avoidance; it is the anchor that stops a label sitting on
  the marker it belongs to. Decluttering cannot supply it, because OpenLayers drops a
  colliding label rather than moving it.

- **The dots do not declutter, and must not be obstacles.** `declutterMode: 'obstacle'`
  is the reading that looks right and is not: an obstacle reserves its own footprint, and
  a label is anchored to the marker it belongs to, so every label collided with its own
  dot and the map lost all of them at once. With `'none'` a label can land on a
  neighbouring marker, so the label background is near-opaque — at 88% the marker beneath
  showed through as a smudge that read as a rendering fault.

- **The identity is pooled across the segment, like the identifiers.** A pod is
  reported in prose, and prose belongs to one sighting. The head is the *last* point, so
  an encounter posted as "J pod northbound" at 09:00 and "three orca" at 11:00 labelled
  itself `Killer whale`. Pod anywhere beats ecotype anywhere beats the subspecies, which
  is the weakest evidence: a report naming J pod is more specific than a taxon saying
  "some resident".

- **The ecotype regex missed the plural.** `\b(...|transient|biggs)\b` refuses
  "transients" and "southern residents", which is how people actually write it. Invisible
  while the ecotype only chose a letter; the label made it obvious.

## Open

- **What makes a track worth drawing.** A 2-point, sub-hour segment is a thin claim to render as a journey. The threshold probably wants 3+ points or a minimum distance; unresolved.
- **Density beyond a typical day.** The measurements above cover 33–106 occurrences. The busiest day on record is 185, and the historical view ([#31](https://github.com/salish-sea/salishsea-io/issues/31)) would exceed that by orders of magnitude. Nothing here has been tested at that scale.
