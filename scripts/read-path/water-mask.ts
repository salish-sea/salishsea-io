/**
 * Reads the basemap's water mask (basemap decision 028; salish-20u7.2): a 1-bit greyscale
 * PNG of the sea, white where it is water, with a JSON beside it that says where on earth
 * the picture lies. Only the PNGs the basemap writes are understood (greyscale, 1 or 8
 * bits a sample, not interlaced); anything else is refused with the reason, rather than
 * read wrongly. No dependency: node:zlib inflates the pixels and checks the chunk sums.
 * The encoder is for tests and for cutting a fixture out of the whole mask.
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

import type { DistanceM } from '../../src/segments.ts';
import { WaterGrid, seaDistanceFor, type WaterGridSpec } from '../../src/sea-distance.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Rows of samples, each row padded to a whole byte; for 1 bit a sample the first is in the high bit. */
export type Greyscale = {width: number, height: number, bitDepth: 1 | 8, data: Uint8Array};

const rowBytes = (width: number, bitDepth: number) => Math.ceil(width * bitDepth / 8);

export function decodePng(png: Uint8Array): Greyscale {
    const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG: the signature is wrong');
    let header: {width: number, height: number, bitDepth: number} | undefined;
    const idat: Buffer[] = [];
    let ended = false;
    for (let at = 8; at < buf.length && !ended;) {
        if (at + 12 > buf.length) throw new Error('the PNG ends inside a chunk');
        const length = buf.readUInt32BE(at);
        const type = buf.toString('latin1', at + 4, at + 8);
        if (at + 12 + length > buf.length) throw new Error(`the PNG ends inside its ${type} chunk`);
        const body = buf.subarray(at + 8, at + 8 + length);
        if (crc32(buf.subarray(at + 4, at + 8 + length)) !== buf.readUInt32BE(at + 8 + length)) throw new Error(`the PNG's ${type} chunk fails its checksum`);
        if (type === 'IHDR') {
            const [bitDepth, colorType, compression, filter, interlace] = [body[8]!, body[9]!, body[10]!, body[11]!, body[12]!];
            if (colorType !== 0) throw new Error(`the PNG has colour type ${colorType}; only greyscale (0) is read`);
            if (bitDepth !== 1 && bitDepth !== 8) throw new Error(`the PNG has ${bitDepth} bits a sample; only 1 and 8 are read`);
            if (interlace !== 0) throw new Error('the PNG is interlaced; only plain rows are read');
            if (compression !== 0 || filter !== 0) throw new Error('the PNG uses a compression or filter method this reader does not know');
            header = {width: body.readUInt32BE(0), height: body.readUInt32BE(4), bitDepth};
        } else if (type === 'IDAT') idat.push(body);
        else if (type === 'IEND') ended = true;
        at += 12 + length;
    }
    if (!header) throw new Error('the PNG has no header chunk');
    if (!ended) throw new Error('the PNG has no end chunk');
    const {width, height, bitDepth} = header;
    const stride = rowBytes(width, bitDepth);
    const raw = inflateSync(Buffer.concat(idat));
    if (raw.length !== (stride + 1) * height) throw new Error(`the PNG holds ${raw.length} bytes of rows, not ${(stride + 1) * height}`);

    // Every sample is one byte or less, so the byte to the left (for the filters) is the previous byte.
    const data = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]!;
        const line = y * stride, source = y * (stride + 1) + 1;
        for (let x = 0; x < stride; x++) {
            const left = x > 0 ? data[line + x - 1]! : 0;
            const up = y > 0 ? data[line - stride + x]! : 0;
            const upLeft = x > 0 && y > 0 ? data[line - stride + x - 1]! : 0;
            const v = raw[source + x]!;
            switch (filter) {
                case 0: data[line + x] = v; break;
                case 1: data[line + x] = v + left; break;
                case 2: data[line + x] = v + up; break;
                case 3: data[line + x] = v + ((left + up) >> 1); break;
                case 4: data[line + x] = v + paeth(left, up, upLeft); break;
                default: throw new Error(`the PNG's row ${y} has filter type ${filter}`);
            }
        }
    }
    return {width, height, bitDepth: bitDepth as 1 | 8, data};
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function chunk(type: string, body: Uint8Array): Buffer {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    out.set(body, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
}

/** A PNG of the picture, every row with the given filter type (0 to 4), so tests can reach each one. */
export function encodePng(image: Greyscale, filter: 0 | 1 | 2 | 3 | 4 = 0): Buffer {
    const {width, height, bitDepth, data} = image;
    const stride = rowBytes(width, bitDepth);
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = filter;
        for (let x = 0; x < stride; x++) {
            const at = y * stride + x;
            const left = x > 0 ? data[at - 1]! : 0;
            const up = y > 0 ? data[at - stride]! : 0;
            const upLeft = x > 0 && y > 0 ? data[at - stride - 1]! : 0;
            const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
            raw[y * (stride + 1) + 1 + x] = (data[at]! - predicted) & 0xff;
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = bitDepth;
    return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', new Uint8Array(0))]);
}

/** What the JSON beside the picture says; the rest of it (sources, licence) is kept for whoever cuts a fixture. */
export type WaterMaskJson = WaterGridSpec & {water: 1} & Record<string, unknown>;

export function gridFromPng(png: Uint8Array, json: WaterMaskJson): WaterGrid {
    if (json.water !== 1) throw new Error(`the mask's JSON says water is ${JSON.stringify(json.water)}; only 1 (white) is read`);
    const image = decodePng(png);
    if (image.width !== json.width || image.height !== json.height) {
        throw new Error(`the picture is ${image.width} by ${image.height} but its JSON says ${json.width} by ${json.height}`);
    }
    const spec: WaterGridSpec = {bbox: json.bbox, width: json.width, height: json.height, cell: json.cell};
    if (image.bitDepth === 1) return new WaterGrid(image.data, spec);
    const stride = rowBytes(image.width, 1);
    const bits = new Uint8Array(stride * image.height);
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            if (image.data[y * image.width + x]! >= 128) bits[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
        }
    }
    return new WaterGrid(bits, spec);
}

/**
 * The join's distance from a command line that may carry `--water-mask <png> <json>`
 * (the build always passes it: occurrence-days.ts and encounters.ts must measure the same
 * way): the distance by sea, with the arguments left over. Without the flag the join
 * measures in a straight line, as the browser does, which is for hand runs and tests.
 */
export function waterMaskArgs(args: readonly string[]): {rest: string[], distanceM: DistanceM | undefined} {
    const at = args.indexOf('--water-mask');
    if (at < 0) return {rest: [...args], distanceM: undefined};
    const [png, json] = [args[at + 1], args[at + 2]];
    if (!png || !json || png.startsWith('--') || json.startsWith('--')) throw new Error('--water-mask takes two paths: <water-mask.png> <water-mask.json>');
    return {rest: [...args.slice(0, at), ...args.slice(at + 3)], distanceM: seaDistanceFor(loadWaterGrid(png, json))};
}

export function loadWaterGrid(pngPath: string, jsonPath: string): WaterGrid {
    return gridFromPng(readFileSync(pngPath), JSON.parse(readFileSync(jsonPath, 'utf8')));
}

/** The part of the mask in a box, cut at cell edges (so a little larger than asked), as a picture and its JSON. */
export function cropMask(grid: WaterGrid, json: WaterMaskJson, west: number, south: number, east: number, north: number): {png: Buffer, json: WaterMaskJson} {
    const col0 = Math.max(0, Math.floor(grid.colAt(west))), col1 = Math.min(grid.width, Math.ceil(grid.colAt(east)));
    const row0 = Math.max(0, Math.floor(grid.rowAt(north))), row1 = Math.min(grid.height, Math.ceil(grid.rowAt(south)));
    const width = col1 - col0, height = row1 - row0;
    const stride = rowBytes(width, 1);
    const data = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (grid.isWaterCell(col0 + x, row0 + y)) data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
        }
    }
    const [dx, dy] = grid.spec.cell;
    const bbox: [number, number, number, number] = [
        grid.spec.bbox[0] + col0 * dx, grid.spec.bbox[3] - row1 * dy, grid.spec.bbox[0] + col1 * dx, grid.spec.bbox[3] - row0 * dy,
    ];
    return {png: encodePng({width, height, bitDepth: 1, data}), json: {...json, bbox, width, height}};
}
