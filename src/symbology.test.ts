import { describe, expect, test } from 'vitest';
import { GROUPS, displayNameFor, identifiersBeyond, labelFor, labelIdentifiers, labelForSegment, taxonGroup, trackSummary } from './symbology.ts';
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

  test('a longer prefix rescues an animal the shorter one would misname', () => {
    // Delphinapterus is the beluga — a monodontid. 'Delphin' would have made it
    // a dolphin by colour and, with no vernacular, by name too.
    expect(taxonGroup('Delphinapterus leucas')).toBe('toothed');
    expect(taxonGroup('Delphinus delphis')).toBe('dolphin');
    expect(taxonGroup('Delphinidae')).toBe('dolphin');
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

  test('the two orca subspecies read their name from the register, and we compose nothing', () => {
    // These were the last two animals we minted a name for, in a SUBSPECIES_FORMS
    // table keyed on the scientific name, because the register could not hold an
    // ecotype as a taxon. It can reach them now: editions 2026.09.2 and 2026.09.3
    // crosswalk the ecotypes to iNaturalist's subspecies and name them, and
    // migration 20260920220000 admits the close match. So `vernacular_name`
    // arrives already correct and passes straight through.
    //
    // The displayed string is unchanged; what is asserted here is that it comes
    // from the register rather than from us.
    expect(displayNameFor(taxon('Orcinus orca ater', 'Resident killer whale', 'SSA:0000003')))
      .toBe('Resident killer whale');
    expect(displayNameFor(taxon('Orcinus orca rectipinnus', "Bigg's killer whale", 'SSA:0000002')))
      .toBe("Bigg's killer whale");
  });

  test('nothing rewrites a subspecies name we no longer have a table for', () => {
    // The regression this guards is the deletion of SUBSPECIES_FORMS being
    // reverted in spirit — a lookup keyed on the scientific name creeping back.
    // Feed the scientific names it used to key on, with the register absent, and
    // iNaturalist's own string must come through untouched rather than being
    // rewritten to sentence case by a table.
    expect(displayNameFor(taxon('Orcinus orca ater', 'Resident Killer Whale')))
      .toBe('Resident Killer Whale');
    expect(displayNameFor(taxon('Orcinus orca rectipinnus', "Bigg's Killer Whale")))
      .toBe("Bigg's Killer Whale");
  });

  test('any other missing register entity still falls back to the vernacular', () => {
    expect(displayNameFor(taxon('Eumetopias jubatus', 'Steller Sea Lions')))
      .toBe('Steller Sea Lions');
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

// The label is made from what the build published: each report's identifiers and its taxon
// (decision 121). `orca(['J pod'])` is a report whose identifiers are those, as a day file has them.
const orca = (identifiers: string[], scientific_name = 'Orcinus orca', entity_id = 'SSA:0000900') =>
  ({identifiers, taxon: taxon(scientific_name, 'Killer whale', entity_id)});

describe('labelFor', () => {
  test('a pod named among the identifiers becomes the label', () => {
    expect(labelFor(orca(['J pod']))).toBe('J pod');
    expect(labelFor(orca(['K37', 'L54']))).toBe('K pod');
    expect(labelFor(orca(['L pod', 'T65A']))).toBe('L pod');
  });

  test('Biggs is named, not lettered', () => {
    expect(labelFor(orca(['T65A']))).toBe('Biggs');
    expect(labelFor(orca(["Bigg's"]))).toBe('Biggs');
  });

  test('a population named among the identifiers says which whales', () => {
    expect(labelFor(orca(['Southern Resident']))).toBe('SRKW');
  });

  test('the text of a report is not read: the label is what the build published', () => {
    // The Orcasound bout of 2026-11-20 at Andrews Bay, titled "Faint SRKW calls, likely J pod",
    // tagged Southern Resident. The title is a note; its tags are the moderators' identification.
    const bout = {body: 'Faint SRKW calls, likely J pod (Andrews Bay)', identifiers: ['Southern Resident'],
      taxon: taxon('Orcinus orca', 'Killer whale', 'SSA:0000900')};
    expect(labelFor(bout)).toBe('SRKW');
    expect(identifiersBeyond(labelFor(bout), bout.identifiers)).toEqual([]);
  });

  test('a name only possibly there keeps its ?', () => {
    expect(labelFor(orca(['J pod?']))).toBe('J pod?');
    expect(labelFor(orca(['J27?']))).toBe('J pod?');
    expect(labelFor(orca(['T65A?']))).toBe('Biggs?');
    expect(labelFor(orca(['Southern Resident?']))).toBe('SRKW?');
    expect(labelFor(orca(["Bigg's?"]))).toBe('Biggs?');
  });

  test('a plain population outranks the same population named only by a possible code', () => {
    expect(labelFor(orca(['T65A?', "Bigg's"]))).toBe('Biggs');
    expect(labelFor(orca(['J27?', 'Southern Resident']))).toBe('J pod?');
    // another population ahead of the plain one doesn't hide it
    expect(labelFor(orca(['T65A?', 'Southern Resident', "Bigg's"]))).toBe('Biggs');
  });

  test('the subspecies carries the ecotype when the identifiers do not', () => {
    expect(labelFor(orca([], 'Orcinus orca rectipinnus'))).toBe('Biggs');
  });

  test('a resident subspecies is not narrowed to Southern Resident', () => {
    // salish-frk. `ater` covers Northern and Alaskan residents too, so the
    // taxon alone cannot say SRKW — only a report that named them can.
    expect(labelFor(orca([], 'Orcinus orca ater'))).toBe('Resident');
    expect(labelFor(orca(['Southern Resident'], 'Orcinus orca ater'))).toBe('SRKW');
  });

  test('a record identified as the Southern Resident community is SRKW', () => {
    // 4,571 Maplify records resolve to SSA:0000010 (decision 049). Their taxon still
    // reads `ater` through the crosswalk, which alone would say only "Resident".
    const srkw = orca([], 'Orcinus orca ater', 'SSA:0000010');
    expect(labelFor(srkw)).toBe('SRKW');
    // More specific than the subspecies whichever record comes first in the track...
    expect(labelForSegment([orca([], 'Orcinus orca ater'), srkw])).toBe('SRKW');
    expect(labelForSegment([srkw, orca([], 'Orcinus orca ater')])).toBe('SRKW');
    // ...and less specific than a pod a report names.
    expect(labelForSegment([srkw, orca(['J pod'])])).toBe('J pod');
  });

  test('an unattributed killer whale is not renamed to Orca', () => {
    // The register holds `orca` for SSA:0000900 as a `hidden` name — a string
    // in use, explicitly not one it offers for display. Composing our way to
    // the same string would route around that.
    expect(labelFor(orca([]))).toBe('Killer whale');
  });

  test('everything else is just its name', () => {
    expect(labelFor({identifiers: ['J pod'], taxon: taxon('Phoca vitulina', 'Harbour seal', 'SSA:0000904')}))
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
  test('a pod named in any sighting labels the whole track', () => {
    // The head is the LAST point, and a pod is named by one sighting — usually not the
    // last one. Labelling the head from the head alone said "Killer whale" over a track
    // that plainly was J pod.
    expect(labelForSegment([orca(['J pod']), orca([])])).toBe('J pod');
  });

  test('a pod anywhere beats a population anywhere', () => {
    // "J pod" is a more specific claim than "residents", wherever each was said.
    expect(labelForSegment([orca(['Southern Resident']), orca(['J17'])])).toBe('J pod');
  });

  test('the subspecies is the weakest evidence, not the first consulted', () => {
    // A report naming the pod outranks a taxon that only says "some resident".
    expect(labelForSegment([orca([], 'Orcinus orca ater'), orca(['K pod'])])).toBe('K pod');
    expect(labelForSegment([orca([]), orca([], 'Orcinus orca ater')])).toBe('Resident');
  });

  test('the reports are read in time order, each one in the order its text gives its names', () => {
    expect(labelForSegment([orca(['L pod', 'J pod']), orca(['K pod'])])).toBe('L pod');
    expect(labelForSegment([orca(['K pod']), orca(['L pod', 'J pod'])])).toBe('K pod');
    // not the pooled, sorted list: "J pod" sorts first, and the first report named K
    expect(labelForSegment([orca(['K27']), orca(['J pod'])])).toBe('K pod');
  });

  test('a plain name beats a possible one within each step', () => {
    expect(labelForSegment([orca(['J pod?']), orca(['K pod'])])).toBe('K pod');
    expect(labelForSegment([orca(['T65A?']), orca(['T137'])])).toBe('Biggs');
    expect(labelForSegment([orca(["Bigg's?"]), orca(['Southern Resident'])])).toBe('SRKW');
    // a name that is possible in every report that gives it stays possible
    expect(labelForSegment([orca(['J pod?']), orca(['J27?'])])).toBe('J pod?');
  });

  test('a possible pod still comes before a plain population', () => {
    expect(labelForSegment([orca(['J pod?', 'Southern Resident'])])).toBe('J pod?');
    expect(labelForSegment([orca(['Southern Resident']), orca(['J pod?'])])).toBe('J pod?');
  });

  test('a non-orca track is named from its head, identifiers ignored', () => {
    const seal = (identifiers: string[]) => ({identifiers, taxon: taxon('Phoca vitulina', 'Harbour seal', 'SSA:0000904')});
    expect(labelForSegment([seal(['J pod']), seal([])])).toBe('Harbour seal');
  });

  test('labelFor is a segment of one', () => {
    expect(labelFor(orca(['J pod']))).toBe(labelForSegment([orca(['J pod'])]));
  });
});

describe('identifiersBeyond: what the name already says is left out of the list', () => {
  test('a plain pod says the pod and the population it belongs to', () => {
    expect(identifiersBeyond('J pod', ['J pod', 'J pod?', 'Southern Resident', 'Southern Resident?', 'J27', 'K pod']))
      .toEqual(['J27', 'K pod']);
  });

  test('a possible pod says the pod, not the population', () => {
    expect(identifiersBeyond('J pod?', ['J pod', 'J pod?', 'Southern Resident', 'J27']))
      .toEqual(['Southern Resident', 'J27']);
  });

  test('Biggs says Bigg\'s, and SRKW says Southern Resident', () => {
    expect(identifiersBeyond('Biggs', ["Bigg's", "Bigg's?", 'T65A', 'Southern Resident'])).toEqual(['T65A', 'Southern Resident']);
    expect(identifiersBeyond('SRKW', ['Southern Resident', 'Southern Resident?', 'J27', "Bigg's"])).toEqual(['J27', "Bigg's"]);
  });

  test('a population only possibly there says its own hedged name', () => {
    expect(identifiersBeyond('Biggs?', ["Bigg's?", 'T65A?'])).toEqual(['T65A?']);
    expect(identifiersBeyond('SRKW?', ['Southern Resident?'])).toEqual([]);
  });

  test('a name with no population to say leaves the list alone', () => {
    expect(identifiersBeyond('Killer whale', ['T65A', 'Southern Resident'])).toEqual(['T65A', 'Southern Resident']);
    expect(identifiersBeyond('Resident', ['Southern Resident'])).toEqual(['Southern Resident']);
  });
});

describe('labelIdentifiers: roll up to matrilines, then cap (decision 029, 2026-11-25)', () => {
  // The catalogue's answers, as topMatrilineOf gives them: T46B8, T46B2s and T46s are all T46s.
  const tops: Record<string, string> = {
    T46: 'T46s', T46s: 'T46s', T46B8: 'T46s', T46B2s: 'T46s', T46B1s: 'T46s',
    T49A7: 'T49s', T49As: 'T49s', T65A: 'T65s', T100s: 'T100s', T101s: 'T101s', T37Bs: 'T37s',
  };
  const roll = (identifiers: string[]) => labelIdentifiers(identifiers, id => tops[id] ?? null);

  test('says nothing when there are no identifiers', () => {
    expect(roll([])).toBeNull();
  });

  test('an individual or a matriline becomes its topmost matriline, however deep', () => {
    expect(roll(['T46B8'])).toBe('T46s');
    expect(roll(['T46B2s'])).toBe('T46s');
    expect(roll(['T49A7', 'T49As'])).toBe('T49s');
  });

  test('keeps a ? on the matriline, and a plain identifier outranks a hedged one', () => {
    expect(roll(['T65A?'])).toBe('T65s?');
    expect(roll(['T46B8?', 'T46s'])).toBe('T46s');
    expect(roll(['T46s', 'T46B8?'])).toBe('T46s');
    expect(roll(['T46B8?', 'T46B2s?'])).toBe('T46s?');
  });

  test('an identifier the catalogue does not know stays as written', () => {
    expect(roll(['BCX1358', 'T46B8'])).toBe('BCX1358, T46s');
    expect(roll(['CRC1234?'])).toBe('CRC1234?');
  });

  test('lists up to two entries and counts more', () => {
    expect(roll(['T46B8', 'T49A7'])).toBe('T46s, T49s');
    expect(roll(['T46B8', 'T49A7', 'T65A'])).toBe('3 matrilines');
  });

  test('counts "matrilines" only when every entry is one, and "identified" otherwise', () => {
    const seven = ['T100s', 'T101s', 'T37Bs', 'T46B8', 'T49A7', 'T65A?'];
    expect(roll(seven)).toBe('6 matrilines');
    expect(roll([...seven, 'BCX1358'])).toBe('7 identified');
    expect(roll(['BCX1', 'BCX2', 'BCX3'])).toBe('3 identified');
  });

  test('before the catalogue loads nothing rolls up, and the cap still applies to the raw list', () => {
    const none = () => null;
    expect(labelIdentifiers(['T46B8', 'T46B2s'], none)).toBe('T46B8, T46B2s');
    expect(labelIdentifiers(['T46B8', 'T46B2s', 'T49A7'], none)).toBe('3 identified');
    expect(labelIdentifiers(['T46B8?', 'T46B8'], none)).toBe('T46B8');
  });
});
