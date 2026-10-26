# 092 — The read-path graphs live in this repo, and Stelis loads them by path

**Status:** accepted · **Decided:** 2026-10-26 · **Work:** bd `salish-dhts` (Stelis `st-ab3`) · **Follows:** [Stelis ADR 0020](https://github.com/rainhead/stelis/blob/0cfe67146f74744ead9998cbf03cca9ce78bc47e/docs/adr/0020-a-projects-graph-lives-in-its-repo.md) · **Amends:** [061](061-ingest-and-derivation-move-into-the-build.md), [090](090-the-read-path-build-is-two-stelis-projects.md)

## Context

The read-path build is a Stelis graph: a Racket module declaring every artifact, task, runtime and resolver, which until now lived in Stelis's own repository as `src/salishsea.rkt`. Every change to it was a Stelis commit, and the register move (decision 064 amended, `salish-vedj`) showed the cost. The graph's half of that change, where `register.*` lives and what two tasks are handed, and this repo's half, what the scripts open, are one change: a task's arguments and the script that reads them. In two repositories they were two pull requests that could not land apart, a pin computed only after Stelis's image had published, a merge order with a warning attached, and a commit stranded on a branch reused after its pull request had merged. The two-project split (090) had the same shape. And the graph's own tests, which check it against this checkout, skipped in Stelis's CI, where there is no checkout.

## Decision

The two graphs live here, in [`stelis/salishsea.rkt`](../../stelis/salishsea.rkt) and [`stelis/salishsea-ingest.rkt`](../../stelis/salishsea-ingest.rkt), beside the scripts they name, with their four tests. They require the engine as the Racket collection `stelis`, which the Stelis image carries, and `fly/build.sh` names each by its module path (`--project /app/stelis/salishsea.rkt`). A graph defaults to the repository it is in as its checkout, so a worktree's graph builds that worktree; `SALISHSEA_DIR` still relocates it.

Their tests run twice: on every pull request inside the pinned Stelis image, which has Racket and the engine and nothing else, so the structural tests run in full and the two needing the DuckDB CLI or esbuild skip; and in the Fly image build, which has both, where the two graphs are also compiled and dry-run against the pinned engine before anything is published.

A change to a graph and to the scripts it names is now one pull request and one deploy. The Stelis pin moves only for engine changes, and the pin check in the Dockerfile asks that the engine provide the collection.

## Rejected alternatives

- **Keep the graph in Stelis and script the lockstep.** It would shorten the wait, not remove it, and the tests would still run without the checkout they test against.
- **Run the graph's tests only in the Fly image build.** That gates the deploy, not the pull request; a graph edit that drifts from a script would be found after the merge.

## Consequences

- Racket appears in a TypeScript repository as a declaration rather than application code; decision 065's one-language rule is bent for it, not broken. The Stelis image gives CI and the Dockerfile the Racket to run it.
- Stelis drops its copy of the graph once this pin is live; its registered name `salishsea` then means nothing there.
- The first deploy carries the pin to a Stelis that loads a project by path and the build script that asks it to; they land together, in this one change.
