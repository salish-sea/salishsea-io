import sharp from 'sharp';
import { renderBasemap } from './basemap';
import { tilesFor, viewport } from './mercator';

// A card's viewport off San Juan Island, at the zoom of an occurrence card.
const V = viewport({ lon: -123.09, lat: 48.61 }, 9, 600, 315);
const TILES = tilesFor(V).tiles.length;

/** Answers every tile request with `answer`, and restores fetch afterwards. */
function serving(answer: (call: number) => Promise<Response>) {
  let call = 0;
  jest.spyOn(globalThis, 'fetch').mockImplementation(() => answer(call++));
}

afterEach(() => jest.restoreAllMocks());

let webp: Buffer;
beforeAll(async () => {
  webp = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#808080' } }).webp().toBuffer();
});

describe('renderBasemap', () => {
  it('counts no failures when every tile arrives', async () => {
    serving(async () => new Response(new Uint8Array(webp)));
    expect((await renderBasemap(V)).failed).toBe(0);
  });

  it("doesn't count a tile the basemap has no file for as a failure", async () => {
    // Image tiles cover only some of the map; S3 behind CloudFront answers 403 for a
    // file it doesn't hold. Drawing the card again wouldn't fill those in.
    serving(async (call) => new Response(null, { status: call % 2 ? 403 : 404 }));
    expect((await renderBasemap(V)).failed).toBe(0);
  });

  it('counts tiles that time out, fail to connect or meet a server error', async () => {
    serving(async (call) => {
      if (call === 0) throw new DOMException('The operation timed out.', 'TimeoutError');
      if (call === 1) throw new TypeError('fetch failed');
      if (call === 2) return new Response(null, { status: 503 });
      return new Response(new Uint8Array(webp));
    });
    expect(TILES).toBeGreaterThan(3);
    expect((await renderBasemap(V)).failed).toBe(3);
  });
});
