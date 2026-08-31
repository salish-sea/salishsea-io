import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SCRIPT = join(process.cwd(), 'scripts/only-already-exists.sh');

/** Runs the script over a log, returning its exit code and output. */
async function check(log: string, extra: string[] = []) {
  const path = join(mkdtempSync(join(tmpdir(), 'psqllog-')), 'psql.log');
  writeFileSync(path, log);
  try {
    const {stdout} = await run(SCRIPT, [path, 'test step', ...extra]);
    return {code: 0, out: stdout};
  } catch (err) {
    const e = err as {code: number; stdout: string};
    return {code: e.code, out: e.stdout};
  }
}

// psql prefixes each error with `psql:<file>:<line>: `. Anything anchored on
// `^ERROR:` matches none of this, which is how an earlier version of the guard
// came to pass whatever happened.
const err = (line: number, text: string) => `psql:restore.sql:${line}: ERROR:  ${text}\n`;

describe('only-already-exists.sh', () => {
  it('passes a log with no errors at all', async () => {
    // The case that matters most and the one that first failed: grep exits 1
    // when it matches nothing, and under pipefail an unguarded version failed
    // hardest on a restore that went perfectly.
    const {code, out} = await check('SET\nCREATE ROLE\nALTER ROLE\n');
    expect(code).toBe(0);
    expect(out).toContain('no errors');
  });

  it('passes an entirely empty log', async () => {
    expect((await check('')).code).toBe(0);
  });

  it('passes when every error is one that already exists', async () => {
    const {code, out} = await check(
      err(3, 'role "anon" already exists') + err(9, 'type "aal_level" already exists')
    );
    expect(code).toBe(0);
    expect(out).toContain('2 tolerated error(s)');
  });

  it('fails on an error that is not tolerated', async () => {
    const {code} = await check(err(12, 'relation "auth.users" does not exist'));
    expect(code).toBe(1);
  });

  it('fails on an unexpected error even when tolerated ones are present', async () => {
    const {code} = await check(
      err(3, 'role "anon" already exists') + err(12, 'permission denied for schema auth')
    );
    expect(code).toBe(1);
  });

  it('tolerates extra patterns when given them', async () => {
    // The first auth-storage pass, whose triggers reference public functions
    // that do not exist yet.
    const log = err(2270, 'function public.create_contributor_on_sign_in() does not exist');
    expect((await check(log)).code).toBe(1);
    expect((await check(log, ['function [^ ]+ does not exist'])).code).toBe(0);
  });

  it("tolerates a re-added primary key, which psql does not call 'already exists'", async () => {
    // The second auth pass re-runs the whole file. `ALTER TABLE ... ADD
    // CONSTRAINT ... PRIMARY KEY` reports the repeat as "multiple primary keys",
    // so it has to be named separately from the 73 plain "already exists".
    const log = err(1955, 'multiple primary keys for table "users" are not allowed');
    expect((await check(log)).code).toBe(1);
    expect((await check(log, ['multiple primary keys for table .* are not allowed'])).code).toBe(0);
  });

  it('still fails the second pass on a dependency that never resolved', async () => {
    // The whole point of a second pass: if a trigger still cannot find its
    // function, the circular dependency did not clear and the restore is
    // incomplete, however many idempotency errors surround it.
    const log =
      err(1955, 'multiple primary keys for table "users" are not allowed') +
      err(2270, 'function public.create_contributor_on_sign_in() does not exist');
    expect((await check(log, ['multiple primary keys for table .* are not allowed'])).code).toBe(1);
  });

  it('only judges psql\'s own errors, not the database server log', async () => {
    // A container's stderr reaches the same file and uses a different shape:
    // `[224] supabase_admin@postgres ERROR:  ...`. Judging those would fail
    // restores on errors psql itself already handled.
    const serverLog = ' 172.18.0.1 2026-08-31 [224] supabase_admin@postgres ERROR:  function public.f() does not exist\n';
    expect((await check(serverLog)).code).toBe(0);
  });

  it('does not let a missing table through the missing-function exception', async () => {
    // The exception is for functions specifically. A missing table at that point
    // is a real failure, and a broad "does not exist" would have waved it past.
    const log = err(40, 'relation "auth.users" does not exist');
    expect((await check(log, ['function [^ ]+ does not exist'])).code).toBe(1);
  });
});
