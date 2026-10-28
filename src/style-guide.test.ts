import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// src/site.css names the font and loads it (salish-74v6, salish-hdhv). Read off
// the HTML files rather than a list, so a page added later is covered the day it is.
describe('every page links the stylesheet that names and loads the font', () => {
  const pages = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.html'));

  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)('%s links src/site.css', page => {
    const html = fs.readFileSync(path.join(process.cwd(), page), 'utf-8');
    expect(html, `${page} should link /src/site.css`).toMatch(/<link\b[^>]*\bhref="\/src\/site\.css"[^>]*>/);
  });
});

// Text set side by side matches only if every size comes from one scale (salish-hdhv):
// the count beside a sighting's name was 13px and the time beside it 12px. A style
// names a step of src/site.css's scale, and the families are named there alone, so
// a component inherits Work Sans or asks for the mono face by its property.
describe('every style takes its type from src/site.css', () => {
  const sources = [
    ...fs.readdirSync(process.cwd()).filter(f => f.endsWith('.html')),
    ...fs.readdirSync(path.join(process.cwd(), 'src'))
      .filter(f => /\.(ts|css)$/.test(f) && !f.endsWith('.test.ts') && f !== 'site.css')
      .map(f => path.join('src', f)),
  ];

  it.each(sources)('%s sizes text from the scale', file => {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    const sizes = [...text.matchAll(/font-size:\s*([^;}]+)/g)].map(m => m[1]!.trim());
    expect(sizes.filter(s => !/^var\(--fs-(h4|h5|h6|body1|body2|caption|mono)\)$/.test(s))).toEqual([]);
  });

  // Light is too thin at 12px; caption text is Regular (src/site.css), unless its
  // rule says why not.
  it.each(sources)('%s sets caption text in Regular', file => {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    const blocks = [...text.matchAll(/\{[^{}]*font-size:\s*var\(--fs-caption\)[^{}]*\}/g)].map(m => m[0]);
    expect(blocks.filter(b => !/font-weight:\s*400;/.test(b) && !/Light at 12px/.test(b))).toEqual([]);
  });

  it.each(sources)('%s names no typeface', file => {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    const families = [...text.matchAll(/font-family:\s*([^;}]+)/g)].map(m => m[1]!.trim());
    expect(families.filter(f => f !== 'inherit' && f !== 'var(--font-mono)')).toEqual([]);
  });
});

// The plain pages' link mark (src/site.css) is a copy of the components' (src/icons.ts).
describe('the link mark is the same inside and outside a shadow root', () => {
  it('src/site.css draws the path src/icons.ts names', () => {
    const icons = fs.readFileSync(path.join(process.cwd(), 'src/icons.ts'), 'utf-8');
    const fonts = fs.readFileSync(path.join(process.cwd(), 'src/site.css'), 'utf-8');
    const openInNew = icons.match(/openInNewPath = '([^']+)'/)?.[1];
    expect(openInNew).toBeTruthy();
    expect(fonts).toContain(encodeURIComponent(openInNew!));
  });
});

// Colours are named by role in src/site.css (style guide, "Colour"); a component names
// the role, so a change of palette is one edit and nothing drifts. A colour that
// encodes data or draws the map's symbols keeps its literal and says so ("data
// colour"). The modules that draw the maps themselves are left out.
describe('interface colours come from src/site.css', () => {
  const mapDrawing = new Set(['style.ts', 'symbology.ts', 'profile-map.ts', 'small-multiples.ts']);
  const styleText = (file: string, text: string): string[] =>
    file.endsWith('.ts') ? [...text.matchAll(/css`([\s\S]*?)`/g)].map(m => m[1]!)
    : file.endsWith('.html') ? [...text.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]!)
    : [text];
  const sources = [
    ...fs.readdirSync(process.cwd()).filter(f => f.endsWith('.html')),
    ...fs.readdirSync(path.join(process.cwd(), 'src'))
      .filter(f => /\.(ts|css)$/.test(f) && !f.endsWith('.test.ts') && f !== 'site.css' && !mapDrawing.has(f))
      .map(f => path.join('src', f)),
  ];

  it.each(sources)('%s names its colours by role', file => {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    const literals = styleText(file, text).flatMap(css =>
      [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d[^)]*\)/g)]
        .filter(m => !/data\s+colour/i.test(css.slice(Math.max(0, m.index! - 400), m.index! + 200)))
        .map(m => m[0]));
    expect(literals).toEqual([]);
  });
});
