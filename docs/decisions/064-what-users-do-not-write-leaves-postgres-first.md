# 064 — Step 4 starts by taking out of Postgres everything our users do not write

**Status:** accepted · **Decided:** 2026-10-05 · **Answers:** the first move of step 4 of [056](056-the-logged-out-read-path-is-built-as-static-files.md), toward [059](059-the-end-state-is-a-build-graph-with-a-small-authoritative-store.md)'s end state · **Context:** bd `salish-9uu`

## Context

After step 3 ([061](061-ingest-and-derivation-move-into-the-build.md)), Postgres ingests nothing, but every build still begins by copying from it. The snapshot reads four kinds of thing, and they come from very different places:

- **The register** (`register.*`), which is somebody else's data: [`load.ts`](../../scripts/register/load.ts) replaces it daily with the newest digest-verified release of the animals register ([`register-refresh.yml`](../../.github/workflows/register-refresh.yml)).
- **Our curated catalogue and reference data.** The Bigg's catalogue (`individuals`, `designations`, `parties`, `social_groups`, `nicknames`) was seeded once from the Bigg's sheet by [`seed-biggs.ts`](../../scripts/seed/seed-biggs.ts), run by hand, and corrected since by migrations; [051](051-group-hierarchy-is-the-registers.md) lists what of it stays ours. The haul-out sites came from the 2000 WDFW atlas in one migration. Providers, organizations, collections, Maplify's collection rules and the enums' orders were written by migrations. Three more catalogue relations (`animal_names`, `matriline_members`, `group_parents`) are views over the register, and the vitals on `individuals` are copied from it on every load. Nothing in the app writes any of these; a curator changes them by a pull request.
- **Happywhale's tables**, frozen: nothing has written them since their in-database loader stopped being called.
- **What our users write**: sightings and their photos, the identifications they assert, contributors, feedback.

Only the last is what 059's store is for. The rest is in Postgres because Postgres was where everything was.

## Decision

**Everything our users do not write leaves the snapshot first, one kind at a time, while the store and the write API wait.** None of it needs the store, the sign-in question, or any change a visitor can see, so it can move now, and each move leaves the build reading less of a database it is about to stop having. At the end the snapshot reads only what users write, which is exactly what the store will hold.

**The register is fetched by the build, as the three sources are.** A boundary task fetches the newest published release, verifies it against its `SHA256SUMS`, and writes it to a mirror on the volume, recording the tag. It refuses an edition that would un-name a Maplify sighting before adopting it, the check [`register-refresh.yml`](../../.github/workflows/register-refresh.yml) already makes ([`check-unnaming.ts`](../../scripts/register/check-unnaming.ts)): the mirror keeps the edition it has and the run says why, as an unreachable source does. The register-derived catalogue — the three views and the vitals — becomes DuckDB in the derivation. Postgres keeps being loaded by the workflow until the cutover; the two may sit an edition apart for up to a day, which only the signed-in overlay of native sightings can show.

**What we curate becomes checked-in data.** The catalogue's own facts, the haul-out sites and the reference tables become files under [`data/`](../../data/), read by the build as inputs it does not produce. They are ours and forward-only, so they cannot live with the derived files; they change rarely and only by a curator's pull request, which is how they change today. A file in the repository is versioned, reviewed and backed up by being cloned, and the build sees an edit as an input moving. Withheld columns stay out: the `individuals.notes` sheet text and the nicknames' `story` are kept off every page by [rights policy D-21](../rights-policy.md), and this repository is public, so they wait in Postgres for the store.

**Happywhale becomes a frozen file.** Its tables are exported once and the build reads the export. Whether it is checked in or kept beside the mirrors depends on its size, measured when it moves.

**Each move is checked once against production, then Postgres's copy is frozen.** The change that moves a kind of data compares what the build now reads with what the snapshot read from production, and they must agree before it lands. Afterwards the file is the source. Until the cutover, a change to it that the signed-in site must see in Postgres also needs a migration, and for the reference tables, which migrations wrote in the first place, a test checks that a fresh migration replay matches the files.

The order is the reference tables, then the register, then the catalogue (which reads the register), then Happywhale. The `read_path` role's grants narrow as each one leaves.

## Rejected alternatives

- **Curated data in the store.** It is ours and cannot be regenerated, which is what the store is for. But nobody edits it through the site, and putting it there would mean building a curator's editing interface before step 4 needs one, or editing a production database by hand, which is what leaving Supabase is meant to end. If curators come to need edits through the site, the facts they edit move to the store then.
- **Keep loading the register into Postgres and snapshotting it.** It works today, but leaves the build depending on a database for data that is published as a file, and keeps a second copy of a decision — which edition — in two places at the cutover.
- **A standing agreement gate per kind of data.** The derivations needed one in step 3 because they were ports of logic. Here nothing is ported but the three register views; a file copied from a table either matches it or does not, and one comparison when it moves says which.

## Consequences

- The build gains a register mirror and a handful of checked-in inputs. A curator's catalogue fix lands as a pull request the build reacts to, with no migration once Postgres is gone.
- `seed-biggs.ts` and the Bigg's sheet stop being the catalogue's source; the checked-in files are. The sheet stays as the record of where the seed came from.
- The browser still reads the catalogue from Supabase on the live, unprerendered pages. Which of those reads a signed-out visitor reaches under the static read source is audited as part of this work, since the cutover has to move any that remain.
