// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildShareUrl } from './obs-summary.ts';

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

  it('Test 1: builds a URL from origin + pathname + ?o=id', () => {
    const result = buildShareUrl('abc123');
    expect(result).toBe('https://example.com/app?o=abc123');
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
    expect(result).toBe('https://example.com/app?o=xyz');
  });

  it('Test 3: UUID-style id round-trips cleanly', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const result = buildShareUrl(uuid);
    expect(result).toBe(`https://example.com/app?o=${uuid}`);
    // Verify no double-encoding occurs for standard UUID characters
    expect(result).toContain(uuid);
  });
});
