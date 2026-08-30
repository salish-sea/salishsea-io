# Issue tracker: GitHub (customer-facing) + beads (everything else)

Two trackers, routed by audience:

- **GitHub Issues** (`gh`) — customer-facing feature communication. Anything meant
  to be seen by, discussed with, or picked up by the customer/community: PRDs,
  feature requests, inbound bug reports, and triage of those reports.
- **beads** (`bd`) — everything else. Internal implementation work: breaking
  features into build tasks, in-flight work, bugs found while building,
  discovered/follow-up work, sequencing. Issues live in a **local Dolt database**
  (`.beads/embeddeddolt/`, gitignored) and travel over the git remote under a
  dedicated ref, `refs/dolt/data` — *not* as files in the working tree. Only bd's
  config and hooks are tracked as ordinary files; see
  [.beads/.gitignore](../../.beads/.gitignore) for what is deliberately excluded.

  The consequence that bites: **nothing reaches anyone else until `bd dolt push`
  runs.** A `git push` does not carry issues, and a session that closes without
  the bd push leaves them on one laptop. This has happened before, under the
  older JSONL-export layout, for the same underlying reason.

  JSONL is not the interchange format — so do not expect an issue to reach
  anyone through a diff or a code review. Two JSONL artefacts exist, and they
  are not the same thing: `.beads/backup/` holds bd's own `.darc` snapshots and
  is gitignored, while `.beads/issues.jsonl` **is tracked**, deliberately, as
  the recovery floor beneath the Dolt DB. `bd import` rebuilds the issues from
  it; Dolt's history does not survive that round trip.

  It is kept current by an export step in
  [`.beads/hooks/pre-commit`](../../.beads/hooks/pre-commit), added below bd's
  managed markers after bd's own auto-export was found to have stopped on
  2026-08-04 and gone unnoticed for three weeks (salish-ck8). If you export by
  hand, `bd export` writes to **stdout** — it must be `bd export -o
  .beads/issues.jsonl`, or the file silently stays stale.

**Issue ids are `salish-<suffix>`** (e.g. `salish-g9e`). They were
`salishsea-io-<suffix>` until 2026-07-27; the suffix never changed, so an old id
in a commit message or an archived PR maps to the current one by swapping the
prefix. Commit history and merged PRs still carry the old form.

The rule: **if it's communicating with the customer about a feature, it's GitHub;
if it's how we build and track the work, it's beads.**

## GitHub (via `gh`)

- Create: `gh issue create --title "..." --body "..."` (heredoc for multi-line)
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
- Comment: `gh issue comment <number> --body "..."`
- Label: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

`gh` infers the repo from `git remote -v` automatically inside a clone.

## beads (via `bd`)

- Create: `bd create "title" -t <bug|task|feature|epic> -p <0-3> -d "..."`
- Frontier: `bd ready` · Show: `bd show <id>` · List: `bd list --status open --json`
- Update/close: `bd update <id> --status <state>` · `bd close <id> --reason "..."`
- Link/provenance: `bd dep add <blocked> <blocker>` · `--deps discovered-from:<id>`
- Sync: `bd dolt push` · `bd dolt pull` — publish/fetch via `refs/dolt/data` on
  the git remote. Required before a session ends; `git push` does not carry issues.

## When a skill says "publish to the issue tracker"

- A PRD or customer-facing feature → GitHub issue (`gh issue create`).
- Internal implementation tickets / a plan split into build tasks → beads (`bd create`).

## When a skill says "fetch the relevant ticket"

- A GitHub number (e.g. #250) → `gh issue view <number> --comments`.
- A beads id (e.g. `salish-i5u`) → `bd show <id>`.
