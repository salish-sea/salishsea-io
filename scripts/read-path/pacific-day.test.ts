import { expect, test } from 'vitest';

import { OBSERVATION_TIME_ZONE } from '../../src/constants.ts';
import { DAY_ZONE } from './pacific-day.ts';

// The browser puts an occurrence on a day in this zone, and the build files it under a
// day in DAY_ZONE; if they differ, a link opens a day whose file doesn't hold it.
test("the build's day is the frontend's", () => {
    expect(DAY_ZONE).toBe(OBSERVATION_TIME_ZONE);
});
