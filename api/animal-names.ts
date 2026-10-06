/**
 * The species names the build publishes (animal-names.json, scripts/read-path/profile-index.ts),
 * read from the export directory beside the API so a public sighting read can name the
 * species as the map would (salish-9uu.5). The file is reread when it changes, which is once
 * a build; no file (a fresh machine before its first build) means no names, and the
 * occurrence goes out with a null species name rather than failing.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { SpeciesNames } from '../src/own-occurrence.ts';

type Row = SpeciesNames & {entity_id: string};

export type NamesLookup = (entityIds: readonly string[]) => ReadonlyMap<string, SpeciesNames>;

/** A lookup over `<exportDir>/animal-names.json`, cached by the file's modification time. */
export function animalNames(exportDir: string): NamesLookup {
    const file = join(exportDir, 'animal-names.json');
    let seen = -1;
    let names = new Map<string, SpeciesNames>();
    return wanted => {
        let mtime: number;
        try {
            mtime = statSync(file).mtimeMs;
        } catch {
            return new Map();
        }
        if (mtime !== seen) {
            try {
                const rows = JSON.parse(readFileSync(file, 'utf8')) as Row[];
                names = new Map(rows.map(r => [r.entity_id, r]));
                seen = mtime;
            } catch (error) {
                console.error('api: animal-names.json unreadable', error);
                return new Map();
            }
        }
        return new Map(wanted.filter(id => names.has(id)).map(id => [id, names.get(id)!]));
    };
}
