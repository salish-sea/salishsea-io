#!/usr/bin/env bash
# One read-path build: snapshot the database, rewrite the files that changed.
# Arguments go to Stelis, which is how the write API's build after a save is scoped
# to the store and what derives from it (--downstream snapshot, salish-9uu.6): the
# three ingests have their five-minute schedule, and a save should not wait on them.
#
# Under a lock, because the build assumes one writer: the day files are swapped
# into place with two renames, and two builds interleaving would each move the
# other's directory. A build that finds the lock held skips rather than queues,
# and exits 75 (EX_TEMPFAIL) to say so: the write API's coalescer (api/server.ts)
# retries on that, while the five-minute schedule simply leaves it for the next run.
set -euo pipefail

mkdir -p "$STELIS_STATE_DIR" "$READ_PATH_EXPORT_DIR"
exec 9> /data/build.lock
if ! flock -n 9; then
    echo "read-path build: another build holds the lock; skipping this one"
    exit 75
fi

cd /opt/stelis
exec racket src/main.rkt --project salishsea --build --all --export-dir "$READ_PATH_EXPORT_DIR" "$@"
