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

// A var() naming a custom property nothing defines is dropped by the browser, and the
// rule with it: the sighting form's fields had no border for that reason (--slate-300).
describe('every custom property a style uses is defined', () => {
  const sources = [
    ...fs.readdirSync(process.cwd()).filter(f => f.endsWith('.html')),
    ...fs.readdirSync(path.join(process.cwd(), 'src'))
      .filter(f => /\.(ts|css)$/.test(f) && !f.endsWith('.test.ts')).map(f => path.join('src', f)),
  ];
  const texts = sources.map(f => fs.readFileSync(path.join(process.cwd(), f), 'utf-8'));
  // Defined in a stylesheet, or set from script (style.setProperty, an inline style).
  const defined = new Set(texts.flatMap(t => [...t.matchAll(/(--[\w-]+)\s*:|setProperty\(\s*['"](--[\w-]+)/g)].map(m => m[1] ?? m[2])));

  it.each(sources)('%s uses only defined properties, or gives a fallback', file => {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
    const undefinedUses = [...text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map(m => m[1]!).filter(name => !defined.has(name));
    expect(undefinedUses).toEqual([]);
  });
});

// The palette's contrast (style guide, rule 10), from the values src/site.css gives.
describe('the palette passes its contrast rules', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/site.css'), 'utf-8');
  const vars = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
  const value = (name: string): string => {
    let v = vars[name]!;
    while (v.startsWith('var(')) v = vars[v.slice(4, -1)]!;
    return v;
  };
  // An opaque colour as [r, g, b]; a translucent one laid over white.
  const rgb = (colour: string): number[] => {
    const hex = colour.match(/^#([0-9a-f]{6})$/i);
    if (hex) return [0, 2, 4].map(i => parseInt(hex[1]!.slice(i, i + 2), 16));
    const [r, g, b, a = 1] = colour.match(/[\d.]+/g)!.map(Number);
    return [r!, g!, b!].map(c => c * a + 255 * (1 - a));
  };
  const luminance = (colour: string) => {
    const [r, g, b] = rgb(colour).map(c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(value(a)), luminance(value(b))].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  // Every background text can sit on: the page, the pale grey, and the two washes (a
  // highlighted card's teal, the grey behind one's own sightings and the form).
  const backgrounds = ['--color-surface', '--color-surface-subtle', '--color-primary-tint', '--color-surface-tint'];
  const text = ['--color-text', '--color-text-secondary', '--color-text-muted', '--color-primary',
    '--color-error', '--color-warning', '--color-success'];
  it.each([
    ...text.flatMap(fg => backgrounds.map(bg => [fg, bg])),
    ['--color-surface', '--color-primary'],
    ['--color-chrome-accent', '--color-chrome'], ['--color-surface', '--color-chrome'],
  ])('text in %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('a field’s edge is at least 3:1 on white', () => {
    expect(contrast('--color-border-field', '--color-surface')).toBeGreaterThanOrEqual(3);
  });

  it('a link is at least 3:1 against the text around it', () => {
    expect(contrast('--color-primary', '--color-text')).toBeGreaterThanOrEqual(3);
  });
});
