/**
 * Score the readers of sighting text against the gold set (decision 102):
 *
 *   node scripts/gold/measure.ts [regex] [tokens] [claude-haiku-5-5] [claude-sonnet-5-5] [--show 23 40]
 *
 * `--show` prints each listed row's text, its reading and its gold labels.
 *
 * Prints, for each reader, a table of reports read right per field by stratum, with the
 * held-out half of the random strata (gold.ts) separated from the half a reader may have
 * been developed on. A model reader needs credentials (readers/claude.ts) and caches its
 * readings beside the fixture, so a rerun costs nothing and the readings can be reviewed.
 */

import { isHeldOut, loadGold, reportText, type GoldRow } from './gold.ts';
import { scoreRow, table, tally, type Reading } from './score.ts';
import { readWithRegex } from './readers/regex.ts';

type Reader = (rows: GoldRow[]) => Promise<Map<number, Reading>>;

const READERS: Record<string, () => Promise<Reader>> = {
    regex: async () => readWithRegex,
    tokens: async () => (await import('./readers/tokens.ts')).readWithTokens,
    'claude-haiku-5-5': async () => (await import('./readers/claude.ts')).claudeReader('claude-haiku-5-5'),
    'claude-sonnet-5-5': async () => (await import('./readers/claude.ts')).claudeReader('claude-sonnet-5-5'),
};

const group = (row: GoldRow) => isHeldOut(row) ? `${row.stratum} (held out)` : row.stratum;

const args = process.argv.slice(2);
const showAt = args.indexOf('--show');
const show = new Set(showAt < 0 ? [] : args.slice(showAt + 1).map(Number));
const named = (showAt < 0 ? args : args.slice(0, showAt));
const names = named.length ? named : ['regex'];
const rows = loadGold();
for (const name of names) {
    const make = READERS[name];
    if (!make) { console.error(`no reader ${name}; readers: ${Object.keys(READERS).join(', ')}`); process.exit(2); }
    const readings = await (await make())(rows);
    console.log(`\n## ${name}\n`);
    console.log(table(tally(rows, readings, group)));
    const wrong = tally(rows, readings, () => 'all').get('all')!.wrong;
    console.log(`\nwrong: ${Object.entries(wrong).map(([f, rs]) => `${f} ${rs.length} [${rs.join(' ')}]`).join('; ')}`);
    for (const row of rows.filter(r => show.has(r.row))) {
        const got = readings.get(row.row)!;
        const bad = Object.entries(scoreRow(row, got)).filter(([, ok]) => !ok).map(([f]) => f);
        console.log(`\n#${row.row} ${reportText(row.comment)}\n  read: ${JSON.stringify(got)}\n  gold: present ${row.codes_present} | absent ${row.codes_absent} | hedged ${row.codes_hedged} | pods ${row.pods} | direction ${row.direction}${bad.length ? `\n  wrong: ${bad.join(', ')}` : ''}`);
    }
}
