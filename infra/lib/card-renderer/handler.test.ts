import { INCOMPLETE, SETTLED } from './cache-control';
import { renderOccurrenceCard } from './cards.js';
import { handler } from './handler';

jest.mock('./cards.js', () => ({ renderOccurrenceCard: jest.fn(), renderDayCard: jest.fn() }));
jest.mock('./data.js', () => ({
  // A sighting from long ago, whose card would otherwise be cached for a month.
  fetchOccurrence: async (id: string) => ({
    id, location: { lon: -123.09, lat: 48.61 }, observedAt: '2025-06-03T18:00:00Z', species: 'Orca', count: 3,
  }),
  fetchDayOccurrences: async () => [],
}));

const drawn = (failedTiles: number) =>
  jest.mocked(renderOccurrenceCard).mockResolvedValue({ jpeg: Buffer.from('jpeg'), failedTiles });
const cacheControl = async () =>
  (await handler({ rawPath: '/cards/o/inaturalist%3A1.jpg' })).headers['cache-control'];

describe('a card for a settled sighting', () => {
  it('is cached for a month when its basemap is whole', async () => {
    drawn(0);
    expect(await cacheControl()).toBe(SETTLED);
  });

  it('is cached only briefly when some of its basemap tiles failed to arrive', async () => {
    drawn(2);
    expect(await cacheControl()).toBe(INCOMPLETE);
  });
});
