# The twin fixture

The read-path build derives the occurrences, their identifier candidates, the catalogue's views over the register, the profile pages' links and the Darwin Core relations in DuckDB, as twins of what Postgres's views computed (decision 061). Postgres was the twins' only oracle. These files are what it answered, captured once on 2026-10-09 before it retired (`salish-9uu.11`), so the twins stay checked without it.

- **`snapshot/`**: a read-path snapshot, the inputs and Postgres's answers together, as DuckDB's `EXPORT DATABASE` writes one in CSV, each table's rows sorted. [`twin-fixture.ts`](../../twin-fixture.ts) loads it; [`derive-occurrences.test.ts`](../../derive-occurrences.test.ts) derives from it and compares each derivation with Postgres's answer beside it (the `compare-*.ts` files). The inputs are the tables the build reads, under their Postgres names: what users write, the source tables the mirrors are written from (`derive/mirrors-from-snapshot.ts`), Happywhale's, the register and the catalogue's documents. The answers are `snapshot.occurrences`, the link views under `snapshot.`, `snapshot.<view>_answer` for the catalogue's three views, `derived.occurrence_identifier_candidates` and `dwc.*`. The reference tables aren't in it: the test loads them from `data/reference/`, as the build does.
- **`haulout-distance.tsv`**: `public.haulout_distance_m` around three haul-out sites, for `derive/haulout-distance.test.ts`.
- **`ingest-*.json`**: what Postgres's ingest stored for each ingest test's recorded response, for the "mirror stores what Postgres stored" tests.

The smaller twins' answers (the text extractions, Happywhale's instants, the register's fold) are written into their tests.

## Where the rows came from

All of it is synthetic or public. The snapshot was taken (`snapshot.ts --answers`, as of [95c8e13](https://github.com/salish-sea/salishsea-io/blob/95c8e1363b5b42f22c2511161726f275eea35325/scripts/read-path/snapshot.ts)) from a scratch copy of the local database holding, in order:

1. `supabase/ci-seed.sql`: three Maplify sightings and one native one;
2. register release 2026.10.1, loaded by the [register loader](https://github.com/salish-sea/salishsea-io/blob/5c1497a95301e7cc212e46712705ef5d0f426cec/scripts/register/load.ts);
3. the Bigg's catalogue, from `data/biggs-ids.tsv` by the [catalogue seed](https://github.com/salish-sea/salishsea-io/blob/37564ef580f84996b42c57b907fcb85029c6f984/scripts/seed/seed-biggs.ts), without the withheld notes and stories (rights policy D-21), which the snapshot never read;
4. [`seed.sql`](seed.sql): one or two invented rows per source, so every derivation has something to derive;
5. [`trim.sql`](trim.sql): the catalogue, register, iNaturalist taxa and haul-out sites cut down to what those rows reach, so the fixture can be read. Postgres's answers were computed after it.

Neither SQL file runs any more; they are the record of how the rows were made.

## When a derivation changes on purpose

The test then fails, naming the rows that differ. With no Postgres to ask, the new answer is the build's: check that the difference is the one you meant, then edit the expected rows in `snapshot/` to match, as a reviewed change.
