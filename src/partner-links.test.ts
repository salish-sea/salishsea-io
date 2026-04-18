// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { injectPartnerLinks, partners } from './partner-links.ts';

describe('partners CSV', () => {
  it('parses CSV into Partner[] with name and url', () => {
    expect(partners.length).toBeGreaterThanOrEqual(3);
    expect(typeof partners[0]!.name).toBe('string');
    expect(typeof partners[0]!.url).toBe('string');
    expect(partners.find(p => p.name === 'Orca Network')?.url).toBe('https://orcanetwork.org');
  });
});

describe('injectPartnerLinks', () => {
  it('replaces plain org name with markdown link', () => {
    const result = injectPartnerLinks('Spotted by Orca Network today');
    expect(result).toContain('[Orca Network](https://orcanetwork.org)');
  });

  it('matches org names case-insensitively', () => {
    const result = injectPartnerLinks('spotted by orca network');
    expect(result).toContain('[Orca Network](https://orcanetwork.org)');
  });

  it('converts [Org Name] bracket pattern to link without double brackets', () => {
    const result = injectPartnerLinks('[Orca Network] report');
    expect(result).toBe('[Orca Network](https://orcanetwork.org) report');
  });

  it('does not double-link already-linked text', () => {
    const input = 'See [Orca Network](https://orcanetwork.org) for details';
    expect(injectPartnerLinks(input)).toBe(input);
  });

  it('applies longest-match-first to prevent partial matches', () => {
    const result = injectPartnerLinks('Report from NOAA Fisheries');
    expect(result).toContain('[NOAA Fisheries](https://fisheries.noaa.gov)');
    expect(result).not.toContain('[NOAA]');
  });

  it('leaves unrecognized names unchanged', () => {
    const input = 'No partner orgs mentioned here';
    expect(injectPartnerLinks(input)).toBe(input);
  });

  it('preserves target and rel attributes through marked + DOMPurify pipeline', async () => {
    const { marked, Renderer } = await import('marked');
    const createDOMPurify = (await import('dompurify')).default;
    const domPurify = createDOMPurify(window as any);

    const renderer = new Renderer();
    renderer.link = ({ href, text }: { href: string; text: string }) =>
      `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

    const body = 'Report from Orca Network';
    const processed = injectPartnerLinks(body);
    const html = marked.parse(processed, { async: false, renderer }) as string;
    const sanitized = domPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });

    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
    expect(sanitized).toContain('href="https://orcanetwork.org"');
  });
});
