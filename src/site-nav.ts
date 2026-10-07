/**
 * The site's nav, About · Map · Whales (salish-nkbq), on every page: the map's header,
 * the About page, the whales page and the profile pages. A template that renders anywhere,
 * prerendered or in the browser. about.html carries the same markup by hand, since it is
 * plain HTML, and a test holds the two together.
 */

import { css, html } from 'lit';

export type NavPage = 'about' | 'map' | 'whales';

const LINKS: readonly { page: NavPage, href: string, label: string }[] = [
  { page: 'about', href: '/about.html', label: 'About' },
  { page: 'map', href: '/', label: 'Map' },
  { page: 'whales', href: '/whales', label: 'Whales' },
];

/** The links, the current page's marked; `null` on a page the nav doesn't name (a profile). */
export function renderSiteNav(current: NavPage | null) {
  return html`<nav class="site-nav" aria-label="Site">${LINKS.map(({ page, href, label }) =>
    html`<a class=${`${page}-link`} href=${href} aria-current=${page === current ? 'page' : 'false'}>${label}</a>`)}</nav>`;
}

/** For pages on a light background. The map's dark header styles the links itself. */
export const siteNavStyles = css`
  nav.site-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
    margin-bottom: 2.5rem;
  }
  nav.site-nav a {
    color: #1976d2;
    font-weight: 500;
    text-decoration: none;
  }
  nav.site-nav a:hover {
    color: #1565c0;
  }
  nav.site-nav a[aria-current="page"] {
    color: #213547;
    font-weight: 600;
  }
`;
