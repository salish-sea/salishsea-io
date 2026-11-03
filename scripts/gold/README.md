# Measuring how sighting text is read

The gold set ([`scripts/read-path/fixtures/gold/`](../read-path/fixtures/gold/README.md), decision [102](../../docs/decisions/102-reading-sighting-text-is-measured-against-a-gold-set.md)) says what 200 Maplify reports state. The scripts here read those reports with several readers and score each against the gold labels, so the question "which reader should the build use" is answered by a table, not an argument.

```sh
node scripts/gold/measure.ts regex tokens              # the two readers that need nothing
node scripts/gold/measure.ts claude-haiku-5-5          # a model; needs credentials, caches its readings
node scripts/gold/measure.ts tokens --show 23 40       # a reader's answer and the gold labels for rows 23 and 40
```

## The readers

- **`readers/regex.ts`**: the two macros the build ran until decision [105](../../docs/decisions/105-the-build-and-the-browser-read-sighting-text-with-one-reader.md), kept in [`readers/regex.sql`](readers/regex.sql) and run over the full comment. They answer codes and a direction only.
- **`readers/tokens.ts`**: the reader the build and the browser run, [`src/sighting-text.ts`](../../src/sighting-text.ts), given each row's report text. A deterministic reader over the words: the macro's codes plus codes written without their letter, hyphens inside a code, exclusions, hedges, pods, and a direction that knows abbreviations, bearings, place names, spreads and a narrated change. It was written against the gold set's hard strata and the first half of each random stratum; the second half is held out, and `measure.ts` reports it separately.
- **`readers/claude.ts`**: a Claude model, one request per report, with the gold set's definitions and the catalogue's codes, matrilines and nicknames as a cached system prompt, answering structured output. Readings are cached in `readings/<model>.json` by the text's hash and checked in, so a rerun costs nothing and a reviewer can read what the model said. Credentials come from an `ant auth login` profile or `ANTHROPIC_API_KEY`; the reports sent are ones the project already publishes (decision [101](../../docs/decisions/101-the-data-download-is-public.md)).

## The score

A reader answers claims, one per code the text names, each with its presence and the reporter's certainty (decision 054: certain, probable, possible), plus the pods and the direction. `score.ts` scores six fields per report, each right or wrong: direction, codes present, codes absent, codes hedged, certainty (every present code at the gold's level) and pods. Codes are compared as sets. Direction accepts the label's second direction where the text gives two, and treats `milling`, `unknown` and null alike, as "no compass direction", so a reader that cannot say `milling` is not penalised for it and one that can is not rewarded. The table counts reports read right per field, by stratum; the two random strata estimate the corpus and each hard stratum says how a reader does on its pattern.

## Improving the reader

Two loops, kept apart. **Correcting a reading is data:** a person who knows a card is wrong makes a claim that outranks the reader's candidate (decisions 014 and 054), and the reader is not touched. **Improving the reader is a gold row first, a rule second:** a miss becomes a labelled row in the fixture and the sheet, in a stratum of its own, "found in production", so the random strata keep estimating the corpus; then the rule changes, and the pull request names the rows that moved in the test's recorded lists. The second half of each random stratum is held out from development, and the estimate stays honest only if fresh random rows are drawn and labelled blind now and then, about fifty a quarter.

Misses are silent in production, so three signals find them: codes the reader emits that resolve to nothing in the register; text that names something code-shaped the reader didn't read; and a second opinion from Claude Haiku on each day's reports, with the disagreements listed. The model reviews the rules and is never the reader the build depends on. Triage the list in batches, monthly or when it grows, and measure once after the batch. The work is bd `salish-vwkn`.
