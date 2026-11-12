/**
 * The token reader, src/sighting-text.ts, which the build and the browser run, given each
 * gold row's report text.
 */

import { readText } from '../../../src/sighting-text.ts';
import type { Reading } from '../score.ts';
import { reportText, type GoldRow } from '../gold.ts';

export async function readWithTokens(rows: GoldRow[]): Promise<Map<number, Reading>> {
    return new Map(rows.map(r => [r.row, readText(reportText(r.comment))]));
}
