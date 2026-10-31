# The gold set for reading sighting text

[`sighting-text.json`](sighting-text.json) holds 200 Maplify reports with what each one says, read by hand (decision [102](../../../../docs/decisions/102-reading-sighting-text-is-measured-against-a-gold-set.md)). It is the measure for any change to how the build reads free text: the regex macros in [`derive/extract.sql`](../../derive/extract.sql) today, a token grammar or a model's reading later. [`derive/extract-gold.test.ts`](../../derive/extract-gold.test.ts) runs the macros over every row and records, by stratum, which rows they get wrong today.

The labels are the truth here, not the macros' output. A row's labels change only when someone rereads the text and disagrees. The lists in the test change whenever the extraction does, as a reviewed edit.

## How the rows were drawn

From the Maplify mirror on 2026-10-31: every report received in the year to 2026-10-30 with a non-empty comment, from any source but the two the ingest excludes (`rwsas`, `wras`), 5,123 reports, 2,656 of them killer whales. Seven strata, each a seeded uniform draw (seed 20261031), without replacement across strata:

| stratum | rows | drawn from |
|---|---|---|
| random orca | 100 | the killer whale reports |
| random other species | 40 | the rest |
| hard: exclusion | 15 | killer whale reports whose text excludes an animal: `(-D)`, `(-T46D)`, `minus T137A` |
| hard: code without letter | 13 | killer whale reports with a code written without its letter: `T36/36Bs`, `65A5` |
| hard: hedge | 10 | killer whale reports with *likely*, *possibly*, *presumed* or `?` |
| hard: change of direction | 5 | reports with *previously*, *flipped*, *turned*, *now* and a direction word |
| hard: abbreviated direction | 5 | reports with `NB`, `SB`, `EB`, `WB` or `N bound` |
| filter miss | 12 | rows a hard stratum's filter matched by accident, moved here so they don't count for the pattern: five drawn for a catalogue nickname where the filter matched a common word, two drawn for a code without its letter where it matched ", 10 orcas" and a date, and five drawn for a change of direction where it matched *now* or *earlier* in a report that changes none |

Every comment is public Maplify data as the mirror holds it, reporter names included, as the twin fixture's Maplify rows are.

The two random strata estimate the corpus. The hard strata say how an extraction does on the pattern named, not how often it occurs. The same 200 rows, with the labels in columns, are in Peter's Google Sheet "Sighting text gold set", where they were reviewed.

## The columns

Each row is one report. `comment` is the comment as Maplify sent it, which the build's macros read. `text` is the comment with its collection tag (`[Orca Network]`), its trailing *Submitted by* line and its HTML removed, which is what was read for the labels. `maplify_id`, `maplify_name`, `number_sighted` and `collection_tag` are as sent.

The labels say what the text says, not what is true of the animals:

- `codes_present`: catalogue codes of animals and matrilines the text says were there, in text order, in the form the macro emits (letter upper case, digits as written, a matriline's `s` lower case). A code written without its letter is written with it. A hedged code is still present.
- `codes_absent`: codes the text says were not there. A short form such as `(-D)` after `T46s` means `T46D`. Only what the text names: where it excludes an animal it fails to name (*T46s minus T46s*), nothing is labelled absent.
- `codes_hedged`: codes whose presence the text hedges: *likely T36A1s*, *maybe T65A5*; every code the report names when the whole identification is hedged, *possibly Biggs T99s and T65A3*.
- `pods`: Southern Resident pods named, as `J`, `K`, `L`.
- `ecotype`: `Biggs` when the text says so or names a T code; `SRKW` when it says so or names J, K or L; otherwise null.
- `nicknames`: animals named by nickname rather than code, not resolved.
- `certainty`: how sure the reporter was of the animals named: `certain` when stated flat, `probable` for *likely* or *presumably*, `possible` for *possibly*, *maybe* or `?`; null when no animal or ecotype is named. Where codes differ, the report's overall value, with the hedged ones in `codes_hedged`.
- `direction`: the travel direction given for the time of the report, as one of eight compass points; `milling` for milling, stalled or directional changes with no net direction; `unknown` when the text says so; null when the text says nothing about travel. Facing a direction is not travel. A bearing from a landmark (*north of Alki*) is not a direction. Abbreviations count. A hedged direction (*possibly westbound*) is recorded, with the hedge in `notes`.
- `direction_before`: an earlier direction or state the text narrates: *had been northbound, now stalled*.
- `direction_also`: a second compass point the text allows, where it gives two: *north/northwestbound*. Null otherwise.
- `count_min`: the smallest number of animals the text itself states; null otherwise, except where `notes` says the count came from `number_sighted`.
- `count_text`: the phrase the count came from, or one that qualifies it: *at least two orcas*, *numbers approximate*.
- `extra_unidentified`: the text says there were animals beyond those named: *and others*, *could have been more*.
- `calf`: the text mentions a calf.
- `behaviour`: the behaviour words used, as written, not normalised.
- `places`: place names and position phrases: landmarks, waterways, webcams, *mid channel*.
- `identifier_named`: the text names who made the identification: *(ID Bart Rulon)*.
- `later_edit`: the text is or contains a later edit: *EDIT: K pod*, *Edit by Alisa LB*.
- `notes`: why a label is what it is, and anything odd about the text.

## How the test scores the macros

A direction is right when the macro answers the labelled compass point (or `direction_also`), or NULL where the label is null, `milling` or `unknown`. A code list is right when the macro's list, in order, equals `codes_present`, so a listed absent code, a missed code and a repeated code are each wrong. Nothing else the labels hold is scored yet; a reading that extracts pods, hedges, counts or behaviour gets its own scoring when it exists.
