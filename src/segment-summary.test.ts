// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { setCatalogCodes } from './individual-links.ts';
import type { Subject } from './subject.ts';
import type { Occurrence } from './types.ts';
import './segment-summary.ts';
import { behaviourSpells, type SegmentSummary } from './segment-summary.ts';

setCatalogCodes({
  designations: [{ code: 'T065A5', individual: { entity_id: 'SSA:0010197', primary_designation: 'T065A5' } }],
  groups: [],
});

const report = (id: string, minutes: number, body: string | null, identifiers: string[] = []) => ({
  id, body, identifiers, count: 1, photos: [], provider_slug: 'maplify', collection: 'Orca Network', direction: null,
  location: {lat: 48.5 + minutes / 1000, lon: -123},
  observed_at: new Date(Date.parse('2026-10-20T19:00:00Z') + minutes * 60_000).toISOString(),
  observed_at_ms: Date.parse('2026-10-20T19:00:00Z') + minutes * 60_000,
  taxon: {scientific_name: 'Orcinus orca', species_id: 41521},
}) as unknown as Occurrence;

async function mount(sightings: Occurrence[]) {
  const card = document.createElement('segment-summary') as SegmentSummary;
  card.sightings = sightings;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

afterEach(() => { document.body.innerHTML = ''; });

test("a chip on a segment's card opens the animal in the sidebar, as a sighting card's does", async () => {
  const card = await mount([report('a', 0, 'Biggs', ['T065A5']), report('b', 30, 'Biggs'), report('c', 60, 'Biggs T65A5 westbound', ['T065A5'])]);
  const opened: Subject[] = [];
  document.addEventListener('open-subject', e => opened.push((e as CustomEvent<Subject>).detail), {once: true});
  const chip = card.shadowRoot!.querySelector<HTMLAnchorElement>('ul.animals a')!;
  expect(chip.textContent).toBe('T065A5');
  const click = new MouseEvent('click', {bubbles: true, composed: true, cancelable: true, button: 0});
  chip.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
  expect(opened).toEqual([{kind: 'individuals', id: '0010197'}]);
  // And says how many of the reports name it.
  expect(card.shadowRoot!.querySelector('.support')!.textContent).toBe('2 of 3');
});

test("'Latest' quotes the newest report only, and nothing when it has no words", async () => {
  const card = await mount([report('a', 0, 'Orcas milling'), report('b', 30, 'Orcas northbound'), report('c', 60, null)]);
  expect(card.shadowRoot!.querySelector('.latest')).toBeNull();
  card.sightings = [report('a', 0, 'Orcas milling'), report('b', 30, 'Orcas northbound')];
  await card.updateComplete;
  expect(card.shadowRoot!.querySelector('.latest .text')!.textContent).toContain('Orcas northbound');
});

test('an animal some reports say was absent is a struck-through chip after the others, with how many say so (decision 109)', async () => {
  const absentIn = (r: Occurrence, absent: string[]) => ({...r, absent}) as Occurrence;
  const card = await mount([absentIn(report('a', 0, 'T46s (-D)', ['T46s']), ['T065A5']), report('b', 30, 'T46s', ['T46s'])]);
  const chips = [...card.shadowRoot!.querySelectorAll('ul.animals li')];
  expect(chips.map(li => li.className)).toEqual(['', 'absent']);
  const absent = chips[1]!;
  // a screen reader hears the absence, which a strike-through doesn't say
  expect(absent.querySelector('a')!.textContent).toBe('T065A5 (not with them)');
  expect(absent.querySelector('.support')!.textContent).toBe('1 of 2');
  expect(absent.querySelector('.support')!.getAttribute('title')).toBe("1 of the 2 reports say T065A5 wasn't with them");
});

describe('what the reports say the animals were doing (decision 116)', () => {
  const said = (r: Occurrence, behaviour: string[], group_part: Occurrence['group_part'] = null) => ({...r, behaviour, group_part}) as Occurrence;

  test('in the order they said it, reports that share a tag running together', () => {
    const spells = behaviourSpells([
      said(report('a', 0, 'spread out'), ['spread out']),
      said(report('b', 30, 'milling, foraging'), ['milling', 'foraging']),
      // a report that says nothing about behaviour doesn't break a spell
      said(report('c', 45, 'J pod NB'), []),
      said(report('d', 60, 'still milling, directional changes'), ['milling', 'directional changes']),
      // surface activity is not about where they're going
      said(report('e', 90, 'spread, surface active'), ['spread out', 'surface active']),
      said(report('f', 120, 'breaching'), ['breaching']),
    ]);
    expect(spells.map(({tags, from, to}) => [tags, from.id, to.id])).toEqual([
      [['spread out'], 'a', 'a'],
      [['milling', 'foraging', 'directional changes'], 'b', 'd'],
      [['spread out'], 'e', 'e'],
    ]);
  });

  test('a report joins the spell by what the report before it said, not anything earlier in the spell', () => {
    const spells = behaviourSpells([
      said(report('a', 0, ''), ['milling']),
      said(report('b', 15, ''), ['milling', 'foraging']),
      said(report('c', 30, ''), ['foraging']),
      said(report('d', 45, ''), ['milling']),
    ]);
    expect(spells.map(({tags, from, to}) => [tags, from.id, to.id])).toEqual([
      [['milling', 'foraging'], 'a', 'c'],
      [['milling'], 'd', 'd'],
    ]);
  });

  test('the card says it as a sentence, with times, and nothing when no report says anything', async () => {
    const card = await mount([
      said(report('a', 0, 'spread out'), ['spread out']),
      said(report('b', 30, 'milling'), ['milling']),
      said(report('c', 60, 'milling, foraging'), ['milling', 'foraging']),
      said(report('d', 90, 'quickly northbound, spread'), ['quickly', 'spread out']),
    ]);
    // each tag in a form a sentence can hold: "quickly" is "moving quickly" (Peter, 2026-11-12)
    expect(card.shadowRoot!.querySelector('p.behaviour')!.textContent!.replace(/\s+/g, ' ').trim())
      .toBe('Spread out 12:00, then milling and foraging 12:30–13:00, then moving quickly and spread out 13:30.');
    card.sightings = [report('a', 0, 'Orcas'), report('b', 30, 'Orcas')];
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('p.behaviour')).toBeNull();
  });

  test("'Latest' says when the newest report is the leaders' or the trailers' position", async () => {
    const card = await mount([report('a', 0, 'J pod NB'), said(report('b', 30, 'J pod trailers here'), [], 'trailers')]);
    expect(card.shadowRoot!.querySelector('.latest .label')!.textContent).toBe('Latest, 12:30, the trailers:');
  });
});
