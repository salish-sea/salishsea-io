#!/usr/bin/env bash
# Fail unless every error in a psql log is one we expect.
#
# Restoring a backup into a database that already has some of its objects — the
# platform roles, the tables a previous pass created — produces "already exists"
# errors that mean nothing. Blanket-tolerating all errors to swallow those is
# how "restore the backup" quietly becomes "run it and see": a role that failed
# to create, or a table that failed for a real reason, would pass unnoticed and
# surface later as something confusing.
#
# psql prefixes each error with `psql:<file>:<line>: `, so an anchored `^ERROR:`
# matches nothing at all. Verified against psql 17.
#
# Usage: only-already-exists.sh <logfile> <label> [extra tolerated substring...]
set -euo pipefail

LOG="$1"
LABEL="$2"
shift 2

PATTERN='already exists'
for extra in "$@"; do
    PATTERN="${PATTERN}|${extra}"
done

# Both greps are guarded, and the first one is the reason this matters: grep
# exits 1 when it matches nothing, and a log with no errors at all matches
# nothing. Under `set -o pipefail` that failure propagates out of the pipeline
# and out of the assignment, so an unguarded version fails hardest on a restore
# that went perfectly. Which is exactly how it first failed.
ERRORS=$({ grep -E '(^|:[0-9]+: )ERROR:' "${LOG}" || true; })
UNEXPECTED=$(printf '%s' "${ERRORS}" | { grep -Ev "${PATTERN}" || true; })

if [ -n "${UNEXPECTED}" ]; then
    echo "::error::${LABEL} failed for a reason other than: ${PATTERN}"
    echo "${UNEXPECTED}"
    exit 1
fi

if [ -z "${ERRORS}" ]; then
    echo "${LABEL}: no errors."
else
    echo "${LABEL}: $(printf '%s\n' "${ERRORS}" | wc -l | tr -d ' ') tolerated error(s), none unexpected."
fi
