/**
 * Maplify (name, scientific name) pairs a curator has accepted as un-named
 * (salish-xv35.9.2): data/maplify-unnamed.tsv.
 *
 * A register edition that stops naming a pair Maplify sightings carry would drop those
 * sightings from the map. Two checks refuse that — register-refresh.yml before it loads
 * the edition (check-unnaming.ts), and the build's own gate before it derives
 * (read-path/check-maplify-names.ts) — and both read this one file for the pairs a
 * curator means to un-name, so an accepted un-naming is one reviewed change rather than
 * a file edited on a volume.
 *
 * TSV with a header, as the register's own files are: `name` empty means the sighting
 * carries no common name (the pair is keyed on NULL, not on the string "null").
 */

import { readFileSync } from 'node:fs';

export type Pair = {readonly name: string | null, readonly scientific_name: string};
export type Unnamed = Pair & {readonly since: string, readonly reason: string};

const COLUMNS = ['name', 'scientific_name', 'since', 'reason'] as const;

/** One key for a pair, wherever pairs are compared; NULL and "null" stay distinct. */
export const pairKey = (p: Pair): string => JSON.stringify([p.name, p.scientific_name]);

/** Parse the file's text; refuses a changed header or a ragged row rather than guess. */
export function parseUnnamed(text: string): Unnamed[] {
    const lines = text.replace(/\n$/, '').split('\n').filter(l => l !== '');
    if (lines.length === 0) return [];
    const header = lines[0]!.split('\t');
    if (header.length !== COLUMNS.length || COLUMNS.some((c, i) => header[i] !== c))
        throw new Error(`maplify-unnamed.tsv: expected columns ${COLUMNS.join(', ')}, got ${header.join(', ')}`);
    return lines.slice(1).map(line => {
        const cells = line.split('\t');
        if (cells.length !== COLUMNS.length)
            throw new Error(`maplify-unnamed.tsv: ragged row (${cells.length} of ${COLUMNS.length}): ${line.slice(0, 120)}`);
        const [name, scientific_name, since, reason] = cells as [string, string, string, string];
        if (scientific_name === '' && name === '') throw new Error('maplify-unnamed.tsv: a row names no pair');
        return {name: name === '' ? null : name, scientific_name, since, reason};
    });
}

/** The accepted pairs' keys; an absent file means none. */
export function readUnnamed(file: string | undefined): Set<string> {
    if (file === undefined) return new Set();
    return new Set(parseUnnamed(readFileSync(file, 'utf8')).map(pairKey));
}
