/**
 * A profile page's map of where its subject has been reported (decision 076): a
 * picture, drawn into the page when it is prerendered, with no script.
 *
 * It replaces an OpenLayers map that neither panned nor zoomed, so nothing is lost
 * by drawing it once: it frames its own reports, Esri's ocean tiles are `<image>`s
 * under them (decision 020's basemap and terms), and each dot is still a link to
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
export const TILE_URL = 'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile';

/** Web Mercator pixel coordinates at `zoom`, counting 256-pixel tiles, as Esri's tiles do. */
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
  const flat = points.map(([lon, lat]) => project(lon, lat, 0));
  const xs = flat.map(p => p[0]), ys = flat.map(p => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fits = (span: number, room: number) => span > 0 ? Math.log2(room / span) : Infinity;
  const zoom = Math.min(fits(maxX - minX, WIDTH - 2 * PADDING), fits(maxY - minY, HEIGHT - 2 * PADDING), site ? MAX_ZOOM_SITE : MAX_ZOOM);
  const scale = 2 ** zoom;
  const left = (minX + maxX) / 2 * scale - WIDTH / 2;
  const top = (minY + maxY) / 2 * scale - HEIGHT / 2;
  const at = (lon: number, lat: number): [number, number] => {
    const [x, y] = project(lon, lat, 0);
    return [x * scale - left, y * scale - top];
  };

  // Tiles from the next zoom up, so they are never stretched; each drawn at its scaled size.
  const tileZoom = Math.ceil(zoom);
  const tileSize = TILE * 2 ** (zoom - tileZoom);
  const lastTile = 2 ** tileZoom - 1;
  const tiles: string[] = [];
  for (let ty = Math.max(0, Math.floor(top / tileSize)); ty * tileSize < top + HEIGHT && ty <= lastTile; ty++)
    for (let tx = Math.floor(left / tileSize); tx * tileSize < left + WIDTH; tx++)
      tiles.push(`<image href="${TILE_URL}/${tileZoom}/${ty}/${tx}" x="${(tx * tileSize - left).toFixed(1)}" y="${(ty * tileSize - top).toFixed(1)}" width="${tileSize.toFixed(1)}" height="${tileSize.toFixed(1)}"></image>`);

  // Every element is closed explicitly: Lit's server renderer parses this markup
  // as HTML, where a self-closing <circle/> doesn't close (src/small-multiples.ts).
  const [newest, ...older] = located;
  const cells = new Map<string, { x: number, y: number, dot: MapDot, count: number }>();
  for (const dot of older) {
    const [x, y] = at(dot.location.lon, dot.location.lat);
    const [cx, cy] = [Math.round(x / DOT_GRID) * DOT_GRID, Math.round(y / DOT_GRID) * DOT_GRID];
    const cell = cells.get(`${cx},${cy}`);
    if (cell) cell.count++;
    else cells.set(`${cx},${cy}`, { x: cx, y: cy, dot, count: 1 });
  }
  const link = (dot: MapDot, count: number, circleMarkup: string) =>
    `<a href="${escape(mapUrl(dot))}"><title>${escape(dotTitle(dot, count))}</title>${circleMarkup}</a>`;
  const olderMarkup = [...cells.values()].map(({ x, y, dot, count }) =>
    link(dot, count, `<circle class="dot" cx="${x}" cy="${y}" r="5" fill-opacity="${(1 - (1 - DOT_OPACITY) ** count).toFixed(2)}"></circle>`));

  const siteMarkup = site ? (() => {
    const path = ring.map(([lon, lat], i) => `${i ? 'L' : 'M'}${at(lon, lat).map(v => v.toFixed(1)).join(' ')}`).join('') + 'Z';
    const [x, y] = at(site.lon, site.lat);
    return { ring: `<path class="site" d="${path}"></path>`, centre: `<circle class="site-centre" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"></circle>` };
  })() : null;

  const newestMarkup = newest ? (() => {
    const [x, y] = at(newest.location.lon, newest.location.lat);
    return link(newest, 1, `<circle class="newest" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"></circle>`);
  })() : '';

  return tiles.join('') + olderMarkup.join('') + (siteMarkup?.ring ?? '') + newestMarkup + (siteMarkup?.centre ?? '');
}

export const profileMapStyles = css`
  figure.profile-map {
    margin: 1.5rem 0 0;
  }
  figure.profile-map svg {
    background: #c4daea;
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
  figure.profile-map a:hover circle {
    stroke: #ffff00;
    stroke-width: 3;
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
    font-size: 0.75rem;
    margin: 0.25rem 0 0;
  }
`;

/**
 * The map, framed on its reports, with the basemap's credit under it, which its
 * terms require (decision 020). Nothing when no report has a location and there is
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
      <figcaption>Base map by Esri and its data providers</figcaption>
    </figure>
  `;
}
