# Runbook: the read-path build on the Fly machine

What runs on the `salishsea-io` Fly app, where its state lives, and how to look at or repair it without hurting it. Audience: anyone operating the machine. The design is [decision 056](../decisions/056-the-logged-out-read-path-is-built-as-static-files.md) and [decision 061](../decisions/061-ingest-and-derivation-move-into-the-build.md); deploys and rollback are in [deploys.md](deploys.md).

## What runs

Every five minutes (`fly/crontab`) `fly/build.sh` runs two Stelis builds, from `/opt/stelis`, one after the other: `--project /app/stelis/salishsea-ingest.rkt`, the four source ingests, with its state in `/data/stelis-ingest`, under `/data/ingest.lock`; then `--project /app/stelis/salishsea.rkt`, everything from the snapshot on, with its state in `/data/stelis`, under `/data/build.lock` as well ([decisions 090](../decisions/090-the-read-path-build-is-two-stelis-projects.md) and [091](../decisions/091-a-save-never-waits-for-an-ingest.md)). The ingests write only their own mirrors and the register's file, which a build can read while they are written, so the ingests don't take the build lock and a save's build runs beside them. An ingest that fails doesn't stop the second build, which reads each mirror as the last good fetch left it. And right after a native sighting is saved, the write API runs the same script, building `salishsea` only and scoped to the store and what derives from it (`--downstream snapshot`: the snapshot task and every task that transitively consumes its outputs, about five seconds; `racket src/main.rkt --project /app/stelis/salishsea.rkt --commands --all --downstream snapshot` lists them, from the graph in this repo's `stelis/salishsea.rkt`, decision 092), so the three ingests, which have their schedule, are not part of a save's build. And a save doesn't wait for the scheduled `salishsea` build: it asks that build to yield by creating `yield` in its state dir and waits for the build lock, and the scheduled build finishes the task it is on, records the rest as yielded, exits 3, and reruns once the save's build has finished, its completed tasks skipping ([Stelis ADR 0018](https://github.com/rainhead/stelis/blob/144c99f04980f6fa5d19e247b46b471668a87eee/docs/adr/0018-a-build-yields-to-a-waiting-one.md)). So a save waits at most for the task the scheduled `salishsea` build is on: under two seconds for most, about nine for the Darwin Core archive. A save's build that doesn't have the lock within two minutes gives up and is retried half a minute later. The log of a build that yielded says `yielded to another build`, and `--explain --last` marks its tasks `⏸`. A second save follows once the first one's build has finished and five seconds have passed since it started. Within that build, the occurrences derivation is told which inputs changed (Stelis ADR 0015) and re-derives only the sources that read them: a save re-derives the native arm's few hundred rows, not all ~64,000 (the run log says `native re-derived; the rest as they were`). The scheduled build is told too, and re-derives the arms whose mirrors moved — typically Maplify's and iNaturalist's, or iNaturalist's alone (observed 2026-10-06: 4 s against 8 s for all five) — and every arm when an input every arm reads moved, such as iNaturalist's taxa, saying which input made it so. The day files follow the same idea at the next step: the build observes the occurrences by Pacific day (Stelis ADR 0016), so `occurrence-days` is told which days moved (`STELIS_REBUILD_KEYS`) and rewrites those files in place, the build deleting the days that emptied; the run log says `N of K named day(s) rewritten in place`. A build with no such basis (the first after a deploy, a day map it cannot read) rewrites the directory whole as before. One build: three ingest tasks fetch Maplify, iNaturalist and Orcasound into SQLite mirrors; a fourth fetches the newest release of the animals register into its own DuckDB file beside the mirrors, which every task that reads the register attaches as `register` ([decision 064](../decisions/064-what-users-do-not-write-leaves-postgres-first.md), amended); the snapshot task reads what users write from the store into `/data/read-path.duckdb`; the Maplify name guard runs; the derivations write `build.*` into the snapshot file; the day files, calendar, id index, profile pages, redirects and the Darwin Core archive are written under `/data/export`, which Caddy serves. A no-op build takes about half a minute; one that rebuilds the occurrences, a few minutes.

## The write API

[Decision 065](../decisions/065-the-store-and-write-api.md)'s service, `api/server.ts`, has taken what users write since the cutover (2026-10-05): sign-in, sightings, photos and feedback, in the store at `/data/store/salishsea.db`. It also keeps a record of each search made in the site's search field, in the `searches` table ([decision 078](../decisions/078-searches-are-recorded-in-our-own-store.md), which says how to read it). `fly/start.sh` starts it when the machine's environment sets `API_ENABLED` (`fly.toml` does), under Litestream (below), and restarts it after a pause if it exits, while Caddy keeps serving. Caddy routes `/api/*` to it, on the Fly app's own address and through salishsea.io's `/api/*` CloudFront behavior alike.

**What the build reads users' writes from.** The snapshot reads the native sightings, their photos, contributors and identifications from a consistent copy of the store (`scripts/read-path/snapshot.ts`, typed as Postgres's arrived, so nothing downstream changed at the cutover), named by `READ_PATH_STORE=/data/store/salishsea.db` in `fly.toml`. The API wakes the build after each write. There is no way back to Postgres: it was kept read-only from the cutover and given up on 2026-10-09 (`salish-9uu.3.9`), and the snapshot refuses to run without `READ_PATH_STORE`.

Set it only with `API_ENABLED`: without the API nothing writes the store, and a missing store fails the snapshot, so the build stops (loudly) rather than publish a map without native sightings.

Its secrets are Fly secrets. `fly/start.sh` takes them out of the environment before it starts anything and hands them to the API alone:

- **`SESSION_SIGNING_KEY`**: at least 32 random bytes, base64. Changing it signs everyone out.
- **`EDGE_SECRET`**: the value CloudFront sends on `/api/*` requests as `x-origin-verify`, so the API can tell them from requests made to the Fly app directly. It must equal the production environment's `EDGE_SECRET` GitHub secret, which the deploy passes to `cdk deploy`. A mismatch fails nothing visibly: the feedback rate limit falls back to keying senders by the CloudFront edge that carried them. CloudFormation holds it in the stack's template, so anyone who can read the template or the distribution in the AWS account can read it. To rotate it, set both:

  ```sh
  (
    set -e
    secret=$(openssl rand -hex 32)
    printf %s "$secret" | gh secret set EDGE_SECRET --env production
    fly secrets set -a salishsea-io --stage EDGE_SECRET="$secret"
  )
  ```

  CloudFront takes the new value at the next run of the deploy workflow, the Fly app at its next `fly/deploy.sh`; until both have, they disagree.
- **`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`**, for photo uploads (`POST /api/photos`, which answers 503 without them) and, once it ships, Litestream (`salish-9uu.3.6`): the IAM user `salishsea-io-store-writer` (`infra/`), which may add photos under `media/` in `salishsea-io-media` and keep Litestream's replica under `store/` in `salishsea-io-store-replica`, and nothing else. CDK makes the user but not its key, so the key's secret never passes through CloudFormation. Make one:

  ```sh
  (
    set -e
    creds=$(aws iam create-access-key --profile orcasound --user-name salishsea-io-store-writer \
      --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
    read -r id secret <<< "$creds"
    [ -n "$id" ] && [ -n "$secret" ]
    fly secrets set -a salishsea-io --stage AWS_ACCESS_KEY_ID="$id" AWS_SECRET_ACCESS_KEY="$secret"
  )
  ```

  To rotate, make a second the same way (a user may hold two), deploy the Fly app, and check that a photo upload and Litestream's replication both still work. Only then delete the old key, which `aws iam list-access-keys --profile orcasound --user-name salishsea-io-store-writer` names:

  ```sh
  aws iam delete-access-key --profile orcasound --user-name salishsea-io-store-writer --access-key-id <old key id>
  ```

- **`FEEDBACK_GITHUB_TOKEN`**, with **`FEEDBACK_ISSUE_AUTHOR`**, for the feedback notifier (`api/notifier.ts`), which files each new piece of feedback in the store as a GitHub issue every fifteen minutes, as [039](../decisions/039-feedback-goes-to-our-own-database.md)'s workflow does for Postgres's until the cutover. The token may create issues in `salish-sea/salishsea-io` and nothing else (a fine-grained token with Issues: read and write on that repository alone); `FEEDBACK_ISSUE_AUTHOR` is the login the issues are posted as, which the notifier needs to recognise its own work after a crash. Without either, feedback is kept and no issue is filed; the API says so when it starts. A wrong author files a report twice at worst, never loses one.

  ```sh
  fly secrets set -a salishsea-io --stage FEEDBACK_GITHUB_TOKEN=<token> FEEDBACK_ISSUE_AUTHOR=<its login>
  ```

### The cutover, once (salish-9uu.3.8)

Done on 2026-10-05: Supabase's writes frozen, the store copied from Postgres, the photos moved to S3, the site switched. The procedure is in this runbook's [last version that carried it](https://github.com/salish-sea/salishsea-io/blob/37564ef580f84996b42c57b907fcb85029c6f984/docs/runbook/read-path-build.md#the-cutover-once-salish-9uu38), and what happened in bd `salish-9uu.3.8`.

## The store's replica: Litestream

The write API runs under `litestream replicate -exec` ([`fly/litestream.yml`](../../fly/litestream.yml), started by `fly/start.sh`), so the store is replicated to `s3://salishsea-io-store-replica/store/salishsea.db` (Orcasound account, us-west-2) for exactly as long as the API can write it, about a second behind each write. A full snapshot is taken daily and kept thirty days, which is how far back a point-in-time restore reaches. If the API or Litestream exits, both are restarted together.

**On a fresh volume the store comes back by itself.** Before each start, `start.sh` runs `litestream restore -if-db-not-exists`. With the store present, that does nothing. With the store gone, it restores the replica's latest state before the API can write. With neither, it fails, and the API stays down, retrying every ten seconds, rather than start an empty store and publish a map without anyone's sightings.

**A restore drill**, to run before the cutover and after any change to the replication. [`fly/restore-drill.sh`](../../fly/restore-drill.sh) restores the latest replicated state into a scratch file, never over the live store, and compares each table with the store's, by its row count and a hash of every row, so a changed row shows as well as a missing one. It exits non-zero if any differ:

```sh
fly ssh console -a salishsea-io -C "setpriv --reuid=app --regid=app --init-groups env HOME=/home/app /app/fly/restore-drill.sh"
```

A write in the second between the two reads can show as a difference, so run it again before believing one. To restore a moment rather than the latest state, call Litestream directly, into a scratch file:

```sh
litestream restore -config /app/fly/litestream.yml -timestamp 2026-10-20T17:00:00Z -o /tmp/restored.db /data/store/salishsea.db
```

To put a restored store into service, first stop the API (maintenance mode), move the live file and its `-wal` and `-shm` aside, put the restored file at `/data/store/salishsea.db`, then leave maintenance. Litestream then replicates it as a new generation.

Rehearsed on 2026-10-05 against the bucket, with a copy of production's rows under a scratch prefix (since deleted): a one-off replication, then a restore, gave a byte-identical SQL dump, and a write made while replication ran was in the next restore. The drill above, against the live store, runs once the cutover has made one.

## Where state lives

| Path | What | Provenance |
|---|---|---|
| `/data/mirrors/{maplify,inaturalist,orcasound}.sqlite` | the upstream mirrors, holding only what each source said | derived: a lost one is rebuilt by a backfill (below) |
| `/data/mirrors/runs.sqlite` → `/status/ingest-runs.json` | each ingest run's outcome; what the heartbeat reads | log |
| `/data/mirrors/maplify-names.json` → `/status/maplify-names.json` | the name guard's report: what its checked-in baseline (`data/maplify-names.json`, decision 083) should become, every Maplify (name, scientific name) pair the last passing build resolved and what it resolved to | derived: rewritten by each passing build; `node scripts/read-path/refresh-maplify-names.ts` copies it into the checkout for a pull request |
| `/data/mirrors/water-regions.json` | the basemap's water regions, which name each sighting's place (decision 099), fetched by `water-regions` from the URL `src/basemap-style.json` names | derived: a lost one is fetched again by the next build |
| `/data/mirrors/places-osm.json` | the basemap's OpenStreetMap place list, which places the landmarks named from OpenStreetMap (decision 100), fetched by `water-regions` beside the regions | derived: a lost one is fetched again by the next build |
| `/data/mirrors/register.duckdb` | the register release the build holds (`register.edition` says which), written whole by `ingest-register` and renamed into place | derived: a lost one is fetched again by the next build |
| `/data/read-path.duckdb` | the store's snapshot of what users write, the reference tables from `data/reference/`, the catalogue from `data/catalogue/` and the rows it generates from the register (decision 070), and the build's own derived relations | derived |
| `/data/store/salishsea.db` | what users write (decision 065): sightings, photos' URLs, contributors, sign-ins, feedback | **authoritative** — the write API's alone; replicated by Litestream (above) |
| `/data/stelis/` | Stelis's build history (30 days) and content-addressed blocks for `salishsea`, the build from the snapshot on | log |
| `/data/stelis-ingest/` | the same for `salishsea-ingest`, the four source ingests | log |
| `/data/export/` | every published file | derived |
| `/app/data/maplify-unnamed.tsv` | the curator's allow-list of accepted un-namings | from git, in the image |

## Stopping and restarting

On `SIGTERM` (`fly.toml`'s `kill_signal`; a deploy, `fly machine restart`, `fly machine stop`), `fly/start.sh` stops the schedule, then the write API, waiting while Litestream makes its final sync, then Caddy. All of that fits in a few seconds of `kill_timeout`'s sixty. A running build is not waited for: Fly has stopped routing to the machine by then, so waiting would be downtime. `fly/deploy.sh` takes `/data/ingest.lock` and then `/data/build.lock` before it switches, so no ingest or build is running when a deploy stops the machine. Any other stop may kill one, and the next build repairs it ([decision 066](../decisions/066-a-deploy-takes-the-build-lock-and-the-machine-stops-its-writers.md)). While a deploy holds the locks, an operator command run under either waits for it, as it would for a build.

## Maintenance mode: for anything longer than a query

For a backfill, a repair of the snapshot or a measurement — anything that would hold a lock for more than a minute or two — put the machine in maintenance mode rather than racing the schedule for it:

```sh
fly machine update 82973dc7675348 -a salishsea-io --env READ_PATH_MAINTENANCE=1 -y   # in
fly machine update 82973dc7675348 -a salishsea-io --env READ_PATH_MAINTENANCE=0 -y   # out
```

Each is one reboot of the machine (about ten seconds). In maintenance, Caddy and the redirect server run and nothing else: every published file keeps serving, Fly's health check keeps passing, and the schedule and the boot build stay off, so `/data` is yours. `/status/maintenance.json` says since when; the heartbeat reads it and reports a planned window instead of filing a stale-build issue (it still files one if a window runs past a day). The Sentry cron monitor can't read it: **mute `read-path-build` in Sentry before entering maintenance, and unmute it after**, or it opens an issue half an hour in ([below](#is-the-build-publishing-the-sentry-cron-monitor)). Visitors notice nothing except that the files stop advancing; a signed-in contributor sees their own sightings live as always. Leaving the mode boots normally, build included. (Beeline's PR #132 is the same idea for an app with a store to keep closed; here the site is static, so it can simply keep serving.)

## Is the build publishing? The Sentry cron monitor

Each scheduled build checks in to the Sentry cron monitor [`read-path-build`](https://beam-reach.sentry.io/crons/salishsea-io/read-path-build/) ([`fly/build.sh`](../../fly/build.sh), decision 012 as amended): `ok` when it rewrote `manifest.json`, which waits on every other file, `error` when it didn't. A build that doesn't run at all, because the machine is down or the schedule stopped, checks in nothing, which Sentry counts as missed. Six in a row without an `ok`, half an hour, open a Sentry issue, and the first `ok` resolves it. The monitor's settings travel with each check-in, so change them in `build.sh`, not in Sentry. A save's build doesn't check in.

What it doesn't tell you is *why*. For that, read the build's log (`flyctl logs -a salishsea-io --no-tail`, a failing task prints `✗ <task> — exit 1` and the tasks it blocked `⊘`), or ask Stelis, below.

## Looking at the machine: take a lock first

The machine has 2 GB and no swap ([decision 091](../decisions/091-a-save-never-waits-for-an-ingest.md)). The services and the kernel take about 350 MB, the ingest build peaks near 165 MB and a derive build near 505 MB (`derive-occurrences` re-deriving every arm), and the two builds can run at once. Anything you run beside them competes with them; a Stelis query run during a build was killed at 137 on 2026-10-04, when the machine had 1 GB. So run operator commands under a lock: `/data/build.lock` for anything about `salishsea` or the snapshot, `/data/ingest.lock` for anything about an ingest or a mirror. The ingests and a save's build can run beside each other, so a measurement that must have the machine to itself takes both. A scheduled build that finds the ingest lock held skips that tick, and one that finds the build lock held waits up to two minutes:

```sh
fly ssh console -a salishsea-io -C "sh -c 'cd /opt/stelis && flock /data/build.lock racket src/main.rkt --project /app/stelis/salishsea.rkt --explain --last'"
```

Useful questions, under the lock of the project asked:

- `--explain --last` — what the last build decided and did, task by task; asked of `salishsea-ingest`, each ingest's receipt (unchanged / changed / **unreachable**).
- `--history build.occurrences` — the occurrences' digest timeline; `--history build.occurrences:<id>` why one moved.
- `--why <task>` — what would make a task run now.
- `--commands <artifact>` — the exact hermetic command for each task that would run.

These ask `salishsea`, whose state is in `/data/stelis`, the image's `STELIS_STATE_DIR`. For an ingest, ask its own project with its own state dir:

```sh
fly ssh console -a salishsea-io -C "sh -c 'cd /opt/stelis && flock /data/ingest.lock env STELIS_STATE_DIR=/data/stelis-ingest racket src/main.rkt --project /app/stelis/salishsea-ingest.rkt --explain --last'"
```

The operator build log, the same history as one page, is written after every build to the state dir.

## Refreshing the landmarks

The landmarks a card names (decision 100) are `data/reference/landmarks.tsv`, which [scripts/propose-landmarks.ts](../../scripts/propose-landmarks.ts) proposes from the reports in the Maplify mirror. To refresh it, copy the mirror under the ingest lock, so no ingest writes it mid-copy (at worst one scheduled ingest skips a tick), then run the script on the copy and review the diff in a pull request:

```sh
fly ssh console -a salishsea-io -C "flock -w 60 /data/ingest.lock cp /data/mirrors/maplify.sqlite /tmp/maplify-copy.sqlite"
fly ssh sftp get -a salishsea-io /tmp/maplify-copy.sqlite maplify.sqlite
fly ssh console -a salishsea-io -C "rm /tmp/maplify-copy.sqlite"
node scripts/propose-landmarks.ts maplify.sqlite
```

The script adds the places reports newly name and updates each row's count, and keeps every row the file had, with its `says`. To strike a name out, empty its `says`; a refresh leaves it so.

## Backfilling a mirror

The ingests fetch a window each run (Maplify: 30 days plus one sampled older month; iNaturalist: what changed since the last run, the last ten days, and one older month). A mirror lost or newly created gets the rest by running the same script by hand with a window, under `/data/ingest.lock` so no scheduled ingest writes beside it. It runs as `app`, as the build does (`fly/start.sh`): `fly ssh console` is root, and a file a root run creates, such as a mirror recreated from nothing, belongs to root, so the build can't write it afterwards. A manual run fails loudly rather than keeping the last good copy, and records itself in the run log as `manual`:

```sh
# Maplify, one month; serves history, so any window works
fly ssh console -a salishsea-io -C "sh -c 'cd /app && flock /data/ingest.lock setpriv --reuid=app --regid=app --init-groups env HOME=/home/app node scripts/read-path/ingest-maplify.ts /data/mirrors/maplify.sqlite 2026-01-01 2026-01-31'"
# iNaturalist, likewise — but it asks for at most 60 requests a minute (decision 041), so a year takes hours; do it a month at a time
fly ssh console -a salishsea-io -C "sh -c 'cd /app && flock /data/ingest.lock setpriv --reuid=app --regid=app --init-groups env HOME=/home/app node scripts/read-path/ingest-inaturalist.ts /data/mirrors/inaturalist.sqlite 2026-01-01 2026-01-31'"
```

Orcasound is read whole every run, so its mirror needs no backfill. A scheduled Maplify run refuses to delete more than a tenth of a window's stored sightings in one go (a response cut short would otherwise read as a month of retractions) and fails instead; the run log's error names the window. If Maplify really did retract them, a backfill of that window by hand applies the deletes — the manual run has no floor. The iNaturalist mirror's taxa refresh themselves (thirty a run) and pick up what the register names on the next scheduled run. Its observations' identifications and comments (decision 075) backfill themselves too: each scheduled run asks about the next 200 observations that have no identification, by ascending id past a cursor in the mirror's `sync` table (`identifications_backfilled_through`). A whole mirror takes about a day and a half of builds, and the run log names each batch. A comment added to an old observation doesn't move its `updated_at`, so the mirror has it only once that observation is fetched again. Each scheduled run also fetches any taxon an identification names that the mirror doesn't hold yet, such as a gull someone suggested for a seal, so the derivation can tell an identification that agrees from one that disputes (decision 080); until it arrives, that identification counts for neither. An observation's annotations, such as Alive or Dead (`salish-1y8`), arrive whenever it is next fetched, as its votes did (decision 081); one mirrored before then shows no vitality until the anti-entropy window reaches it or a backfill by hand covers its dates.

## When the build refuses a register edition

Every build asks which release of the animals register is newest and adopts it if it is new — unless it would stop naming a (name, scientific name) pair from the Maplify mirror that the edition the build holds names. Then the build keeps the edition it holds, the `register` run in `/status/ingest-runs.json` fails with the pairs named, and the heartbeat files a `stale` finding for `register` the next time it runs, which GitHub's scheduler makes hours rather than minutes. Everything else keeps publishing. The fix is the same as for the name guard below: name the pair again in the register, or accept the un-naming with a row in `data/maplify-unnamed.tsv`. To hold the build at one edition meanwhile (or roll it back), set it in the machine's environment, which reboots the machine once:

```sh
fly machine update 82973dc7675348 -a salishsea-io --env REGISTER_TAG=2026.09.6 -y   # hold
fly machine update 82973dc7675348 -a salishsea-io --env REGISTER_TAG= -y            # follow the newest again
```

## When the name guard holds

`maplify-names` fails when a register edition stops naming a pair the last passing build named; every published file then stays as it was, and the Sentry cron monitor opens an issue within half an hour (the heartbeat's `unpublished` check too, whenever it next runs). This should not happen: the build's register fetch refuses such an edition before adopting it. The guard still catches a pair the Maplify mirror didn't hold when the edition was judged. The fix is in the register (name the pair again) or, for an un-naming meant on purpose, a row in `data/maplify-unnamed.tsv` in a pull request — never an edit to `maplify-names.json` on the volume, which is only the last pass's report. The baseline the guard judges against is `data/maplify-names.json` in git (decision 083): a pair is guarded once it is there, and `node scripts/read-path/refresh-maplify-names.ts` copies the served report over it for a pull request whenever new pairs have appeared.

## Measuring a task

There is no `time` on the image. Peak RSS of one task, run alone into a scratch export dir:

```sh
# from /app, under the lock; EXPORT_DIR somewhere disposable
EXPORT_DIR=/tmp/measure node scripts/read-path/occurrence-ids.ts /data/read-path.duckdb & pid=$!
peak=0; while kill -0 $pid 2>/dev/null; do h=$(awk '/VmHWM/{print $2}' /proc/$pid/status 2>/dev/null); [ -n "$h" ] && peak=$h; sleep 0.2; done; wait $pid; echo "$((peak/1024)) MB"
```

Measured peaks are recorded on the bead that changed the task (`salish-xv35.10`, `.17`, `.19`).
