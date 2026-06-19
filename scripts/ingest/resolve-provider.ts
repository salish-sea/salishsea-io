/**
 * Pure URL-pattern resolver — Phase 11 Plan 01.
 *
 * Maps a source_url string to a { provider, collection } slug pair, or null
 * for unrecognized / invalid input. Side-effect-free: no I/O, no DB access,
 * no external npm imports (built-in URL constructor only).
 *
 * Roles (D-06):
 *   (a) One-time iNat/native URL backfill (consumed in plan 11-04).
 *   (b) Future-FB / mixed-source extension point.
 *
 * NOT on the Maplify resolution path — Maplify uses a DB-side rule table
 * (maplify.collection_rule + maplify.resolve_collection) per D-02/D-03.
 * NOT the ongoing mechanism for iNat/native/HappyWhale — that is the
 * migration-resolved column DEFAULT per D-05.
 *
 * Slug literals must exactly match the Phase 9 seed in
 * supabase/migrations/20260619184037_reference_tables.sql — they are the
 * join contract with public.providers and public.collections.
 *
 * Cross-reference:
 *   - 11-01-PLAN.md Task 1 for the full behavior spec.
 *   - 11-CONTEXT.md D-06 for the locked decision.
 *   - RESOLVE-01 in .planning/REQUIREMENTS.md.
 */

/**
 * Result type for resolveProvider. The resolver returns this on a recognized
 * URL, or null for any unrecognized host or unparseable input.
 *
 * `provider` matches public.providers.slug.
 * `collection` matches public.collections.slug.
 */
export type ProviderResolution = {
    readonly provider: string;
    readonly collection: string;
} | null;

/**
 * Resolves a source_url to { provider, collection } slug pair.
 *
 * Recognized patterns (Phase 9 slug contract):
 *   - inaturalist.org (with or without www)  → { provider: 'inaturalist', collection: 'inaturalist' }
 *   - salishsea.io                           → { provider: 'direct',       collection: 'salishsea-direct' }
 *   - anything else                          → null
 *
 * Returns null (never throws) on empty, non-URL, or unrecognized input —
 * safe to call with arbitrary source_url values from upstream records.
 */
export function resolveProvider(sourceUrl: string): ProviderResolution {
    let parsed: URL;
    try {
        parsed = new URL(sourceUrl);
    } catch {
        return null;
    }

    const host = parsed.hostname;

    if (host === 'www.inaturalist.org' || host === 'inaturalist.org') {
        return { provider: 'inaturalist', collection: 'inaturalist' };
    }

    if (host === 'salishsea.io') {
        return { provider: 'direct', collection: 'salishsea-direct' };
    }

    return null;
}
