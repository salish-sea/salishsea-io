// Stage the card renderer as a Lambda deployment package.
//
// sharp ships prebuilt native binaries as platform-specific optional
// dependencies, so a plain `npm install` on a laptop stages macOS binaries that
// fail on Lambda. `--os` / `--cpu` pin the selection explicitly, which keeps a
// deploy from a developer machine byte-identical to one from CI instead of
// silently platform-dependent.
//
// Run by `npm run build`, so `cdk deploy` always has a fresh bundle.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'lib', 'card-renderer');
const bundle = join(source, 'bundle');

// Must match the `architecture` on the CardRenderer function in infra-stack.ts.
// `libc` matters as much as os/cpu: without it npm filters out
// @img/sharp-linux-x64 and silently resolves the wasm fallback instead, which
// runs but is markedly slower. The Lambda Node runtime is Amazon Linux (glibc).
const TARGET = { os: 'linux', cpu: 'x64', libc: 'glibc' };

// Proof the native binary was selected. Without this the wasm fallback ships
// unnoticed — it works, so nothing else would catch it.
const REQUIRED_BINARY = '@img/sharp-linux-x64';

rmSync(bundle, { recursive: true, force: true });
mkdirSync(bundle, { recursive: true });

// Compiled output only — the .ts sources and tests have no business in a
// deployment package, and the CLI is a local tool.
const runtime = readdirSync(source)
  .filter(f => f.endsWith('.js'))
  .filter(f => !f.endsWith('.test.js') && f !== 'cli.js');

if (runtime.length === 0) {
  throw new Error('no compiled .js in lib/card-renderer — run tsc first');
}
for (const file of runtime) cpSync(join(source, file), join(bundle, file));

// sharp's version tracks infra's own dependency so the bundle can't drift from
// what the tests ran against.
const { dependencies } = JSON.parse(
  execFileSync('node', ['-e', 'process.stdout.write(require("fs").readFileSync("package.json","utf8"))'], {
    cwd: join(here, '..'), encoding: 'utf8',
  }),
);
const sharpVersion = dependencies?.sharp;
if (!sharpVersion) throw new Error('infra/package.json has no sharp dependency');

writeFileSync(join(bundle, 'package.json'), JSON.stringify({
  name: 'card-renderer-bundle',
  private: true,
  type: 'commonjs',
  dependencies: { sharp: sharpVersion },
}, null, 2) + '\n');

execFileSync('npm', [
  'install',
  '--omit=dev', '--no-audit', '--no-fund',
  `--os=${TARGET.os}`, `--cpu=${TARGET.cpu}`, `--libc=${TARGET.libc}`,
], { cwd: bundle, stdio: 'inherit' });

if (!existsSync(join(bundle, 'node_modules', 'sharp'))) {
  throw new Error('sharp missing from the bundle after install');
}
if (!existsSync(join(bundle, 'node_modules', REQUIRED_BINARY))) {
  throw new Error(
    `${REQUIRED_BINARY} missing — npm resolved a fallback (likely wasm) instead of the ` +
    `native ${TARGET.os}/${TARGET.cpu}/${TARGET.libc} binary. The bundle would run, slowly.`,
  );
}

console.log(
  `card-renderer bundle ready (${runtime.length} modules, sharp ${sharpVersion}, ` +
  `${TARGET.os}/${TARGET.cpu}/${TARGET.libc})`,
);
