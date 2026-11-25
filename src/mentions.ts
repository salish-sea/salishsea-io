/**
 * Where a text names an animal or a group: the catalogue codes, the pods and the populations
 * (decision 121), found as src/sighting-text.ts reads them and as src/behaviour.ts and
 * src/hedge.ts need them, so a "?" that belongs to a mention is found in one place.
 * Imports nothing, so every reader may import it.
 */

/** Where a sentence ends: a semicolon, "!", or a full stop before a capital or the end of the text (not an ellipsis, "i.e.", "e.g." or an abbreviation such as "Pt."). */
export const SENTENCE_END = String.raw`[;!]|(?<!\.|\b[ie]\.[eg]|\b(?:Pt|Mt|St|Ft|Is|Mr|Dr|No|approx|ca|vs))\.(?!\.)(?=\s+[A-Z]|\s*$)`;

/** What kind of name a mention is: a catalogue code, a pod or a population. */
export type NameKind = 'code' | 'pod' | 'population';

// A letter in capitals may stand apart from its number ("T 65", "CRC-56"); one in lower case
// only touching it ("t46s", "crc22"), or "crc " before one, so a word ending in t or l
// before a number is not read as a code. A suffix is at most three letter groups ("A1B2s"),
// so words run together ("T49A1Southbound") are not one.
const CODE = /\b(?:([TJKL]|CRC|BC[XYZ])\s?-?\s?|([tjkl]|[Cc]rc\s?)(?=\d))?(\d{1,5})(?:-?((?:[A-Za-z]\d*){1,3}))?(s)?\b/g;
// What may stand between two codes of one list, so a code without its letter takes the letter of the one before.
const LIST_GAP = /^\s*(?:(?:[,\/&+]|and)\s*)+$/i;
// "Biggs 36Bs": a code without its letter right after the ecotype's name is a Bigg's code.
const AFTER_BIGGS = /\b(?:biggs?|bigg['’]s|transients?)[\s:,]*$/i;

export type Code = {start: number, end: number, text: string, letter: string | null, suffix: string, matriline: boolean};

/** Every code-shaped token in the text, with the letter it carries, if any. */
export function codeTokens(text: string): Code[] {
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

// A pod's name: "Js" and "K's", then "J pod", "J Pod" (most of Orca Network's in November
// 2026), "J AND K PODS", with the "and" of a list in any of the cases reporters write it.
const POD_PLURAL = /\b([JKL])(?:s|['’]s)\b/g;
// Letters of a list may touch ("JK pods", "JKL pods") or be joined by a comma, "and", "&", "+" or "/".
const POD_NAMED = /\b([JKLjkl](?:(?:\s*(?:,\s*(?:[Aa]nd|AND)|,|[Aa]nd|AND|&|\+|\/)\s*)?[JKLjkl])*)\s*-?\s?(?:[Pp]ods?|PODS?)\b/g;
// What may join two plurals ("Js or Ks") when a "?" after the last reaches back to the first.
export const POD_JOIN = /^\s*(?:(?:[,\/&+]|and|or)\s*)+$/i;
// A population's name: the plural is as ordinary as the singular, "transients in Haro
// Strait", "southern residents foraging", and \b after the singular refuses it.
const BIGGS = /\b(?:biggs|bigg['’]s|transients?)\b/gi;
const SOUTHERN_RESIDENT = /\b(?:srkws?|southern residents?)\b/gi;

/**
 * One place the text names a pod or a population. The letters of one "J, K and L pods" share
 * a `group` and a hedge scope that starts where the match does; a "Js" is `plural`.
 */
export type Group = {start: number, end: number, text: string, kind: NameKind, group?: number, plural?: boolean, scopeStart?: number, scopeEnd?: number};

/** Where the text names a pod or a population, in the register's words (decision 121). */
export function groupTokens(text: string): Group[] {
    const out: Group[] = [];
    for (const m of text.matchAll(POD_PLURAL)) out.push({start: m.index!, end: m.index! + m[0].length, text: `${m[1]} pod`, kind: 'pod', plural: true});
    for (const m of text.matchAll(POD_NAMED)) {
        const letters = [...m[1]!.matchAll(/[JKLjkl]/g)];
        letters.forEach((l, i) => out.push({
            start: m.index! + l.index!,
            // a "?" after the list belongs to the last pod in it
            end: i === letters.length - 1 ? m.index! + m[0].length : m.index! + l.index! + 1,
            text: `${l[0].toUpperCase()} pod`, kind: 'pod',
            group: m.index!, scopeStart: m.index!, scopeEnd: m.index! + letters[0]!.index! + 1,
        }));
    }
    for (const m of text.matchAll(BIGGS)) out.push({start: m.index!, end: m.index! + m[0].length, text: "Bigg's", kind: 'population'});
    for (const m of text.matchAll(SOUTHERN_RESIDENT)) out.push({start: m.index!, end: m.index! + m[0].length, text: 'Southern Resident', kind: 'population'});
    return out.sort((x, y) => x.start - y.start);
}

/** Where a name may start, as a pattern for a regular expression: a code, a pod or a population. */
export const NAME_START = String.raw`(?:(?:[TJKL]|CRC|BC[XYZ])\s?-?\d|[JKLjkl]s?\s+[Pp]ods?|[JKL](?:s|['’]s)\b|(?:[Bb]iggs?|[Bb]igg['’]s|[Tt]ransients?|SRKWs?|[Ss]outhern\s+[Rr]esidents?)\b)`;

/** How a name may end, for a pattern tested against the text before a point: a code, a pod or a population. */
export const NAME_END = String.raw`(?:\d[A-Za-z\d]*(?:['’]s)?|[Pp]ods?|[JKL](?:s|['’]s)|[Bb]iggs?|[Bb]igg['’]s|[Tt]ransients?|SRKWs?|[Ss]outhern\s+[Rr]esidents?)\s*`;

/**
 * The catalogue codes in a text, each with the letter it carries. A code without its letter
 * takes the letter of the code before it in a list ("T36, 36Bs", "T36/36Bs", "CRC 21 and 22"),
 * or T right after the text says Biggs. Anywhere else it is a count ("spread in 1s to 4s"),
 * and is left out.
 */
export function namedCodes(text: string): Code[] {
    const tokens = codeTokens(text);
    let previous: Code | null = null;
    for (const t of tokens) {
        if (t.letter) { previous = t; continue; }
        const listed = previous !== null && LIST_GAP.test(text.slice(previous.end, t.start));
        const letter = listed ? previous!.letter : AFTER_BIGGS.test(text.slice(0, t.start)) ? 'T' : null;
        if (!letter) { t.text = ''; continue; }
        t.letter = letter; t.text = letter + t.text;
        previous = t;
    }
    return tokens.filter(t => t.text);
}

/**
 * Where the "?" after a mention ends (a mention's end being where its name ends), or null when
 * there is none. A plural's apostrophe and one space may stand between: "T46B's?", "milling ?".
 * The one rule for which "?" belongs to which mention, shared by the readers of names and of
 * behaviour: such a "?" makes that mention possible and hedges nothing after it.
 */
export function markAfter(text: string, end: number): number | null {
    const m = /^(?:['’]s)? ?\?/.exec(text.slice(end));
    return m ? end + m[0].length - 1 : null;
}

/** Every "?" that belongs to a name in the text (see markAfter). */
export function nameMarks(text: string): Set<number> {
    const marks = new Set<number>();
    for (const n of [...namedCodes(text), ...groupTokens(text)]) {
        const at = markAfter(text, n.end);
        if (at !== null) marks.add(at);
    }
    return marks;
}
