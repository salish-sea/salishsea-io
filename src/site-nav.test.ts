import { readFileSync } from 'node:fs';
import { render } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { expect, test } from 'vitest';

import { renderSiteNav } from './site-nav.ts';

/** Each link's class, href, current-ness and label, from markup. */
const links = (markup: string) => [...markup.matchAll(/<a class="([^"]+)" href="([^"]+)" aria-current="([^"]+)">([^<]+)<\/a>/g)]
  .map(([, cls, href, current, label]) => [cls, href, current, label]);

test('about.html carries, by hand, the nav the template renders for it', () => {
  const about = readFileSync(new URL('../about.html', import.meta.url), 'utf8');
  const handWritten = about.match(/<nav class="site-nav"[^>]*>.*?<\/nav>/s)![0];
  const rendered = collectResultSync(render(renderSiteNav('about'))).replace(/<!--[^>]*-->/g, '');
  expect(links(handWritten)).toEqual(links(rendered));
  expect(links(handWritten)).toHaveLength(3);
});
