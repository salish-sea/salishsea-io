import { readFileSync } from 'node:fs';
import { render } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { expect, test } from 'vitest';

import { renderSiteNav, siteNavStyles } from './site-nav.ts';

const about = readFileSync(new URL('../about.html', import.meta.url), 'utf8');
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

test('about.html carries, by hand, the nav the template renders for it, icons and search button included', () => {
  const handWritten = about.match(/<nav class="site-nav"[^>]*>.*?<\/nav>/s)![0];
  const rendered = collectResultSync(render(renderSiteNav('about'))).replace(/<!--[^>]*-->/g, '');
  expect(handWritten).toBe(rendered);
  expect(rendered.match(/<a /g)).toHaveLength(3);
  expect(rendered).toMatch(/<\/a><site-search><\/site-search><\/nav>$/);
});

test('and its styles', () => {
  expect(collapse(about)).toContain(collapse(siteNavStyles.cssText));
});

test('each link keeps its name when its label is hidden (GH #640)', () => {
  const rendered = collectResultSync(render(renderSiteNav('map'))).replace(/<!--[^>]*-->/g, '');
  expect(rendered).toContain('<a class="map-link" href="/" aria-current="page" aria-label="Map" title="Map">');
  expect(rendered).toContain('<span class="nav-label">Whales</span>');
});
