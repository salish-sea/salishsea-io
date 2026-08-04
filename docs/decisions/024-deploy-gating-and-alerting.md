# 024 — Deploys gate on the full test suite, verify themselves, and alert by issue

**Status:** accepted · **Decided:** 2026-08-04

## Context

`deploy.yml` fires on push to `main` and, before this decision, ran only `npm run build`
before mutating production. The verification suite — type-drift check, unit tests, infra
tests — lived exclusively in `build.yml` on `pull_request`. Three gaps followed:

- **The merge commit was never tested.** PR checks run against the PR *head*, not the merge
  result. A PR green in isolation can break `main` on merge, and the first thing that happens
  to that merge commit is a production deploy.
- **Nothing required the PR checks anyway.** `main` had no branch protection and no ruleset
  (`gh api repos/salish-sea/salishsea-io/rulesets` returned `[]`). Any push reaching `main` by
  any route deployed with zero test verification.
- **Failure was silent.** `smoke.yml` ran *after* the deploy via `workflow_run` and was gated
  on `github.event.workflow_run.conclusion == 'success'`, so a failed deploy — exactly when
  production is most likely to be half-updated — produced a *skipped* smoke run and no signal
  at all. Two such skips occurred on 2026-08-04. Even a genuine smoke failure only turned a
  separate workflow red; nothing was filed, nothing notified.

The deploy sequence is also unrepeatable and non-atomic: Edge Function → `supabase db push`
→ S3 sync → CloudFront invalidation → `cdk deploy`, with no transaction around it. A
mid-sequence failure leaves the schema ahead of a stale frontend, or a new frontend against
an old edge handler.

## Decision

**One suite, run wherever code can reach production.** `build.yml` gains a `workflow_call`
trigger and `deploy.yml` calls it as a `test` job that the `deploy` job depends on. The gate
is the same workflow PRs run, pointed at the commit actually being deployed, so it covers
merge commits, direct pushes, and re-runs alike — without a second definition to drift.

**Post-deploy verification inside the deploy run.** `smoke.yml` likewise becomes callable and
is invoked as a `smoke` job after `deploy`, replacing the `workflow_run` trigger. A production
that doesn't answer correctly now fails the deploy run itself. It also checks out the deployed
commit rather than whatever the default branch had become by then. The daily schedule and
manual dispatch are unchanged.

**Alerting by labeled issue**, following [003](003-dwc-export-pipeline.md) and
[012](012-ingest-heartbeat.md): a failure opens or updates a single `deploy-failed` issue
naming which job failed and whether production was touched; the next fully green deploy
comments and closes it. One channel for all three of this repo's automated alarms.

**Alerts are suppressed when the run has been superseded *and changed nothing*.** Two merges
in quick succession make the older run fail the `require-current-tip` guard by design
(gotcha 3 in the runbook). That failure is expected and self-correcting, so the alert job
re-asks "is this run's commit still the tip of `main`?" and stays quiet if not — but only
while the run never got past the deploy job's first remote change. The deploy job sets a
`mutation_started` output immediately before that point; once it is set, a failure has left
production in some half-updated state that the newer run behind it is not guaranteed to
repair, and the alert fires regardless of supersession.

## Rejected alternatives

- **Branch ruleset with required checks + merge queue.** A merge queue does test the merge
  result, which is the textbook fix for the first gap. Rejected as the *primary* mechanism
  because it is repo configuration rather than reviewable, reviewed code — invisible in the
  tree, easily lost, and untestable in a PR — and because it leaves the direct-push path
  depending on that same configuration being right. The in-repo gate covers every route on
  its own. A ruleset remains worth adding as defense in depth; it is not load-bearing here.
- **Automatic rollback on smoke failure** (re-sync S3 from the previous artifact and
  invalidate). Rejected: `supabase db push` is forward-only, so reverting the frontend alone
  points old code at an already-migrated schema — frequently worse than the failure being
  rolled back, and worse in a way that is harder to reason about at 2am. Recovery is fix-
  forward, and the alert says so explicitly.
- **Keeping the gate on PRs only and trusting review.** This is what was in place; it is what
  the issue is about.
- **A separate, deploy-specific test workflow.** Two definitions of "verified" drift apart,
  and the cheaper one wins.

## Consequences

- Every deploy costs the suite up front — a few minutes, dominated by `supabase db start`.
  Deploys are serialized (`concurrency: deploy-production`), so that time is also queue time
  for anything merged behind it. Accepted: the sequence it guards cannot be taken back.
- The smoke job runs inside the deploy run and therefore inside the concurrency group, so the
  next deploy waits until this one is verified rather than merely shipped. Intended.
- An open `deploy-failed` issue means a run failed and no green one has followed. It states
  in its own body whether production was touched, because a gate failure and a half-finished
  deploy are the same colour in the Actions tab and very different at 2am.
- A deploy can now fail for a reason production never sees (a test failure), and that failure
  files an issue saying production was untouched. The gate working looks like a red run.
- Smoke checking out the deployed commit is a small loss against one specific hole. The old
  `workflow_run` trigger checked out the default branch, so it incidentally compared
  production against `main` and could notice a deploy that shipped *stale* content (the
  "`main` advances during the deploy" hole in the runbook's gotcha 3). It now verifies what
  this run shipped, which is the question a post-deploy check should answer. The stale case is
  covered instead by the newer run deploying behind it and by the daily scheduled smoke run,
  which still checks out `main`.

## Reference

Issue: `salish-ior`. Workflows: [`deploy.yml`](../../.github/workflows/deploy.yml),
[`build.yml`](../../.github/workflows/build.yml), [`smoke.yml`](../../.github/workflows/smoke.yml).
Alert-channel precedent: [`dwca-nightly.yml`](../../.github/workflows/dwca-nightly.yml).
Superseded-commit guard: [`require-current-tip`](../../.github/actions/require-current-tip/action.yml),
[runbook gotcha 3](../runbook/deploys.md).
