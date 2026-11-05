/**
 * Cuts a box out of the water mask, for the test fixture (scripts/read-path/fixtures/water-mask/):
 *
 *   node scripts/read-path/crop-water-mask.ts <water-mask.png> <water-mask.json> <west> <south> <east> <north> <out.png> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { cropMask, gridFromPng } from './water-mask.ts';

if (import.meta.main) {
    const [png, json, west, south, east, north, outPng, outJson] = process.argv.slice(2);
    if (!outJson) {
        console.error('usage: crop-water-mask.ts <water-mask.png> <water-mask.json> <west> <south> <east> <north> <out.png> <out.json>');
        process.exit(2);
    }
    const meta = JSON.parse(readFileSync(json!, 'utf8'));
    const cut = cropMask(gridFromPng(readFileSync(png!), meta), meta, +west!, +south!, +east!, +north!);
    writeFileSync(outPng!, cut.png);
    writeFileSync(outJson, JSON.stringify(cut.json, null, 1) + '\n');
    console.log(`${cut.json.width} by ${cut.json.height} cells, ${cut.png.length} bytes`);
}
