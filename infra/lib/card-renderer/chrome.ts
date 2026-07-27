// Everything drawn on top of the basemap: markers, the caption, the attribution.
// One SVG, rasterized once and composited over the tiles.

import { project, type LonLat, type Viewport } from './mercator.js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

// Matches the marker the app draws for an occurrence (src/individual-map.ts).
const MARKER_BLUE = '#1565c0';

const FONT_STACK = 'Helvetica Neue, Helvetica, Arial, sans-serif';

/**
 * Escape the four characters that would otherwise break out of SVG text or an
 * attribute value: ampersand, less-than, greater-than and double quote. Species
 * names and dates reach this from the database, so it is the boundary that keeps
 * ingested text from becoming markup.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Trim to fit the card's width. SVG has no text wrapping and a long vernacular
 * name ("Pacific white-sided dolphin") would otherwise run off the edge or under
 * the attribution. The ratio is a deliberate approximation — measuring glyphs
 * would mean shipping font metrics for a problem that a safe cap solves.
 */
function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars - 1).trimEnd() + '…';
}

export interface Marker {
  at: LonLat;
  /** The subject of the card, drawn larger with a halo. */
  primary?: boolean;
}

export interface Chrome {
  title: string;
  subtitle: string;
  attribution: string;
  markers: Marker[];
}

export function chromeSvg(c: Chrome, v: Viewport): Buffer {
  const dots = c.markers.map(m => {
    const { x, y } = project(m.at, v);
    const px = x.toFixed(1), py = y.toFixed(1);
    return m.primary
      ? `<circle cx="${px}" cy="${py}" r="26" fill="${MARKER_BLUE}" fill-opacity="0.18"/>` +
        `<circle cx="${px}" cy="${py}" r="13" fill="${MARKER_BLUE}" stroke="#fff" stroke-width="3.5" filter="url(#shadow)"/>`
      : `<circle cx="${px}" cy="${py}" r="7" fill="${MARKER_BLUE}" fill-opacity="0.85" stroke="#fff" stroke-width="2"/>`;
  }).join('');

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">
  <defs>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.45"/>
    </filter>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.62"/>
    </linearGradient>
  </defs>
  ${dots}
  <rect x="0" y="${CARD_HEIGHT - 150}" width="${CARD_WIDTH}" height="150" fill="url(#scrim)"/>
  <text x="48" y="${CARD_HEIGHT - 74}" font-family="${FONT_STACK}" font-size="46" font-weight="700" fill="#fff">${escapeXml(truncate(c.title, 34))}</text>
  <text x="48" y="${CARD_HEIGHT - 34}" font-family="${FONT_STACK}" font-size="27" fill="#e8eef5">${escapeXml(truncate(c.subtitle, 60))}</text>
  <text x="${CARD_WIDTH - 16}" y="${CARD_HEIGHT - 12}" text-anchor="end" font-family="${FONT_STACK}" font-size="15" fill="#fff" fill-opacity="0.75">${escapeXml(c.attribution)}</text>
</svg>`);
}
