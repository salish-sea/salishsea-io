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
#       Prod schedules ingest-maplify and ingest-inaturalist every 5 minutes,
#       each doing net.http_post to a secret URL. Mirroring them would make a
#       laptop start hammering that endpoint on a timer.
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

LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DUMP="${TMPDIR:-/tmp}/salishsea-prod-data.sql"

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

echo "==> Applying local drift workaround"
psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 \
  -c "ALTER TABLE happywhale.individuals ALTER COLUMN nickname TYPE varchar(100);"

# `db reset` leaves rows behind that the dump also carries: reference tables
# seeded by migration 20260619184037_reference_tables.sql (providers,
# organizations, collections) and the `media` storage bucket. Clear exactly the
# tables the dump will load, or those primary keys collide.
echo "==> Clearing migration-seeded rows"
TABLES=$(grep -oE '^COPY "[^"]+"\."[^"]+"' "$DUMP" | sed 's/^COPY //; s/"//g' | sort -u)
TRUNCATE_LIST=$(echo "$TABLES" | grep -v '^storage\.' | paste -sd, -)
psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 \
  -c "SET session_replication_role = replica; TRUNCATE TABLE $TRUNCATE_LIST CASCADE;"
# storage.buckets cannot be TRUNCATEd: it is referenced by admin-owned tables
# that would require CASCADE, which the local postgres role may not touch.
psql "$LOCAL_DB" -q -v ON_ERROR_STOP=1 \
  -c "SET session_replication_role = replica; DELETE FROM storage.objects; DELETE FROM storage.buckets;"

echo "==> Loading production data"
psql "$LOCAL_DB" -v ON_ERROR_STOP=1 -q -f "$DUMP"

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
records. It is on your laptop now. The local stack signs its own JWTs with a
different secret, so prod sessions and passwords do not carry over, but the
rows themselves are real.
EOF
