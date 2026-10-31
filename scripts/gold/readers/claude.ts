/**
 * A Claude model reading sighting text, scored like the other readers.
 *
 * One request per report: the system prompt holds the task, the gold set's definitions
 * of the fields and a dictionary from the checked-in catalogue (codes, matrilines and
 * nicknames), cached across requests; the user turn is the report text. The answer is
 * structured output against READING below. Every reading is cached in
 * scripts/gold/readings/<model>.json by the text's hash, so a rerun costs nothing and
 * the readings can be reviewed and diffed; delete an entry to read it again.
 *
 * Credentials: the SDK's zero-argument client reads an `ant auth login` profile (the
 * Anthropic CLI, ~/.config/anthropic) or ANTHROPIC_API_KEY. The comments sent are public
 * Maplify reports the project already publishes in its archive (decision 101).
 *
 * Refusal fallbacks are not configured: a refusal on whale-sighting text would be a
 * surprise worth seeing, so it is thrown with the row number instead of hidden.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { reportText, type GoldRow } from '../gold.ts';
import type { Reading } from '../score.ts';

export const READING = z.object({
    codes_present: z.array(z.string()).describe('Catalogue codes of the animals and matrilines the text says were there, in the form T65A5, T36Bs, CRC531.'),
    codes_absent: z.array(z.string()).describe('Codes the text says were not there.'),
    codes_hedged: z.array(z.string()).describe('Codes among codes_present whose presence the text hedges.'),
    pods: z.array(z.enum(['J', 'K', 'L'])).describe('Southern Resident pods the text names.'),
    direction: z.enum(['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest', 'milling', 'unknown']).nullable()
        .describe('The direction of travel at the time of the report, or milling, or unknown, or null when the text says nothing about travel.'),
    ecotype: z.enum(['Biggs', 'SRKW']).nullable(),
    nicknames: z.array(z.string()).describe('Animals named by nickname rather than code, as written.'),
    count_min: z.number().int().nullable().describe('The smallest number of animals the text itself states.'),
    calf: z.boolean().describe('The text mentions a calf.'),
});
export type ModelReading = z.infer<typeof READING>;

const CATALOGUE = new URL('../../../data/catalogue/', import.meta.url);
const tsv = (name: string) => {
    const [head, ...rows] = readFileSync(new URL(name, CATALOGUE), 'utf8').trim().split('\n').map(l => l.split('\t'));
    return rows.map(r => Object.fromEntries(head!.map((k, i) => [k, r[i] ?? ''])));
};

/** The dictionary the model reads with: every code, matriline and nickname the catalogue holds. */
export function dictionary(): string {
    const designations = tsv('designations.tsv');
    const primary = new Map(designations.filter(d => d.is_primary === 'true').map(d => [d.individual_id, d.code]));
    const codes = [...new Set(designations.map(d => d.code!))].sort();
    const matrilines = tsv('social-groups.tsv').filter(g => g.kind === 'matriline').map(g => g.designation + 's').sort();
    const nicknames = tsv('nicknames.tsv').filter(n => n.individual_id && primary.has(n.individual_id))
        .map(n => `${n.name} = ${primary.get(n.individual_id)}`).sort();
    return [
        `Codes of individual animals the catalogue knows (new ones appear every year, so a code not listed here can still be real):\n${codes.join(' ')}`,
        `Matrilines (a code with a trailing s names a family):\n${matrilines.join(' ')}`,
        `Nicknames and the code of the animal they name:\n${nicknames.join('; ')}`,
    ].join('\n\n');
}

export const SYSTEM = `You read one report of a whale sighting from the Salish Sea and say what its text states. The reports come from Orca Network and the public; they are terse and use conventions you must know:

- "Biggs" means Bigg's (transient) killer whales; their codes begin with T. "SRKW" is the Southern Resident killer whales, whose pods are J, K and L. "Js", "Ks", "Ls", "J pod", "Jpod" name a pod. CRC codes are gray whales, BCX codes are humpbacks.
- A code with a trailing s is a matriline (T36Bs). A code may be written without its letter after a slash or comma: "T36/36Bs" names T36 and T36Bs; "T36A1s, 65A5, and 137s" names T36A1s, T65A5 and T137s; "68Cs, 69A4" after "Biggs" are T68Cs and T69A4. A hyphen may sit inside a code: "T65-A3" is T65A3.
- An exclusion names animals that were NOT there: "T46s (-D)" means the T46s were there but T46D was not; "(-T46D)" the same; "T124As (-A4s)" means the T124A4s were absent; "T137s (-A)" or "T137s minus T137A" means T137A was absent; "T65As (minus A5)" means T65A5 was absent; "T60s minus T60D&E" means T60D and T60E were absent.
- A hedge ("likely", "possibly", "maybe", "presumably", "?") marks the codes it applies to as hedged; they are still listed as present. "Likely Biggs T137s and T36A1s" hedges both.
- Direction is the travel direction at the time of the report, as one of eight compass points. "NB", "SB", "EB", "WB", "NE bound", "SW bound", "heading in a SE direction", "trending N" count. A bearing from a landmark ("north of Alki", "1/2 mile southeast of Polnell Point", "W of mid channel") is a position, not a direction. A place name ("West Point", "North Beach") is not a direction. A spread ("spread north to south", "N to S", "wide north-south spread") is not a direction. "Facing west" is not travel. When the text narrates a change ("had been northbound, now stalled"; "southbound then turned west"), answer the direction now. "milling", "stalled", "directional changes", "multidirectional" with no net travel is "milling". "direction unknown" is "unknown". Say null only when the text says nothing about travel.
- Only what the text states. Do not infer an absent animal the text does not name, do not add behaviour the text does not describe, and take a count only from the text ("at least two orcas" is 2; "4-6 orcas" is 4).

Answer with the structured fields and nothing else.

${dictionary()}`;

const cachePath = (model: string) => new URL(`../readings/${model}.json`, import.meta.url);
type CacheEntry = {text: string, sha256: string, reading: ModelReading, usage: {input: number, output: number, cache_read: number}};

/** A reader for one model, answering from its cache where the text has not changed. */
export function claudeReader(model: string) {
    return async (rows: GoldRow[]): Promise<Map<number, Reading>> => {
        const path = cachePath(model);
        const cache: Record<string, CacheEntry> = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
        const client = new Anthropic();
        const pending = rows.filter(r => cache[r.maplify_id]?.sha256 !== sha(reportText(r.comment)));
        if (pending.length) console.error(`${model}: reading ${pending.length} of ${rows.length} reports`);
        let n = 0;
        await Promise.all(Array.from({length: 4}, async () => {
            for (;;) {
                const r = pending[n++];
                if (!r) return;
                const text = reportText(r.comment);
                const response = await client.messages.parse({
                    model, max_tokens: 2000,
                    system: [{type: 'text', text: SYSTEM, cache_control: {type: 'ephemeral'}}],
                    messages: [{role: 'user', content: text}],
                    output_config: {format: zodOutputFormat(READING)},
                });
                if (response.stop_reason === 'refusal') throw new Error(`row ${r.row}: refused: ${JSON.stringify(response.stop_details)}`);
                if (!response.parsed_output) throw new Error(`row ${r.row}: no parsed output (${response.stop_reason})`);
                cache[r.maplify_id] = {text, sha256: sha(text), reading: response.parsed_output, usage: {
                    input: response.usage.input_tokens, output: response.usage.output_tokens,
                    cache_read: response.usage.cache_read_input_tokens ?? 0,
                }};
                save(path, cache);
            }
        }));
        save(path, cache);
        return new Map(rows.map(r => {
            const m = cache[r.maplify_id]!.reading;
            return [r.row, {codes_present: m.codes_present, codes_absent: m.codes_absent, codes_hedged: m.codes_hedged, pods: m.pods, direction: m.direction}];
        }));
    };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** The cache on disk, one entry per line, in id order, so a rerun's diff is readable. */
function save(path: URL, cache: Record<string, CacheEntry>): void {
    const ids = Object.keys(cache).sort((a, b) => Number(a) - Number(b));
    writeFileSync(path, '{\n' + ids.map(id => `${JSON.stringify(id)}: ${JSON.stringify(cache[id])}`).join(',\n') + '\n}\n');
}
