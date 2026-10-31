# Reading sighting text: four readers measured against the gold set

*2026-10-31. Work: bd `salish-oyh3`. Measure: decision [102](../decisions/102-reading-sighting-text-is-measured-against-a-gold-set.md); the scripts and readers are [`scripts/gold/`](../../scripts/gold/README.md).*

Peter asked how much better the project could read a sighting's free text than its regexes do, and whether a Claude model with the project's context would do better than conventional, deterministic parsing. The gold set answers for the fields it labels. Each reader was given the 200 reports and scored on five fields per report, right or wrong: the direction of travel, the codes present, the codes absent, the codes hedged, and the pods named.

## Result

Reports read right, out of the 100 random killer whale reports (the stratum that estimates the corpus):

| reader | direction | codes present | codes absent | codes hedged | pods |
|---|---|---|---|---|---|
| the build's regexes | 94 | 94 | 97 | 96 | 82 |
| token reader | 100 | 100 | 100 | 100 | 100 |
| Claude Haiku 5.5 | 100 | 99 | 100 | 100 | 100 |
| Claude Sonnet 5.5 | 99 | 100 | 100 | 100 | 100 |

The regexes' "right" counts on absent codes, hedged codes and pods are the reports that have none to find. On the hard strata, drawn for the patterns the regexes miss:

| reader | exclusions, codes absent (15) | codes without their letter, codes present (13) | abbreviated directions (5) | changes of direction (5) |
|---|---|---|---|---|
| the build's regexes | 1 | 0 | 0 | 2 |
| token reader | 14 | 13 | 5 | 5 |
| Claude Haiku 5.5 | 14 | 13 | 5 | 5 |
| Claude Sonnet 5.5 | 14 | 13 | 5 | 5 |

Over all 200 reports the token reader is wrong on two fields, Sonnet on five, Haiku on six, the regexes on 92. Every reader misses the same two rows: the typo *T46s minus T46s*, which names no absent animal, and a calf's report that names its mother's code as context. The models' other misses are judgement calls on a direction: both say `milling` for *at least milling, some directional changes but possibly westbound*, where the label takes the hedged *westbound*; Sonnet says `milling` for *continuing southbound, some stalled and appear to be foraging*. Haiku once failed to read *ALB edit w IDs of T419s* and once resolved the nickname *Thor* to a code where the label keeps nicknames apart from codes, which is a capability, not a mistake.

## What the token reader is

[`readers/tokens.ts`](../../scripts/gold/readers/tokens.ts) is about 150 lines of rules over the words, with the register's conventions written in: a code without its letter takes the letter of the code before it, or T when the text says Biggs; a hyphen may sit inside a code; *(-D)* after *T46s* is T46D absent, resolved against the matriline it follows; a hedge word covers the codes up to the next comma; pods are *J pod*, *Jpod*, *Js*, *J and K pods*; a direction is a compass word or an abbreviation with *bound* or a verb of travel, except a bearing (*north of Alki*), a place name (*West Point*), a spread (*north to south*) and *facing*; after *now*, *then* or *turned*, the direction after the cue wins, and *stalled* there is milling. It was written against the hard strata and the first half of each random stratum. On the second half of each random stratum, 70 reports it was never tuned on, it is wrong on one field of one report (the calf's report above), but 70 is a small test, and the hard strata were development data.

## What the models cost and how they behaved

Each report was one request with the task, the gold set's definitions and the catalogue's codes, matrilines and nicknames as a cached system prompt of about 8,650 tokens, and structured output. Reading all 200 once cost about 1.7 million cached input tokens and 63,000 output tokens on Haiku 5.5 (about five cents at list price) and 25,000 output tokens on Sonnet 5.5 (about sixty cents). Read every Maplify report with text for a year, some 10,000, and Sonnet is about thirty dollars; the usage ran on Peter's Claude subscription.

Two things to know before relying on a model reading in the build. The models spell codes as the dictionary spells them, zero-padded (T065A5), so the scorer folds leading zeros as the register does; a build would normalise the same way. And Haiku's readings were not the same twice: a second run differed on a few rows. The readings are cached by the text's hash in [`scripts/gold/readings/`](../../scripts/gold/readings/) so a rerun costs nothing and the answers can be read; the cache is what makes a model step fit a build that must produce the same bytes from the same input.

## What this settles

- **The regexes' misses are patterns, and rules fix them.** On the five fields the gold set labels, a deterministic reader does as well as either model, costs nothing, runs in the build without a network and gives the same answer every time. Codes, exclusions, hedges, pods and directions should stay deterministic, as decision 102 expected.
- **A model earns its place beyond these fields.** The gold set also labels counts, calves, behaviour words, places, who identified and later edits, which no reader here answers yet and which rules will fit less well; the model reader already returns a count and a calf flag that nobody has scored. That is the next measurement.
- **An exclusion needs somewhere to go.** Every reader but the regexes can say an animal was absent, and the build has no column for it: a candidate identifier is a bare code. Peter's question on 2026-10-31, "we need schema work to do exclusions", is bd `salish-uh38`.
