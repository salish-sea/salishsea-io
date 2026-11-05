import { expect, test } from 'vitest';
import type { OccurrenceLink } from './catalog.ts';
import { matrilineLegend } from './matriline-profile.ts';

const link = (via: Partial<Pick<OccurrenceLink, 'via_group' | 'via_member'>> = {}): OccurrenceLink =>
  ({ occurrence_id: 'a', observed_at: '2026-09-20T18:00:00Z', location: null, is_present: true, status: 'candidate', via_group: null, ...via });

// salish-fwyt.7: the legend under a matriline's map, as agreed on T065s's mockup.
test("a matriline's legend names each kind of report, with how many", () => {
  expect(matrilineLegend('T065', [
    link(),
    ...Array.from({length: 1200}, () => link({via_group: 'T065A'})),
    link({via_group: 'T065B'}),
    link({via_member: 'T065A5'}), link({via_member: 'T065A5'}), link({via_member: 'T065B1'}),
  ])).toEqual({
    own: 'Reports naming T065s (1)',
    sub_lineage: 'Reports naming a sub-lineage, T065As or T065Bs (1,201)',
    members: 'Reports naming only members, such as T065A5 (3)',
  });
});

test('a kind with no reports is left out, and a single name is said as one', () => {
  expect(matrilineLegend('T137', [link(), link({via_member: 'T137A'})]))
    .toEqual({own: 'Reports naming T137s (1)', members: 'Reports naming only a member, T137A (1)'});
});

test('more than three sub-lineages are named by the two most reported', () => {
  const subs = ['T002C', 'T002B', 'T002B', 'T002D', 'T002E', 'T002E', 'T002E'].map(via_group => link({via_group}));
  expect(matrilineLegend('T002', subs).sub_lineage).toBe('Reports naming a sub-lineage, such as T002Es or T002Bs (7)');
});
