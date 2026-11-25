import { absent, identifierLabels, present, readSighting } from './sighting-text.ts';

/**
 * The names a sighting's text says were there, as the build reads them into an
 * occurrence's identifiers (decisions 105 and 121): codes ('T65A5', 'J27s', 'CRC56'), pods
 * ('J pod') and populations ("Bigg's", 'Southern Resident'), in the order the text gives
 * them as the build writes them, one the reporter only says was possibly there marked
 * 'T65A?' (decision 109). A contributor's own sighting carries these until a build
 * publishes it.
 */
export const detectIndividuals = (text: Readonly<string>) => [...new Set(identifierLabels(readSighting(text)))];

/** The codes a sighting's text says were absent, as the build writes them into an occurrence's `absent` (decision 109). */
export function detectAbsent(text: Readonly<string>): string[] {
  const reading = readSighting(text);
  const named = present(reading);
  return [...new Set(absent(reading))].filter(code => !named.includes(code)).sort();
}
