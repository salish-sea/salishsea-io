// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { setCatalogCodes } from './individual-links.ts';
import type { Subject } from './subject.ts';
import type { Occurrence } from './types.ts';
import './segment-summary.ts';
import type { SegmentSummary } from './segment-summary.ts';

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
