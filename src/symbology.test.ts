import { describe, expect, test } from 'vitest';
import { GROUPS, displayNameFor, labelFor, labelForSegment, taxonGroup, trackSummary } from './symbology.ts';
import type { Occurrence } from './types.ts';

const taxon = (
  scientific_name: string,
  vernacular_name: string | null = null,
  entity_id: string | null = null,
): Occurrence['taxon'] => ({scientific_name, vernacular_name, species_id: null, entity_id});

describe('taxonGroup', () => {
  test('separates the animals the letter scheme collided', () => {
    // The defect that started decision 029: `H` meant a 15 m humpback and a
    // 1.5 m harbour porpoise, on the most common glyph on the map.
    expect(taxonGroup('Megaptera novaeangliae')).toBe('baleen');
    expect(taxonGroup('Phocoena phocoena')).toBe('porpoise');
    // And `S` covered ten taxa across four of these groups.
    expect(taxonGroup('Phoca vitulina')).toBe('seal');
    expect(taxonGroup('Enhydra lutris')).toBe('otter');
    expect(taxonGroup('Physeter macrocephalus')).toBe('toothed');
    expect(taxonGroup('Eumetopias jubatus')).toBe('sealion');
    expect(taxonGroup('Stenella coeruleoalba')).toBe('dolphin');
  });

  test('resolves every rank iNaturalist identifies at', () => {
    for (const name of ['Megaptera', 'Megaptera novaeangliae', 'Megaptera novaeangliae kuzira'])
      expect(taxonGroup(name), name).toBe('baleen');
  });

  test('longest prefix wins, so a family is not swallowed by a genus', () => {
    // 'Phocoenidae' starts with 'Phoc' but is a porpoise, not a seal.
    expect(taxonGroup('Phocoenidae')).toBe('porpoise');
    expect(taxonGroup('Phocoenoides dalli')).toBe('porpoise');
    expect(taxonGroup('Phocidae')).toBe('seal');
  });

  test("iNaturalist's mislabelled Phocoidea is not guessed at", () => {
    // Decision 027: upstream calls it "Pinnipeds", but it is strictly the
    // true-seal superfamily. Neither seal nor sea lion is honest.
    expect(taxonGroup('Phocoidea')).toBe('unknown');
  });

  test('an unknown or missing name is a marine mammal, not a crash', () => {
    expect(taxonGroup('Ursus maritimus')).toBe('unknown');
    expect(taxonGroup(null)).toBe('unknown');
  });

  test('every group has a colour and a label', () => {
    for (const [key, group] of Object.entries(GROUPS)) {
      expect(group.color, key).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(group.label.length, key).toBeGreaterThan(0);
    }
  });
});

describe('displayNameFor', () => {
  test('a curated short form wins, keyed on the SSA identifier', () => {
    expect(displayNameFor(taxon('Megaptera novaeangliae', 'Humpback whale', 'SSA:0000901')))
      .toBe('Humpback');
  });

  test('an unshortened register name passes through whole', () => {
    // 'Gray whale' -> 'Gray' does not work: the modifier is an adjective. Most
    // register names need no short form at all.
    expect(displayNameFor(taxon('Eschrichtius robustus', 'Gray whale', 'SSA:0000905')))
      .toBe('Gray whale');
  });

  test('no register entity falls back to the vernacular we do have', () => {
    expect(displayNameFor(taxon('Orcinus orca ater', 'Resident Killer Whale')))
      .toBe('Resident Killer Whale');
  });

  test('no name anywhere falls back to the group, not the scientific name', () => {
    // A genus stub with no vernacular. "Baleen whale" claims less than
    // "Balaenopteridae" says, and more of it is readable.
    expect(displayNameFor(taxon('Balaenopteridae'))).toBe('Baleen whale');
    expect(displayNameFor(taxon('Ursus maritimus'))).toBe('Marine mammal');
  });

  test('a short form is never applied to the wrong animal', () => {
    // The key is the entity, not the name: a taxon carrying no entity_id gets
    // no override even if its name matches one that has been shortened.
    expect(displayNameFor(taxon('Megaptera novaeangliae', 'Humpback whale')))
      .toBe('Humpback whale');
  });
});

describe('labelFor', () => {
  const orca = (body: string, scientific_name = 'Orcinus orca') =>
    ({body, taxon: taxon(scientific_name, 'Killer whale', 'SSA:0000900')});

  test('a pod named in the prose becomes the label', () => {
    expect(labelFor(orca('J pod heading north past Lime Kiln'))).toBe('J pod');
    expect(labelFor(orca('K37 and L54 together'))).toBe('K pod');
  });

  test('Biggs is named, not lettered', () => {
    expect(labelFor(orca('T65A group inbound'))).toBe('Biggs');
    expect(labelFor(orca('transients in Haro Strait'))).toBe('Biggs');
  });

  test('the plural form is the ordinary one and must be read', () => {
    // \b after 'transient' refuses 'transients'. This was silently missed while
    // the ecotype only chose a letter; it is visible now that it is the label.
    expect(labelFor(orca('a group of transients'))).toBe('Biggs');
    expect(labelFor(orca('southern residents inbound'))).toBe('SRKW');
  });

  test('an ecotype without a matriline still says which whales', () => {
    // symbolFor() answered this with 'S'; detectPod alone does not answer it
    // at all, because it only maps Biggs back through their old pod letter.
    expect(labelFor(orca('southern residents foraging'))).toBe('SRKW');
    expect(labelFor(orca('SRKW westbound'))).toBe('SRKW');
  });

  test('the subspecies carries the ecotype when the prose does not', () => {
    expect(labelFor(orca('', 'Orcinus orca ater'))).toBe('SRKW');
    expect(labelFor(orca('', 'Orcinus orca rectipinnus'))).toBe('Biggs');
  });

  test('an unattributed killer whale is not renamed to Orca', () => {
    // The register holds `orca` for SSA:0000900 as a `hidden` name — a string
    // in use, explicitly not one it offers for display. Composing our way to
    // the same string would route around that.
    expect(labelFor(orca('two whales offshore'))).toBe('Killer whale');
  });

  test('everything else is just its name', () => {
    expect(labelFor({body: 'J pod was here yesterday', taxon: taxon('Phoca vitulina', 'Harbour seal', 'SSA:0000904')}))
      .toBe('Harbour seal');
  });
});

describe('trackSummary', () => {
  test('names the unit, because a bare number reads as a count of animals', () => {
    expect(trackSummary(3, 10)).toBe('Seen 3× over 10h');
  });

  test('a sub-hour track says so rather than rounding to 0h', () => {
    expect(trackSummary(2, 0.4)).toBe('Seen 2× in under an hour');
  });
});

describe('labelForSegment', () => {
  const orca = (body: string, scientific_name = 'Orcinus orca') =>
    ({body, taxon: taxon(scientific_name, 'Killer whale', 'SSA:0000900')});

  test('a pod named in any sighting labels the whole track', () => {
    // The head is the LAST point, and a pod is named in prose that belongs to
    // one sighting — usually not the last one. Labelling the head from the head
    // alone said "Killer whale" over a track that plainly was J pod.
    expect(labelForSegment([orca('J pod northbound past Lime Kiln'), orca('three orca')]))
      .toBe('J pod');
  });

  test('a pod anywhere beats an ecotype anywhere', () => {
    // "J pod" is a more specific claim than "residents", wherever each was said.
    expect(labelForSegment([orca('southern residents'), orca('J17 and calf')]))
      .toBe('J pod');
  });

  test('the subspecies is the weakest evidence, not the first consulted', () => {
    // A report naming the pod outranks a taxon that only says "some resident".
    expect(labelForSegment([orca('', 'Orcinus orca ater'), orca('K pod inbound')]))
      .toBe('K pod');
    expect(labelForSegment([orca(''), orca('', 'Orcinus orca ater')]))
      .toBe('SRKW');
  });

  test('a non-orca track is named from its head, prose ignored', () => {
    const seal = (body: string) => ({body, taxon: taxon('Phoca vitulina', 'Harbour seal', 'SSA:0000904')});
    expect(labelForSegment([seal('J pod was here earlier'), seal('')])).toBe('Harbour seal');
  });

  test('labelFor is a segment of one', () => {
    expect(labelFor(orca('J pod'))).toBe(labelForSegment([orca('J pod')]));
  });
});
