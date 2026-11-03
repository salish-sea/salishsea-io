/**
 * How the site reads a sighting's free text: the codes it names, each as a claim that the
 * animal or group was present or absent, with how sure the reporter was; the pods it
 * names; and the direction of travel. A few rules over the words, with no model, no
 * network and no dictionary, so the build (scripts/read-path/derive/readings.ts) and the
 * browser (identifiers.ts) run the same code and get the same answer every time
 * (decision 105, which replaced the build's regular expressions).
 *
 * readSighting takes a sighting's body as a source stores it; readText takes the part a
 * reader should read, which reportText cuts from it. The codes are found as the old regex
 * found them, plus three things it could not see: a code written without its letter after
 * a slash or comma ("T36/36Bs", "T36A1s, 65A5"), which takes the letter of the code before
 * it or T when the text says Biggs; a hyphen inside a code ("T65-A3"); and an exclusion,
 * "(-D)", "(-T46D)", "minus T137A", "minus T60D&E", whose animals are absent, a short form
 * resolved against the matriline before it. A negation in a sentence makes absent the
 * codes it governs: "no T100E", "not the T090s actually", "I don't recognize this as any
 * T077", and a list after it ("no T060D T060E", "Not seeing T65A2 & A3"). A code's leading
 * zeros are dropped while a digit follows ("T065A" is "T65A"), as the register's fold
 * compares codes. A hedge word marks the codes that follow it up to the next comma:
 * "likely" and "presumably" make them probable, "possibly", "maybe", "not sure" and "?"
 * possible (decision 054's certainty). Pods
 * are "J pod", "Jpod", "Js", "J and K pods". The direction is a compass word or
 * abbreviation, "NB", "SW bound", "trending N", ignoring a bearing ("north of Alki",
 * "1/2 mile southeast of"), a place name ("West Point"), a spread ("north to south", "N to
 * S") and "facing"; after "now", "then" or "turned", the direction after the cue wins,
 * and "stalled" or "milling" there means milling.
 *
 * Measured against the hand-read gold set (scripts/read-path/fixtures/gold/, decision
 * 102), whose hard strata and the first half of its random strata it was developed
 * against; the second half is held out (scripts/gold/gold.ts). sighting-text.test.ts
 * records the rows it gets wrong today.
 */

export type Certainty = 'certain' | 'probable' | 'possible';
export type Presence = 'present' | 'absent';
/** One code the text names: whether it says the animal or group was there, and how sure the reporter was. */
export type Claim = {code: string, presence: Presence, certainty: Certainty};

export type Reading = {
    claims: Claim[];
    /** The Southern Resident pods named, as their letters. */
    pods: string[];
    /** A compass direction ("north" … "northwest"), "milling", "unknown", or null. */
    direction: string | null;
};

export const present = (r: Reading) => r.claims.filter(c => c.presence === 'present').map(c => c.code);
export const absent = (r: Reading) => r.claims.filter(c => c.presence === 'absent').map(c => c.code);
export const hedged = (r: Reading) => r.claims.filter(c => c.presence === 'present' && c.certainty !== 'certain').map(c => c.code);

/**
 * The part of a sighting's body a reader should read: the collection tag at the front
 * ("[Orca Network] "), Maplify's trailing "Submitted by …" attribution and any HTML
 * removed, whitespace collapsed. The gold set's `text` column was cut the same way. From
 * 2020 to early 2022 Orca Network wrote the whole report inside the tag, after a colon
 * ("[Orca Network: T65As northbound]"), and then the report is what follows the colon.
 */
export function reportText(body: string): string {
    let text = body.replace(/<br><br>Submitted by .*$/s, '').replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const tag = /^\[([^\]:]+)(?::([^\]]*))?\]+/.exec(text);
    // A collection's name has no digits; "[T65A5] heading north" is a note, and is read.
    if (tag && !/\d/.test(tag[1]!)) text = ((tag[2] ?? '') + ' ' + text.slice(tag[0].length)).trim();
    return text;
}

/** A sighting's body, as a source stores it, read. */
export function readSighting(body: string): Reading {
    return readText(reportText(body));
}

// A letter in capitals may stand apart from its number ("T 65", "CRC-56"); one in lower case
// only touching it ("t46s", "crc22"), or "crc " before one, so a word ending in t or l
// before a number is not read as a code. A suffix is at most three letter groups ("A1B2s"),
// so words run together ("T49A1Southbound") are not one.
const CODE = /\b(?:([TJKL]|CRC|BCX)\s?-?\s?|([tjkl]|[Cc]rc\s?)(?=\d))?(\d{1,5})(?:-?((?:[A-Za-z]\d*){1,3}))?(s)?\b/g;
// What may stand between two codes of one list, so a code without its letter takes the letter of the one before.
const LIST_GAP = /^\s*(?:(?:[,\/&+]|and)\s*)+$/i;
// "Biggs 36Bs": a code without its letter right after the ecotype's name is a Bigg's code.
const AFTER_BIGGS = /\b(?:biggs?|bigg['’]s|transients?)[\s:,]*$/i;
const HEDGE = /\b(likely|possibly|possible|maybe|presumably|presumed|probably|probable|unconfirmed|not (?:sure|certain|positive|100\s*%?))\b|\?/gi;
/** Decision 054's certainty for a hedge word: a strong hedge is probable, a weak one possible. */
const LEVEL: Record<string, Certainty> = {likely: 'probable', presumably: 'probable', presumed: 'probable', probably: 'probable', probable: 'probable',
    possibly: 'possible', possible: 'possible', maybe: 'possible', unconfirmed: 'possible', '?': 'possible'};
const levelOf = (hedge: string): Certainty => LEVEL[hedge.toLowerCase()] ?? 'possible';
const EXCLUDE = /\(\s*-\s*|\bminus\b|(?<=[A-Za-z0-9]s)\s+-(?=[A-Z])/g;
// A negation in a sentence, as people write in comments on iNaturalist ("not the T090s
// actually", "I don't recognize this as any T077 orca"): the codes it governs are absent.
// "Not sure", "not certain", "not positive" and "not 100%" are hedges, not negations (see
// HEDGE), "not only", "not just" and "no doubt" affirm, "never mind" negates nothing, and a question ("Isn't it T65A?")
// asks rather than says, so its "?" hedges the code instead.
const NEGATION = /\b(?:not(?!\s+(?:sure|certain|positive|100\s*%?|only|just)\b)|no(?!\s+doubt\b)|never(?!\s+mind\b)|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|don['’]t|doesn['’]t|didn['’]t)\b/gi;
// What may stand between a negation and the first code it governs: a few words of the
// same clause, "the", "any", "think this is", "recognize this as any", and no punctuation.
const NEGATED_GAP = /^(?:\s+(?:the|a|an|any|one|of|this|that|these|those|it|it['’]s|is|was|are|were|be|as|actually|from|in|part|recognize|think|believe|see|seen|seeing|either|even|quite|just))*\s+$/i;
// What may stand between two codes a negation governs, matched at the start of the rest: a
// list over a comma, a slash, "&", "and", "or", "nor" or only a space ("no T060D T060E").
const NEGATED_LIST = /^\s*(?:(?:[,\/&+]|and|or|nor)\s*)*(?:the\s+)?/i;

type Code = {start: number, end: number, text: string, letter: string | null, suffix: string, matriline: boolean};

/** Every code-shaped token in the text, with the letter it carries, if any. */
function codeTokens(text: string): Code[] {
    const out: Code[] = [];
    for (const m of text.matchAll(CODE)) {
        let [, upper, lower, digits, suffix = '', s] = m;
        const letter = (upper ?? lower)?.trim().toUpperCase();
        digits = digits!.replace(/^0+(?=\d)/, '');
        const whole = m[0];
        // The suffix pattern eats a trailing matriline s; give it back.
        if (suffix.endsWith('s')) { suffix = suffix.slice(0, -1); s = 's'; }
        const matriline = s === 's';
        // Bare digits with nothing after them are a count, a date or a time, never a code.
        if (!letter && !suffix && !matriline) continue;
        // "4 nm", "20 whales" and the like carry no letter; a suffix of real letters is
        // allowed only when the token's letter is known from context (resolved later).
        if (!letter && /^[a-z]/.test(suffix)) continue;
        const code = (letter ?? '') + digits + suffix.toUpperCase() + (matriline ? 's' : '');
        out.push({start: m.index!, end: m.index! + whole.length, text: code, letter: letter ?? null, suffix: suffix.toUpperCase(), matriline});
    }
    return out;
}

/** The code with its trailing s removed, and the last letter group removed if asked. */
const base = (code: string, dropLastGroup: boolean) => {
    let b = code.replace(/s$/, '');
    if (dropLastGroup) b = b.replace(/[A-Z]\d*$/, '');
    return b;
};

/** The text a reader should read (reportText), read. */
export function readText(text: string): Reading {
    const tokens = codeTokens(text);
    // A code without its letter takes the letter of the code before it in a list ("T36,
    // 36Bs", "T36/36Bs", "CRC 21 and 22"), or T right after the text says Biggs. Anywhere
    // else it is a count ("spread in 1s to 4s").
    let previous: Code | null = null;
    for (const t of tokens) {
        if (t.letter) { previous = t; continue; }
        const listed = previous !== null && LIST_GAP.test(text.slice(previous.end, t.start));
        const letter = listed ? previous!.letter : AFTER_BIGGS.test(text.slice(0, t.start)) ? 'T' : null;
        if (!letter) { t.text = ''; continue; }
        t.letter = letter; t.text = letter + t.text;
        previous = t;
    }
    const named = tokens.filter(t => t.text);

    // Exclusions: a cue, then codes or short suffixes up to the next word that is neither.
    const absent = new Set<string>();
    const excludedIdx = new Set<number>();
    for (const cue of text.matchAll(EXCLUDE)) {
        let pos = cue.index! + cue[0].length;
        // The matriline the short forms are relative to: the last code before the cue.
        const before = named.filter(t => t.end <= cue.index!).at(-1);
        let previousAbsent: string | null = null;
        for (;;) {
            const rest = text.slice(pos);
            // A list of absent animals continues over a comma or an ampersand; "and" starts the next present group.
            const gap = /^[\s,&]*/.exec(rest)![0];
            const at = pos + gap.length;
            const tok: Code | undefined = named.find(t => t.start === at);
            if (tok) {
                absent.add(tok.text); excludedIdx.add(named.indexOf(tok)); previousAbsent = tok.text; pos = tok.end; continue;
            }
            const short = /^([A-Z]\d*s?)(?![A-Za-z])/.exec(text.slice(at));
            if (short && (before || previousAbsent)) {
                const suffix = short[1]!;
                let code: string;
                if (previousAbsent) code = base(previousAbsent, true) + suffix;
                else {
                    const b = base(before!.text, false);
                    const lastGroup = /[A-Z]\d*$/.exec(b)?.[0];
                    code = (lastGroup && lastGroup[0] === suffix[0] ? b.slice(0, -lastGroup.length) : b) + suffix;
                }
                absent.add(code); previousAbsent = code; pos = at + suffix.length; continue;
            }
            break;
        }
    }
    // Negations: the first code within a few words of the same clause, then the codes listed
    // after it, a short form taking its matriline from the code before it ("Not seeing T65A2
    // & A3"), as an exclusion's does.
    const questioned = new Set<string>();
    for (const cue of text.matchAll(NEGATION)) {
        // a question ("Isn't it T65A?"): its codes are possible, not absent. The "?" must end
        // the negation's own clause, not a later one that "but" or a comma and a question word
        // begins ("No T65A, but is it T65B?", "No T65A, is it T65B?").
        const question = /^(?:(?!\bbut\b|,\s*(?:is|are|was|were|could|can|would|do|does|did|isn['’]t|aren['’]t)\b)[^.;!?])*\?/i
            .exec(text.slice(cue.index!));
        if (question) {
            const end = cue.index! + question[0].length;
            for (const t of named) if (t.start >= cue.index! && t.end <= end) questioned.add(t.text);
            continue;
        }
        const first = named.find(t => t.start >= cue.index! + cue[0].length);
        if (!first || !NEGATED_GAP.test(text.slice(cue.index! + cue[0].length, first.start) || ' ')) continue;
        let previousAbsent: string | null = null;
        let pos = first.start;
        for (;;) {
            const at: number = previousAbsent === null ? pos : pos + NEGATED_LIST.exec(text.slice(pos))![0].length;
            const tok: Code | undefined = named.find(t => t.start === at);
            if (tok) { absent.add(tok.text); excludedIdx.add(named.indexOf(tok)); previousAbsent = tok.text; pos = tok.end; continue; }
            // a short form with a digit ("& A3"), or a matriline's letter alone after a list
            // separator ("& B"), but not a word such as "I"
            const listed = /[,\/&+]|\b(?:and|or|nor)\b/i.test(text.slice(pos, at));
            const short: RegExpExecArray | null = previousAbsent === null ? null
                : /^([A-Z]\d+s?)(?![A-Za-z0-9])/.exec(text.slice(at)) ?? (listed ? /^([A-H])(?![A-Za-z0-9'’])/.exec(text.slice(at)) : null);
            if (short) { const code: string = base(previousAbsent!, true) + short[1]!; absent.add(code); previousAbsent = code; pos = at + short[1]!.length; continue; }
            break;
        }
    }
    const present: string[] = [];
    named.forEach((t, i) => { if (!excludedIdx.has(i) && !present.includes(t.text)) present.push(t.text); });

    // Hedges: the codes after a hedge word, up to the next comma, period or closing bracket,
    // carry the word's certainty; a code under two hedges takes the weaker.
    const certainty = new Map<string, Certainty>([...questioned].map(code => [code, 'possible' as const]));
    for (const h of text.matchAll(HEDGE)) {
        const level = levelOf(h[0]);
        const end = text.slice(h.index!).search(/[,.;)]|\bbut\b/);
        const stop = end < 0 ? text.length : h.index! + end;
        for (const t of named) {
            if (t.start >= h.index! && t.end <= stop && present.includes(t.text) && certainty.get(t.text) !== 'possible') certainty.set(t.text, level);
        }
    }
    const claims: Claim[] = [
        ...present.map(code => ({code, presence: 'present' as const, certainty: certainty.get(code) ?? 'certain'})),
        ...[...absent].map(code => ({code, presence: 'absent' as const, certainty: 'certain' as const})),
    ];

    // Pods.
    const pods = new Set<string>();
    for (const m of text.matchAll(/\b([JKL])(?:s|'s)\b/g)) pods.add(m[1]!);
    for (const m of text.matchAll(/\b([JKLjkl](?:\s*(?:,\s*and|,|and|&|\+)\s*[JKLjkl])*)\s*-?\s?pods?\b/g)) {
        for (const l of m[1]!.toUpperCase().match(/[JKL]/g) ?? []) pods.add(l);
    }

    return {claims, pods: [...pods], direction: readDirection(text)};
}

const FULL: Record<string, string> = {
    north: 'north', south: 'south', east: 'east', west: 'west',
    northeast: 'northeast', northwest: 'northwest', southeast: 'southeast', southwest: 'southwest',
    n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
};
// A compass word, or a compass abbreviation that the words around it make a direction.
const COMPASS = /\b((?:north[- ]?(?:east|west)|south[- ]?(?:east|west)|north|south|east|west)(?:\s?-?bound)?|(?:NB|SB|EB|WB)|(?<=\b(?:heading|headed|trending|trend|going|moving|traveling|travelling|drifting|continuing|direction)\s+)(?:NE|NW|SE|SW|N|S|E|W)|(?:NE|NW|SE|SW|N|S|E|W)(?=\s*-?\s*(?:bound|direction|toward)))\b/gi;
const MILLING = /\b(milling|stalled|directional changes|multi ?-?directional|shuffling|foraging)\b/i;
const TRAVEL_WORD = /^(?:heading|headed|traveling|travelling|moving|going|swimming|trending|continuing|tracking|turning|now|then|turned|direction)$/i;
const UNKNOWN = /direction (?:unknown|unconfirmed|not given)|no direction/i;
const CHANGE = /\b(now|then|turned|flipped|changed direction|committed to)\b/gi;

// "south and east bound": one direction from two words.
const COMPOUND = /\b(north|south)\s+and\s+(east|west)\s*-?\s*bound\b/gi;

function mentions(text: string): {at: number, dir: string}[] {
    const out: {at: number, dir: string}[] = [];
    const compounds = [...text.matchAll(COMPOUND)].map(m => ({at: m.index!, end: m.index! + m[0].length, dir: `${m[1]!.toLowerCase()}${m[2]!.toLowerCase()}`}));
    out.push(...compounds);
    for (const m of text.matchAll(COMPASS)) {
        if (compounds.some(c => m.index! >= c.at && m.index! < c.end)) continue;
        const word = m[1]!;
        const before = text.slice(0, m.index!);
        const after = text.slice(m.index! + word.length);
        const key = word.toLowerCase().replace(/bound$/, '').replace(/[- ]/g, '').replace(/^(n|s|e|w)b$/, '$1');
        const dir = FULL[key];
        if (!dir) continue;
        if (/\bfacing\s*$/i.test(before)) continue;                              // facing west
        if (/^\s+of\b/i.test(after)) continue;                                   // north of Alki, W of mid
        if (/^\s+(side|end|shore)\b/i.test(after)) continue;                     // west side of channel
        if (/^\s+to\s+(north|south|east|west|N|S|E|W)\b/.test(after)) continue;  // north to south
        if (/^\s*-\s*(north|south|east|west)\b/i.test(after)) continue;          // north-south spread
        if (/\bto\s*$/i.test(before) && /\b(north|south|east|west|N|S|E|W)\s+to\s*$/.test(before)) continue;
        if (/^\s+[A-Z][a-z]/.test(after) && /^(north|south|east|west)$/i.test(word)) continue; // West Point, North Beach
        // Steve East, Katie West, Off East Sooke Park: a name, unless the word before says it travels (Heading South)
        const capitalBefore = /\b([A-Z][a-z]+)\s+$/.exec(before);
        if (/^(North|South|East|West)$/.test(word) && capitalBefore && !TRAVEL_WORD.test(capitalBefore[1]!)) continue;
        if (/\d\s*(?:mile|miles|mi|km|nm|yards?)\s*$/i.test(before)) continue;   // 1/2 mile southeast of
        out.push({at: m.index!, dir});
    }
    return out;
}

export function readDirection(text: string): string | null {
    if (UNKNOWN.test(text)) return 'unknown';
    const all = mentions(text).sort((a, b) => a.at - b.at);
    let cueEnd = -1;
    for (const c of text.matchAll(CHANGE)) cueEnd = c.index! + c[0].length;
    if (cueEnd >= 0) {
        const afterCue = all.find(m => m.at >= cueEnd);
        if (afterCue) return afterCue.dir;
        if (MILLING.test(text.slice(cueEnd))) return 'milling';
    }
    if (all.length) return all.at(-1)!.dir;
    return MILLING.test(text) ? 'milling' : null;
}
