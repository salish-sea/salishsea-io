import { absent, identifierLabels, present, readSighting } from './sighting-text.ts';

// The plural is the ordinary form — "transients in Haro Strait", "southern
// residents foraging" — and \b after the singular refuses it, because there is
// no word boundary between 'transient' and its 's'. Missed silently until
// decision 029 put the ecotype on the map label rather than behind a letter.
// The reader in sighting-text.ts doesn't name ecotypes, so this stays a pattern of its own.
const ecotypeRE = /\b(srkw|southern resident|transient|biggs)s?\b/gi;
export const detectEcotype = (text: Readonly<string>) => {
  for (const [, ecotype] of text.matchAll(ecotypeRE)) {
    switch (ecotype!.toLowerCase()) {
      case 'biggs': return 'Biggs';
      case 'southern resident': return 'SRKW';
      case 'srkw': return 'SRKW';
      case 'transient': return 'Biggs';
    }
  }
  return null;
}

/**
 * The pod a sighting's text names, as a letter: a pod it names outright ("J pod", "Js"),
 * else the letter of the first code it says was there ("K37" is K, "T65A" is T, the
 * Bigg's old pod letter), else T when it says Biggs. Read by the same reader as the build
 * (decision 105), so a code the text says was absent names no pod.
 */
export const detectPod = (text: Readonly<string>) => {
  const reading = readSighting(text);
  if (reading.pods.length) return reading.pods[0]!;
  for (const code of present(reading)) {
    const letter = /^[JKLT](?=\d)/.exec(code)?.[0];
    if (letter) return letter;
  }
  if (detectEcotype(text) === 'Biggs')
    return 'T';
  return null;
}

/**
 * The codes a sighting's text says were there, as the build reads them into an
 * occurrence's identifiers (decision 105): 'T65A5', 'J27s', 'CRC56', in sorted order,
 * one the reporter only says was possibly there marked 'T65A?' (decision 109).
 * A contributor's own sighting carries these until a build publishes it.
 */
export const detectIndividuals = (text: Readonly<string>) => [...new Set(identifierLabels(readSighting(text)))].sort();

/** The codes a sighting's text says were absent, as the build writes them into an occurrence's `absent` (decision 109). */
export function detectAbsent(text: Readonly<string>): string[] {
  const reading = readSighting(text);
  const named = present(reading);
  return [...new Set(absent(reading))].filter(code => !named.includes(code)).sort();
}
