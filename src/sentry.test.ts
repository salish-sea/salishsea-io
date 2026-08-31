// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const setClient = vi.hoisted(() => vi.fn());
const init = vi.hoisted(() => vi.fn());

vi.mock('@sentry/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/browser')>()),
  BrowserClient: class { init = init },
  getCurrentScope: () => ({setClient}),
}));
vi.mock('@supabase/sentry-js-integration', () => ({supabaseIntegration: () => ({name: 'supabase'})}));
vi.mock('./supabase.ts', () => ({supabase: () => ({})}));

describe('initSentry', () => {
  beforeEach(() => { setClient.mockClear(); init.mockClear(); vi.resetModules(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  const load = () => import('./sentry.ts');

  it('binds the client and installs integrations in production', async () => {
    vi.stubEnv('PROD', true);
    (await load()).initSentry();
    expect(setClient).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('binds nothing outside production, so captureException cannot transmit', async () => {
    vi.stubEnv('PROD', false);
    (await load()).initSentry();
    // Binding is what makes captureException send; gating init() alone left a
    // direct capture transmitting from dev (salish-280).
    expect(setClient).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
  });

  it('does not bind the client merely on import', async () => {
    vi.stubEnv('PROD', true);
    await load();
    expect(setClient).not.toHaveBeenCalled();
  });
});

describe('the entry points agree about Sentry', () => {
  // Read off the HTML rather than hardcoded, so a page added later is covered
  // by this test on the day it is added.
  const entryPointSources = () => {
    const pages = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.html'));
    const modules = new Set<string>();
    for (const page of pages) {
      const html = fs.readFileSync(path.join(process.cwd(), page), 'utf-8');
      for (const match of html.matchAll(/<script type="module" src="\/?(src\/[^"]+)"/g))
        modules.add(match[1]!);
    }
    return [...modules].map(src => [src, fs.readFileSync(path.join(process.cwd(), src), 'utf-8')] as const);
  };

  it('initialises Sentry through initSentry, with no page deciding for itself', () => {
    const reporting = entryPointSources().filter(([, code]) => /['"]\.\/sentry\.ts['"]/.test(code));
    // about.ts reports nothing and is not required to; the rest must agree.
    expect(reporting.map(([src]) => src).sort()).toEqual([
      'src/ecotype-page.ts',
      'src/individual-page.ts',
      'src/matriline-page.ts',
      'src/salish-sea.ts',
    ]);
    for (const [src, code] of reporting) {
      expect(code, `${src} should call initSentry()`).toMatch(/\binitSentry\(\)/);
      // The gate lives in sentry.ts. A page that guards the call itself is how
      // the four came to disagree in the first place (salish-280).
      expect(code, `${src} should not gate Sentry itself`).not.toMatch(/import\.meta\.env\.PROD/);
    }
  });
});
