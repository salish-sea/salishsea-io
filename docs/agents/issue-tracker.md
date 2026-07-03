# Issue tracker: GitHub (customer-facing) + beads (everything else)

Two trackers, routed by audience:

- **GitHub Issues** (`gh`) — customer-facing feature communication. Anything meant
  to be seen by, discussed with, or picked up by the customer/community: PRDs,
  feature requests, inbound bug reports, and triage of those reports.
- **beads** (`bd`) — everything else. Internal implementation work: breaking
  features into build tasks, in-flight work, bugs found while building,
  discovered/follow-up work, sequencing. Beads is local-only (issues live in a
  Dolt DB and do not travel with git).

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

## When a skill says "publish to the issue tracker"

- A PRD or customer-facing feature → GitHub issue (`gh issue create`).
- Internal implementation tickets / a plan split into build tasks → beads (`bd create`).

## When a skill says "fetch the relevant ticket"

- A GitHub number (e.g. #250) → `gh issue view <number> --comments`.
- A beads id (e.g. `salishsea-io-i5u`) → `bd show <id>`.
