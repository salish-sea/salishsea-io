import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { OBSERVATION_TIME_ZONE } from '../../src/constants.ts';
import { dayOf, DAY_ZONE } from './pacific-day.ts';

// The browser puts an occurrence on a day in this zone, and the build files it under a
// day in DAY_ZONE; if they differ, a link opens a day whose file doesn't hold it.
test("the build's day is the frontend's", () => {
    expect(DAY_ZONE).toBe(OBSERVATION_TIME_ZONE);
});

// Stelis's graph keys build.occurrences by day with a hand copy of this expression
// (OCCURRENCE-DAY in stelis/salishsea.rkt), to tell occurrence-days which days a save
// moved. It said 'PST8PDT' while this said 'America/Los_Angeles' until 2026-11-08.
test("the graph's copy of the day is this one", () => {
    const graph = readFileSync(new URL('../../stelis/salishsea.rkt', import.meta.url), 'utf8');
    expect(graph).toContain(`(define OCCURRENCE-DAY "${dayOf('observed_at')}")`);
});
