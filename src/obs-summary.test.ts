// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildShareUrl, stripResolvedProvenance } from './obs-summary.ts';

describe('buildShareUrl', () => {
  beforeEach(() => {
    // jsdom provides window.location but we need to stub it for tests
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/app',
        search: '',
        href: 'https://example.com/app',
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Reset to defaults
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'http://localhost:3000',
        pathname: '/',
        search: '',
        href: 'http://localhost:3000/',
      },
      writable: true,
      configurable: true,
    });
  });

  it('Test 1: builds a URL from origin + map root + ?o=id, whatever page hosts the summary', () => {
    const result = buildShareUrl('abc123');
    expect(result).toBe('https://example.com/?o=abc123');
  });

  it('Test 2: never includes other query params regardless of window.location.search', () => {
    // Set search to simulate existing query params
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/app',
        search: '?d=2024-01-01&x=48.5&y=-123.2&z=10',
        href: 'https://example.com/app?d=2024-01-01&x=48.5&y=-123.2&z=10',
      },
      writable: true,
      configurable: true,
    });
    const result = buildShareUrl('xyz');
    expect(result).not.toContain('?d=');
    expect(result).not.toContain('?x=');
    expect(result).not.toContain('?y=');
    expect(result).not.toContain('?z=');
    expect(result).toBe('https://example.com/?o=xyz');
  });

  it('Test 3: UUID-style id round-trips cleanly', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = buildShareUrl(uuid);
    expect(result).toBe(`https://example.com/?o=${uuid}`);
    // Verify no double-encoding occurs for standard UUID characters
    expect(result).toContain(uuid);
  });
});

describe('stripResolvedProvenance', () => {
  // Patterns mirror real maplify.sightings.comments resolved by
  // maplify.resolve_collection (leading bracket tag + trailing attribution).

  it('drops a row whose body is only the trailing attribution line', () => {
    const body = '\n\nSubmitted by a Whale Alert Alaska Trusted Observer Via Webmap';
    expect(stripResolvedProvenance(body, 'maplify')).toBe('');
  });

  it('strips the leading bracket tag but keeps the real sighting content', () => {
    const body = '[Orca Network] Biggs T65As northbound (Charvet Drucker)\n\nSubmitted by a Cascadia Trusted Observer Via Webmap';
    expect(stripResolvedProvenance(body, 'maplify')).toBe('Biggs T65As northbound (Charvet Drucker)');
  });

  it('handles "an" and other org names in the trailing line', () => {
    const body = 'Two orcas\n\nSubmitted by an MMC Trusted Observer Via App';
    expect(stripResolvedProvenance(body, 'maplify')).toBe('Two orcas');
  });

  it('is a no-op for non-Maplify sources (preserves HappyWhale markdown links)', () => {
    const body = '[CRC-1234](https://happywhale.com/individual/1234)\n\n📍 Salish Sea';
    expect(stripResolvedProvenance(body, 'happywhale')).toBe(body);
  });

  it('leaves Maplify content without resolver artifacts untouched', () => {
    const body = 'Gray whale southbound near Alki';
    expect(stripResolvedProvenance(body, 'maplify')).toBe(body);
  });
});
