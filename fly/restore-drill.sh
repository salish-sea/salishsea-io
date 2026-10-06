#!/usr/bin/env bash
# A restore drill for the store's replica (decision 065, salish-9uu.3.6): restore the
# latest replicated state into a scratch file, never over the store, and compare each
# table's row count with the store's. Exits non-zero if any differ.
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
    node -e '
        const {DatabaseSync} = require("node:sqlite");
        const db = new DatabaseSync(process.argv[1], {readOnly: true});
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all("table").map(t => t.name);
        for (const t of tables) console.log(`${t} ${db.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n}`);
    ' "$1" 2>/dev/null
}

if diff <(counts "$store") <(counts "$restored"); then
    echo "restore drill: the replica's latest state matches the store, table by table:"
    counts "$restored" | sed 's/^/  /'
else
    echo "restore drill: the replica differs from the store (above: < store, > restored)" >&2
    exit 1
fi
