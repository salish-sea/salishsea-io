# 025 — pnpm replaces npm as the package manager

**Status:** accepted · **Decided:** 2026-08-04

## Context

`npm ci` broke `main` twice on 2026-08-04, and the same failure mode had bitten the project
before. The mechanism is worth stating precisely, because it is not a mistake anyone made —
it is npm behaving as designed.

`package-lock.json` is meant to be host-independent: one file, committed once, reproducing
the same tree on a laptop and on a linux runner. But `npm install` writes the lockfile from
the tree it just built *for the current host*, and it prunes optional dependencies that do
not apply to that host. Packages reachable only through a platform-specific optional
dependency therefore vanish from the lockfile when the lockfile is regenerated on macOS.

Concretely: `@napi-rs/wasm-runtime` declares `@emnapi/core` and `@emnapi/runtime` as ordinary
dependencies. Both are reachable in this tree only via `@rolldown/binding-wasm32-wasi`, an
optional dependency that a darwin/arm64 install skips. Regenerating the lock on a Mac dropped
them; linux CI then computed an ideal tree that wanted `@emnapi/core@1.11.3`, found nothing
in the lock, and failed with `EUSAGE`. The second attempted fix re-added them *nested* under
`@rolldown/binding-wasm32-wasi`, which does not satisfy `@napi-rs/wasm-runtime`'s own
requirement at the tree root, so CI failed identically. This is
[npm/cli#4828](https://github.com/npm/cli/issues/4828), open since 2022.

The workaround — always regenerate with `npm install --package-lock-only --os=linux --cpu=x64`
— works, but it is an unwritten rule enforced by nothing, and every Dependabot PR and every
casual `npm install` is another chance to forget it. The failure is silent locally and only
appears in CI, on `main`, where this repo deploys straight to production.

## Decision

**pnpm is the package manager for this repo, at the root and in `infra/`.** `pnpm-lock.yaml`
records every platform variant unconditionally, so a lockfile written on macOS resolves
identically on linux. The failure mode cannot occur, rather than being avoided by discipline.

Specifics:

- **`packageManager: pnpm@11.20.0`** in `package.json`. `pnpm/action-setup` reads it, so CI
  and laptops run the same pnpm without a version pinned in six workflow files.
- **`pnpm install --frozen-lockfile`** replaces `npm ci` everywhere. It is the same contract:
  fail rather than silently rewrite the lockfile.
- **`infra/` stays a separate project, not a workspace member.** It has a different TypeScript
  major, a CDK-only graph, and its own deploy step. pnpm finds a workspace root by walking up
  for `pnpm-workspace.yaml`, so `infra/` needs one of its own — without it the root file claims
  the directory and `pnpm install` there reports "Already up to date" having installed nothing,
  which surfaces only at `cdk deploy`.
- **Install scripts are allowlisted** in `pnpm-workspace.yaml` (`allowBuilds`). pnpm refuses to
  run a dependency's install script unless it is named, so a compromised transitive package
  cannot execute code merely by entering the tree. Two are allowed, each with its reason in the
  file: `esbuild` and `@sentry/cli` fetch binaries the build genuinely needs. `exifreader` is
  listed as an explicit *deny* rather than omitted, because pnpm requires every package with a
  build script to be adjudicated either way — an unlisted one is `ERR_PNPM_IGNORED_BUILDS` and
  exit 1, which would fail `--frozen-lockfile` in every workflow. Adding a dependency that ships
  an install script will therefore break CI until it is named here, which is the intended
  friction: the decision to let a package run code at install time should be explicit.
- **`infra/scripts/bundle-card-renderer.mjs` keeps shelling out to `npm`.** Lambda unzips a
  deployment package and resolves modules from it directly, so it needs the flat `node_modules`
  npm produces; pnpm's symlinks into a content-addressed store would dangle. npm also takes the
  target platform as CLI flags, which is what that script needs. It installs one package into an
  ignored scratch directory from a `package.json` it writes itself — it never touches this
  project's dependency resolution.

`package-lock.json` is deleted at both levels. Keeping one would let `npm install` succeed and
reintroduce exactly the drift this decision removes.

## Consequences

`node_modules` is no longer flat. Anything relying on an undeclared transitive dependency — a
"phantom dependency" — now fails at resolution instead of working by accident. Nothing in this
repo did; the full suite (356 root tests, 155 infra tests), a production build, and the CDK
bundle all pass unchanged. Future breakage of this kind is a real missing dependency, and the
fix is to declare it.

Dependabot needs no configuration change: its `npm` ecosystem covers pnpm, and the lockfile
format it reads is version 9, which is what pnpm 11 writes. Its support for the pnpm 11 CLI
itself is newer, so the first update cycle after this lands is worth confirming — a Dependabot
that cannot resolve the project goes quiet rather than failing loudly, and quiet is
indistinguishable from "nothing to update". As before, it covers the root only; `infra/` is not
tracked by Dependabot.

Contributors must have pnpm; `npm install` in this repo is now a mistake rather than a slower
path to the same place. The README states it as a prerequisite.

## Alternatives rejected

**Stay on npm and enforce the flags.** A `--package-lock-only --os=linux --cpu=x64` convention,
or a CI check that re-resolves the lockfile and diffs. This is the status quo plus vigilance,
and vigilance is what already failed twice in one day. A CI check would catch the breakage one
step earlier without preventing it.

**Yarn Berry.** Well maintained and immune to the same bug. Its distinguishing feature is Plug'n'Play,
which fights Vite and the OpenLayers/Lit toolchain; setting `nodeLinker: node-modules` to avoid
that forfeits the reason to choose it over pnpm.

**Bun.** Fastest, and `bun install` is close to drop-in. But it adds a second JavaScript runtime
to the CI surface for a dependency-resolution problem, which cuts against the project's stated
constraint of staying "light, nimble, and maintainable, minimizing abstractions and volatile
dependencies."

**Make `infra/` a workspace package.** Tempting — one lockfile, one install. It would put the
CDK graph into the deploy job's root install and couple two projects that are deployed by
different steps and share no code, for no benefit beyond tidiness.
