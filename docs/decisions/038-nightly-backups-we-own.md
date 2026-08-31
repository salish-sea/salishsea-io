# 038 — A nightly backup we own, in a bucket that is not the public one

**Status:** accepted · **Decided:** 2026-08-31 · bd `salish-5xy`

## Context

There were no backups. Not "backups with a gap", not "backups nobody had tested" — none.

The project sits on Supabase's free plan, which takes no daily snapshots: the Management API
reports `pitr_enabled: false` and `backups: []`, with no add-ons. No workflow or script in this
repository ran `pg_dump`. The nightly DarwinCore Archive is a ~3 MB projection of
`dwc.occurrences` alone, overwritten in place on a bucket with no versioning, and it is a
publication rather than a backup. And
[`dwca-attribution-pitfalls.md`](../design-notes/dwca-attribution-pitfalls.md) listed "restore
from pre-backfill snapshot (Supabase PITR)" as the recovery route for a destructive backfill —
a mitigation for a HIGH-cost pitfall that named a facility this project does not have.

Two of the largest tables would survive the loss, because their upstreams still serve history:
`maplify.sightings` (40,792 rows) and `inaturalist.observations` (21,951). What would not come
back from anywhere:

| | rows | what it is |
|---|---|---|
| `public.observations` | 501 | sightings people typed into this site themselves |
| `public.individuals` | 510 | the catalogue, now carrying register identifiers |
| `public.social_groups` | 133 | matrilines and pods |
| `public.designations` | 575 | the names those animals are known by |
| `public.contributors` | 6,719 | who observed what |
| `auth.users` | 36 | accounts |
| `storage.objects` | 95 | photo metadata — the photos themselves are ~104 MB elsewhere |

## Decision

**A nightly dump, into a bucket this account owns.**
[`db-backup-nightly.yml`](../../.github/workflows/db-backup-nightly.yml) runs at 07:00 UTC,
clear of the DwC-A build at 09:00, and writes `roles.sql.gz`, `schema.sql.gz`,
`auth-storage.sql.gz`, `data.sql.gz` and `SHA256SUMS` under `s3://salishsea-io-backups/db/YYYY/MM/DD/HHMMSS/`.

Keyed to the second rather than the day, so a re-run after a failure cannot write over the
morning's objects — and, more to the point, so a re-run that itself dies partway cannot leave
one prefix holding some new files, some old ones, and a checksum list describing neither.
`SHA256SUMS` is uploaded last and is therefore the marker of a complete backup: the restore
picker chooses only among prefixes that have one, so a half-finished run is skipped rather
than selected and then failed for a reason that says nothing about whether backups work.

**Its own bucket, and this is not a matter of tidiness.** `salishsea-io`, the site bucket,
carries a policy granting `s3:GetObject` to `Principal: "*"` on `arn:aws:s3:::salishsea-io/*`,
with public access block switched fully off. Every object in it is readable by anyone who
knows the key. A dump of this database contains `auth.users`. A prefix would not have helped —
the policy carries no prefix condition — so the backup goes to a separate bucket with
`BLOCK_ALL`, SSE, enforced TLS, versioning, and `RETAIN` so a stack teardown cannot take the
backups with it.

**Four plain-SQL files, not one custom-format archive.** The manual backup taken on
2026-08-30 used the Supabase CLI's `db dump` and its restore steps are known to work; matching
it means the automated path and the procedure a human would follow under pressure are the same
path. The CLI also knows which platform schemas to exclude, which a hand-rolled `pg_dump`
would have to learn and then keep learning.

**The dump is checked against the database before it is kept.**
[`verify-dump.ts`](../../scripts/backup/verify-dump.ts) counts the rows in each `COPY` block
and compares them, table by table, against the seven irreplaceable tables above. `pg_dump`
exiting 0 means the process finished, not that the file is worth keeping — and a size floor is
nearly useless here: a dump missing `public.observations` entirely is within 1% of the right
size, because 501 sightings are a rounding error beside 40,792 Maplify rows.

The comparison is a *range*, not an equality, and that distinction is the difference between a
check people trust and one they learn to re-run. The database is live while the dump runs:
someone submits a sighting, ingest mints a contributor, a photo lands. A count taken afterwards
will legitimately exceed the file, so an equality would fail good backups on ordinary traffic
and raise an alarm saying the opposite of the truth. The workflow therefore brackets the dump —
counts before, counts after — and the dump's own count has to land between them. Anything
outside that range is not timing, it is a short dump. With no bracket the check is exact, which
is right for the one case with no traffic: verifying a restored copy.

**Photos are mirrored incrementally, and separately.** `pg_dump` captures `storage.objects` and
not one byte of the objects. Copying the whole ~104 MB bucket nightly would spend roughly 3 GB
a month against a free-tier allowance of 5 GB, re-downloading bytes we already hold, and would
grow to breach it. So [`plan-media-sync.ts`](../../scripts/backup/plan-media-sync.ts) compares
upstream names and ETags against the mirror and names only the difference; sighting photos are
written once and never edited, so the steady state is nearly zero.

The objects come over plain HTTPS from the bucket's public URL rather than through
`supabase storage cp`, which refuses to run without `--experimental` — not a flag to build a
backup on. Each download is checked against what the database recorded, and what can be checked depends on
how the object was stored: Supabase keeps a plain MD5 for a single-part upload and a
digest-of-digests with a `-N` suffix for a multipart one — 8 of the 95 objects, all between 5.6
and 7.6 MB. A whole-file MD5 can never equal the second kind, so those are verified on length,
which is the shape a truncated download takes anyway. Either way the manifest written afterwards
describes bytes that actually arrived.
This depends on the `media` bucket being public, as it is today; were it made private the step
would start returning 403 and fail, which is the right way round.

The mirror never deletes. That is not an oversight to tidy up later: the local directory holds
only the objects a given run fetched, so a `--delete` sweep would read the other ninety-odd as
removed and destroy the mirror in one step. It is also the wrong instinct for a backup — an
object deleted upstream is precisely the one you want to still have.

**The auth and storage schemas are dumped separately, because otherwise they are not dumped at
all.** The CLI's schema dump excludes the platform's own schemas: it defines none of `auth`'s
or `storage`'s 31 tables, while the data dump copies happily into 22 of them. A backup holding
rows for tables it cannot create is restorable only onto a database that already has exactly
the right ones — which is a bet on a version you do not control.

We did not reason our way to that. The restore verification found it, by failing:
`column "ip_address" of relation "audit_log_entries" does not exist`. Production's `auth` had a
column the container's did not, and nothing in the backup could have created the right table.

**A restore is verified by restoring.**
[`db-restore-verify.yml`](../../.github/workflows/db-restore-verify.yml) loads the most recent
complete backup into `supabase/postgres` and re-runs the same row comparison against the
restored copy. It is manual: restoring 166 MB nightly to assert something that changes only
when the schema changes is not worth the minutes. Run it after a migration that changes the
shape of the database.

Its restore order is worth knowing, because it is not the obvious one. `auth` and `storage`
are restored, then `public`, then `auth` and `storage` **again**. The dependency is genuinely
circular — public tables carry foreign keys into `auth.users`, and `auth`'s triggers call
functions that live in `public` — so a single pass in either direction fails. The first pass
creates the tables, the second picks up the triggers it could not create the first time. It
also connects as `supabase_admin` rather than `postgres`: only that role is a superuser in the
image, and the restore has to create roles and drop the platform's own schemas.

Every step that must tolerate an error names exactly which errors, via
[`only-already-exists.sh`](../../scripts/only-already-exists.sh), and fails on anything else.
Most tolerate only "already exists"; the first `auth-storage` pass also tolerates a missing
*function* specifically, because the `public` functions its triggers call are not there yet —
which is the whole reason there is a second pass, and the second pass does not get that
exception. A missing table, schema or role is never tolerated, at any pass. Blanket
tolerance is how "restore the backup" quietly becomes "run it and see".

## Rejected alternatives

**Upgrade to Supabase Pro for managed daily backups.** The obvious answer, and it should
probably happen anyway — but not *instead* of this. Pro's backups live in the same vendor
account as the thing they protect, so they cover hardware and accident and not account loss,
billing failure, or a mistake made with the credentials that reach both. A backup whose fate is
correlated with the original is half a backup. This one is in a different vendor's account,
under different credentials.

**A prefix in the existing site bucket.** No new infrastructure, and the deploy role already
writes there. Rejected on the bucket policy above: it would have published `auth.users` to
anyone who guessed a key, and it would have looked like it was working.

**A size floor instead of row counts.** Cheaper, and the DwC-A guard's existing precedent.
Rejected because the sizes here are dominated by the two tables that are *not* at risk, so the
floor would pass every failure worth catching.

**Copy all media nightly.** Simpler, no ETag comparison, no manifest. Rejected on the egress
arithmetic above — and the failure mode is the bad one: it would silently eat the project's
monthly allowance while looking exactly like a working backup.

**Compare against S3's own ETag instead of keeping a manifest.** One fewer file, and it works —
until an object crosses S3's multipart threshold, above which its ETag stops being the MD5 of
the content and can never match Supabase's. The largest photo today is 7.6 MB against an 8 MB
threshold. Rejected on how it would fail rather than whether: every object would read as
changed, the bucket would be re-downloaded nightly, and nothing would look wrong.

**Restore-verify on every run.** The strongest possible check, and the honest one. Rejected on
cost for now, with the manual workflow as the compromise. Worth revisiting if the schema starts
changing often.

## Consequences

The bucket is created by CDK on the next deploy to `main`, so the first scheduled run must come
after that deploy. Its name is a literal in two places — `BACKUP_BUCKET_NAME` in
[`infra-stack.ts`](../../infra/lib/infra-stack.ts) and `BACKUP_BUCKET` in the workflow —
because a CDK-generated name would have to be copied into a repository variable by hand after
the first deploy, which is exactly when nobody is watching. A test fails if the two drift.

**Known gaps, so nobody assumes otherwise.** The `vault` schema is excluded from the CLI's data
dump, so the two secrets it holds (`ingest_function_url`, `ingest_trigger_secret`) are not
backed up and would have to be re-minted. Platform configuration — auth providers, API keys,
edge settings — lives in Supabase's control plane, not the database, and is not captured here.
Recovery restores to the previous 07:00 UTC, not to an arbitrary moment; a destructive change
made just after a nightly costs a day of writes.

A failed run files a `db-backup-failed` issue and updates it rather than filing a new one,
matching `dwca-nightly.yml`. Its body names the most recent good backup, because the question
in that moment is not "what broke" but "how much am I covered for".
