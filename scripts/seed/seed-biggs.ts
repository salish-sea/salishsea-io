/**
 * Bigg's catalog seed — imperative shell (decision 011).
 *
 * Reads data/biggs-ids.tsv, runs the pure parseBiggsIds core, and upserts the
 * result into the public catalog over an injected postgres.js connection, in ONE
 * transaction, in two passes:
 *   pass 1 — insert every table in FK order, ON CONFLICT (natural key), resolving
 *            FKs by joining on natural keys (designation / party name);
 *   pass 2 — fill the self-referential FKs (mother_id, anchor, parent, superseded_by)
 *            now that surrogate ids exist.
 *
 * Idempotent: surrogate ids are never referenced by the input, only natural keys,
 * so a re-run refreshes rather than duplicates. Run against any environment via
 * SUPABASE_DB_URL (local stack, or the prod IPv4 session pooler after `db push`):
 *   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/seed/seed-biggs.ts
 */

import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { parseBiggsIds } from './biggs-ids.ts';

async function main(): Promise<void> {
    const dsn = process.env['SUPABASE_DB_URL'];
    if (!dsn) {
        console.error('SUPABASE_DB_URL is not set');
        process.exit(1);
    }

    const tsv = readFileSync(new URL('../../data/biggs-ids.tsv', import.meta.url), 'utf8');
    const cat = parseBiggsIds(tsv);

    const known = new Set(cat.individuals.map((i) => i.primary_designation));
    const unresolvedMothers = cat.individuals
        .filter((i) => i.mother_designation && !known.has(i.mother_designation))
        .map((i) => `${i.primary_designation}→${i.mother_designation}`);

    const nnIndividual = cat.nicknames.filter((n) => n.individual_designation);
    const nnGroup = cat.nicknames.filter((n) => n.group_designation);

    const sql = postgres(dsn, { prepare: false, max: 1 });
    try {
        const counts = await sql.begin(async (tx) => {
            // ---- pass 1: inserts in FK order ----
            const parties = (await tx`
                INSERT INTO public.parties (name, kind, url)
                SELECT v.name, v.kind::public.party_kind, v.url
                FROM jsonb_to_recordset(${tx.json(cat.parties as never)}) AS v(name text, kind text, url text)
                ON CONFLICT (name) DO UPDATE SET kind = EXCLUDED.kind, url = EXCLUDED.url
                RETURNING id`).count;

            const individuals = (await tx`
                INSERT INTO public.individuals
                    (primary_designation, sex, born_earliest, born_latest, life_status, notes)
                SELECT v.primary_designation, v.sex::public.sex, v.born_earliest, v.born_latest,
                       v.life_status::public.life_status, v.notes
                FROM jsonb_to_recordset(${tx.json(cat.individuals as never)}) AS v(
                    primary_designation text, sex text, born_earliest int, born_latest int,
                    life_status text, notes text)
                ON CONFLICT (primary_designation) DO UPDATE SET
                    sex = EXCLUDED.sex, born_earliest = EXCLUDED.born_earliest,
                    born_latest = EXCLUDED.born_latest, life_status = EXCLUDED.life_status,
                    notes = EXCLUDED.notes
                RETURNING id`).count;

            const groups = (await tx`
                INSERT INTO public.social_groups (kind, designation, notes)
                SELECT v.kind::public.social_group_kind, v.designation, v.notes
                FROM jsonb_to_recordset(${tx.json(cat.socialGroups as never)}) AS v(
                    designation text, kind text, notes text)
                ON CONFLICT (designation) DO UPDATE SET kind = EXCLUDED.kind, notes = EXCLUDED.notes
                RETURNING id`).count;

            const designations = (await tx`
                INSERT INTO public.designations
                    (individual_id, code, scheme, is_primary, status, in_catalog)
                SELECT i.id, v.code, v.scheme::public.designation_scheme, v.is_primary,
                       v.status::public.designation_status, v.in_catalog
                FROM jsonb_to_recordset(${tx.json(cat.designations as never)}) AS v(
                    code text, individual_designation text, scheme text, is_primary bool,
                    status text, in_catalog bool)
                JOIN public.individuals i ON i.primary_designation = v.individual_designation
                ON CONFLICT (code) DO UPDATE SET
                    individual_id = EXCLUDED.individual_id, scheme = EXCLUDED.scheme,
                    is_primary = EXCLUDED.is_primary, status = EXCLUDED.status,
                    in_catalog = EXCLUDED.in_catalog
                RETURNING id`).count;

            const memberships = (await tx`
                INSERT INTO public.group_memberships
                    (group_id, individual_id, is_current, joined_year, basis)
                SELECT g.id, i.id, v.is_current, v.joined_year, 'maternal'::public.membership_basis
                FROM jsonb_to_recordset(${tx.json(cat.memberships as never)}) AS v(
                    group_designation text, individual_designation text, is_current bool, joined_year int)
                JOIN public.social_groups g ON g.designation = v.group_designation
                JOIN public.individuals i ON i.primary_designation = v.individual_designation
                ON CONFLICT (group_id, individual_id) DO UPDATE SET
                    is_current = EXCLUDED.is_current, joined_year = EXCLUDED.joined_year,
                    basis = EXCLUDED.basis
                RETURNING id`).count;

            const nickIndividual = (await tx`
                INSERT INTO public.nicknames (individual_id, name, story, namer_id, theme, status)
                SELECT i.id, v.name, v.story, p.id, v.theme, v.status::public.nickname_status
                FROM jsonb_to_recordset(${tx.json(nnIndividual as never)}) AS v(
                    individual_designation text, name text, story text, namer_name text,
                    theme text, status text)
                JOIN public.individuals i ON i.primary_designation = v.individual_designation
                LEFT JOIN public.parties p ON p.name = v.namer_name
                ON CONFLICT (individual_id, name) DO UPDATE SET
                    story = EXCLUDED.story, namer_id = EXCLUDED.namer_id,
                    theme = EXCLUDED.theme, status = EXCLUDED.status
                RETURNING id`).count;

            const nickGroup = (await tx`
                INSERT INTO public.nicknames (social_group_id, name, story, namer_id, theme, status)
                SELECT g.id, v.name, v.story, p.id, v.theme, v.status::public.nickname_status
                FROM jsonb_to_recordset(${tx.json(nnGroup as never)}) AS v(
                    group_designation text, name text, story text, namer_name text,
                    theme text, status text)
                JOIN public.social_groups g ON g.designation = v.group_designation
                LEFT JOIN public.parties p ON p.name = v.namer_name
                ON CONFLICT (social_group_id, name) DO UPDATE SET
                    story = EXCLUDED.story, namer_id = EXCLUDED.namer_id,
                    theme = EXCLUDED.theme, status = EXCLUDED.status
                RETURNING id`).count;

            // ---- pass 2: resolve self-referential FKs ----
            // Feed the FULL source set and LEFT JOIN the target, so a link that the
            // TSV removes or that no longer resolves is explicitly cleared to NULL on
            // a refresh — an inner join over a filtered set would leave it stale.
            const mothers = cat.individuals
                .map((i) => ({ child: i.primary_designation, mother: i.mother_designation }));
            const motherUpd = (await tx`
                UPDATE public.individuals child SET mother_id = mother.id
                FROM jsonb_to_recordset(${tx.json(mothers as never)}) AS v(child text, mother text)
                LEFT JOIN public.individuals mother ON mother.primary_designation = v.mother
                WHERE child.primary_designation = v.child`).count;

            const anchors = cat.socialGroups
                .map((g) => ({ group_designation: g.designation, anchor: g.anchor_designation }));
            await tx`
                UPDATE public.social_groups g SET anchor_individual_id = i.id
                FROM jsonb_to_recordset(${tx.json(anchors as never)}) AS v(group_designation text, anchor text)
                LEFT JOIN public.individuals i ON i.primary_designation = v.anchor
                WHERE g.designation = v.group_designation`;

            const parents = cat.socialGroups
                .map((g) => ({ group_designation: g.designation, parent: g.parent_designation }));
            await tx`
                UPDATE public.social_groups g SET parent_group_id = parent.id
                FROM jsonb_to_recordset(${tx.json(parents as never)}) AS v(group_designation text, parent text)
                LEFT JOIN public.social_groups parent ON parent.designation = v.parent
                WHERE g.designation = v.group_designation`;

            const supersessions = cat.designations
                .map((d) => ({ code: d.code, target: d.superseded_by_code }));
            await tx`
                UPDATE public.designations d SET superseded_by = target.id
                FROM jsonb_to_recordset(${tx.json(supersessions as never)}) AS v(code text, target text)
                LEFT JOIN public.designations target ON target.code = v.target
                WHERE d.code = v.code`;

            return {
                parties, individuals, groups, designations, memberships,
                nicknames: nickIndividual + nickGroup, motherUpd,
            };
        });

        console.log('Bigg\'s catalog seeded:', counts);

        // A reseed changes what sighting codes resolve to; the candidate cache
        // (20260708000104) otherwise only refreshes on the ingest cadence.
        const [cache] = await sql`
            SELECT to_regclass('public.occurrence_identifier_candidates') IS NOT NULL AS exists`;
        if (cache?.['exists']) {
            await sql`REFRESH MATERIALIZED VIEW public.occurrence_identifier_candidates`;
            console.log('Refreshed occurrence_identifier_candidates');
        }

        if (unresolvedMothers.length) {
            console.warn(
                `${unresolvedMothers.length} mother designation(s) not present as their own row (mother_id left NULL): ` +
                unresolvedMothers.slice(0, 20).join(', ') + (unresolvedMothers.length > 20 ? ' …' : ''),
            );
        }
    } finally {
        await sql.end();
    }
}

await main();
