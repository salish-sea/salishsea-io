export type TaxonRow = {
  id: number;
  parent_id: number | null;
  scientific_name: string;
  taxon_rank: string;
  updated_at: number; // UNIX time
  vernacular_name: string | null;
}

const pods = ['J', 'K', 'L', 'T'] as const;
export type Pod = typeof pods[number];
export type IndividualOrca = `${typeof pods[number]}${number}` | `${typeof pods[number]}${number}${string}`;
export type Matriline = `${IndividualOrca}s`;

const ecotypeRE = /\b(srkw|southern resident|transient|biggs)\b/gi;
export const detectEcotype = (text: Readonly<string>) => {
  for (const [, ecotype] of text.matchAll(ecotypeRE)) {
    switch (ecotype.toLowerCase()) {
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

const podCleanerRE = /\s*(\+|,|&|and|-)\\s*/gi;
const podRE = /\b([jklt]+)\s?pod\b/gi;
export const detectPod = (text: Readonly<string>) => {
  for (const [, pods] of text.replaceAll(podCleanerRE, '').matchAll(podRE)) {
    for (const pod of [...pods]) {
      assertPod(pod);
      return pod.toUpperCase();
    }
  }
  if (detectEcotype(text) === 'Biggs')
    return 'T';
  return null;
}

const normalizeIndividual = (name: string) => {
  return name.replace(/^(J|K|L|T|CRC)0+/, '$1');
}

// return an array of identifiers like 'Biggs', 'Transient', 'J', 'K37', etc.
const individualRE = /\b(t|j|k|l|t|crc)-?([0-9][0-9a-f]+)(s?)\b/gi;
export const detectIndividuals = (text: Readonly<string>) => {
  const matches = new Set<string>();
  for (let [, pod, individual, matriline] of text.matchAll(individualRE)) {
    pod = pod.toUpperCase();
    const id = normalizeIndividual(`${pod}${individual.toUpperCase()}`);
    if (matriline) {
      matches.add(`${id}s` as Matriline);
    } else if (isIndividualOrca(id)) {
      matches.add(id);
    }
  }
  return [...matches].sort();
}

function isIndividualOrca(name: string): name is IndividualOrca {
  // if (individuals.indexOf(name) !== -1)
  //   return true;
  if (name.startsWith('CRC'))
    return true;
  // console.warn(`${name} is not an individual Orca`);
  return false;
}

export function symbolFor(
  {body, scientific_name, vernacular_name}:
    {body: string | null; scientific_name: string; vernacular_name: string | null}
): string {
  let label = vernacular_name || scientific_name;
  if (scientific_name.startsWith('Orcinus orca')) {
    label = 'O';
    if (scientific_name === 'Orcinus orca rectipinnis') {
      label = 'T';
    }
    if (body) {
      label = detectPod(body) || detectEcotype(body) || label;
    }
  }
  return label[0];
}
