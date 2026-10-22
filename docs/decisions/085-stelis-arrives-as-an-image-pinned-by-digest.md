# 085 — Stelis arrives as an image pinned by digest, not an install in the Dockerfile

**Status:** accepted · **Decided:** 2026-10-21, by Peter · **Relates:** [084](084-the-image-builds-downloads-come-from-our-own-mirror-first.md) (the mirror, whose open item this closes), [056](056-one-fly-machine.md) (the Fly image), Stelis [ADR 0017](https://github.com/rainhead/stelis/blob/8e70ad68aa990f86e0e05ae77e6358dc37c0cced/docs/adr/0017-stelis-ships-as-an-image-per-commit.md) (the image and what it holds)

## Context

After decision 084 the Fly image build still did Stelis's provisioning itself: it ran Stelis's install script at the pinned commit, which fetched the Racket installer (from our mirror) and the two Racket packages with their dependencies (from Racket's package catalog and GitHub, pinned but not mirrored), then fetched the engine's tarball from GitHub and compiled it. Four hosts for one dependency, two of them outside the mirror, and two minutes of every build. beeatlas's Fly image was about to do the same.

Stelis now builds that once per commit in its own CI ([ADR 0017](https://github.com/rainhead/stelis/blob/8e70ad68aa990f86e0e05ae77e6358dc37c0cced/docs/adr/0017-stelis-ships-as-an-image-per-commit.md), `st-9ov`): `ghcr.io/rainhead/stelis:<commit>` holds Racket at `/opt/racket` and the engine compiled at `/opt/stelis`, with Stelis's test suite run inside the image, as a non-root user on a read-only filesystem, before it is published. That gate found a dependency this image had satisfied by accident: the engine's `sha` package opens libcrypto through Racket's FFI, and the only reason it was here is that the CA store depends on OpenSSL.

## Decision

The Dockerfile takes Stelis from that image. `FROM ghcr.io/rainhead/stelis@<digest> AS stelis`, and the machine stage copies `/opt/racket` and `/opt/stelis` out of it, puts Racket on the PATH, and names `libssl3` among the packages it installs. The install script, the five files it read, the tarball fetch and the compile leave the Dockerfile. What stays is the check that the copied engine loads on this base (Stelis's `preflight.sh`) and the check that the pin carries `--downstream`.

The pin is two files. `fly/stelis-commit` keeps the commit, which is what a release names and what a person reads. `fly/stelis-digest` holds the digest of the image built from it, which is what the build pulls: a tag can be moved, a digest names one set of bytes. `fly/pin-stelis.sh <commit>` writes both, using Stelis's own `scripts/image-digest.sh` from the Stelis checkout on the operator's machine (not a download from the commit being pinned, so nothing runs that a review has not seen), which refuses unless the image the tag names is labelled with that commit. The Dockerfile checks the other direction, `/opt/stelis/commit` against `fly/stelis-commit`, so a digest pasted from the wrong commit fails the build instead of shipping the wrong engine.

`scripts/downloads/mirror.sh` no longer reads Stelis's `racket-downloads.tsv`: nothing here downloads Racket now. The installers already in the bucket stay, unused.

Rejected: `FROM` the Stelis image as the machine's base. The base is this image's choice (Debian 12 with node copied from the node image), and Stelis's image is the same Debian 12 only by coincidence. Copying two trees keeps the two choices apart, at the cost that this base must carry what the trees load, which is glibc, zlib and libcrypto.

## Consequences

- A deploy's dependence on hosts for Stelis is ghcr.io, and nothing else: not Racket's installer mirrors, not its package catalog, not GitHub's tarball endpoint. Decision 084's one unmirrored download is gone rather than mirrored.
- The image build does no Racket install and no compile, so it is a couple of minutes shorter, and runs Racket only once, for the load check. A local `docker build` on an x86_64 host works; on Apple silicon that one check still runs under emulation.
- Moving Stelis is: merge to Stelis's main, wait for its image (a few minutes), run `fly/pin-stelis.sh`, open a PR with the two files. The runbook says so. Moving `fly/stelis-commit` is no longer a reason to run the mirror script.
- The first pin under this decision is Stelis `8e70ad6`, the commit that published the first image.
