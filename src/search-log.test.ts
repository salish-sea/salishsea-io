import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { pageKind, sameSearch, SearchRecorder, type SearchRecord } from './search-log.ts';

describe('what the search field records (decision 078)', () => {
  let sent: SearchRecord[];
  let recorder: SearchRecorder;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    recorder = new SearchRecorder('map', record => sent.push(record), 3000);
  });
  afterEach(() => vi.useRealTimers());

  const miss = (query: string, results: number | null) => ({ query, results, chosen_kind: null, chosen_label: null, page: 'map' });

  test('a choice is recorded once, with what was typed, however long the list was read', () => {
    recorder.typed('l', 8);
    recorder.typed('lime k', 1);
    vi.advanceTimersByTime(10_000);
    recorder.chose('lime k', 1, 'place', 'Lime Kiln Point');
    recorder.gaveUp();
    expect(sent).toEqual([{ query: 'lime k', results: 1, chosen_kind: 'place', chosen_label: 'Lime Kiln Point', page: 'map' }]);
  });

  test('other words after a pause give up the query paused on; more of the same words do not', () => {
    recorder.typed('jeff head', 0);
    vi.advanceTimersByTime(3000);
    recorder.typed('jefferson', 1);
    recorder.chose('jefferson', 1, 'place', 'Point Jefferson');
    recorder.typed('lime', 2);
    vi.advanceTimersByTime(3000);
    recorder.typed('lime kiln', 1);
    recorder.chose('lime kiln', 1, 'place', 'Lime Kiln Point');
    expect(sent.map(r => [r.query, r.chosen_label])).toEqual([['jeff head', null], ['jefferson', 'Point Jefferson'], ['lime kiln', 'Lime Kiln Point']]);
  });

  test('backspacing or correcting after a pause is the same search', () => {
    recorder.typed('lime kiln', 1);
    vi.advanceTimersByTime(3000);
    recorder.typed('lime kil', 1);
    recorder.typed('lime kikn', 0);
    recorder.typed('lime kiln', 1);
    recorder.chose('lime kiln', 1, 'place', 'Lime Kiln Point');
    expect(sent.map(r => r.chosen_label)).toEqual(['Lime Kiln Point']);
  });

  test('a pause alone records nothing; other words without a pause give nothing up', () => {
    recorder.typed('coon', 2);
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
    recorder.typed('cutts', 0);
    recorder.typed('day island', 1);
    recorder.gaveUp();
    // "coon" was paused on, so other words gave it up; "cutts" was not, so they didn't.
    expect(sent).toEqual([miss('coon', 2), miss('day island', 1)]);
  });

  test('closing the field gives up the query in it, once; an emptied field records nothing', () => {
    recorder.typed('coon', 2);
    recorder.gaveUp();
    recorder.gaveUp();
    recorder.typed('x', 1);
    recorder.typed('', 0);
    recorder.gaveUp();
    expect(sent).toEqual([miss('coon', 2)]);
  });

  test('a count not known while the index loads is filled in when it arrives', () => {
    recorder.typed('mud bay', null);
    recorder.found(7);
    recorder.gaveUp();
    recorder.typed('j35', null);
    recorder.gaveUp();
    expect(sent).toEqual([miss('mud bay', 7), miss('j35', null)]);
  });

  test('one search going on, or two', () => {
    expect([sameSearch('lime kiln', 'lime'), sameSearch('lime', 'lime kiln'), sameSearch('lime kikn', 'lime kiln')]).toEqual([true, true, true]);
    expect([sameSearch('jefferson', 'jeff head'), sameSearch('cutts', 'coon')]).toEqual([false, false]);
  });

  test('the kind of page is the path\'s first part', () => {
    expect(pageKind('/')).toBe('map');
    expect(pageKind('/individuals/0000101/J35')).toBe('individuals');
    expect(pageKind('/about.html')).toBe('about');
  });
});
