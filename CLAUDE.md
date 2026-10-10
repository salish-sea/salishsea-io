# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote (`bd dolt push` — `git push` does not carry issues); `.beads/issues.jsonl` is a tracked export — the recovery floor beneath the Dolt DB, not the issue store — kept current by `.beads/hooks/pre-commit`. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md). See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Product Memory

Durable knowledge lives in three places. Keep them current — this is not optional bookkeeping; it is the product's memory.

- **[PRODUCT.md](PRODUCT.md)** — what this is, for whom, requirements and their rationale, constraints, out-of-scope. Update when scope or requirements change.
- **[CONTEXT.md](CONTEXT.md)** — the domain glossary. Use its terms exactly (provider ≠ collection; occurrence, segment, aggregator pattern, SRC-01…). Update when a term is coined or sharpened.
- **[docs/decisions/](docs/decisions/)** — numbered decision records with rationale and rejected alternatives. **When a product or technical decision is made in conversation, write the record before moving on.** Mark superseded records; don't delete them. Rights/licensing questions: [docs/rights-policy.md](docs/rights-policy.md) is authoritative.

Division of labor with beads: decisions and their *why* go in docs (permanent, searchable); bd issues track work in flight and *reference* decisions by filename. Don't bury rationale in issue notes.

## Agent skills

Config the engineering skills (`triage`, `to-issues`, `to-prd`, `grill-with-docs`, `improve-codebase-architecture`, …) read from.

### Issue tracker

GitHub Issues (`gh`) for customer-facing feature communication; beads (`bd`) for implementation and in-flight work. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Five canonical triage roles mapped to GitHub labels (`needs-info` → `question`, the rest 1:1). See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context: `CONTEXT.md` + `docs/decisions/` at the repo root. See [docs/agents/domain.md](docs/agents/domain.md).

## Build & Test

```bash
pnpm install         # install deps (NOT npm — see decision 025)
pnpm dev             # vite dev server
pnpm test            # vitest; needs no database
pnpm build           # tsc + vite build + html-validate + CSP hash check
pnpm exec playwright test  # e2e
READ_PATH_DIR=/path/to/export pnpm dev  # the site reads a read-path build's files (decision 056); without it the map has nothing to show
```

Node version is pinned in `.nvmrc`. The derivations' tests compare against answers Postgres gave once, saved in [`scripts/read-path/fixtures/twins/`](scripts/read-path/fixtures/twins/README.md); when a derivation changes on purpose, the expected rows change with it, as a reviewed edit.

## Parallel agents

**More than one agent at a time means one worktree each.** Sharing a working directory is how uncommitted work gets swept into someone else's commit — on 2026-08-13 a decision record's index row and forward pointer landed in an unrelated PR while the record itself, being untracked, stayed behind, leaving two dangling links on `main`.

Use `bd worktree create <name>`, not `git worktree add` — it shares the main repo's beads database via git's common directory, so the issue tracker stays single. Then, before working:

- **`pnpm install` in the worktree, and again in `infra/`** — a separate pnpm project with its own lockfile. Cheap: pnpm's global store hardlinks rather than copies.

One rule survives the isolation, because worktrees separate files and nothing else:

- **Commit a new file as soon as it exists**, even as a stub. In a shared directory, a tracked file's edits get swept up by another agent's `git add -A` while an untracked file doesn't, which is precisely how the two halves of a change separate. In a worktree the risk inverts rather than disappears: nothing else can touch your files, and uncommitted work is discarded outright when the worktree is cleaned up.

## Architecture Overview

Static SPA (Lit web components + Vite + TypeScript, OpenLayers maps). Since 2026-10-03 the site people see is served by the `salishsea-io` Fly app (Caddy + a small redirect server, `fly/`), behind CloudFront, which keeps only `/cards/*` (the preview-card renderer Lambda) (decision 061, `salish-xv35.16`). On that machine the read-path build — Stelis, a build system Peter maintains ([github.com/rainhead/stelis](https://github.com/rainhead/stelis); the graph is `src/salishsea.rkt` there) — runs every five minutes: it fetches Maplify, iNaturalist and Orcasound itself into SQLite mirrors on the volume, fetches the register's newest release, snapshots the write API's store, derives the occurrences, identifier candidates and profile links in DuckDB, and writes the day files, calendar, id index, prerendered profile pages and the Darwin Core archive (decisions 056, 057, 061, 064). What users write — native sightings, feedback, the Google sign-in that owns them — goes to a small write API on the same machine (`api/`), kept in a SQLite store on the volume and replicated by Litestream; photos go to S3 (decision 065). The catalogue is checked-in data under `data/` (decision 064). A signed-in tab reads the files with its own sightings overlaid from the API. Supabase is retired (`salish-9uu`): nothing reads or writes it, and its final dump is in the backups bucket. AWS CDK infra in `infra/` and the Fly app (`fly/deploy.sh`, Stelis pinned in `fly/stelis-commit`) are both deployed by GitHub Actions on push to `main` ([runbook](docs/runbook/deploys.md)); what runs there, where its state lives and how to operate it: [docs/runbook/read-path-build.md](docs/runbook/read-path-build.md). A Lambda@Edge function serves OG meta tags to crawlers on the map page only (fail-open; decision 015's rewrite of profile paths retired with the move to Fly, which prerenders them and answers designation `301`s itself). The Darwin Core archive is written by that build and served by the Fly app too; the nightly workflow that built it from Postgres is retired (decision 003, amended). Details: [docs/decisions/](docs/decisions/), [docs/data-provenance.md](docs/data-provenance.md).

## Conventions & Patterns

- Coordinates: decimal lon/lat WGS84, map projection EPSG:3857. Time: UNIX epoch seconds.
- URL state: `d` (date), `x/y/z` (map), `o` (occurrence); profile pages at `/individuals/<7-digit register id>/<designation slug>`, `/matrilines/<id>/<slug>`, `/populations/<id>/<slug>` (a population's top page, an ecotype's or a community's; `/ecotypes/…` `301`s there, decision 070) and `/pods/<id>/<slug>` (a Southern Resident pod, 070) — the slug is never read; a legacy `/<family>/<designation>` path is looked up once and `301`s to that form (decision 034).
- Postgres is retired (`salish-9uu.14`): its migrations were deleted with it. A comment citing `supabase/migrations/<file>@6898775` means `git show 6898775:supabase/migrations/<file>`; its final dump is `s3://salishsea-io-backups/final/postgres-2026-10-09/`.
- `maplify.sightings.comments` is immutable — parse at read time, never UPDATE it.
- Keep the project "light, nimble, and maintainable, minimizing abstractions and volatile dependencies" (README).
- Engineering lessons from past milestones: [docs/engineering-lessons.md](docs/engineering-lessons.md).
