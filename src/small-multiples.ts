/**
 * Small maps of where each of several subjects has been reported, every one at the same
 * scale, so they can be compared at a glance (decision 067). The ecotype page draws one
 * per matriline.
 *
 * Static SVG, with no script: the basemap is Esri's ocean tiles as <image>s, the same
 * layer and terms as the interactive maps (decision 020), and the reports are circles
 * over it. Every map shares one extent and zoom, so they all ask for the same dozen
 * tiles and the browser fetches each once. Like the templates that use it, nothing here
 * touches the window, the document, or the network.
 */

import { css, html, nothing } from 'lit';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import type { MapDot } from './individual-map.ts';

/**
 * The Salish Sea, as the maps all show it. It holds 8,764 of the 8,832 located reports
 * that name a matriline (99%, production on 2026-10-06); the rest, off the outer coast or
 * up in Johnstone Strait, would shrink every map to fit a handful of reports.
 */
export const SMALL_MAP_EXTENT = { west: -124.3, east: -122.1, south: 47.05, north: 49.45 } as const;

// Zoom 8 puts the extent about 400 tiles-pixels wide: sharp at twice the width a map is
// drawn at, which is what a high-density screen asks for.
const ZOOM = 8;
const TILE = 256;
const TILE_URL = 'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile';

/**
 * Radius and opacity of one report, in the map's own units (about 0.4 of a CSS pixel).
 * Big and dark enough that a matriline reported once still shows on its map.
 */
const DOT_RADIUS = 6;
const DOT_OPACITY = 0.5;
/** Reports this close together, in the map's units, are drawn as one darker circle. */
const DOT_GRID = 2;

/** Web Mercator pixel coordinates at ZOOM. */
function project(lon: number, lat: number): [number, number] {
  const size = TILE * 2 ** ZOOM;
  const sin = Math.sin(lat * Math.PI / 180);
  return [
    (lon + 180) / 360 * size,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  ];
}

const [X0, Y0] = project(SMALL_MAP_EXTENT.west, SMALL_MAP_EXTENT.north).map(Math.floor) as [number, number];
const [X1, Y1] = project(SMALL_MAP_EXTENT.east, SMALL_MAP_EXTENT.south).map(Math.ceil) as [number, number];
const WIDTH = X1 - X0;
const HEIGHT = Y1 - Y0;

/** The basemap every small map shares, as SVG. Path order is Esri's: /z/y/x. */
const BASEMAP = (() => {
  const tiles: string[] = [];
  for (let ty = Math.floor(Y0 / TILE); ty * TILE < Y1; ty++)
    for (let tx = Math.floor(X0 / TILE); tx * TILE < X1; tx++)
      tiles.push(`<image href="${TILE_URL}/${ZOOM}/${ty}/${tx}" x="${tx * TILE - X0}" y="${ty * TILE - Y0}" width="${TILE}" height="${TILE}"/>`);
  return tiles.join('');
})();

/**
 * One map's reports as SVG circles, and how many of them it draws. Reports in the same
 * cell of a fine grid become one circle, as dark as that many overlapping dots would be:
 * what the eye reads is the same, and the page is a fraction of the size. A report with
 * no location, or outside the extent, is left off.
 */
export function smallMapDots(dots: readonly MapDot[]): { svg: string, shown: number } {
  const cells = new Map<string, number>();
  let shown = 0;
  for (const { location } of dots) {
    if (!location) continue;
    const [x, y] = project(location.lon, location.lat);
    if (x < X0 || x > X1 || y < Y0 || y > Y1) continue;
    const key = `${Math.round((x - X0) / DOT_GRID) * DOT_GRID},${Math.round((y - Y0) / DOT_GRID) * DOT_GRID}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    shown++;
  }
  const svg = [...cells].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => {
    const [cx, cy] = key.split(',');
    const opacity = 1 - (1 - DOT_OPACITY) ** n;
    return `<circle cx="${cx}" cy="${cy}" r="${DOT_RADIUS}" fill-opacity="${opacity.toFixed(2)}"/>`;
  }).join('');
  return { svg, shown };
}

/**
 * "1,249 reports", every one of them. A map missing a few, off the edge or without a
 * location, says nothing: the page's note covers that. A map that draws none says so,
 * or it would look broken.
 */
function countLabel(total: number, shown: number): string {
  const reports = `${total.toLocaleString('en-US')} report${total === 1 ? '' : 's'}`;
  return shown ? reports : `${reports}, none here`;
}

export interface SmallMap {
  /** Where the map leads: the subject's own page, which has the interactive map. */
  href: string;
  label: string;
  /** Every report, whether or not it is located: what the count beside the label says. */
  dots: readonly MapDot[];
}

export const smallMapStyles = css`
  ul.small-maps {
    display: grid;
    gap: 1.25rem 0.75rem;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
  }
  ul.small-maps a {
    display: block;
  }
  /* One line, so the maps in a row line up. */
  ul.small-maps .label {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ul.small-maps .count {
    color: #64748b;
    font-size: 0.8125rem;
    font-weight: 400;
    margin-left: 0.25rem;
  }
  ul.small-maps svg {
    background: #c4daea;
    border: 1px solid #e2e8f0;
    display: block;
    height: auto;
    margin-top: 0.25rem;
    width: 100%;
  }
  ul.small-maps circle {
    fill: #1a1a1a;
  }
  .small-maps-credit {
    color: #94a3b8;
    font-size: 0.75rem;
    margin: 0.75rem 0 0;
  }
`;

/** The maps, in the order given, and the basemap's credit. */
export function renderSmallMaps(maps: readonly SmallMap[]) {
  if (!maps.length) return nothing;
  return html`
    <ul class="small-maps">
      ${maps.map(({ href, label, dots }) => {
        const { svg, shown } = smallMapDots(dots);
        return html`<li>
          <a href=${href}><span class="label">${label}<span class="count">${countLabel(dots.length, shown)}</span></span>
            <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width=${WIDTH} height=${HEIGHT} role="img"
              aria-label="Map of where the ${label} have been reported">${unsafeSVG(BASEMAP + svg)}</svg>
          </a>
        </li>`;
      })}
    </ul>
    <p class="small-maps-credit">Base maps by Esri and its data providers</p>
  `;
}
