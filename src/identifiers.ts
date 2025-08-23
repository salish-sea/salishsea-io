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

const podCleanerRE = /\s*(\+|,|&|and|-)\s*/gi;
const podRE = /\b([jklt]+)\s?(pod|\d)/gi;
export const detectPod = (text: Readonly<string>) => {
  for (const [, pods] of text.replaceAll(podCleanerRE, '').matchAll(podRE)) {
    for (const pod of [...pods!]) {
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

export function symbolFor(
  {body, scientific_name, vernacular_name}:
    {body: string | null; scientific_name: string; vernacular_name: string | null}
): string | undefined {
  let label = vernacular_name || scientific_name;
  if (scientific_name.startsWith('Orcinus orca')) {
    label = 'O';
    if (scientific_name === 'Orcinus orca rectipinnus') {
      label = 'T';
    }
    if (body) {
      label = detectPod(body) || detectEcotype(body) || label;
    }
  } else if (scientific_name.startsWith('Phoca vitulina')) {
    label = 'H';
  }

  return label[0];
}
