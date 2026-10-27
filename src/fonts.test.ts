import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Every page names Mukta, and src/fonts.css is what loads it (salish-74v6). Read off
// the HTML files rather than a list, so a page added later is covered the day it is.
describe('the font every page names is loaded on every page', () => {
  const pages = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.html'));

  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)('%s links src/fonts.css before any style that names Mukta', page => {
    const html = fs.readFileSync(path.join(process.cwd(), page), 'utf-8');
    const link = html.indexOf('<link rel="stylesheet" href="/src/fonts.css">');
    expect(link, `${page} should link /src/fonts.css`).toBeGreaterThan(-1);
    const firstMukta = html.search(/font-family:[^;]*Mukta/);
    if (firstMukta !== -1) expect(link).toBeLessThan(firstMukta);
  });
});
