/**
 * Bigg's catalog seed — pure functional core (decision 011).
 *
 * `parseBiggsIds` maps the committed reference TSV (data/biggs-ids.tsv) into
 * normalized catalog records. No I/O, no DB — every derivation here is a pure
 * string transform, unit-tested in biggs-ids.test.ts. The imperative shell
 * (seed-biggs.ts) reads the file, calls this, and upserts the result.
 *
 * Source columns (tab-separated, 0-indexed):
 *   0 deceased flag (D / PD / ? / blank)
 *   1 Local ID (BC/WA) — the T-code; ALSO holds collective-group labels
 *   2 Additional Designations (Alaska / California), slash-separated
 *   3 Gender (F / M / F? / unknown / blank)
 *   4 Birth Year (1979 / ≤1961 / <1968 / UNK / ? / blank)
 *   5 Nicknames (slash-separated, positionally aligned with 6 and 7)
 *   6 Story Behind the Nickname (slash-separated when the names are)
 *   7 Who Nicknamed (slash-separated; parentheticals may contain slashes)
 *   8 Other Notes or Comments
 *
 * Designation codes are kept AS WRITTEN (zero-padded, e.g. 'T065A5'). The future
 * sightings↔catalog bridge will normalize (strip padding, map trailing 's' to a
 * matriline) at match time — that matcher is NOT built here.
 */

export type Sex = 'male' | 'female';
export type LifeStatus = 'alive' | 'deceased' | 'presumed_deceased' | 'unknown';
export type DesignationScheme = 'bc_wa' | 'alaska' | 'california' | 'other';
export type DesignationStatus = 'active' | 'superseded' | 'uncertain';
export type PartyKind =
    | 'researcher' | 'organization' | 'agency' | 'community_project' | 'first_nation';
export type NicknameStatus =
    | 'official' | 'provisional' | 'proposed' | 'deprecated' | 'awaiting_decision';

export type ParsedIndividual = {
    primary_designation: string;
    sex: Sex | null;
    born_earliest: number | null;
    born_latest: number | null;
    life_status: LifeStatus;
    notes: string | null;
    mother_designation: string | null; // resolved to mother_id in shell pass 2
};

export type ParsedDesignation = {
    code: string;
    individual_designation: string;
    scheme: DesignationScheme;
    is_primary: boolean;
    status: DesignationStatus;
    in_catalog: boolean;
    superseded_by_code: string | null;
};

export type ParsedParty = { name: string; kind: PartyKind | null; url: string | null };

export type ParsedSocialGroup = {
    designation: string; // natural key: T-base for matrilines, 'Biggs' ecotype, label for named groups
    kind: 'ecotype' | 'matriline' | 'named_group';
    anchor_designation: string | null;
    parent_designation: string | null;
    notes: string | null;
};

export type ParsedMembership = {
    group_designation: string;
    individual_designation: string;
    is_current: boolean;
    joined_year: number | null;
};

export type ParsedNickname = {
    individual_designation: string | null;
    group_designation: string | null;
    name: string;
    story: string | null;
    namer_name: string | null;
    theme: string | null;
    status: NicknameStatus;
};

export type ParsedCatalog = {
    parties: ParsedParty[];
    individuals: ParsedIndividual[];
    designations: ParsedDesignation[];
    socialGroups: ParsedSocialGroup[];
    memberships: ParsedMembership[];
    nicknames: ParsedNickname[];
};

const ECOTYPE_DESIGNATION = 'Biggs';

// --- small pure helpers ---------------------------------------------------

const blank = (s: string | undefined): boolean => !s || s.trim() === '';

/** Pad the numeric block after the leading T to 3 digits: 'T46A' -> 'T046A'. */
export function padDesignation(code: string): string {
    const m = code.trim().match(/^T(\d+)(.*)$/);
    if (!m) return code.trim();
    return 'T' + (m[1] ?? '').padStart(3, '0') + (m[2] ?? '');
}

/**
 * Mother's designation by peeling the trailing genealogy segment, never past the
 * base T-number: T065A5 -> T065A, T065A -> T065, T036B1A -> T036B1, T065 -> null.
 */
export function motherDesignation(code: string): string | null {
    const base = code.match(/^T\d+/)?.[0];
    if (!base) return null;
    const rem = code.slice(base.length);
    if (rem === '') return null; // matriarch — no mother in the catalog
    const runs = rem.match(/[A-Za-z]+|[0-9]+/g) ?? [];
    runs.pop();
    return base + runs.join('');
}

/** Matriline base T-number, e.g. T065A5 -> T065. */
function matrilineBase(code: string): string | null {
    return code.match(/^T\d+/)?.[0] ?? null;
}

export function parseSex(raw: string | undefined): { sex: Sex | null; uncertain: boolean } {
    const v = (raw ?? '').trim();
    if (v === '' || /^unknown$/i.test(v)) return { sex: null, uncertain: false };
    const uncertain = v.includes('?');
    if (/^f/i.test(v)) return { sex: 'female', uncertain };
    if (/^m/i.test(v)) return { sex: 'male', uncertain };
    return { sex: null, uncertain: false };
}

export function parseLifeStatus(raw: string | undefined): LifeStatus {
    const v = (raw ?? '').trim().toUpperCase();
    if (v === 'D') return 'deceased';
    if (v === 'PD') return 'presumed_deceased';
    if (v === '?') return 'unknown';
    if (v === '') return 'alive';
    return 'unknown';
}

/** Birth year as an [earliest, latest] bound pair. */
export function parseBirth(raw: string | undefined): { earliest: number | null; latest: number | null } {
    const v = (raw ?? '').trim();
    const exact = v.match(/^(\d{4})$/);
    if (exact) {
        const y = Number(exact[1]);
        return { earliest: y, latest: y };
    }
    const bound = v.match(/^[≤<](\d{4})$/);
    if (bound) {
        const y = Number(bound[1]);
        return { earliest: null, latest: v.startsWith('<') ? y - 1 : y };
    }
    return { earliest: null, latest: null };
}

export function schemeFor(code: string): DesignationScheme {
    const c = code.trim().toUpperCase();
    if (/^CA/.test(c)) return 'california';
    if (/^(AM|AL|AQ|AO|AH|AT|AV|AB|U)\d/.test(c)) return 'alaska';
    return 'other';
}

const NOT_IN_CATALOG = /not in( the)? cat|not on finwave/i;

/** Split on '/' but not inside parentheses (namer parentheticals contain slashes). */
export function splitOutsideParens(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        if (ch === '/' && depth === 0) {
            out.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter((x) => x !== '');
}

const KNOWN_ORGS = /^(VanAqua|SIMRS|OceanWise|Ocean Wise|Orca Behavior Institute|OBI)$/i;

export function partyKind(name: string): PartyKind | null {
    if (/nick ?naming|nicknaming|community choice/i.test(name)) return 'community_project';
    if (/\b(nation|tribe|tulalip|ehattesaht|coast salish)\b/i.test(name)) return 'first_nation';
    if (/^DFO$/i.test(name)) return 'agency';
    if (KNOWN_ORGS.test(name)) return 'organization';
    if (/^[A-Z][a-z]+(\s+[A-Z][\w.'-]+)+$/.test(name)) return 'researcher'; // "Firstname Lastname"
    return null;
}

const THEME_RULES: ReadonlyArray<[RegExp, string]> = [
    [/james bond|007|goldfinger|moonraker/i, 'James Bond'],
    [/m(ö|o)tley cr(ü|u)e|rock (group|band)/i, 'Mötley Crüe'],
    [/loch ness|sea (serpent|monster)|ogopogo|cadbor/i, 'Sea monsters'],
    [/gretzky|hockey/i, 'Hockey'],
];

function themeFor(story: string | null): string | null {
    if (!story) return null;
    for (const [re, theme] of THEME_RULES) if (re.test(story)) return theme;
    return null;
}

function nicknameStatus(name: string, notes: string): NicknameStatus {
    if (/awaiting decision/i.test(notes)) return 'awaiting_decision';
    if (name.includes('*') || /open to renaming/i.test(notes)) return 'provisional';
    return 'official';
}

/** Strip a trailing community-project parenthetical, returning the person + the project. */
function splitNamer(raw: string): { person: string; project: string | null } {
    const m = raw.match(/^(.*?)\s*\(([^)]*(?:nick ?naming|nicknaming)[^)]*)\)\s*$/i);
    const person = m?.[1]?.trim();
    if (person) return { person, project: m?.[2]?.trim() ?? null };
    return { person: raw.trim(), project: null };
}

// --- main -----------------------------------------------------------------

export function parseBiggsIds(tsv: string): ParsedCatalog {
    const cat: ParsedCatalog = {
        parties: [], individuals: [], designations: [],
        socialGroups: [], memberships: [], nicknames: [],
    };
    const partyNames = new Set<string>();
    const groupKeys = new Set<string>();

    const addParty = (name: string): string | null => {
        const n = name.trim();
        if (!n) return null;
        if (!partyNames.has(n)) {
            partyNames.add(n);
            cat.parties.push({ name: n, kind: partyKind(n), url: null });
        }
        return n;
    };
    const ensureGroup = (g: ParsedSocialGroup): void => {
        if (groupKeys.has(g.designation)) return;
        groupKeys.add(g.designation);
        cat.socialGroups.push(g);
    };

    // shared ecotype parent for every matriline
    ensureGroup({
        designation: ECOTYPE_DESIGNATION, kind: 'ecotype',
        anchor_designation: null, parent_designation: null, notes: "Bigg's (transient) killer whales",
    });

    const lines = tsv.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const cells = (lines[i] ?? '').split('\t').map((c) => c.trim());
        const col = (j: number): string => cells[j] ?? '';
        const flag = col(0), localId = col(1), altIds = col(2), gender = col(3), birth = col(4);
        const nickCell = col(5), storyCell = col(6), namerCell = col(7), notesCell = col(8);

        if (cells.every(blank)) continue; // spacer
        if (i === 0 || /^D if Deceased/i.test(flag)) continue; // legend header

        // collective-label row: a name in the Local-ID column that isn't a T-code
        if (!/^T\d/i.test(localId)) {
            const label = localId.replace(/^known as( the)?\s+/i, '').replace(/^the\s+/i, '').trim();
            if (!label) continue;
            ensureGroup({
                designation: label, kind: 'named_group',
                anchor_designation: null, parent_designation: null,
                notes: 'Members not assigned in the Phase 1 seed (fuzzy in the source).',
            });
            cat.nicknames.push({
                individual_designation: null, group_designation: label, name: label,
                story: blank(storyCell) ? null : storyCell, namer_name: null,
                theme: themeFor(blank(storyCell) ? null : storyCell), status: 'official',
            });
            continue;
        }

        // ---- animal row ----
        const uncertainId = localId.endsWith('?');
        const designation = padDesignation(localId.replace(/\?+$/, ''));

        const { sex, uncertain: sexUncertain } = parseSex(gender);
        const { earliest, latest } = parseBirth(birth);
        const noteParts: string[] = [];
        if (!blank(notesCell)) noteParts.push(notesCell);
        if (sexUncertain) noteParts.push('Sex uncertain in source.');

        cat.individuals.push({
            primary_designation: designation,
            sex,
            born_earliest: earliest,
            born_latest: latest,
            life_status: parseLifeStatus(flag),
            notes: noteParts.length ? noteParts.join(' ') : null,
            mother_designation: motherDesignation(designation),
        });

        // primary (BC/WA) designation
        cat.designations.push({
            code: designation,
            individual_designation: designation,
            scheme: 'bc_wa',
            is_primary: true,
            status: uncertainId || flag.trim() === '?' ? 'uncertain' : 'active',
            in_catalog: !NOT_IN_CATALOG.test(notesCell),
            superseded_by_code: null,
        });

        // alternate (Alaska / California) designations
        for (const alt of splitOutsideParens(altIds)) {
            cat.designations.push({
                code: alt, individual_designation: designation, scheme: schemeFor(alt),
                is_primary: false, status: 'active', in_catalog: true, superseded_by_code: null,
            });
        }

        // rename synthesis, e.g. T122 "originally designated T46A"
        const renamed = `${storyCell} ${notesCell}`.match(/originally designated\s+(T\d+[A-Za-z]?\d*)/i);
        if (renamed?.[1]) {
            const oldCode = padDesignation(renamed[1]);
            if (oldCode !== designation) {
                cat.designations.push({
                    code: oldCode, individual_designation: designation, scheme: 'bc_wa',
                    is_primary: false, status: 'superseded', in_catalog: true,
                    superseded_by_code: designation,
                });
            }
        }

        // matriline group + membership
        const base = matrilineBase(designation);
        if (base) {
            ensureGroup({
                designation: base, kind: 'matriline',
                anchor_designation: base, parent_designation: ECOTYPE_DESIGNATION, notes: null,
            });
            cat.memberships.push({
                group_designation: base, individual_designation: designation,
                is_current: parseLifeStatus(flag) === 'alive', joined_year: latest,
            });
        }

        // nicknames — names, stories, namers positionally aligned on '/'
        const names = blank(nickCell) ? [] : nickCell.split('/').map((s) => s.trim()).filter(Boolean);
        const stories = storyCell.split('/').map((s) => s.trim());
        const namers = splitOutsideParens(namerCell);
        names.forEach((name, idx) => {
            const cleanName = name.replace(/\*+$/, '').trim();
            if (!cleanName) return;
            const rawNamer = (namers.length === names.length ? namers[idx] : namers[0]) ?? '';
            let namerName: string | null = null;
            if (rawNamer) {
                const { person, project } = splitNamer(rawNamer);
                namerName = addParty(person);
                if (project) addParty(project); // register the naming page as a party too
            }
            const aligned = names.length === stories.length ? stories[idx] : storyCell;
            const story = aligned && aligned.trim() !== '' ? aligned.trim() : null;
            cat.nicknames.push({
                individual_designation: designation, group_designation: null, name: cleanName,
                story, namer_name: namerName,
                theme: null, status: nicknameStatus(name, notesCell),
            });
        });
    }

    return cat;
}
