// @vitest-environment jsdom
import { html, render } from 'lit';
import { expect, test } from 'vitest';
import type { OccurrenceLink } from './catalog.ts';
import { latestLink, renderSightingsSummary } from './profile-shared.ts';

const link = (over: Partial<OccurrenceLink> = {}): OccurrenceLink => ({
  occurrence_id: 'maplify:1', observed_at: '2025-12-28T20:33:00+00:00', location: null,
  is_present: true, status: 'candidate', via_group: null, ...over,
});

const lastReported = (links: OccurrenceLink[]) => {
  const el = document.createElement('div');
  render(renderSightingsSummary(links, html`none`, {map: false, table: false, latestCard: html``}), el);
  return el.querySelector('.sightings-note')!.textContent!.replace(/\s+/g, ' ').trim().split(' · ')[0];
};

test('"Last reported" says when the newest report only possibly names it, and through which group (decision 054)', () => {
  expect(lastReported([link()])).toBe('Last reported December 28, 2025');
  expect(lastReported([link({possibly: true})])).toBe('Last reported December 28, 2025 (possibly)');
  // the build writes a group's designation, T099; a page writes the group, T099s
  expect(lastReported([link({possibly: true, via_group: 'T099'})])).toBe('Last reported December 28, 2025 (possibly, as T099s)');
  expect(lastReported([link({via_group: 'T099'})])).toBe('Last reported December 28, 2025 (as T099s)');
  // a matriline's report that names only a member (salish-fwyt.7)
  expect(lastReported([link({via_member: 'T099A2'})])).toBe('Last reported December 28, 2025 (as T099A2)');
  // a member's carcass is reported as one, and isn't the matriline's last report as it is the animal's (decision 088)
  expect(lastReported([link({via_member: 'T099A2', vitality: 'dead'})])).toBe('Last reported December 28, 2025 (as T099A2, dead)');
  expect(latestLink([link({occurrence_id: 'newer'}), link({occurrence_id: 'carcass', via_member: 'T099A2', vitality: 'dead'})]))
    .toMatchObject({latest: {occurrence_id: 'newer'}, dead: false});
});
