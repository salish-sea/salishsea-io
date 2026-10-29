/**
 * A profile page's map of where its subject has been reported (decision 076): a
 * picture, drawn into the page when it is prerendered, with no script.
 *
 * It replaces an OpenLayers map that neither panned nor zoomed, so nothing is lost
 * by drawing it once: it frames its own reports, the basemap's image tiles are
 * `<image>`s under them (decision 074), and each dot is still a link to
 * that day on the main map. Like the small maps it shares its projection with
 * (`src/small-multiples.ts`), nothing here touches the window, the document, or
 * the network.
 */

import { css, html } from 'lit';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import { circle } from '@turf/circle';
import { mapUrl, observedDate, type OccurrenceLink } from './catalog.ts';
import { formatDate } from './date-format.ts';

/** What a dot needs: where, when, and which occurrence to open on the main map. */
export type MapDot = Pick<OccurrenceLink, 'occurrence_id' | 'observed_at' | 'location'>;

/** A place the dots are measured against (a haul-out site): its point and the radius within which a report counts (decision 040). */
export interface MapSite {
  lon: number;
  lat: number;
  radius_m: number;
}

export const TILE = 256;
/**
 * The basemap's image tiles (salish-sea/basemap's decision 014): the map without its
 * labels, in 256-pixel tiles drawn at 512 for high-density screens, close in (zooms 11 to
 * 15) only along the Salish Sea's shore. This is the set src/basemap-style.json names in
 * its metadata; scripts/update-basemap.ts rewrites this line, and src/style.test.ts checks
 * that the two agree.
 */
export const IMAGE_TILES = 'https://tiles.salishsea.io/images/847eeee11300d439/{z}/{x}/{y}.webp';
/**
 * What the basemap's sources ask to be credited with, wherever its tiles appear. OpenStreetMap's
 * licence asks that its name link to its copyright page, which says the data is under the ODbL.
 */
export const basemapCredit = () =>
  html`Base map © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors; depths from NOAA, Natural Resources Canada and GEBCO`;
/**
 * The deepest zoom the image tiles cover everywhere a picture can be framed. Closer in they
 * cover only the shore (the basemap's decision 014), so a closer picture lays this zoom's
 * tiles under its own: where a close tile is missing, such as over a buoy in open water, the
 * coarser one shows through rather than a flat colour.
 */
const COVERED_ZOOM = 10;

/** The URL of one image tile. */
export const tileUrl = (z: number, x: number, y: number) =>
  IMAGE_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

/** Web Mercator pixel coordinates at `zoom`, counting 256-pixel tiles, as the image tiles do. */
export function project(lon: number, lat: number, zoom: number): [number, number] {
  const size = TILE * 2 ** zoom;
  const sin = Math.sin(lat * Math.PI / 180);
  return [
    (lon + 180) / 360 * size,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  ];
}

/** The picture's size, in its own units; it is drawn the width of the page and as tall as that makes it. */
const WIDTH = 720;
const HEIGHT = 384;
/** Room around the reports, so a dot at the edge is whole. */
const PADDING = 32;
/**
 * How close the map comes, in the same zoom numbers as the main map's permalinks.
 * A site's map comes in close enough to see its radius.
 */
const MAX_ZOOM = 10;
const MAX_ZOOM_SITE = 15;
/** Reports this close together, in the picture's units, are drawn as one dot linking to the newest of them. */
const DOT_GRID = 2;
const DOT_OPACITY = 0.55;

/** Escaped for an attribute or text in markup Lit is told not to escape. */
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** "Reported Sep 20, 2026", or how many reports a dot stands for and the newest's date. */
function dotTitle(newest: MapDot, count: number): string {
  const date = formatDate(observedDate(newest.observed_at), { day: 'numeric', month: 'short', year: 'numeric' });
  return count > 1 ? `${count} reports, the newest on ${date}` : `Reported ${date}`;
}

/**
 * The map as SVG markup: the view that fits the reports (and the site's radius),
 * the tiles under it, and the dots. Exported for its tests; pages use
 * {@link renderProfileMap}. `dots` are newest first, and the newest is drawn solid
 * and on top.
 */
export function profileMapSvg(dots: readonly MapDot[], site: MapSite | null = null): string {
  const located = dots.filter((d): d is MapDot & { location: { lon: number, lat: number } } => !!d.location);
  const ring = site
    ? (circle([site.lon, site.lat], site.radius_m / 1000, { steps: 64, units: 'kilometers' }).geometry.coordinates[0] as [number, number][])
    : [];
  const points = [...located.map(d => [d.location.lon, d.location.lat] as [number, number]), ...ring];
  if (!points.length)
    return '';

  // Fit the points at zoom 0, then scale up to the zoom that just holds them.
  // A loop, not Math.min(...xs): spreading a page's worth of points as arguments
  // overflows the stack somewhere past a hundred thousand.
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [lon, lat] of points) {
    const [x, y] = project(lon, lat, 0);
    [minX, maxX, minY, maxY] = [Math.min(minX, x), Math.max(maxX, x), Math.min(minY, y), Math.max(maxY, y)];
  }
  const fits = (span: number, room: number) => span > 0 ? Math.log2(room / span) : Infinity;
  const zoom = Math.min(fits(maxX - minX, WIDTH - 2 * PADDING), fits(maxY - minY, HEIGHT - 2 * PADDING), site ? MAX_ZOOM_SITE : MAX_ZOOM);
  const scale = 2 ** zoom;
  const left = (minX + maxX) / 2 * scale - WIDTH / 2;
  const top = (minY + maxY) / 2 * scale - HEIGHT / 2;
  const at = (lon: number, lat: number): [number, number] => {
    const [x, y] = project(lon, lat, 0);
    return [x * scale - left, y * scale - top];
  };

  // Tiles from the next zoom up, so they are never stretched much; each drawn at its
  // scaled size. A zoom a hair past a whole one takes that one's tiles, stretched a
  // little, rather than four times as many from the next. Closer than COVERED_ZOOM, that
  // zoom's tiles go underneath first.
  const tileZoom = Math.ceil(zoom - 0.1);
  const tiles: string[] = [];
  const layer = (z: number) => {
    const tileSize = TILE * 2 ** (zoom - z);
    const lastTile = 2 ** z - 1;
    for (let ty = Math.max(0, Math.floor(top / tileSize)); ty * tileSize < top + HEIGHT && ty <= lastTile; ty++)
      for (let tx = Math.floor(left / tileSize); tx * tileSize < left + WIDTH; tx++)
        tiles.push(`<image href="${tileUrl(z, ((tx % (lastTile + 1)) + lastTile + 1) % (lastTile + 1), ty)}" x="${(tx * tileSize - left).toFixed(1)}" y="${(ty * tileSize - top).toFixed(1)}" width="${tileSize.toFixed(1)}" height="${tileSize.toFixed(1)}"></image>`);
  };
  if (tileZoom > COVERED_ZOOM) layer(COVERED_ZOOM);
  layer(tileZoom);

  // Every element is closed explicitly: Lit's server renderer parses this markup
  // as HTML, where a self-closing <circle/> doesn't close (src/small-multiples.ts).
  const [newest, ...older] = located;
  const cellOf = (dot: MapDot & { location: { lon: number, lat: number } }) => {
    const [x, y] = at(dot.location.lon, dot.location.lat);
    return [Math.round(x / DOT_GRID) * DOT_GRID, Math.round(y / DOT_GRID) * DOT_GRID] as const;
  };
  // Older reports at the newest's spot are counted in its dot, which covers theirs.
  const newestCell = newest ? cellOf(newest).join(',') : null;
  let newestCount = 1;
  const cells = new Map<string, { x: number, y: number, dot: MapDot, count: number }>();
  for (const dot of older) {
    const [cx, cy] = cellOf(dot);
    if (`${cx},${cy}` === newestCell) {
      newestCount++;
      continue;
    }
    const cell = cells.get(`${cx},${cy}`);
    if (cell) cell.count++;
    else cells.set(`${cx},${cy}`, { x: cx, y: cy, dot, count: 1 });
  }
  // Out of the tab order: a busy page would otherwise put hundreds of stops before
  // the next link. The old map's canvas had no keyboard route to these days
  // either; the line under the map links the newest.
  const link = (dot: MapDot, count: number, circleMarkup: string) =>
    `<a href="${escape(mapUrl(dot))}" tabindex="-1"><title>${escape(dotTitle(dot, count))}</title>${circleMarkup}</a>`;
  // A tap target wider than each dot, so a dot stays easy to tap when the picture
  // is scaled down to a phone's width. They are a layer of their own under the
  // dots: a pointer right on a dot takes that dot, and only a near miss falls to
  // a target, which may be a neighbour's.
  const hit = (dot: MapDot, x: number, y: number) =>
    `<a href="${escape(mapUrl(dot))}" tabindex="-1" aria-hidden="true"><circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12"></circle></a>`;
  const olderCells = [...cells.values()];
  const olderMarkup = olderCells.map(({ x, y, dot, count }) =>
    link(dot, count, `<circle class="dot" cx="${x}" cy="${y}" r="5" fill-opacity="${(1 - (1 - DOT_OPACITY) ** count).toFixed(2)}"></circle>`));

  const siteMarkup = site ? (() => {
    const path = ring.map(([lon, lat], i) => `${i ? 'L' : 'M'}${at(lon, lat).map(v => v.toFixed(1)).join(' ')}`).join('') + 'Z';
    const [x, y] = at(site.lon, site.lat);
    return { ring: `<path class="site" d="${path}"></path>`, centre: `<circle class="site-centre" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"></circle>` };
  })() : null;

  const newestAt = newest ? at(newest.location.lon, newest.location.lat) : null;
  const newestMarkup = newest && newestAt
    ? link(newest, newestCount, `<circle class="newest" cx="${newestAt[0].toFixed(1)}" cy="${newestAt[1].toFixed(1)}" r="7"></circle>`)
    : '';
  // The newest's target last, so a near miss between it and another goes to the newest.
  const hits = [...olderCells.map(({ x, y, dot }) => hit(dot, x, y)), ...(newest && newestAt ? [hit(newest, ...newestAt)] : [])];

  return tiles.join('') + hits.join('') + olderMarkup.join('') + (siteMarkup?.ring ?? '') + newestMarkup + (siteMarkup?.centre ?? '');
}

export const profileMapStyles = css`
  figure.profile-map {
    margin: 1.5rem 0 0;
  }
  figure.profile-map svg {
    background: #c3deeb;
    border: 1px solid #e2e8f0;
    display: block;
    height: auto;
    width: 100%;
  }
  figure.profile-map .dot {
    fill: rgb(25, 118, 210);
    stroke: #ffffff;
    stroke-width: 1;
  }
  figure.profile-map .newest {
    fill: #1565c0;
    stroke: #ffffff;
    stroke-width: 2;
  }
  figure.profile-map .hit {
    fill: transparent;
  }
  /* Scaled down to a phone's width, a 12-unit target is about 6 pixels; this keeps
     it near the old map's 9-pixel reach. */
  @media (max-width: 600px) {
    figure.profile-map .hit {
      r: 20px;
    }
  }
  figure.profile-map a:hover circle:not(.hit) {
    stroke: #ffff00;
    stroke-width: 3;
  }
  /* The site's radius and centre are drawn over the reports but take no clicks. */
  figure.profile-map .site, figure.profile-map .site-centre {
    pointer-events: none;
  }
  figure.profile-map .site {
    fill: rgba(230, 81, 0, 0.10);
    stroke: rgba(230, 81, 0, 0.8);
    stroke-dasharray: 6 4;
    stroke-width: 1.5;
  }
  figure.profile-map .site-centre {
    fill: #e65100;
    stroke: #ffffff;
    stroke-width: 1;
  }
  figure.profile-map figcaption {
    color: #94a3b8;
    font-size: var(--fs-caption);
    font-weight: 400;
    margin: 0.25rem 0 0;
  }
  figure.profile-map figcaption a {
    color: inherit;
  }
`;

/**
 * The map, framed on its reports, with the basemap's credit under it, which
 * OpenStreetMap's licence requires. Nothing when no report has a location and there is
 * no site to show.
 */
export function renderProfileMap(dots: readonly MapDot[], site: MapSite | null = null) {
  const svg = profileMapSvg(dots, site);
  if (!svg)
    return html``;
  return html`
    <figure class="profile-map">
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width=${WIDTH} height=${HEIGHT}
        aria-label="Map of where these reports were made. Each dot links to its day on the main map.">${unsafeSVG(svg)}</svg>
      <figcaption>${basemapCredit()}</figcaption>
    </figure>
  `;
}
