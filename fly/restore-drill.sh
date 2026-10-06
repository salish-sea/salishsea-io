#!/usr/bin/env bash
# A restore drill for the store's replica (decision 065, salish-9uu.3.6): restore the
# latest replicated state into a scratch file, never over the store, and compare each
# table with the store's: its row count and a hash of every row, in rowid order, so a
# changed row shows as well as a missing one. Exits non-zero if any differ.
#
#   fly/restore-drill.sh [config] [store]
#
# On the machine, as app, with the store-writer's AWS key in the environment (the
# machine's secrets are, in an ssh session). Writes in the second between the two reads
# can show as a difference; run it again before believing one.
set -euo pipefail
config="${1:-/app/fly/litestream.yml}"
store="${2:-/data/store/salishsea.db}"
restored="$(mktemp -d)/restored.db"
trap 'rm -rf "$(dirname "$restored")"' EXIT

litestream restore -config "$config" -o "$restored" "$store"

counts() {
    # shellcheck disable=SC2016 # the script is JavaScript, its ${…} node's own
    NODE_NO_WARNINGS=1 node -e '
        const {createHash} = require("node:crypto");
        const {DatabaseSync} = require("node:sqlite");
        const db = new DatabaseSync(process.argv[1], {readOnly: true});
        db.exec("BEGIN");  // one read transaction: the tables agree with each other
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all("table").map(t => t.name);
        for (const t of tables) {
            const hash = createHash("sha256");
            let n = 0;
            for (const row of db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).iterate()) {
                hash.update(JSON.stringify(Object.values(row)) + "\n");
                n++;
            }
            console.log(`${t} ${n} ${hash.digest("hex").slice(0, 16)}`);
        }
        db.exec("COMMIT");
    ' "$1"
}

# Each read must succeed, or there is nothing to compare: two failed reads would
# otherwise "agree".
live="$(counts "$store")"
replica="$(counts "$restored")"
if [ "$live" = "$replica" ]; then
    echo "restore drill: the replica's latest state matches the store, table by table:"
    printf '%s\n' "$replica" | sed 's/^/  /'
else
    echo "restore drill: the replica differs from the store (< store, > restored):" >&2
    diff <(printf '%s\n' "$live") <(printf '%s\n' "$replica") >&2 || true
    exit 1
fi
