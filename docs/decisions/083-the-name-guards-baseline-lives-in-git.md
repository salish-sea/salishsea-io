# 083 — The name guard's baseline lives in git, not on the volume

**Status:** accepted · **Decided:** 2026-10-21, by Peter · **Relates:** [061](061-ingest-and-derivation-move-into-the-build.md) (the guard moved into the build), [064](064-what-users-do-not-write-leaves-postgres-first.md) (the reference tables became checked-in files), [082](082-happywhale-leaves-the-build.md) (the other input the volume could not get again)

## Context

The name guard (`scripts/read-path/check-maplify-names.ts`) keeps a register edition from quietly dropping Maplify sightings off the map: every (name, scientific name) pair a passing build has resolved to an animal, the register must still resolve. Its baseline, the pairs and what they resolved to, is forward-only. Nothing regenerates it, because since decision 064 nothing but the build resolves Maplify names, and a pair the mirror no longer holds survives in the baseline only because the last baseline had it.

Until now the build kept that baseline beside the mirrors on the Fly volume, rewriting it after each pass and serving it as `/status/maplify-names.json`. The volume was its only home: five days of Fly snapshots, and the served copy, which is the same file. Lose the volume and miss that window, and the guard has no baseline; the next build either seeds a new one from whatever the register names that day, which is exactly the un-naming the guard exists to catch, or fails on every pair. Asking what else on the Fly side could not be recovered, after [salishsea-io#727](https://github.com/salish-sea/salishsea-io/pull/727), turned this up.

Peter's point: it should be checked in. Everything that changes the baseline on purpose already is. A register edit lives in the register's repository, and an accepted un-naming is a row in `data/maplify-unnamed.tsv`, by pull request, which the runbook already insists on over any edit to the volume's file. The one cause that was not in git is additive: a new Maplify pair appearing and resolving.

## Decision

`data/maplify-names.json` is the baseline, checked in beside the reference tables and the allow-list. The build reads it (`--baseline`), judges this build's answers against it, and on a pass writes what the baseline should become, this build's answers plus the named pairs the mirror no longer holds, as a derived report beside the mirrors, served as before at `/status/maplify-names.json`. The report is not state: a lost one is rewritten by the next pass. In Stelis's graph the baseline is a producerless authoritative input, as the allow-list is, and the report is a derived output of the gate ([rainhead/stelis](https://github.com/rainhead/stelis), `src/salishsea.rkt`).

A pull request brings new pairs into the baseline: `node scripts/read-path/refresh-maplify-names.ts` copies the report over the checked-in file and lists what changed, and the diff is reviewed like any other. A build with no baseline file does not run unguarded; it fails, since the file is in the checkout the image is built from.

The first checked-in baseline is the report the build served on 2026-10-21, 107 pairs.

## Consequences

- The volume holds nothing the build cannot get again except the store, which Litestream replicates (decision 065).
- A pair that appears in Maplify's feed is guarded only once a pull request adds it. Until then the register fetch's own refusal covers it (`ingest-register.ts` refuses an edition that un-names a pair the mirror holds), which is the same window the guard already had for a pair the mirror did not hold when the edition was judged. Nothing gets weaker; the refresh is routine, not urgent.
- A change to the baseline is a diff someone reads, which a volume write never was. A pair resolving to a different animal shows in that diff.
- `check-unnaming.ts`, run by hand against a candidate edition, can read either the checked-in file or the served report. The report is the stricter baseline, since it has the pairs not yet committed.
- The runbook's instruction stands: never edit the file on the volume. There is now nothing there to edit; the report is rewritten by the next pass.
