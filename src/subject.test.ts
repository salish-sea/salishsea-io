import { describe, expect, it } from 'vitest';
import {
  decodeSubjectData, encodeSubjectData, parseSubject, sameSubject, subjectFromHref, subjectParam,
} from './subject.ts';

describe('the subject in the URL', () => {
  it('reads and writes a kind and a register identifier', () => {
    expect(parseSubject('individuals/0000101')).toEqual({kind: 'individuals', id: '0000101'});
    expect(parseSubject('matrilines/0002163')).toEqual({kind: 'matrilines', id: '0002163'});
    expect(subjectParam({kind: 'individuals', id: '0000101'})).toBe('individuals/0000101');
  });

  it('ignores anything else, so a stale or mistyped link still shows the map', () => {
    for (const value of [null, '', 'individuals', 'individuals/101', 'individuals/J35', 'pods/0000020', 'haulouts/0000340', 'individuals/0000101/J035'])
      expect(parseSubject(value), String(value)).toBeNull();
  });

  it('compares subjects by kind and identifier', () => {
    expect(sameSubject({kind: 'individuals', id: '0000101'}, {kind: 'individuals', id: '0000101'})).toBe(true);
    expect(sameSubject({kind: 'individuals', id: '0000101'}, {kind: 'matrilines', id: '0000101'})).toBe(false);
    expect(sameSubject(null, null)).toBe(true);
    expect(sameSubject(null, {kind: 'individuals', id: '0000101'})).toBe(false);
  });
});

describe('which links the sidebar opens', () => {
  const base = 'https://salishsea.io/?d=2026-10-24';

  it('an animal or a matriline page, by register identifier, with or without its slug', () => {
    expect(subjectFromHref('/individuals/0000101/J035', base)).toEqual({kind: 'individuals', id: '0000101'});
    expect(subjectFromHref('/individuals/0000101', base)).toEqual({kind: 'individuals', id: '0000101'});
    expect(subjectFromHref('https://salishsea.io/matrilines/0002163/T065As', base)).toEqual({kind: 'matrilines', id: '0002163'});
  });

  it('not a page the sidebar has no view of, a legacy address, or another site', () => {
    for (const href of ['/pods/0000020/J-pod', '/populations/0000002/Biggs', '/haulouts/340', '/individuals/J35',
                        '/?d=2026-10-24&o=maplify:1', 'https://example.org/individuals/0000101', 'not a url: ::'])
      expect(subjectFromHref(href, base), href).toBeNull();
  });
});

describe("a page's data as JSON", () => {
  it('keeps its maps as maps', () => {
    const data = {name: 'Tahlequah', groups: new Map([[17, {id: 17, designation: 'J017'}]]), members: [{id: 1}]};
    const back = decodeSubjectData<typeof data>(encodeSubjectData(data));
    expect(back.groups).toBeInstanceOf(Map);
    expect(back.groups.get(17)).toEqual({id: 17, designation: 'J017'});
    expect(back).toEqual(data);
  });

  it('leaves an ordinary object with a $map-like key alone unless it is exactly the encoding', () => {
    const data = {note: {$map: 'not an array'}, other: {$map: [], extra: 1}};
    expect(decodeSubjectData(encodeSubjectData(data))).toEqual(data);
  });
});
