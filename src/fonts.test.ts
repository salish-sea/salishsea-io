import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// src/fonts.css names the font and loads it (salish-74v6, salish-hdhv). Read off
// the HTML files rather than a list, so a page added later is covered the day it is.
describe('every page links the stylesheet that names and loads the font', () => {
  const pages = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.html'));

  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)('%s links src/fonts.css', page => {
    const html = fs.readFileSync(path.join(process.cwd(), page), 'utf-8');
    expect(html, `${page} should link /src/fonts.css`).toMatch(/<link\b[^>]*\bhref="\/src\/fonts\.css"[^>]*>/);
  });
});

// Text set side by side matches only if every size comes from one scale (salish-hdhv):
// the count beside a sighting's name was 13px and the time beside it 12px. A style
// names a step of src/fonts.css's scale, and the families are named there alone, so
// a component inherits Work Sans or asks for the mono face by its property.
describe('every style takes its type from src/fonts.css', () => {
  const sources = [
    ...fs.readdirSync(process.cwd()).filter(f => f.endsWith('.html')),
    ...fs.readdirSync(path.join(process.cwd(), 'src'))
      .filter(f => /\.(ts|css)$/.test(f) && !f.endsWith('.test.ts') && f !== 'fonts.css')
      .map(f => path.join('src', f)),
  ];

  it.each(sources)('%s sizes text from the scale', file => {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    const sizes = [...text.matchAll(/font-size:\s*([^;}]+)/g)].map(m => m[1]!.trim());
    expect(sizes.filter(s => !/^var\(--fs-(h4|h5|h6|body1|body2|caption|mono)\)$/.test(s))).toEqual([]);
  });

  it.each(sources)('%s names no typeface', file => {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    const families = [...text.matchAll(/font-family:\s*([^;}]+)/g)].map(m => m[1]!.trim());
    expect(families.filter(f => f !== 'inherit' && f !== 'var(--font-mono)')).toEqual([]);
  });
});
