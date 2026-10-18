# 079 — Dependabot opens security updates only; versions are upgraded in periodic roundups

**Status:** accepted · **Decided:** 2026-10-18, by Peter · **Relates:** [025](025-pnpm-over-npm.md) (pnpm, and Dependabot's `infra/` entry)

## Context

Dependabot opened version-update pull requests every month for three things: the GitHub Actions in our workflows, the site's npm packages, and the separate pnpm project in `infra/`. They piled up faster than they were read. On 2026-10-17 six were open, the oldest five weeks old, and none had been merged. Most bundled several packages, and a single breaking update in a group blocked the rest. #683 grouped 23 updates and failed CI on one of them, `@sentry/browser` 11. #538 had stalled because two of its new packages carry install scripts, and pnpm refuses to install any package whose script hasn't been explicitly allowed or denied.

## Decision

**Dependabot opens pull requests for security updates only.** Every entry in [`.github/dependabot.yml`](../../.github/dependabot.yml) sets `open-pull-requests-limit: 0`, which GitHub documents as the way to turn off version updates for an ecosystem. Security updates aren't affected by that limit: they have a separate, fixed limit of 10 open pull requests, and they are switched on in the repository's security settings, as are Dependabot alerts. The entries stay, so that security updates still find `infra/` and still use the settings there.

Peter's reasons: the version-update pull requests were noise, and upgrading isn't valuable for its own sake. A new version is worth taking when it fixes a vulnerability or a bug that affects us, or gives us something we want. Being current is not a goal in itself.

**Instead, Peter does a dependency roundup now and then, so the project doesn't fall too far behind.** He hasn't settled how often (monthly or quarterly). The roundup on 2026-10-17 and 18 shows the shape of one: take the updates on current `main`; split any major version that needs code changes into its own pull request (#707 and #708, where Sentry 11 changed its options); allow or deny each new install script in `allowBuilds`; and hold back an upgrade the tooling can't take yet, with a Dependabot ignore rule saying why (#711 and #712, where TypeScript 7 no longer includes the JavaScript API that ts-jest and ts-node need).

## Rejected

- **Keeping version updates, grouped and monthly.** That was the arrangement until now, and it produced the backlog described above.
- **Version updates for patch and minor releases only.** Less breakage per pull request, but still a steady stream of pull requests for upgrades that aren't wanted for their own sake.
- **Turning Dependabot off.** We would lose the security pull requests, which are the ones worth having unprompted.

## Consequences

- Between roundups, dependencies age. Other fixes wait for the next roundup unless one is needed sooner.
- Security fixes arrive as pull requests only for packages we depend on directly. For a package that comes in through another one, which is where most alerts land, Dependabot's security update fails with `security_update_not_possible`: on 2026-10-18 all 12 open alerts were of that kind, and none had a pull request. So the open alerts (Security → Dependabot) are part of every roundup, and a high-severity one is worth acting on without waiting. `pnpm update <name>` moves such a package within its parents' ranges in the site's project. In `infra/` it didn't move them, so `infra/pnpm-workspace.yaml` forces them with `overrides`.
- A roundup has more to absorb than a monthly pull request did, so major versions are more likely to arrive together. Splitting out the ones that need code changes keeps them reviewable.
- Raising the limits in `.github/dependabot.yml` brings version updates back, if this proves wrong.
