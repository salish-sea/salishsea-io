/**
 * Measures the behaviour phrases (src/behaviour.ts, decision 116) against a year of
 * published reports and against the gold set's hand-read behaviour.
 *
 *   node scripts/gold/behaviour.ts <dir of day files>            # reports per tag, by kind of animal
 *   node scripts/gold/behaviour.ts <dir> --examples <tag> [n]     # n random reports a tag was read from
 *   node scripts/gold/behaviour.ts --gold                         # the gold rows that disagree, and why
 *
 * The day files are the site's own, https://salishsea.io/read-path/days/<date>.json. A
 * new phrase is measured with this before it joins the list; src/behaviour.test.ts
 * records which gold rows disagree.
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { PHRASES, readBehaviour } from '../../src/behaviour.ts';
import { reportText } from '../../src/sighting-text.ts';
import { loadGold } from './gold.ts';

type Occurrence = {
    id: string, body: string | null, pods: string[],
    identifiers: string[], taxon: {vernacular_name: string} | null,
};

/** The kind of animal, with an orca's ecotype taken from its codes or pods when the taxon doesn't say. */
export function kindOf(o: Pick<Occurrence, 'taxon' | 'pods' | 'identifiers'>): string {
    const name = o.taxon?.vernacular_name ?? 'unknown';
    if (/killer whale/i.test(name)) {
        if (/southern|resident/i.test(name) || o.pods.length || o.identifiers.some(c => /^[JKL]\d|^[JKL]s?$/.test(c))) return 'Southern Resident';
        if (/bigg/i.test(name) || o.identifiers.some(c => /^T\d/.test(c))) return "Bigg's";
        return 'orca, ecotype not said';
    }
    if (/humpback/i.test(name)) return 'humpback';
    if (/gray|grey/i.test(name)) return 'gray whale';
    if (/seal|sea lion|pinniped/i.test(name)) return 'pinniped';
    return 'other';
}

const KINDS = ['Southern Resident', "Bigg's", 'orca, ecotype not said', 'humpback', 'gray whale', 'pinniped', 'other'];

function load(dir: string) {
    return readdirSync(dir).filter(f => f.endsWith('.json')).sort()
        .flatMap(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Occurrence[])
        .filter(o => o.body)
        .map(o => ({...o, text: reportText(o.body!), kind: kindOf(o)}))
        .filter(o => o.text);
}

/** A seeded shuffle, so a list of examples is the same on every run. */
function sample<T>(xs: T[], n: number, seed = 1): T[] {
    const a = [...xs];
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) % 2 ** 31;
        const j = s % (i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a.slice(0, n);
}

/** A Markdown table: reports per tag, by kind, in the list's order. */
function counts(dir: string) {
    const reports = load(dir).map(r => ({...r, tags: readBehaviour(r.text)}));
    const perKind = KINDS.map(k => reports.filter(r => r.kind === k).length);
    console.log(`${reports.length} reports with text, ${reports.filter(r => r.tags.length).length} with a tag\n`);
    console.log(`| tag | ${KINDS.map((k, i) => `${k} (${perKind[i]!.toLocaleString('en')})`).join(' | ')} | all |`);
    console.log(`|---|${KINDS.map(() => '--:').join('|')}|--:|`);
    for (const {tag} of PHRASES) {
        const hits = reports.filter(r => r.tags.includes(tag));
        console.log(`| ${tag} | ${KINDS.map(k => hits.filter(h => h.kind === k).length || '').join(' | ')} | ${hits.length} |`);
    }
}

function examples(dir: string, tag: string, n: number) {
    const hits = load(dir).filter(r => readBehaviour(r.text).includes(tag));
    for (const r of sample(hits, n)) console.log(`[${r.kind}] ${r.text.slice(0, 300)}`);
}

/** The gold rows whose text reads differently from their labels put through the same list. */
function gold() {
    const unread = new Map<string, number>();
    for (const row of loadGold()) {
        const labelled = new Set(row.behaviour.flatMap(phrase => readBehaviour(phrase)));
        const read = new Set(readBehaviour(row.text));
        for (const phrase of row.behaviour) if (!readBehaviour(phrase).length) unread.set(phrase, (unread.get(phrase) ?? 0) + 1);
        const plus = [...read].filter(t => !labelled.has(t));
        const minus = [...labelled].filter(t => !read.has(t));
        if (plus.length) console.log(`row ${row.row}: read, not labelled: ${plus.join(', ')}: ${row.text.slice(0, 200)}`);
        if (minus.length) console.log(`row ${row.row}: labelled, not read: ${minus.join(', ')}: ${row.text.slice(0, 200)}`);
    }
    console.log(`\nlabelled phrases no tag takes: ${[...unread].map(([p, n]) => n > 1 ? `${p} (${n})` : p).join('; ')}`);
}

if (import.meta.main) {
    const [first, flag, ...rest] = process.argv.slice(2);
    if (first === '--gold') gold();
    else if (!first) { console.error('usage: node scripts/gold/behaviour.ts <dir of day files> [--examples <tag> [n]] | --gold'); process.exit(2); }
    else if (flag === '--examples') examples(first, rest[0]!, Number(rest[1] ?? 20));
    else counts(first);
}
