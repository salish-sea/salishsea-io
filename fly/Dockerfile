# syntax=docker/dockerfile:1
#
# The salishsea-io Fly app (decision 056, salish-t3g.3): one machine that serves
# the site built to read static files, and rebuilds those files every five minutes with
# Stelis. The shape is beeatlas's ADR 0042: one machine, one volume.
#
# Build args (fly/deploy.sh passes them):
#   GITHUB_SHA         the commit, for the release a feedback report names (039) and
#       the one Sentry's source maps are uploaded under
#
# Build secret: SENTRY_AUTH_TOKEN, optional (see the site stage).
#   SOURCE_DATE_EPOCH  that commit's time: Stelis's build clock (its ADR 0004),
#       which it would otherwise read from git, and the image carries no .git
#   STELIS_SHA         the Stelis commit this image pins, from fly/stelis-commit
#   STELIS_IMAGE       the Stelis image built from that commit, by digest, from
#       fly/stelis-digest (fly/pin-stelis.sh writes both files)

ARG NODE_VERSION=24.13

# --- Stelis, the image its own CI built from the pinned commit ----------------
# Racket at /opt/racket and the engine compiled at /opt/stelis, with its test suite
# run inside the image before it was published (Stelis ADR 0017, decision 085). The
# machine stage copies those two trees out; nothing Stelis needs is downloaded or
# compiled here any more.
# The default is a tag that does not exist, so a build that forgot the arg fails
# naming it rather than pulling some other Stelis.
ARG STELIS_IMAGE=ghcr.io/rainhead/stelis:set-STELIS_IMAGE-from-fly-stelis-digest
FROM ${STELIS_IMAGE} AS stelis

# --- the site, built to read the read-path files -----------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS site
# The slim image has no CA store. Node carries its own, so installs work without one,
# but sentry-cli, which uploads the source maps, is a native binary that reads the
# system's, and without it every upload fails its TLS handshake.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG GITHUB_SHA
# Sentry's token, if fly/deploy.sh was given one, as a build secret: the Sentry plugin
# uploads this bundle's source maps, the bundle production runs. Without it, no upload.
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    if [ -s /run/secrets/SENTRY_AUTH_TOKEN ]; then SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN)"; export SENTRY_AUTH_TOKEN; fi \
 && GITHUB_SHA="$GITHUB_SHA" pnpm build

# --- the machine --------------------------------------------------------------
FROM debian:bookworm-slim
# libssl3 is what the Stelis trees ask of this base: the engine's sha package opens
# libcrypto through Racket's FFI (Stelis ADR 0017). The CA store pulls it in anyway;
# naming it keeps that from being an accident.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl libssl3 unzip util-linux \
 && rm -rf /var/lib/apt/lists/*

# node, the same version the site was built with; the read-path scripts run on it.
COPY --from=site /usr/local/bin/node /usr/local/bin/node

# Stelis, pinned: the two trees out of the image its own CI built from the commit in
# fly/stelis-commit, named by digest (fly/stelis-digest). A change spanning both
# repos ships only when the pin moves, which makes it atomic rather than
# coincidental (beeatlas ADR 0042). The pin is checked both ways: fly/pin-stelis.sh
# refused a digest whose image is not labelled with the commit, and here the image
# must carry the commit it was pinned as, so a digest pasted from the wrong commit
# fails the build rather than running the wrong engine. preflight.sh proves the
# copied Racket loads the engine on this base, and the last step checks the pin
# carries --downstream (Stelis f364281, st-wzk), which the save-triggered build
# passes (fly/start.sh, salish-9uu.6): an older pin would refuse it on every save,
# and the coalescer only logs that, so the image fails instead.
ARG STELIS_SHA
COPY --from=stelis /opt/racket /opt/racket
COPY --from=stelis /opt/stelis /opt/stelis
ENV PATH=/opt/racket/bin:$PATH
RUN test -n "$STELIS_SHA" \
 && { test "$(cat /opt/stelis/commit)" = "$STELIS_SHA" \
      || { echo "fly/stelis-digest names a Stelis image built from $(cat /opt/stelis/commit), not fly/stelis-commit's $STELIS_SHA; run fly/pin-stelis.sh" >&2; exit 1; }; } \
 && bash /opt/stelis/scripts/preflight.sh \
 && (racket /opt/stelis/src/main.rkt --help 2>&1 | grep -q -- '--downstream' \
     || { echo "Stelis ${STELIS_SHA} predates --downstream, which the save-triggered build needs (salish-9uu.6)" >&2; exit 1; })

# Every binary below is pinned by sha256 in fly/downloads.tsv and fetched by
# fly/fetch.sh from our own mirror first (salishsea.io/downloads/<sha256>, decision
# 084), then upstream, and only a file matching the checksum counts. So an upstream
# host being down or distrusted (#727: Racket's host redirected to a mirror whose
# certificate Debian doesn't trust) is not a failed deploy, and no host can change
# what is installed.
COPY fly/fetch.sh fly/downloads.tsv /tmp/fetch/

# The DuckDB CLI Stelis content-addresses relations with, pinned as in its CI.
RUN /tmp/fetch/fetch.sh duckdb /tmp/duckdb.zip \
 && unzip -q /tmp/duckdb.zip -d /usr/local/bin && rm /tmp/duckdb.zip

# Caddy serves the site and the files; supercronic runs the build every five minutes;
# Litestream replicates the write API's store to S3 (decision 065).
RUN /tmp/fetch/fetch.sh caddy /tmp/caddy.tgz \
 && tar -xzf /tmp/caddy.tgz -C /usr/local/bin caddy && rm /tmp/caddy.tgz
RUN /tmp/fetch/fetch.sh litestream /tmp/litestream.tgz \
 && tar -xzf /tmp/litestream.tgz -C /usr/local/bin litestream && rm /tmp/litestream.tgz
RUN /tmp/fetch/fetch.sh supercronic /usr/local/bin/supercronic \
 && chmod +x /usr/local/bin/supercronic

# Everything runs as `app`; start.sh drops to it after taking ownership of the
# volume, which Fly mounts owned by root.
RUN useradd --create-home --uid 1000 app
ENV HOME=/home/app

# The salishsea checkout the Stelis graph points at: its scripts, pins and
# dependencies, and the built site.
COPY --from=site /app /app
# The DuckDB extensions the build loads, fetched now (into app's home, where DuckDB
# looks) rather than on the first build after every restart.
USER app
RUN cd /app && node --input-type=module -e "import {DuckDBInstance} from '@duckdb/node-api'; const c = await (await DuckDBInstance.create(':memory:')).connect(); for (const e of ['sqlite', 'icu', 'spatial']) await c.run('INSTALL ' + e);"
USER root

ARG SOURCE_DATE_EPOCH
# SENTRY_CRONS: the scheduled build's check-in (fly/build.sh), under the site's own Sentry
# project. Its key is the DSN's public one, in every browser already (src/sentry.ts), so a
# check-in proves nothing about who sent it: anyone could post an ok and mask a stall, as
# anyone can post an error event. Accepted (decision 012, amended): it guards against the
# build failing, not against someone hiding that it has.
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH} \
    SALISHSEA_DIR=/app \
    STELIS_STATE_DIR=/data/stelis \
    SALISHSEA_SNAPSHOT_DB=/data/read-path.duckdb \
    READ_PATH_EXPORT_DIR=/data/export \
    SENTRY_CRONS=https://o4509634382331904.ingest.us.sentry.io/api/4509634387509248/cron/read-path-build/56ce99ce80994bab79dab62d06078c97/

EXPOSE 8080
CMD ["/app/fly/start.sh"]
