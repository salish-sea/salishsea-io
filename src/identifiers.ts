// The plural is the ordinary form — "transients in Haro Strait", "southern
// residents foraging" — and \b after the singular refuses it, because there is
// no word boundary between 'transient' and its 's'. Missed silently until
// decision 029 put the ecotype on the map label rather than behind a letter.
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

const podCleanerRE = /\s*(\+|,|&|AND|-)\s*/g;
const podRE = /\b([JKLT]+)\s?(POD|\d)/g;
export const detectPod = (text: Readonly<string>) => {
  for (const [, pods] of text.toUpperCase().replaceAll(podCleanerRE, '').matchAll(podRE)) {
    for (const pod of [...pods!]) {
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
      matches.add(`${id}s`);
    } else {
      matches.add(id);
    }
  }
  return [...matches].sort();
}
