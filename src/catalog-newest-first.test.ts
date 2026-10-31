import { expect, test } from 'vitest';

import { dedupeOccurrenceLinks } from './catalog.ts';

// The build writes a time with its fraction trimmed (derive/shared.sql's pg_ts), so a
// report half a second into a minute is a longer string than one on the second.
// localeCompare's collation puts '.' before '+', which ordered the whole second after it.
test('links are newest first when one time has a fraction of a second and another has none', () => {
    const link = (occurrence_id: string, observed_at: string) =>
        ({occurrence_id, observed_at, location: null, is_present: true, status: 'candidate' as const});
    const links = dedupeOccurrenceLinks([
        link('inaturalist:1', '2026-10-20T19:41:54+00:00'),
        link('orcasound:2', '2026-10-20T19:41:54.458+00:00'),
    ]);
    expect(links.map(l => l.occurrence_id)).toEqual(['orcasound:2', 'inaturalist:1']);
});
