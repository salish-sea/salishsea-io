import type { Occurrence } from "./frontend/supabase.ts";

const pods = ['J', 'K', 'L', 'T'] as const;
export type Pod = typeof pods[number];
export type IndividualOrca = `${typeof pods[number]}${number}` | `${typeof pods[number]}${number}${string}`;
export type Matriline = `${IndividualOrca}s`;

const ecotypeRE = /\b(srkw|southern resident|transient|biggs)\b/gi;
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

function assertPod(name: string): asserts name is Pod {
  if (name.match(/^([JKLT]|CRC)$/))
    return;
  throw `${name} is not a pod`;
}

const podCleanerRE = /\s*(\+|,|&|AND|-)\s*/g;
const podRE = /\b([JKLT]+)\s?(POD|\d)/g;
export const detectPod = (text: Readonly<string>) => {
  for (const [, pods] of text.toUpperCase().replaceAll(podCleanerRE, '').matchAll(podRE)) {
    for (const pod of [...pods!]) {
      assertPod(pod);
      return pod;
    }
  }
  if (detectEcotype(text) === 'Biggs')
    return 'T';
  return null;
}

const normalizeIndividual = (name: string) => {
  return name.replace(/^(J|K|L|T|CRC)-?0+/, '$1');
}

// return an array of identifiers like 'Biggs', 'Transient', 'J', 'K37', etc.
const individualRE = /\b(t|j|k|l|t|crc)[- ]?(\d[\da-f]+)(s?)\b/gi;
export const detectIndividuals = (text: Readonly<string>) => {
  const matches = new Set<string>();
  for (let [, pod, individual, matriline] of text.matchAll(individualRE)) {
    pod = pod!.toUpperCase();
    const id = normalizeIndividual(`${pod}${individual!.toUpperCase()}`);
    if (matriline) {
      matches.add(`${id}s` as Matriline);
    } else {
      matches.add(id);
    }
  }
  return [...matches].sort();
}

export function symbolFor({body, taxon: {scientific_name, vernacular_name}}: Pick<Occurrence, 'body' | 'taxon'>): string {
  if (scientific_name.startsWith('Orcinus orca')) {
    const pod = detectPod(body || '');
    if (pod)
      return pod;
    if (scientific_name === 'Orcinus orca rectipinnus')
      return 'T';
    const ecotype = detectEcotype(body || '');
    if (ecotype)
      return ecotype[0]!;
    return 'O';
  } else if (scientific_name.startsWith('Phoca vitulina')) {
    return 'H';
  } else if (vernacular_name) {
    return vernacular_name[0]!;
  } else {
    return scientific_name[0]!;
  }
}
