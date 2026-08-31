import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countDumpedRows, judgeCount } from './verify-dump.ts';

const write = (body: string) => {
  const path = join(mkdtempSync(join(tmpdir(), 'dump-')), 'data.sql');
  writeFileSync(path, body);
  return path;
};

const copyBlock = (qualified: string, rows: string[]) => {
  const [schema, table] = qualified.split('.');
  return [
    `COPY "${schema}"."${table}" ("id", "body") FROM stdin;`,
    ...rows,
    '\\.',
    '',
  ].join('\n');
};

describe('countDumpedRows', () => {
  it('counts the rows between COPY and its terminator', async () => {
    const path = write(copyBlock('public.observations', ['1\ta', '2\tb', '3\tc']));
    expect(await countDumpedRows(path)).toEqual(new Map([['public.observations', 3]]));
  });

  it('counts each table separately, across schemas', async () => {
    const path = write(
      copyBlock('public.observations', ['1\ta']) +
      copyBlock('auth.users', ['u1\tx', 'u2\ty'])
    );
    expect(await countDumpedRows(path)).toEqual(new Map([
      ['public.observations', 1],
      ['auth.users', 2],
    ]));
  });

  it('records an empty table as zero, not as absent', async () => {
    // The distinction the caller acts on: 0 rows dumped for a table that has 0
    // rows live is fine; a table missing from the dump entirely is not.
    const path = write(copyBlock('public.social_groups', []));
    expect(await countDumpedRows(path)).toEqual(new Map([['public.social_groups', 0]]));
  });

  it('does not count SQL around the data as rows', async () => {
    const path = write(
      'SET session_replication_role = replica;\n\n' +
      copyBlock('public.observations', ['1\ta']) +
      '\nSELECT pg_catalog.setval(\'public.thing_id_seq\', 42, true);\n'
    );
    expect(await countDumpedRows(path)).toEqual(new Map([['public.observations', 1]]));
  });

  it('treats a line that merely looks like a terminator as data', async () => {
    // Inside COPY, pg_dump escapes a real backslash-dot in a field; only a lone
    // \. on its own line ends the block.
    const path = write(copyBlock('public.observations', ['1\t\\\\.', '2\tb']));
    expect(await countDumpedRows(path)).toEqual(new Map([['public.observations', 2]]));
  });

  it('refuses a dump that stops inside a COPY block', async () => {
    // A connection dropped mid-COPY leaves a file that is syntactically fine
    // until you look for the terminator. Silently counting the partial rows
    // would report a shortfall as if the table were simply smaller.
    const path = write('COPY "public"."observations" ("id") FROM stdin;\n1\n2\n');
    await expect(countDumpedRows(path)).rejects.toThrow(/truncated/);
  });
});

describe('judgeCount', () => {
  const ok = null;

  it('accepts a dump whose count sits between the before and after readings', () => {
    // Two sightings arrived while the dump ran. The dump is fine.
    expect(judgeCount(501, 503, 501)).toBe(ok);
    expect(judgeCount(502, 503, 501)).toBe(ok);
    expect(judgeCount(503, 503, 501)).toBe(ok);
  });

  it('does not fail a good backup because the site was in use', () => {
    // The regression this guards: an exact match would have failed here and
    // filed an alarm saying the backup was short when it was complete. A check
    // that cries wolf on ordinary traffic is one nobody reads.
    expect(judgeCount(6719, 6740, 6719)).toBe(ok);
  });

  it('fails a dump holding fewer rows than the table ever held', () => {
    expect(judgeCount(400, 503, 501)).toMatch(/the dump is short/);
  });

  it('reports a dump holding more rows than the table ever held', () => {
    // Not a dump defect — rows went away after it was taken — but worth saying.
    expect(judgeCount(510, 505, 501)).toMatch(/deleted after the dump/);
  });

  it('fails a table missing from the dump entirely', () => {
    expect(judgeCount(undefined, 501, 501)).toMatch(/absent from the dump/);
  });

  it('fails an empty table that the database says has rows', () => {
    expect(judgeCount(0, 501, 501)).toMatch(/the dump is short/);
  });

  it('compares exactly when there is no before reading', () => {
    // Verifying a restored copy: nothing is writing, so any difference is a
    // defect in the restore rather than timing.
    expect(judgeCount(501, 501, undefined)).toBe(ok);
    expect(judgeCount(500, 501, undefined)).toMatch(/the dump is short/);
    expect(judgeCount(502, 501, undefined)).toMatch(/deleted after the dump/);
  });

  it('handles a before reading higher than the after one', () => {
    // Rows deleted during the dump. The range is the two readings whichever way
    // round they came, so a dump anywhere between them is still consistent.
    expect(judgeCount(500, 499, 501)).toBe(ok);
  });

  it('accepts a genuinely empty table', () => {
    expect(judgeCount(0, 0, 0)).toBe(ok);
  });
});
