// PROTOTYPE — throwaway. Answers one question: does a real-tile card (A) look
// better than a drawn-coastline card (D) at OG card size? Both render the SAME
// view window so the only variable is how the map is drawn.
const fs = require('fs');
const sharp = require('sharp');

const W = 1200, H = 630, TILE = 256;

// --- Web Mercator, in pixels at a given zoom ---
const lonToX = (lon, z) => (lon + 180) / 360 * Math.pow(2, z) * TILE;
const latToY = (lat, z) => {
  const s = Math.sin(lat * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z) * TILE;
};
const xToLon = (x, z) => x / (Math.pow(2, z) * TILE) * 360 - 180;
const yToLat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / (Math.pow(2, z) * TILE);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const ESRI = z => [
  `https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/${z}`,
  `https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/${z}`,
];

// The card's "chrome": marker, caption, attribution. Shared by both variants so
// the comparison is about the map, not the labelling.
function overlaySvg({ species, date, count, attribution }) {
  const cx = W / 2, cy = H / 2;
  const caption = count ? `${count} ${species}${count > 1 ? 's' : ''}` : species;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <filter id="sh" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.45"/>
      </filter>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.62"/>
      </linearGradient>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="26" fill="#1565c0" fill-opacity="0.18"/>
    <circle cx="${cx}" cy="${cy}" r="13" fill="#1565c0" stroke="#fff" stroke-width="3.5" filter="url(#sh)"/>
    <rect x="0" y="${H - 150}" width="${W}" height="150" fill="url(#fade)"/>
    <text x="48" y="${H - 74}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
          font-size="46" font-weight="700" fill="#fff">${caption}</text>
    <text x="48" y="${H - 34}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
          font-size="27" fill="#e8eef5">${date} &#183; SalishSea.io</text>
    <text x="${W - 16}" y="${H - 12}" text-anchor="end"
          font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
          font-size="15" fill="#fff" fill-opacity="0.75">${attribution}</text>
  </svg>`);
}

// --- Variant A: composite real Esri World Ocean Base tiles ---
async function renderTiles({ lon, lat, z }) {
  const cx = lonToX(lon, z), cy = latToY(lat, z);
  const left = cx - W / 2, top = cy - H / 2;
  const tx0 = Math.floor(left / TILE), ty0 = Math.floor(top / TILE);
  const tx1 = Math.floor((left + W) / TILE), ty1 = Math.floor((top + H) / TILE);

  const canvasW = (tx1 - tx0 + 1) * TILE, canvasH = (ty1 - ty0 + 1) * TILE;
  const composites = [];
  let fetched = 0, failed = 0;
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      let buf = null;
      for (const base of ESRI(z)) {
        try {
          const res = await fetch(`${base}/${ty}/${tx}`); // Esri path order: /z/y/x
          if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); break; }
        } catch { /* try the next host */ }
      }
      if (!buf) { failed++; continue; }
      fetched++;
      composites.push({ input: buf, left: (tx - tx0) * TILE, top: (ty - ty0) * TILE });
    }
  }
  const mosaic = await sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background: '#a9c9e2' },
  }).composite(composites).png().toBuffer();

  return { buf: await sharp(mosaic)
    .extract({ left: Math.round(left - tx0 * TILE), top: Math.round(top - ty0 * TILE), width: W, height: H })
    .png().toBuffer(), fetched, failed };
}

// --- Variant D: draw a coastline we ship ourselves ---
let LAND = null;
function loadLand() {
  if (LAND) return LAND;
  const polys = [];
  for (const file of ['ne_land.json', 'ne_islands.json']) {
    const gj = JSON.parse(fs.readFileSync(`${__dirname}/${file}`, 'utf8'));
    for (const f of gj.features) {
      const g = f.geometry;
      if (!g) continue;
      const rings = g.type === 'Polygon' ? [g.coordinates]
        : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of rings) polys.push(poly);
    }
  }
  LAND = polys;
  return LAND;
}

function renderCoastSvg({ lon, lat, z }) {
  const cx = lonToX(lon, z), cy = latToY(lat, z);
  const left = cx - W / 2, top = cy - H / 2;
  const west = xToLon(left, z), east = xToLon(left + W, z);
  const north = yToLat(top, z), south = yToLat(top + H, z);

  const paths = [];
  for (const poly of loadLand()) {
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r];
      // Cheap bbox reject: skip rings that cannot touch the view.
      let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
      for (const [x, y] of ring) {
        if (x < minLon) minLon = x; if (x > maxLon) maxLon = x;
        if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
      }
      if (maxLon < west || minLon > east || maxLat < south || minLat > north) continue;
      const d = ring.map(([x, y], i) =>
        `${i ? 'L' : 'M'}${(lonToX(x, z) - left).toFixed(1)},${(latToY(y, z) - top).toFixed(1)}`
      ).join('') + 'Z';
      paths.push(`<path d="${d}" fill="${r === 0 ? '#e8e2d5' : '#cfe3f2'}" stroke="#b9ad95" stroke-width="1"/>`);
    }
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#cfe3f2"/>
    <g>${paths.join('')}</g>
  </svg>`, rings: paths.length };
}

async function renderCoast(opts) {
  const { svg, rings } = renderCoastSvg(opts);
  return { buf: await sharp(Buffer.from(svg)).png().toBuffer(), rings };
}

(async () => {
  const cases = JSON.parse(fs.readFileSync(`${__dirname}/cases.json`, 'utf8'));
  const out = `${__dirname}/out`;
  fs.mkdirSync(out, { recursive: true });
  for (const c of cases) {
    for (const z of c.zooms) {
      const chrome = overlaySvg({ ...c, attribution: 'Base map by Esri and its data providers' });
      const chromeD = overlaySvg({ ...c, attribution: 'Coastline: Natural Earth' });

      const a = await renderTiles({ ...c, z });
      await sharp(a.buf).composite([{ input: chrome }]).jpeg({ quality: 86 })
        .toFile(`${out}/${c.slug}-z${z}-A.jpg`);

      const d = await renderCoast({ ...c, z });
      await sharp(d.buf).composite([{ input: chromeD }]).jpeg({ quality: 86 })
        .toFile(`${out}/${c.slug}-z${z}-D.jpg`);

      console.log(`${c.slug} z${z}: A tiles=${a.fetched} failed=${a.failed} | D rings=${d.rings}`);
    }
  }
})();
