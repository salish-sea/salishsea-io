/**
 * A deterministic reader of sighting text: a few rules over the words, where the regex
 * macros are rules over the characters. No model, no network, the same answer every time.
 *
 * It reads the report text (gold.ts's reportText: no collection tag, no attribution
 * line). The codes are found as the macro finds them, plus three things it cannot see:
 * a code written without its letter after a slash or comma ("T36/36Bs", "T36A1s, 65A5"),
 * which takes the letter of the code before it or T when the text says Biggs; a hyphen
 * inside a code ("T65-A3"); and an exclusion, "(-D)", "(-T46D)", "minus T137A", "minus
 * T60D&E", whose animals are absent, a short form resolved against the matriline before
 * it. A hedge word, "likely", "possibly", "maybe", "presumed", marks the codes that
 * follow it up to the next comma as hedged. Pods are "J pod", "Jpod", "Js", "J and K
 * pods". The direction is a compass word or abbreviation, "NB", "SW bound", "trending N",
 * ignoring a bearing ("north of Alki", "1/2 mile southeast of"), a place name ("West
 * Point"), a spread ("north to south", "N to S") and "facing"; after "now", "then" or
 * "turned", the direction after the cue wins, and "stalled" or "milling" there means
 * milling. Developed against the gold set's hard strata and the first half of its random
 * strata; the second half is held out (gold.ts).
 */

import { reportText, type GoldRow } from '../gold.ts';
import type { Reading } from '../score.ts';

const CODE = /\b(?:([TJKL]|CRC|BCX)\s?-?\s?)?(\d{1,5})(?:-?((?:[A-Za-z]\d*)+))?(s)?\b/g;
const HEDGE = /\b(likely|possibly|possible|maybe|presumably|presumed|probably|probable|unconfirmed)\b|\?/gi;
const EXCLUDE = /\(\s*-\s*|\bminus\b|(?<=[A-Za-z0-9]s)\s+-(?=[A-Z])/g;

type Code = {start: number, end: number, text: string, letter: string | null, suffix: string, matriline: boolean};

/** Every code-shaped token in the text, with the letter it carries, if any. */
function codeTokens(text: string): Code[] {
    const out: Code[] = [];
    for (const m of text.matchAll(CODE)) {
        let [, letter, digits, suffix = '', s] = m;
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
        out.push({start: m.index!, end: m.index! + whole.length, text: code, letter: letter ? letter.toUpperCase() : null, suffix: suffix.toUpperCase(), matriline});
    }
    return out;
}

/** The code with its trailing s removed, and the last letter group removed if asked. */
const base = (code: string, dropLastGroup: boolean) => {
    let b = code.replace(/s$/, '');
    if (dropLastGroup) b = b.replace(/[A-Z]\d*$/, '');
    return b;
};

export function readTokens(text: string): Reading {
    const biggs = /\b(biggs?|bigg's|transients?|\bT\d)/i.test(text);
    const tokens = codeTokens(text);
    // Give a letterless code the letter of the code before it, or T when the text says Biggs.
    let lastLetter: string | null = null;
    for (const t of tokens) {
        if (t.letter) { lastLetter = t.letter; continue; }
        const letter = lastLetter ?? (biggs ? 'T' : null);
        if (!letter) { t.text = ''; continue; }
        t.letter = letter; t.text = letter + t.text;
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
            const tok = named.find(t => t.start === at);
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
    const present: string[] = [];
    named.forEach((t, i) => { if (!excludedIdx.has(i) && !present.includes(t.text)) present.push(t.text); });

    // Hedges: the codes after a hedge word, up to the next comma, period or closing bracket.
    const hedged = new Set<string>();
    for (const h of text.matchAll(HEDGE)) {
        const end = text.slice(h.index!).search(/[,.;)]|\bbut\b/);
        const stop = end < 0 ? text.length : h.index! + end;
        for (const t of named) if (t.start >= h.index! && t.end <= stop && present.includes(t.text)) hedged.add(t.text);
    }

    // Pods.
    const pods = new Set<string>();
    for (const m of text.matchAll(/\b([JKL])(?:s|'s)\b/g)) pods.add(m[1]!);
    for (const m of text.matchAll(/\b((?:[jklJKL]\s*(?:,|and|&|\+)?\s*)+)-?\s?pods?\b/gi)) {
        for (const l of m[1]!.toUpperCase().match(/[JKL]/g) ?? []) pods.add(l);
    }

    return {codes_present: present, codes_absent: [...absent], codes_hedged: [...hedged], pods: [...pods], direction: readDirection(text)};
}

const FULL: Record<string, string> = {
    north: 'north', south: 'south', east: 'east', west: 'west',
    northeast: 'northeast', northwest: 'northwest', southeast: 'southeast', southwest: 'southwest',
    n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
};
// A compass word, or a compass abbreviation that the words around it make a direction.
const COMPASS = /\b((?:north[- ]?(?:east|west)|south[- ]?(?:east|west)|north|south|east|west)(?:\s?-?bound)?|(?:NB|SB|EB|WB)|(?<=\b(?:heading|headed|trending|trend|going|moving|traveling|travelling|drifting|continuing|direction)\s+)(?:NE|NW|SE|SW|N|S|E|W)|(?:NE|NW|SE|SW|N|S|E|W)(?=\s*-?\s*(?:bound|direction|toward)))\b/gi;
const MILLING = /\b(milling|stalled|directional changes|multi ?-?directional|shuffling|foraging)\b/i;
const UNKNOWN = /direction (?:unknown|unconfirmed|not given)|no direction/i;
const CHANGE = /\b(now|then|turned|flipped|changed direction|committed to)\b/gi;

function mentions(text: string): {at: number, dir: string}[] {
    const out: {at: number, dir: string}[] = [];
    for (const m of text.matchAll(COMPASS)) {
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
        if (/\d\s*(?:mile|miles|mi|km|nm|yards?)\s*$/i.test(before)) continue;   // 1/2 mile southeast of
        out.push({at: m.index!, dir});
    }
    return out;
}

export function readDirection(text: string): string | null {
    if (UNKNOWN.test(text)) return 'unknown';
    // "south and east bound": one direction from two words.
    const two = /\b(north|south)\s+and\s+(east|west)\s*-?\s*bound\b/i.exec(text);
    if (two) return `${two[1]!.toLowerCase()}${two[2]!.toLowerCase()}`;
    const all = mentions(text);
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

export async function readWithTokens(rows: GoldRow[]): Promise<Map<number, Reading>> {
    return new Map(rows.map(r => [r.row, readTokens(reportText(r.comment))]));
}
