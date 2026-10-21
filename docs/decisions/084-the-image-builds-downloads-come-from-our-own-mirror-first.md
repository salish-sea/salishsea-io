# 084 — The image build's downloads come from our own mirror first

**Status:** accepted · **Decided:** 2026-10-21, by Peter · **Relates:** [056](056-one-fly-machine.md) (the Fly image), [#727](https://github.com/salish-sea/salishsea-io/pull/727) (the outage this answers), Stelis `st-8u3` (its Racket packages pinned the same way)

## Context

Every deploy between 2026-10-21 03:05 UTC and the fix in #727 failed while building the Fly image, because `download.racket-lang.org` redirected to a mirror whose new certificate chains to roots Debian doesn't trust. Nothing in this repository had changed. #727 added two more of Racket's mirrors to try, which is two more hosts we don't run.

The image downloads five binaries at build time, each pinned by sha256: Racket, the DuckDB CLI, Caddy, Litestream and supercronic. The checksum already decides what is installed; what the build still depended on was each upstream host being up, reachable from Fly's builder, and trusted by the image's CA store, on the morning of a deploy. Stelis's two Racket packages were worse off, fetched from the package catalog with no checksum at all, which Stelis fixed by pinning them to a commit (`st-8u3`).

Peter asked for a mirror we own, the way Nix and Bazel keep fixed-output fetches.

## Decision

A bucket of ours, `salishsea-io-downloads`, holds every file the image build downloads, under `downloads/<sha256>`. CloudFront serves it at `salishsea.io/downloads/<sha256>` through origin access control, as it serves photos at `/media/*`: private bucket, public URL, no credentials in the image build.

`fly/downloads.tsv` lists each file by name, sha256 and upstream URLs, and `fly/fetch.sh` fetches one by name: the mirror first, then each upstream, taking the first whose bytes match the sha256 and failing only when none does. The Dockerfile's five `curl` blocks become five `fetch.sh` lines. `scripts/downloads/mirror.sh`, run by a person with the AWS profile, fetches each file upstream, checks it, and uploads it; a file the bucket already holds is skipped, because a key is its content and there is never anything to update.

The order matters for what a failure means. A mirror miss falls through to upstream, so the mirror can be filled after a pin moves, or after this ships; until then the build is what it was. A checksum mismatch anywhere is skipped, not fatal, so a host serving the wrong file costs a retry, not a deploy.

Racket is the one of the five that is not ours to pin: it is the engine's interpreter, and the same day Stelis took over installing it (`st-2t1`: its `scripts/install-racket.sh`, with the build pinned in its `racket-downloads.tsv`, the same format as ours). The Dockerfile runs that script at the pinned Stelis commit with this mirror first, so `racket` left `fly/downloads.tsv`, and `mirror.sh` reads Stelis's file at that commit to keep the bucket holding the Racket it installs. One download that script makes is outside the mirror: the two Racket packages and their dependencies, pinned (`datalog` by the 9.3 release catalog's checksum, `sha` by git commit) but fetched from Racket's package host and GitHub on every image build. Mirroring those means mirroring a package catalog, which a Stelis image built once per Stelis commit (its `st-9ov`) makes unnecessary, so that is where it goes rather than here.

Not mirrored: the Stelis tarball, which GitHub serves by commit and which the deploy already depends on GitHub for; and DuckDB's extensions, which the Dockerfile installs at build time through DuckDB's own `INSTALL` from `extensions.duckdb.org`. Those are the next candidates if either host fails the way Racket's did.

## Consequences

- A deploy depends on our bucket and CloudFront, which the site already depends on, and on upstream hosts only for a file the bucket lacks.
- The sha256 in the TSV is the only thing that decides what is installed. Neither the mirror nor any upstream can change it.
- Moving a pin is a change to the TSV, then `scripts/downloads/mirror.sh`, then a deploy. The runbook says so.
- Stelis's Racket packages install from the sources its own `racket-deps.txt` pins, read from the pinned checkout rather than copied here, so moving that pin is Stelis's change alone.
