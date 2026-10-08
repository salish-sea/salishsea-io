import { describe, expect, it } from 'vitest';
// @ts-expect-error vite.config.js is plain JavaScript with no declarations
import { vendorChunk } from './vite.config.js';

// pnpm puts a package at node_modules/.pnpm/<name>@<version>/node_modules/<name>/…,
// so the name is read after the last node_modules/, not the first.
const pnpm = (name: string, file = 'index.js') =>
  `/repo/node_modules/.pnpm/${name.replace('/', '+')}@1.0.0/node_modules/${name}/${file}`;

describe('vendorChunk', () => {
  it.each([
    ['ol', 'vendor-ol'],
    ['rbush', 'vendor-ol'],
    ['lit-html', 'vendor-lit'],
    ['@lit/reactive-element', 'vendor-lit'],
    ['@sentry/browser', 'vendor-sentry'],
    ['@supabase/sentry-js-integration', 'vendor-sentry'],
    ['@supabase/auth-js', 'vendor-supabase'],
    ['@tanstack/form-core', 'vendor-form'],
    ['dompurify', 'vendor-dompurify'],
    ['temporal-polyfill', 'vendor-temporal'],
  ])('puts %s in %s', (name, chunk) => {
    expect(vendorChunk(pnpm(name))).toBe(chunk);
  });

  it('reads the package, not a directory inside it', () => {
    expect(vendorChunk(pnpm('ol', 'layer/Vector.js'))).toBe('vendor-ol');
  });

  it('leaves our own code to Rolldown', () => {
    expect(vendorChunk('/repo/src/read-path.ts')).toBeNull();
    expect(vendorChunk('/repo/src/sentry.ts')).toBeNull();
  });

  it('leaves libraries loaded on demand to Rolldown, so they stay out of the first load', () => {
    expect(vendorChunk(pnpm('exifreader'))).toBeNull();
    expect(vendorChunk(pnpm('marked'))).toBeNull();
  });

  it('does not take a package whose name merely starts like a listed one', () => {
    expect(vendorChunk(pnpm('olive'))).toBeNull();
    expect(vendorChunk(pnpm('lit-something'))).toBeNull();
  });
});
