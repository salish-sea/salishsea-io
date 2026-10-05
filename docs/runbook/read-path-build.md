# Runbook: the read-path build on the Fly machine

What runs on the `salishsea-io` Fly app, where its state lives, and how to look at or repair it without hurting it. Audience: anyone operating the machine. The design is [decision 056](../decisions/056-the-logged-out-read-path-is-built-as-static-files.md) and [decision 061](../decisions/061-ingest-and-derivation-move-into-the-build.md); deploys and rollback are in [deploys.md](deploys.md).

## What runs

Every five minutes (`fly/crontab`, and a few seconds after a native sighting is saved, via the change listener) `fly/build.sh` takes `/data/build.lock` and runs the Stelis build (`racket src/main.rkt --project salishsea --build --all`, from `/opt/stelis`). One build: three ingest tasks fetch Maplify, iNaturalist and Orcasound into SQLite mirrors; a fourth fetches the newest release of the animals register into the snapshot database ([decision 064](../decisions/064-what-users-do-not-write-leaves-postgres-first.md)); the snapshot task reads what Postgres still holds into `/data/read-path.duckdb`; the Maplify name guard runs; the derivations write `build.*` into the snapshot file; the day files, calendar, id index, profile pages, redirects and the Darwin Core archive are written under `/data/export`, which Caddy serves. A no-op build takes about half a minute; one that rebuilds the occurrences, a few minutes.

## Where state lives

| Path | What | Provenance |
|---|---|---|
| `/data/mirrors/{maplify,inaturalist,orcasound}.sqlite` | the upstream mirrors, holding only what each source said | derived: a lost one is rebuilt by a backfill (below) |
| `/data/mirrors/runs.sqlite` → `/status/ingest-runs.json` | each ingest run's outcome; what the heartbeat reads | log |
| `/data/mirrors/maplify-names.json` → `/status/maplify-names.json` | the name guard's baseline: every Maplify (name, scientific name) pair and what the last passing build resolved it to | **authoritative** — forward-only, nothing regenerates it once Postgres stops resolving Maplify |
| `/data/read-path.duckdb` | what Postgres still holds, the register release the build holds (`register.edition` says which), the reference tables from `data/reference/`, the catalogue from `data/catalogue/` with its views over the register, and the build's own derived relations | derived |
| `/data/stelis/` | Stelis's build history (30 days) and content-addressed blocks | log |
| `/data/export/` | every published file | derived |
| `/app/data/maplify-unnamed.tsv` | the curator's allow-list of accepted un-namings | from git, in the image |

## Maintenance mode: for anything longer than a query

For a backfill, a repair of the snapshot or a measurement — anything that would hold the build lock for more than a minute or two — put the machine in maintenance mode rather than racing the schedule for the lock:

```sh
fly machine update 82973dc7675348 -a salishsea-io --env READ_PATH_MAINTENANCE=1 -y   # in
fly machine update 82973dc7675348 -a salishsea-io --env READ_PATH_MAINTENANCE=0 -y   # out
```

Each is one reboot of the machine (about ten seconds). In maintenance, Caddy and the redirect server run and nothing else: every published file keeps serving, Fly's health check keeps passing, and the schedule, the change listener and the boot build stay off, so `/data` is yours. `/status/maintenance.json` says since when; the heartbeat reads it and reports a planned window instead of filing a stale-build issue (it still files one if a window runs past a day). Visitors notice nothing except that the files stop advancing; a signed-in contributor sees their own sightings live as always. Leaving the mode boots normally, build included. (Beeline's PR #132 is the same idea for an app with a store to keep closed; here the site is static, so it can simply keep serving.)

## Looking at the machine: take the lock first

The machine has 1 GB and no swap, and a build's largest task peaks near 400 MB. Anything you run beside a running build competes with it; a Stelis query run during one was killed at 137 on 2026-10-04. So run operator commands under the build lock — a build that finds it held skips that tick and the next one runs:

```sh
fly ssh console -a salishsea-io -C "sh -c 'cd /opt/stelis && flock /data/build.lock racket src/main.rkt --project salishsea --explain --last'"
```

Useful questions, all under `flock /data/build.lock`:

- `--explain --last` — what the last build decided and did, task by task, including each ingest's receipt (unchanged / changed / **unreachable**).
- `--history build.occurrences` — the occurrences' digest timeline; `--history build.occurrences:<id>` why one moved.
- `--why <task>` — what would make a task run now.
- `--commands <artifact>` — the exact hermetic command for each task that would run.

The operator build log, the same history as one page, is written after every build to the state dir.

## Backfilling a mirror

The ingests fetch a window each run (Maplify: 30 days plus one sampled older month; iNaturalist: what changed since the last run, the last ten days, and one older month). A mirror lost or newly created gets the rest by running the same script by hand with a window, under the lock so no build writes beside it. A manual run fails loudly rather than keeping the last good copy, and records itself in the run log as `manual`:

```sh
# Maplify, one month; serves history, so any window works
fly ssh console -a salishsea-io -C "sh -c 'cd /app && flock /data/build.lock node scripts/read-path/ingest-maplify.ts /data/mirrors/maplify.sqlite 2026-01-01 2026-01-31'"
# iNaturalist, likewise — but it asks for at most 60 requests a minute (decision 041), so a year takes hours; do it a month at a time
fly ssh console -a salishsea-io -C "sh -c 'cd /app && flock /data/build.lock node scripts/read-path/ingest-inaturalist.ts /data/mirrors/inaturalist.sqlite 2026-01-01 2026-01-31'"
```

Orcasound is read whole every run, so its mirror needs no backfill. A scheduled Maplify run refuses to delete more than a tenth of a window's stored sightings in one go (a response cut short would otherwise read as a month of retractions) and fails instead; the run log's error names the window. If Maplify really did retract them, a backfill of that window by hand applies the deletes — the manual run has no floor. The iNaturalist mirror's taxa refresh themselves (thirty a run) and pick up what the register names on the next scheduled run.

## When the build refuses a register edition

Every build asks which release of the animals register is newest and adopts it if it is new — unless it would stop naming a (name, scientific name) pair from the Maplify mirror that the edition the build holds names. Then the build keeps the edition it holds, the `register` run in `/status/ingest-runs.json` fails with the pairs named, and the heartbeat files a `stale` finding for `register` within half an hour. Everything else keeps publishing. The fix is the same as for the name guard below: name the pair again in the register, or accept the un-naming with a row in `data/maplify-unnamed.tsv`. To hold the build at one edition meanwhile (or roll it back), set it in the machine's environment, which reboots the machine once:

```sh
fly machine update 82973dc7675348 -a salishsea-io --env REGISTER_TAG=2026.09.6 -y   # hold
fly machine update 82973dc7675348 -a salishsea-io --env REGISTER_TAG= -y            # follow the newest again
```

## When the name guard holds

`maplify-names` fails when a register edition stops naming a pair the last passing build named; every published file then stays as it was, and the heartbeat's `unpublished` check fires within half an hour. This should not happen: the build's register fetch refuses such an edition before adopting it, and `register-refresh.yml` before loading it into Postgres. The guard still catches a pair the Maplify mirror didn't hold when the edition was judged. The fix is in the register (name the pair again) or, for an un-naming meant on purpose, a row in `data/maplify-unnamed.tsv` in a pull request — never an edit to `maplify-names.json` on the volume.

## Measuring a task

There is no `time` on the image. Peak RSS of one task, run alone into a scratch export dir:

```sh
# from /app, under the lock; EXPORT_DIR somewhere disposable
EXPORT_DIR=/tmp/measure node scripts/read-path/occurrence-ids.ts /data/read-path.duckdb & pid=$!
peak=0; while kill -0 $pid 2>/dev/null; do h=$(awk '/VmHWM/{print $2}' /proc/$pid/status 2>/dev/null); [ -n "$h" ] && peak=$h; sleep 0.2; done; wait $pid; echo "$((peak/1024)) MB"
```

Measured peaks are recorded on the bead that changed the task (`salish-xv35.10`, `.17`, `.19`).
