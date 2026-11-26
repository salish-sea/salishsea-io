/**
 * Where a text names an animal or a group: the catalogue codes, the pods and the populations
 * (decision 121), found as src/sighting-text.ts reads them and as src/behaviour.ts and
 * src/hedge.ts need them, so a "?" that belongs to a mention is found in one place.
 * Imports nothing, so every reader may import it. It also holds the negation and question
 * rules, which decide "is this a name" from the tokens found here and from no pattern of their own.
 */

/** The words that may come between "or" and the next name of a negated list: "or the T65Cs", "or any of the T65Cs". Longest first. */
export const LIST_DETERMINER = String.raw`(?:the|any of the|any|either)`;

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
    // the "?" that closes a negated question belongs to it
    for (const q of negatedQuestions(text)) marks.add(q.end - 1);
    return marks;
}

// A negation in a sentence, as people write in comments on iNaturalist ("not the T090s
// actually", "I don't recognize this as any T077 orca"): the codes it governs are absent.
// "Not sure", "not certain", "not positive" and "not 100%" are hedges, not negations (see
// HEDGE); "not only", "not just" and "no doubt" affirm; "whether or not" and "if not" say
// nothing either way. "Never" is not a negation here: "never seen the T65As this far north
// before" is said of animals that are there.
export const NEGATION = /\b(?:(?<!\b(?:whether\s+or|if)\s+)not(?!\s+(?:sure|certain|positive|100\s*%?|only|just)\b)|no(?!\s+doubt\b)|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|don['’]t|doesn['’]t|didn['’]t)\b/gi;
// A negated question ("Isn't it T65A?") asks rather than says, so its codes are possible,
// not absent. A question asked with an auxiliary and a pronoun ("isn't it", "aren't they")
// runs to the end of its sentence, commas and all ("Isn't it T65A, the one with the
// notch?"). Otherwise the question is the negation's own clause: it ends at a sentence's
// end, at "but", or at a comma that doesn't continue a list ("or", "and", "nor", "&" or a
// code), so a later question ("No T65A, is it T65B?") or a distant "?" doesn't touch it.
// A sentence ends at a semicolon, "!", or a full stop before a capital or the end; an
// ellipsis, "i.e.", "e.g." and an abbreviation such as "Pt." or "approx." don't end it.
// A question asked with an auxiliary and a pronoun is one even without its "?" ("Isn't
// it T65A, that's for sure"): it never makes its codes absent.
export const ASKS = /^(?:isn['’]t|aren['’]t|wasn['’]t|weren['’]t|don['’]t|doesn['’]t|didn['’]t)\s+(?:it|that|this|these|those|they|he|she|you)\b/i;

const STOP_SENTENCE = new RegExp(SENTENCE_END, 'y');
const STOP_BUT = /\bbut\b/iy;
const KEEPS_GOING = /\s*(?:or|and|nor|&)\b/iy;

/**
 * Where the "?" closing a question that starts at `from` is, or null. A question asked with an
 * auxiliary and a pronoun runs to the end of its sentence, commas and all; any other is the
 * negation's own clause, and ends at a sentence's end, at "but", or at a comma that doesn't
 * continue a list ("or", "and", "nor", "&", or a name: `starts` holds where names start).
 */
function questionClose(text: string, from: number, wholeSentence: boolean, starts: ReadonlySet<number>): number | null {
    for (let i = from; i < text.length; i++) {
        if (text[i] === '?') return i;
        STOP_SENTENCE.lastIndex = i;
        if (STOP_SENTENCE.test(text)) return null;
        if (wholeSentence) continue;
        STOP_BUT.lastIndex = i;
        if (STOP_BUT.test(text)) return null;
        if (text[i] === ',') {
            KEEPS_GOING.lastIndex = i + 1;
            const after = i + 1 + /^\s*/.exec(text.slice(i + 1))![0].length;
            if (!KEEPS_GOING.test(text) && !starts.has(after)) return null;
        }
    }
    return null;
}

/**
 * The spans of the negated questions in a text: from a negation to the "?" that closes its
 * question ("Isn't it J pod near shore?"). The names inside one are possible, not absent.
 */
export function negatedQuestions(text: string): {start: number, end: number}[] {
    const out: {start: number, end: number}[] = [];
    let starts: Set<number> | undefined;
    for (const cue of text.matchAll(NEGATION)) {
        starts ??= nameEdges(text).starts;
        const close = questionClose(text, cue.index!, ASKS.test(text.slice(cue.index!)), starts);
        if (close !== null) out.push({start: cue.index!, end: close + 1});
    }
    return out;
}

/**
 * Whether the names a negation governs go on as a list that ends in "or" or "nor", from `at`:
 * names (a name may take a plural's apostrophe) separated by commas, a comma and then the "or",
 * then a name, or a matriline's letter alone ("no T65A, T65B or A4"). `tokens` are the names
 * the parsers found. A bare "not" followed by a comma is a correction ("Not T090s, T030Bs or
 * T037s"), and only "nor" makes it a list.
 */
export function orListFrom(text: string, tokens: readonly {start: number, end: number}[], at: number, onlyNor: boolean): boolean {
    const byStart = new Map(tokens.map(t => [t.start, t]));
    let pos = at;
    for (;;) {
        const tok = byStart.get(pos);
        if (!tok) return false;
        pos = tok.end + (/^['’]s/.exec(text.slice(tok.end))?.[0].length ?? 0);
        const comma = /^\s*,\s*/.exec(text.slice(pos));
        if (comma && byStart.has(pos + comma[0].length)) { pos += comma[0].length; continue; }
        break;
    }
    const join = new RegExp(String.raw`^\s*,?\s+(?:${onlyNor ? 'nor' : 'or|nor'})\s+(?:${LIST_DETERMINER}\s+)?`, 'i').exec(text.slice(pos));
    if (!join) return false;
    const next = pos + join[0].length;
    return byStart.has(next) || /^[A-H]\b/.test(text.slice(next));
}

/** Whether a name (a code, a pod or a population) starts at `at` or ends at `at`, read from the same tokens the readers use. */
export function nameEdges(text: string): {starts: Set<number>, ends: Set<number>} {
    const tokens = [...namedCodes(text), ...groupTokens(text)];
    return {starts: new Set(tokens.map(t => t.start)), ends: new Set(tokens.map(t => t.end))};
}
