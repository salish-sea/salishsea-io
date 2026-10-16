import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { pageKind, SearchRecorder, type SearchRecord } from './search-log.ts';

describe('what the search field records (decision 078)', () => {
  let sent: SearchRecord[];
  let recorder: SearchRecorder;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    recorder = new SearchRecorder('map', record => sent.push(record), 3000);
  });
  afterEach(() => vi.useRealTimers());

  test('a choice is recorded with what was typed', () => {
    recorder.typed('l', 8);
    recorder.typed('lime k', 1);
    recorder.chose('lime k', 1, 'place', 'Lime Kiln Point');
    vi.advanceTimersByTime(10_000);
    expect(sent).toEqual([{ query: 'lime k', results: 1, chosen_kind: 'place', chosen_label: 'Lime Kiln Point', page: 'map' }]);
  });

  test('a pause of three seconds gives up, once, and closing after it adds nothing', () => {
    recorder.typed('jeff hea', 0);
    vi.advanceTimersByTime(2999);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    recorder.gaveUp();
    expect(sent).toEqual([{ query: 'jeff hea', results: 0, chosen_kind: null, chosen_label: null, page: 'map' }]);
  });

  test('closing the field gives up the query in it; an emptied field records nothing', () => {
    recorder.typed('coon', 2);
    recorder.gaveUp();
    recorder.typed('x', 1);
    recorder.typed('', 0);
    recorder.gaveUp();
    vi.advanceTimersByTime(10_000);
    expect(sent.map(r => r.query)).toEqual(['coon']);
  });

  test('places arriving update the count of a query not yet recorded', () => {
    recorder.typed('mud bay', 1);
    recorder.found(7);
    vi.advanceTimersByTime(3000);
    expect(sent[0]?.results).toBe(7);
  });

  test('the kind of page is the path\'s first part', () => {
    expect(pageKind('/')).toBe('map');
    expect(pageKind('/individuals/0000101/J35')).toBe('individuals');
    expect(pageKind('/about.html')).toBe('about');
  });
});
