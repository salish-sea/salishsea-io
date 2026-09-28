# syntax=docker/dockerfile:1
#
# The salishsea-io Fly app (decision 056, salish-t3g.3): one machine that serves
# the site built to read static files, and rebuilds those files hourly with
# Stelis. The shape is beeatlas's ADR 0042: one machine, one volume.
#
# Build args (fly/deploy.sh passes them):
#   VITE_SUPABASE_URL, VITE_SUPABASE_WS_URL, VITE_SUPABASE_KEY  the public client
#       config the site is built with, exactly as the AWS deploy's; the key is the
#       publishable one every browser already receives (decision 002)
#   GITHUB_SHA         the commit, for the release a feedback report names (039)
#   SOURCE_DATE_EPOCH  that commit's time: Stelis's build clock (its ADR 0004),
#       which it would otherwise read from git, and the image carries no .git
#   STELIS_SHA         the Stelis commit this image pins

ARG NODE_VERSION=24.13

# --- the site, built to read the read-path files -----------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS site
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_WS_URL
ARG VITE_SUPABASE_KEY
ARG GITHUB_SHA
ENV VITE_READ_SOURCE=static
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_KEY" \
 && VITE_SUPABASE_URL="$VITE_SUPABASE_URL" VITE_SUPABASE_WS_URL="$VITE_SUPABASE_WS_URL" \
    VITE_SUPABASE_KEY="$VITE_SUPABASE_KEY" GITHUB_SHA="$GITHUB_SHA" pnpm build

# --- the machine --------------------------------------------------------------
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip util-linux \
 && rm -rf /var/lib/apt/lists/*

# node, the same version the site was built with; the read-path scripts run on it.
COPY --from=site /usr/local/bin/node /usr/local/bin/node

# Racket 9.3 CS (Stelis's racket-version), minimal, plus the two collections in
# Stelis's racket-deps.txt. The URL is an alias of the buster build, whose
# published SHA256 this is. --no-docs: datalog's dependencies carry
# documentation whose build needs SQLite, and the engine never reads it.
RUN curl -fsSL -o /tmp/racket.sh \
      https://download.racket-lang.org/installers/9.3/racket-minimal-9.3-x86_64-linux-cs.sh \
 && echo "7a1cc4b14a746add95eec2e549df54e5154b7dc94938a86330ce6a02ec7f75ce  /tmp/racket.sh" | sha256sum -c - \
 && sh /tmp/racket.sh --unix-style --dest /usr/local --create-dir \
 && rm /tmp/racket.sh \
 && raco pkg install --auto --batch --no-docs --scope installation datalog sha

# The DuckDB CLI Stelis content-addresses relations with, pinned as in its CI.
RUN curl -fsSL -o /tmp/duckdb.zip \
      https://github.com/duckdb/duckdb/releases/download/v1.5.5/duckdb_cli-linux-amd64.zip \
 && echo "08c0ca117111fcede14239d0093792352befdc174218c344d232c13279643d05  /tmp/duckdb.zip" | sha256sum -c - \
 && unzip -q /tmp/duckdb.zip -d /usr/local/bin && rm /tmp/duckdb.zip

# Caddy serves the site and the files; supercronic runs the hourly build.
RUN curl -fsSL -o /tmp/caddy.tgz \
      https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_linux_amd64.tar.gz \
 && echo "527fbf917c39189a1e3b31d34fa955601680b2d5c8055d2a87b8b9588dec7bb9  /tmp/caddy.tgz" | sha256sum -c - \
 && tar -xzf /tmp/caddy.tgz -C /usr/local/bin caddy && rm /tmp/caddy.tgz
RUN curl -fsSL -o /usr/local/bin/supercronic \
      https://github.com/aptible/supercronic/releases/download/v0.2.49/supercronic-linux-amd64 \
 && echo "a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1  /usr/local/bin/supercronic" | sha256sum -c - \
 && chmod +x /usr/local/bin/supercronic

# Stelis, pinned. A change spanning both repos ships only when this pin moves,
# which makes it atomic rather than coincidental (beeatlas ADR 0042).
ARG STELIS_SHA
RUN test -n "$STELIS_SHA" \
 && curl -fsSL "https://github.com/rainhead/stelis/archive/${STELIS_SHA}.tar.gz" | tar -xz -C /opt \
 && mv "/opt/stelis-${STELIS_SHA}" /opt/stelis \
 && bash /opt/stelis/scripts/preflight.sh \
 && raco make /opt/stelis/src/main.rkt

# The salishsea checkout the Stelis graph points at: its scripts, pins and
# dependencies, and the built site.
COPY --from=site /app /app
# The Postgres extension the snapshot attaches through, fetched now rather than
# on the first build after every restart.
RUN cd /app && node --input-type=module -e "import {DuckDBInstance} from '@duckdb/node-api'; const c = await (await DuckDBInstance.create(':memory:')).connect(); await c.run('INSTALL postgres');"

ARG SOURCE_DATE_EPOCH
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH} \
    SALISHSEA_DIR=/app \
    STELIS_STATE_DIR=/data/stelis \
    SALISHSEA_SNAPSHOT_DB=/data/read-path.duckdb \
    READ_PATH_EXPORT_DIR=/data/export

EXPOSE 8080
CMD ["/app/fly/start.sh"]
