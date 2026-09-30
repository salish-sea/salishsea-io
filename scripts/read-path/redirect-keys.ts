/**
 * The redirect map's shape and keys (decision 057, step 5), shared by the build that
 * writes it (profile-index.ts) and the server that answers from it (redirect.ts).
 * Kept apart so the server, which runs all day beside Caddy on a small machine, loads
 * the fold and nothing else: not the catalogue, the renderer or DuckDB.
 */

import { fold } from '../../src/fold.ts';

/** The kinds a designation path can name. A haul-out has no designation, only its id. */
export type Redirects = {
    individuals: Record<string, string>,
    matrilines: Record<string, string>,
    ecotypes: Record<string, string>,
};

/** A designation as a redirect key: folded as the register compares names. */
export const designationKey = fold;

/**
 * A typed matriline segment as a redirect key. People write the group's form
 * (T065As) as often as the matriarch's code (T065A) that social_groups holds, and
 * the route has already said this is a group, so a trailing s is dropped here —
 * safe only because of that, as src/catalog.ts's matrilineDesignation says.
 */
export const matrilineKey = (segment: string) => fold(segment).replace(/s$/, '');
