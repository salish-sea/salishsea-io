import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';

import { decodePng, encodePng, gridFromPng, type Greyscale } from './water-mask.ts';

/** A picture of the given width whose samples come from a repeatable pattern. */
function picture(width: number, height: number, bitDepth: 1 | 8): Greyscale {
    const stride = Math.ceil(width * bitDepth / 8);
    const data = new Uint8Array(stride * height);
    let seed = width * 31 + height;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            const on = (seed >> 16) & 1;
            if (bitDepth === 1) data[y * stride + (x >> 3)]! |= on << (7 - (x & 7));
            else data[y * stride + x] = on ? 255 : (seed >> 8) & 0x7f;
        }
    }
    return {width, height, bitDepth, data};
}

describe('decodePng', () => {
    for (const bitDepth of [1, 8] as const) {
        for (const width of [1, 3, 8, 9, 13]) {
            for (const filter of [0, 1, 2, 3, 4] as const) {
                test(`round-trips ${width} columns of ${bitDepth} bit with filter ${filter}`, () => {
                    const image = picture(width, 7, bitDepth);
                    const back = decodePng(encodePng(image, filter));
                    expect(back.width).toBe(width);
                    expect(back.height).toBe(7);
                    expect(back.bitDepth).toBe(bitDepth);
                    expect(Array.from(back.data)).toEqual(Array.from(image.data));
                });
            }
        }
    }

    test('refuses what it does not read, saying why', () => {
        const png = Buffer.from(encodePng(picture(8, 2, 1)));
        expect(() => decodePng(Buffer.from('not a png at all'))).toThrow(/signature/);
        const withHeader = (edit: (header: Buffer) => void) => {
            const copy = Buffer.from(png);
            edit(copy.subarray(8 + 8));
            // Fix the header's checksum so it is the content that is refused, not the sum.
            const crc = crc32(copy.subarray(12, 8 + 8 + 13));
            copy.writeUInt32BE(crc, 8 + 8 + 13);
            return copy;
        };
        expect(() => decodePng(withHeader(h => { h[9] = 2; }))).toThrow(/colour type 2/);
        expect(() => decodePng(withHeader(h => { h[8] = 16; }))).toThrow(/16 bits/);
        expect(() => decodePng(withHeader(h => { h[12] = 1; }))).toThrow(/interlaced/);
        const damaged = Buffer.from(png);
        damaged[30] = damaged[30]! ^ 0xff;
        expect(() => decodePng(damaged)).toThrow(/checksum/);
    });

    test('refuses a row with a filter type that does not exist', () => {
        const png = Buffer.from(encodePng(picture(8, 1, 1)));
        // Rebuild the pixel chunk with filter type 7.
        const header = png.subarray(8, 8 + 25);
        
        const body = deflateSync(Buffer.from([7, 0xaa]));
        const idat = Buffer.alloc(12 + body.length);
        idat.writeUInt32BE(body.length, 0);
        idat.write('IDAT', 4, 'latin1');
        body.copy(idat, 8);
        idat.writeUInt32BE(crc32(idat.subarray(4, 8 + body.length)), 8 + body.length);
        const iend = png.subarray(png.length - 12);
        expect(() => decodePng(Buffer.concat([png.subarray(0, 8), header, idat, iend]))).toThrow(/filter type 7/);
    });
});

describe('gridFromPng', () => {
    const json = (width: number, height: number) => ({bbox: [0, 0, width, height] as [number, number, number, number], width, height, cell: [1, 1] as [number, number], water: 1 as const});

    test('reads a 1-bit and an 8-bit picture to the same grid, white being water', () => {
        const one = gridFromPng(encodePng(picture(13, 5, 1), 4), json(13, 5));
        const eight = picture(13, 5, 8);
        const asEight = gridFromPng(encodePng(eight, 4), json(13, 5));
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 13; x++) {
                expect(asEight.isWaterCell(x, y)).toBe(eight.data[y * 13 + x]! >= 128);
            }
        }
        expect(one.isWaterCell(0, 0)).toBe(((picture(13, 5, 1).data[0]! >> 7) & 1) === 1);
    });

    test('refuses a picture whose size differs from its JSON', () => {
        expect(() => gridFromPng(encodePng(picture(13, 5, 1)), json(13, 6))).toThrow(/13 by 5 but its JSON says 13 by 6/);
    });

    test('refuses a mask whose white is not water', () => {
        expect(() => gridFromPng(encodePng(picture(8, 2, 1)), {...json(8, 2), water: 0 as unknown as 1})).toThrow(/water is 0/);
    });
});
