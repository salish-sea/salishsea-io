import { describe, it, expect } from 'vitest';
import { planSync, type StorageObject } from './plan-media-sync.ts';

const object = (name: string, etag: string | null, size = 1_000): StorageObject =>
  ({name, etag, size});

/** The mirror, described the way the workflow describes it: a manifest plus the S3 listing. */
const mirror = (entries: Record<string, string>, missing: string[] = []) => ({
  held: new Map(Object.entries(entries)),
  present: new Set(Object.keys(entries).filter(name => !missing.includes(name))),
});

describe('planSync', () => {
  it('fetches nothing when every object is mirrored at the same ETag', () => {
    const {held, present} = mirror({'a.jpg': 'abc', 'b.jpg': 'def'});
    const plan = planSync([object('a.jpg', 'abc'), object('b.jpg', 'def')], held, present);
    expect(plan.fetch).toEqual([]);
    expect(plan.fetchBytes).toBe(0);
  });

  it('fetches an object the mirror has never seen', () => {
    const {held, present} = mirror({'a.jpg': 'abc'});
    const plan = planSync([object('a.jpg', 'abc'), object('new.jpg', 'xyz', 2_500)], held, present);
    expect(plan.fetch.map(o => o.name)).toEqual(['new.jpg']);
    expect(plan.fetchBytes).toBe(2_500);
  });

  it('fetches an object re-uploaded under the same name', () => {
    const {held, present} = mirror({'a.jpg': 'old-etag'});
    expect(planSync([object('a.jpg', 'new-etag')], held, present).fetch.map(o => o.name)).toEqual(['a.jpg']);
  });

  it('fetches an object the manifest claims but the bucket does not hold', () => {
    // A sweep that died between uploading and writing the manifest, or a
    // lifecycle rule someone widened. Trusting the manifest alone would leave a
    // photo permanently unbacked while every report said it was covered.
    const {held, present} = mirror({'a.jpg': 'abc'}, ['a.jpg']);
    expect(planSync([object('a.jpg', 'abc')], held, present).fetch.map(o => o.name)).toEqual(['a.jpg']);
  });

  it('ignores quoting differences on either side', () => {
    const {held, present} = mirror({'a.jpg': '"abc"'});
    expect(planSync([object('a.jpg', 'abc')], held, present).fetch).toEqual([]);
  });

  it('fetches when either side has no ETag to compare', () => {
    // A redundant download is cheap; a photo silently assumed current is not.
    const m1 = mirror({'a.jpg': 'abc'});
    expect(planSync([object('a.jpg', null)], m1.held, m1.present).fetch).toHaveLength(1);
    const m2 = mirror({'a.jpg': ''});
    expect(planSync([object('a.jpg', 'abc')], m2.held, m2.present).fetch).toHaveLength(1);
  });

  it('fetches everything when there is no manifest at all', () => {
    // First run, or a manifest lost. Fetching everything is the safe direction.
    const plan = planSync([object('a.jpg', 'abc'), object('b.jpg', 'def')], new Map(), new Set());
    expect(plan.fetch).toHaveLength(2);
  });

  it('reports the full upstream inventory, not just the difference', () => {
    const {held, present} = mirror({'a.jpg': 'abc'});
    const plan = planSync([object('a.jpg', 'abc'), object('b.jpg', 'def')], held, present);
    expect(plan.expected).toHaveLength(2);
    expect(plan.fetch).toHaveLength(1);
  });

  it('leaves an object the mirror holds and upstream no longer lists out of the plan', () => {
    // Nothing deletes from the mirror. A photo removed upstream — by mistake or
    // otherwise — is exactly the one a backup should still hold, so it simply
    // stops appearing in `expected` and its mirrored copy stays.
    const {held, present} = mirror({'a.jpg': 'abc', 'gone.jpg': 'old'});
    const plan = planSync([object('a.jpg', 'abc')], held, present);
    expect(plan.fetch).toEqual([]);
    expect(plan.expected.map(o => o.name)).toEqual(['a.jpg']);
  });
});
