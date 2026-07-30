#!/usr/bin/env bash
#
# Mirror the production database into the local Supabase stack.
#
#   ./scripts/pull-prod-db.sh
#
# Schema comes from supabase/migrations (via `supabase db reset`); data comes
# from a `supabase db dump --linked` of prod. Auth uses the CLI's stored
# Management API credentials, so no DB_PASSWORD is needed.
#
# This DESTROYS the local database. That is the point.
#
# Prod is only ever read.
#
# ---------------------------------------------------------------------------
# Why the exclusions below exist
#
#   cron.job, cron.job_run_details
#       Prod's job rows and their run history. Note this exclusion alone does
#       NOT stop the ingest jobs locally: migration 20260706000000 schedules
#       ingest-maplify and ingest-inaturalist itself, so `db reset` recreates
#       them every time. What actually keeps a laptop from calling the
#       production ingest endpoint every 5 minutes is that both job bodies are
#       guarded by
#           WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets
#                         WHERE name = 'ingest_function_url')
#       and the CLI excludes `vault` from dumps, so the local vault stays
#       empty and net.http_post never runs. That is one guard deep. This
#       script unschedules the two ingest jobs after the reset as well, so
#       populating the local vault for some unrelated reason cannot silently
#       turn a dev box into a fifth ingest worker.
#
#   net.http_request_queue, net._http_response
#       Transient pg_net plumbing for the jobs above.
#
#   gis.spatial_ref_sys
#       Reference data owned by the PostGIS extension; already populated
#       locally by CREATE EXTENSION, so re-inserting collides.
#
#   storage.buckets_vectors, storage.vector_indexes, storage.buckets_analytics
#       Owned by supabase_storage_admin. The local `postgres` role cannot COPY
#       into them, and prod carries zero rows in all three, so there is nothing
#       to lose by skipping them.
#
#   happywhale.encounter_sample
#       SCHEMA DRIFT: exists in prod, no migration creates it. Single `id`
#       column, ~5,600 rows, referenced nowhere in this repo — an ad-hoc
#       sampling leftover. See "Known drift" below.
#
# ---------------------------------------------------------------------------
# Known drift between prod and supabase/migrations (as of 2026-07-30)
#
#   1. happywhale.encounter_sample exists only in prod (excluded above).
#   2. happywhale.individuals.primary_id and .nickname are varchar(100) in
#      prod; migrations still declare varchar(50). Only `nickname` actually
#      needs the extra room (2 rows exceed 50 chars, max 60); primary_id tops
#      out at 28. This script widens `nickname` locally so the load succeeds.
#      `primary_id` is left alone — public.occurrences depends on it, so
#      altering it would mean dropping and recreating the view.
#   3. Prod grants SELECT on ~33 public relations to anon/authenticated that no
#      migration reproduces — including public.occurrences itself. A database
#      built from migrations alone has 15 such grants where prod has 48, and
#      its REST API answers "permission denied for view occurrences". Prod
#      works because the grants were applied out of band and CREATE OR REPLACE
#      VIEW preserves existing grants, so no later migration disturbed them.
#      This script replays prod's grants after loading (see below).
#
# All three are unreconciled: prod has changes that migrations do not
# reproduce, so a rebuild of prod from migrations would NOT match prod — and in
# the case of #3 would not serve traffic. Fixing that properly means a
# migration, which is tracked separately.
# ---------------------------------------------------------------------------

set -euo pipefail

# The dump contains production auth rows and contributor records. Keep it in a
# private directory, mode 0700, and delete it on the way out however we exit --
# a predictable path in a shared /tmp, left behind after the run, is the sort of
# thing nobody notices until it matters.
umask 077
DUMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/salishsea-prod-data.XXXXXX")"
trap 'rm -rf "$DUMP_DIR"' EXIT

LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DUMP="$DUMP_DIR/data.sql"

EXCLUDES=(
  -x gis.spatial_ref_sys
  -x cron.job
  -x cron.job_run_details
  -x net.http_request_queue
  -x net._http_response
  -x happywhale.encounter_sample
  -x storage.buckets_vectors
  -x storage.vector_indexes
  -x storage.buckets_analytics
)

echo "==> Dumping production data (read-only on prod)"
npx supabase db dump --linked --data-only --use-copy "${EXCLUDES[@]}" -f "$DUMP"
echo "    $(du -h "$DUMP" | cut -f1) -> $DUMP"

echo "==> Resetting local database (applying migrations, no seed)"
npx supabase db reset --no-seed >/dev/null

# Only the two ingest jobs. The matview refresh jobs and nightly-vacuum are
# useful locally and harmless -- they touch nothing outside this database.
echo "==> Unscheduling local ingest cron jobs"
psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 -c "
SELECT cron.unschedule(jobid) FROM cron.job
WHERE jobname IN ('ingest-maplify', 'ingest-inaturalist');" >/dev/null

echo "==> Applying local drift workaround"
psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 \
  -c "ALTER TABLE happywhale.individuals ALTER COLUMN nickname TYPE varchar(100);"

# `db reset` leaves rows behind that the dump also carries: reference tables
# seeded by migration 20260619184037_reference_tables.sql (providers,
# organizations, collections) and the `media` storage bucket. Clear exactly the
# tables the dump will load, or those primary keys collide.
echo "==> Clearing migration-seeded rows"
# The CLI currently passes --quote-all-identifier, so every COPY header is
# fully quoted -- but do not depend on a flag we do not control. Accept quoted
# and bare identifiers on either side of the dot, and fail loudly if the parse
# yields nothing rather than building a malformed TRUNCATE.
TABLES=$(grep -oE '^COPY (")?[A-Za-z_][A-Za-z0-9_]*(")?\.(")?[A-Za-z_][A-Za-z0-9_]*(")?' "$DUMP" \
  | sed 's/^COPY //; s/"//g' | sort -u)
if [ -z "$TABLES" ]; then
  echo "ERROR: could not parse any COPY headers from $DUMP -- the dump format changed." >&2
  exit 1
fi
TRUNCATE_LIST=$(echo "$TABLES" | grep -v '^storage\.' | paste -sd, -)
psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 \
  -c "SET session_replication_role = replica; TRUNCATE TABLE $TRUNCATE_LIST CASCADE;"
# storage.buckets cannot be TRUNCATEd: it is referenced by admin-owned tables
# that would require CASCADE, which the local postgres role may not touch.
psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 \
  -c "SET session_replication_role = replica; DELETE FROM storage.objects; DELETE FROM storage.buckets;"

echo "==> Loading production data"
psql "$LOCAL_DB" -v ON_ERROR_STOP=1 -q -f "$DUMP"

# auth.users arrives with encrypted_password intact. GoTrue verifies that bcrypt
# hash directly against a submitted password -- it does not involve the JWT
# signing secret -- so without this step anyone with the local stack could log in
# as a real production user using that user's real production password. The
# differing local JWT secret only invalidates already-issued tokens, which is a
# much weaker property than it sounds like.
#
# The rows stay (contributors reference them); only the credentials go.
echo "==> Stripping credentials from imported auth rows"
psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
UPDATE auth.users SET
  encrypted_password         = NULL,
  confirmation_token         = NULL,
  recovery_token             = NULL,
  email_change_token_new     = NULL,
  email_change_token_current = NULL,
  phone_change_token         = NULL,
  reauthentication_token     = NULL;
DELETE FROM auth.sessions;
DELETE FROM auth.refresh_tokens;
SQL

# Prod carries ~33 SELECT grants to anon/authenticated that NO migration
# reproduces (see "Known drift" #3 below). Without them the local REST API
# returns "permission denied for view occurrences" and the app is dead in the
# water, so replay prod's grants to make the mirror actually usable.
echo "==> Replaying production grants"
npx supabase db query --linked "
SELECT format('GRANT %s ON %I.%I TO %I;', privilege_type, table_schema, table_name, grantee) AS stmt
FROM information_schema.role_table_grants
WHERE table_schema IN ('public','dwc')
  AND grantee IN ('anon','authenticated')
  AND privilege_type = 'SELECT'
ORDER BY 1" \
  | python3 -c "
import sys, json, re
d = json.loads(re.search(r'\{.*\}', sys.stdin.read(), re.S).group(0))
print('\n'.join(r['stmt'] for r in d['rows']))" \
  | psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 -f -

# Materialized views hold no data in a --data-only dump; they must be rebuilt.
echo "==> Refreshing materialized views"
psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 <<'SQL'
REFRESH MATERIALIZED VIEW public.occurrence_index;
REFRESH MATERIALIZED VIEW public.occurrence_identifier_candidates;
SQL

echo "==> Done. Local row counts:"
psql "$LOCAL_DB" -q -c "
SELECT 'public.occurrences'        AS relation, count(*) FROM public.occurrences
UNION ALL SELECT 'public.occurrence_index',     count(*) FROM public.occurrence_index
UNION ALL SELECT 'maplify.sightings',           count(*) FROM maplify.sightings
UNION ALL SELECT 'inaturalist.observations',    count(*) FROM inaturalist.observations
UNION ALL SELECT 'happywhale.encounters',       count(*) FROM happywhale.encounters
UNION ALL SELECT 'public.contributors',         count(*) FROM public.contributors
UNION ALL SELECT 'auth.users',                  count(*) FROM auth.users;"

cat <<'EOF'

NOTE: this is real production data, including auth.users and contributor
records. It is on your laptop now, and the contributor rows carry real email
addresses.

Credentials have been stripped: password hashes and pending email/phone/
recovery tokens are nulled, and sessions and refresh tokens deleted, so nobody
can log in locally as a production user. That is the only thing neutralised —
the data itself is real. Treat this database accordingly, and do not point
anything public at it.
EOF
