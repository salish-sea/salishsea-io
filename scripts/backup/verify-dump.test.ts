import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countDumpedRows } from './verify-dump.ts';

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
