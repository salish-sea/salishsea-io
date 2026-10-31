# Measuring how sighting text is read

The gold set ([`scripts/read-path/fixtures/gold/`](../read-path/fixtures/gold/README.md), decision [102](../../docs/decisions/102-reading-sighting-text-is-measured-against-a-gold-set.md)) says what 200 Maplify reports state. The scripts here read those reports with several readers and score each against the gold labels, so the question "which reader should the build use" is answered by a table, not an argument.

```sh
node scripts/gold/measure.ts regex tokens              # the two readers that need nothing
node scripts/gold/measure.ts claude-haiku-5-5          # a model; needs credentials, caches its readings
node scripts/gold/measure.ts tokens --show 23 40       # a reader's answer and the gold labels for rows 23 and 40
```

## The readers

- **`readers/regex.ts`**: the build's own two macros in [`derive/extract.sql`](../read-path/derive/extract.sql), run over the full comment. They answer codes and a direction only.
- **`readers/tokens.ts`**: a deterministic reader over the words: the macro's codes plus codes written without their letter, hyphens inside a code, exclusions, hedges, pods, and a direction that knows abbreviations, bearings, place names, spreads and a narrated change. It was written against the gold set's hard strata and the first half of each random stratum; the second half is held out, and `measure.ts` reports it separately.
- **`readers/claude.ts`**: a Claude model, one request per report, with the gold set's definitions and the catalogue's codes, matrilines and nicknames as a cached system prompt, answering structured output. Readings are cached in `readings/<model>.json` by the text's hash and checked in, so a rerun costs nothing and a reviewer can read what the model said. Credentials come from an `ant auth login` profile or `ANTHROPIC_API_KEY`; the reports sent are ones the project already publishes (decision [101](../../docs/decisions/101-the-data-download-is-public.md)).

## The score

`score.ts` scores five fields per report, each right or wrong: direction, codes present, codes absent, codes hedged, pods. Codes are compared as sets. Direction accepts the label's second direction where the text gives two, and treats `milling`, `unknown` and null alike, as "no compass direction", so a reader that cannot say `milling` is not penalised for it and one that can is not rewarded. The table counts reports read right per field, by stratum; the two random strata estimate the corpus and each hard stratum says how a reader does on its pattern.
