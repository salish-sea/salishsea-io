/**
 * The site's nav, About · Map · Whales and the search button (salish-nkbq, GH #640), on
 * every page: the map's header, the About page, the whales page and the profile pages. A
 * template that renders anywhere, prerendered or in the browser. about.html carries the
 * same markup by hand, since it is plain HTML, and a test holds the two together.
 *
 * Its look is BeeAtlas's header (bee-header.ts): each item a 44px target with a 24px
 * outline icon, dimmed until it is the page you are on, which is full strength and
 * underlined in the accent. The icons are BeeAtlas's: its map, its taxonomy symbol for
 * the list of species, and heroicons' information circle beside them. Unlike BeeAtlas's,
 * each item also says its name, and drops it when the row runs out of room.
 */

import { css, html, svg } from 'lit';

export type NavPage = 'about' | 'map' | 'whales';

const icon = (paths: ReturnType<typeof svg>) =>
  html`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="24" height="24" aria-hidden="true">${paths}</svg>`;

const aboutIcon = icon(svg`<path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"></path>`);
const mapIcon = icon(svg`<path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z"></path>`);
// BeeAtlas's one symbol for taxonomy (its icons.ts), which marks its species index: the
// whales page is ours.
const whalesIcon = icon(svg`<g transform="translate(0, 2.25)"><rect x="8.5" y="2" width="7" height="4.5" rx="0.75"></rect><path stroke-linecap="round" d="M12 6.5v3M6.5 9.5H17.5M6.5 9.5v3.5M17.5 9.5v3.5"></path><rect x="3" y="13" width="7" height="4.5" rx="0.75"></rect><rect x="14" y="13" width="7" height="4.5" rx="0.75"></rect></g>`);

const LINKS: readonly { page: NavPage, href: string, label: string, icon: unknown }[] = [
  { page: 'about', href: '/about.html', label: 'About', icon: aboutIcon },
  { page: 'map', href: '/', label: 'Map', icon: mapIcon },
  { page: 'whales', href: '/whales', label: 'Whales', icon: whalesIcon },
];

/**
 * The links, the current page's marked, then the search button; `null` on a page the
 * nav doesn't name (a profile). Each link carries its name as aria-label too, since the
 * visible label goes when the row is narrow.
 */
export function renderSiteNav(current: NavPage | null) {
  return html`<nav class="site-nav" aria-label="Site">${LINKS.map(({ page, href, label, icon }) =>
    html`<a class=${`${page}-link`} href=${href} aria-current=${page === current ? 'page' : 'false'} aria-label=${label} title=${label}>${icon}<span class="nav-label">${label}</span></a>`)}<site-search></site-search></nav>`;
}

/** For pages on a light background. The map's dark header gives the same items its own colours. */
export const siteNavStyles = css`
  nav.site-nav {
    align-items: center;
    display: flex;
    gap: 4px;
    margin: 0 0 2rem -10px;
  }
  nav.site-nav a {
    align-items: center;
    border-bottom: 2px solid transparent;
    box-sizing: border-box;
    color: #213547;
    display: inline-flex;
    font-weight: 500;
    gap: 6px;
    justify-content: center;
    min-height: 44px;
    min-width: 44px;
    opacity: 0.6;
    padding: 0 10px;
    text-decoration: none;
  }
  nav.site-nav a:hover {
    opacity: 0.9;
  }
  nav.site-nav a[aria-current="page"] {
    border-bottom-color: #1976d2;
    opacity: 1;
  }
  nav.site-nav site-search {
    color: #213547;
    margin-left: auto;
    margin-right: -10px;
  }
  /* When the row runs out of room, the icons speak for themselves. */
  @media (max-width: 40rem) {
    nav.site-nav {
      gap: 0;
    }
    nav.site-nav .nav-label {
      display: none;
    }
  }
`;
