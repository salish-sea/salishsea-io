// Everything drawn on top of the basemap: markers, the caption, the attribution.
// One SVG, rasterized once and composited over the tiles.

import { project, type LonLat, type Viewport } from './mercator.js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

// Matches the marker a profile page's map draws for a report (src/profile-map.ts).
const MARKER_BLUE = '#1565c0';

// DejaVu Sans is bundled with the Lambda (see fonts/fonts.conf) because the
// runtime image has no fonts and every glyph renders as a .notdef box without
// one. Named first so a card looks the same locally as in production; the rest
// are fallbacks for a developer machine rendering outside the bundle.
const FONT_STACK = 'DejaVu Sans, Helvetica Neue, Helvetica, Arial, sans-serif';

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
  /** The newest report of a travel segment, drawn larger as the map draws the head of a track. */
  head?: boolean;
}

export interface Chrome {
  title: string;
  /** A line between the title and the subtitle: the animals in the frame, on a day card. */
  detail?: string | null;
  subtitle: string;
  attribution: string;
  markers: Marker[];
  /** Travel lines, drawn under the markers. */
  tracks?: LonLat[][];
}

// The map's travel line (src/style.ts, travel-casing and travel-line): slate on a white
// casing, the one thing drawn in no hue, because it supports the dots rather than being
// one of their categories (decision 029). A card is seen smaller than the map, so both
// are a little wider.
const TRACK_CASING = 'rgba(255, 255, 255, 0.9)';
const TRACK_LINE = 'rgba(71, 85, 105, 0.85)';

export function chromeSvg(c: Chrome, v: Viewport): Buffer {
  const paths = (c.tracks ?? []).map(track => track.map((p, i) => {
    const { x, y } = project(p, v);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(''));
  const tracks = paths.map(d =>
    `<path d="${d}" fill="none" stroke="${TRACK_CASING}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`).join('') +
    paths.map(d =>
    `<path d="${d}" fill="none" stroke="${TRACK_LINE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  // Heads last, so a track's newest report sits on top of the reports before it.
  const dots = [...c.markers].sort((a, b) => Number(!!a.head) - Number(!!b.head)).map(m => {
    const { x, y } = project(m.at, v);
    const px = x.toFixed(1), py = y.toFixed(1);
    return m.primary
      ? `<circle cx="${px}" cy="${py}" r="26" fill="${MARKER_BLUE}" fill-opacity="0.18"/>` +
        `<circle cx="${px}" cy="${py}" r="13" fill="${MARKER_BLUE}" stroke="#fff" stroke-width="3.5" filter="url(#shadow)"/>`
      : m.head
        ? `<circle cx="${px}" cy="${py}" r="10" fill="${MARKER_BLUE}" stroke="#fff" stroke-width="3" filter="url(#shadow)"/>`
        : `<circle cx="${px}" cy="${py}" r="7" fill="${MARKER_BLUE}" fill-opacity="0.85" stroke="#fff" stroke-width="2"/>`;
  }).join('');
  // A detail line pushes the title up and the scrim with it.
  const detail = c.detail ? 40 : 0;

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
  ${tracks}
  ${dots}
  <rect x="0" y="${CARD_HEIGHT - 150 - detail}" width="${CARD_WIDTH}" height="${150 + detail}" fill="url(#scrim)"/>
  <text x="48" y="${CARD_HEIGHT - 74 - detail}" font-family="${FONT_STACK}" font-size="46" font-weight="700" fill="#fff">${escapeXml(truncate(c.title, 34))}</text>
  ${c.detail ? `<text x="48" y="${CARD_HEIGHT - 74}" font-family="${FONT_STACK}" font-size="27" fill="#fff">${escapeXml(truncate(c.detail, 62))}</text>` : ''}
  <text x="48" y="${CARD_HEIGHT - 34}" font-family="${FONT_STACK}" font-size="27" fill="#e8eef5">${escapeXml(truncate(c.subtitle, 60))}</text>
  <text x="${CARD_WIDTH - 16}" y="${CARD_HEIGHT - 12}" text-anchor="end" font-family="${FONT_STACK}" font-size="15" fill="#fff" fill-opacity="0.75">${escapeXml(c.attribution)}</text>
</svg>`);
}
