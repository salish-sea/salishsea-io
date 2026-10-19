import sharp from 'sharp';
import { forgetHeldTiles, renderBasemap } from './basemap';
import { tilesFor, viewport } from './mercator';

// A card's viewport off San Juan Island, at the zoom of an occurrence card.
const V = viewport({ lon: -123.09, lat: 48.61 }, 9, 600, 315);
const TILES = tilesFor(V).tiles.map(t => `${t.z} ${t.x} ${t.y}`);

let webp: Buffer;
beforeAll(async () => {
  webp = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#808080' } }).webp().toBuffer();
});
afterEach(() => {
  jest.restoreAllMocks();
  forgetHeldTiles();
});

/**
 * Serves the basemap: `list` as its tiles.txt, or a failure if it is a number, and each
 * tile by `tile`, which is given its "z x y". Returns the tiles that were asked for.
 */
function serving(list: string[] | number, tile: (zxy: string) => Promise<Response>): string[] {
  const asked: string[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/tiles.txt')) {
      return typeof list === 'number' ? new Response(null, { status: list }) : new Response(list.join('\n') + '\n');
    }
    const [, z, x, y] = url.match(/\/(\d+)\/(\d+)\/(\d+)\.webp$/)!;
    asked.push(`${z} ${x} ${y}`);
    return tile(`${z} ${x} ${y}`);
  });
  return asked;
}
const aTile = async () => new Response(new Uint8Array(webp));

describe('renderBasemap', () => {
  it('counts no failures when every tile arrives', async () => {
    serving(TILES, aTile);
    expect((await renderBasemap(V)).failed).toBe(0);
  });

  it("doesn't ask for, or count as failed, a tile the basemap's list doesn't have", async () => {
    // Image tiles cover only some of the map; drawing the card again wouldn't fill those in.
    const asked = serving(TILES.slice(1), aTile);
    expect((await renderBasemap(V)).failed).toBe(0);
    expect(asked).not.toContain(TILES[0]);
  });

  it('counts a tile the list has but that answers 403, as it would if the bucket refused access', async () => {
    serving(TILES, async (zxy) => zxy === TILES[0] ? new Response(null, { status: 403 }) : aTile());
    expect((await renderBasemap(V)).failed).toBe(1);
  });

  it('counts tiles that time out, fail to connect or meet a server error', async () => {
    serving(TILES, async (zxy) => {
      if (zxy === TILES[0]) throw new DOMException('The operation timed out.', 'TimeoutError');
      if (zxy === TILES[1]) throw new TypeError('fetch failed');
      if (zxy === TILES[2]) return new Response(null, { status: 503 });
      return aTile();
    });
    expect((await renderBasemap(V)).failed).toBe(3);
  });

  it("counts every tile that doesn't arrive while the list is unavailable, and asks for the list again", async () => {
    serving(503, async (zxy) => zxy === TILES[0] ? new Response(null, { status: 403 }) : aTile());
    expect((await renderBasemap(V)).failed).toBe(1);

    const asked = serving(TILES.slice(1), aTile);
    expect((await renderBasemap(V)).failed).toBe(0);
    expect(asked).not.toContain(TILES[0]);
  });
});
