/**
 * DarwinCore Archive field definitions — source of truth for Phase 6 archive
 * generation.
 *
 * Each entry pairs a column `name` (used as the header in the data file and
 * as the field name in `meta.xml`) with the canonical DarwinCore (or dcterms)
 * `termUri`. The array index is load-bearing: it is both the column ordinal
 * in the generated TSV/CSV AND the field index emitted into `meta.xml`. The
 * migration that projects rows for export pins its `SELECT` column order to
 * this same ordinal, so reordering an entry without a matching migration edit
 * silently corrupts the archive.
 *
 * Wave 0 (Plan 01) ships placeholder empty arrays so downstream wiring —
 * `tsconfig.json` include, Vitest discovery, and module resolution — can be
 * exercised end-to-end before any real field content lands. Wave 1 / Plan 02
 * populates `OCCURRENCE_FIELDS` with the 25 occurrence terms (dcterms pair at
 * positions 19 = `rightsHolder` and 22 = `license`) and `MULTIMEDIA_FIELDS`
 * with the 6 multimedia terms (dcterms at positions 1..5). Until then, do not
 * consume these arrays — importers should expect zero entries.
 *
 * Cross-reference: see `.planning/phases/06-archive-generation/06-CONTEXT.md`
 * F-01 for the field-shape contract and F-03 for the ordinal-stability rule.
 */

export type OccurrenceField = {
    readonly name: string;
    readonly termUri: string;
};

export type MultimediaField = {
    readonly name: string;
    readonly termUri: string;
};

/**
 * Wave-0 placeholder. Plan 02 (Wave 1) replaces this with the 25 occurrence
 * terms from RESEARCH §T4. Do not rely on entry count or ordering here.
 */
export const OCCURRENCE_FIELDS = [] as const satisfies readonly OccurrenceField[];

/**
 * Wave-0 placeholder. Plan 02 (Wave 1) replaces this with the 6 multimedia
 * terms from RESEARCH §T4. Do not rely on entry count or ordering here.
 */
export const MULTIMEDIA_FIELDS = [] as const satisfies readonly MultimediaField[];
