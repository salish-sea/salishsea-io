/**
 * The Pacific day, the one definition the read-path scripts share (salish-9uu.8.3):
 * the day files, the id index and the calendar group occurrences by it, the manifest
 * says which day a snapshot covers through, and the snapshot dates its year by it. A
 * zone or format changed in one and not another would put an id in a day whose file
 * doesn't hold it.
 *
 * It is the frontend's day too (OBSERVATION_TIME_ZONE in src/constants.ts, which a test
 * holds this to), and Stelis's salishsea.rkt carries a hand copy of dayOf('observed_at')
 * as OCCURRENCE-DAY, which the store-keyed check on days/ holds to occurrence-days. Every
 * task whose script imports this lists it among its code there, so a change here
 * reruns them all. A module of its own, rather than occurrence-days.ts's export, so a
 * change to how the day files are written doesn't rerun the tasks that only share the day.
 */

export const DAY_ZONE = 'PST8PDT';

/** DuckDB SQL for the Pacific day of a timestamptz column, as YYYY-MM-DD. */
export function dayOf(column: string): string {
    return `strftime(timezone('${DAY_ZONE}', ${column}), '%Y-%m-%d')`;
}
