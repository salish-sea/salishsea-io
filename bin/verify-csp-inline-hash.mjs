#!/usr/bin/env node
/**
 * Verify the inline GSI callback script hash matches the hash listed in the CSP meta tag.
 * Exits non-zero if mismatch found.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { argv } from 'node:process';

const [,,htmlPath] = argv;

if (!htmlPath.endsWith('.html')) {
  console.error(`Syntax: bin/verify-csp-inline-hash.mjs dist/index.html`);
  exit(1);
}

function fail(msg) {
  console.error('\n[CSP HASH VERIFY] ' + msg + '\n');
  process.exit(1);
}

const html = await readFile(htmlPath, 'utf8');

// Extract inline script defining window.handleSignInWithGoogle (first occurrence)
const {window: {document}} = new JSDOM(html);
const scriptMatch = document.getElementById('gsi-init')
if (!scriptMatch) fail('Could not find inline handleSignInWithGoogle script in index.html');

// Compute sha256-base64
const computed = 'sha256-' + createHash('sha256').update(scriptMatch.textContent, 'utf8').digest('base64');

// Find CSP meta tag and script-src directive
const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
if (!cspMeta) fail('Could not locate CSP meta tag');

const scriptSrc = cspMeta.getAttribute('content').split(';').map(s => s.trim()).find(str => str.startsWith('script-src '));
if (!scriptSrc) fail('Could not parse script-src directive');

if (!scriptSrc.includes(computed)) {
  fail(`Hash mismatch. Computed ${computed} but script-src directive is: ${scriptSrc}`);
}

console.log(`[CSP HASH VERIFY] OK: ${computed}`);
