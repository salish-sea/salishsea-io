import { describe, expect, it } from 'vitest';
import { latestLink } from './profile-shared.ts';

describe('the sighting a profile reports as its last', () => {
  const link = (id: string, extra: {vitality?: string | null, via_group?: string | null} = {}) =>
    ({occurrence_id: id, vitality: null, via_group: null, ...extra});

  it('is the newest, links coming newest first', () => {
    expect(latestLink([link('b'), link('a')])).toEqual({latest: link('b'), dead: false});
  });

  it("is a dead animal's earliest record as dead, whatever comes after (decision 088)", () => {
    const links = [link('carcass-later', {vitality: 'dead'}), link('found-dead', {vitality: 'dead'}), link('alive')];
    expect(latestLink(links)).toEqual({latest: links[1], dead: true});
  });

  it("isn't a matriline member's death reported through the group", () => {
    const links = [link('newest'), link('member-dead', {vitality: 'dead', via_group: 'T065As'})];
    expect(latestLink(links)).toEqual({latest: links[0], dead: false});
  });

  it('is nothing without links', () => {
    expect(latestLink([])).toBeNull();
  });
});
