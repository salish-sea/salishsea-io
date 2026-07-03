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

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

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
npm run dev          # vite dev server
npm test             # vitest
npm run build        # tsc + vite build + html-validate + CSP hash check
npm run build:dwca   # build the DarwinCore Archive locally (tsx scripts/dwca/build.ts)
npm run gen-types    # regenerate database.types.ts from local Supabase
npx playwright test  # e2e
```

Node version is pinned in `.nvmrc`. The DwC-A build's CI gate needs the Supabase local stack (not bare Postgres) — see [decision 003](docs/decisions/003-dwc-export-pipeline.md).

## Architecture Overview

Static SPA (Lit web components + Vite + TypeScript, OpenLayers maps) on AWS S3/CloudFront, Supabase backend (Postgres + auth + storage), AWS CDK infra in `infra/`, deployed by GitHub Actions on push to `main`. A Lambda@Edge function serves OG meta tags to crawlers for rich link previews (fail-open; `/dwca/*` carved out). A nightly workflow regenerates the DarwinCore Archive from the read-only `dwc` Postgres schema. Details: [docs/decisions/](docs/decisions/), [docs/data-provenance.md](docs/data-provenance.md).

## Conventions & Patterns

- Coordinates: decimal lon/lat WGS84, map projection EPSG:3857. Time: UNIX epoch seconds.
- URL state: `d` (date), `x/y/z` (map), `o` (occurrence).
- Migrations: SELECT grants ship in the same migration that creates a table (Supabase RLS defaults silently zero out joins otherwise).
- `maplify.sightings.comments` is immutable — parse at read time, never UPDATE it.
- Keep the project "light, nimble, and maintainable, minimizing abstractions and volatile dependencies" (README).
- Engineering lessons from past milestones: [docs/engineering-lessons.md](docs/engineering-lessons.md).
