import { INCOMPLETE, SETTLED } from './cache-control';
import { renderDayCard, renderOccurrenceCard } from './cards.js';
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

describe('a day card framed on a shared view', () => {
  beforeEach(() => jest.mocked(renderDayCard).mockReset().mockResolvedValue({ jpeg: Buffer.from('jpeg'), failedTiles: 0 }));

  it('is centred on the view and drawn at its zoom', async () => {
    const result = await handler({ rawPath: '/cards/day/2026-11-10/-13638453,6082529,11.jpg' });
    expect(result.statusCode).toBe(200);
    const frame = jest.mocked(renderDayCard).mock.calls[0]![2]!;
    expect(frame.z).toBe(11);
    expect(frame.center.lon).toBeCloseTo(-122.516, 3);
    expect(frame.center.lat).toBeCloseTo(47.854, 3);
  });

  it.each([
    ['/cards/day/2026-11-10/-13638453,6082529,16.jpg', 'a zoom past the basemap'],
    ['/cards/day/2026-11-10/-13638453,6082529,2.jpg', 'a zoom wider than the world'],
    ['/cards/day/2026-11-10/-13638453,99999999,11.jpg', 'a point off the map'],
    ['/cards/day/2026-02-31/0,0,8.jpg', 'a date that does not exist'],
  ])('is not drawn for %s (%s)', async (rawPath) => {
    expect((await handler({ rawPath })).statusCode).toBe(404);
    expect(renderDayCard).not.toHaveBeenCalled();
  });
});

describe("a sighting's card at a shared view's zoom", () => {
  beforeEach(() => drawn(0));

  it('is drawn at that zoom', async () => {
    jest.mocked(renderOccurrenceCard).mockClear();
    const result = await handler({ rawPath: '/cards/o/maplify%3Awhale_alert%3A263239/12.jpg' });
    expect(result.statusCode).toBe(200);
    expect(jest.mocked(renderOccurrenceCard).mock.calls[0]![0].id).toBe('maplify:whale_alert:263239');
    expect(jest.mocked(renderOccurrenceCard).mock.calls[0]![1]).toBe(12);
  });

  it('is drawn at the default zoom without one', async () => {
    jest.mocked(renderOccurrenceCard).mockClear();
    await handler({ rawPath: '/cards/o/maplify%3Awhale_alert%3A263239.jpg' });
    expect(jest.mocked(renderOccurrenceCard).mock.calls[0]![1]).toBeUndefined();
  });

  it('is not drawn at a zoom past the basemap', async () => {
    expect((await handler({ rawPath: '/cards/o/abc/16.jpg' })).statusCode).toBe(404);
  });
});
