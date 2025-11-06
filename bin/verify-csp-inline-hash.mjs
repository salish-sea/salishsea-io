#!/usr/bin/env node
/**
 * Verify the inline GSI callback script hash matches the hash listed in the CSP meta tag.
 * Exits non-zero if mismatch found.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

function fail(msg) {
  console.error('\n[CSP HASH VERIFY] ' + msg + '\n');
  process.exit(1);
}

const htmlPath = new URL('../index.html', import.meta.url);
const html = await readFile(htmlPath, 'utf8');

// Extract inline script defining window.handleSignInWithGoogle (first occurrence)
const scriptMatch = html.match(/<script>([^<]*handleSignInWithGoogle[^<]*)<\/script>/);
if (!scriptMatch) fail('Could not find inline handleSignInWithGoogle script in index.html');
const scriptContent = scriptMatch[1];

// Compute sha256-base64
const computed = 'sha256-' + createHash('sha256').update(scriptContent, 'utf8').digest('base64');

// Find CSP meta tag and script-src directive
const cspMetaMatch = html.match(/<meta[^>]+Content-Security-Policy[^>]+content="([^"]+)"/i);
if (!cspMetaMatch) fail('Could not locate CSP meta tag');
const csp = cspMetaMatch[1];

const scriptSrcMatch = csp.match(/script-src\s+([^;]+);/);
if (!scriptSrcMatch) fail('Could not parse script-src directive');
const scriptSrc = scriptSrcMatch[1];

if (!scriptSrc.includes(computed)) {
  fail(`Hash mismatch. Computed ${computed} but script-src directive is: ${scriptSrc}`);
}

console.log(`[CSP HASH VERIFY] OK: ${computed}`);
