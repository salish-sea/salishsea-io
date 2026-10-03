/**
 * The build's record of each ingest run (salish-xv35.9): what the heartbeat reads, and
 * what lets the build go on with a mirror's last good copy while its source is down.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { markTransientUpstream } from '../ingest/retry.ts';
import { recordedRun, runsPaths, type RunsFile } from './ingest-runs.ts';

let dir: string;
let mirror: string;
let clock: number;
const now = () => new Date(clock);
const tick = (minutes: number) => { clock += minutes * 60_000; };

beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ingest-runs-'));
    mirror = path.join(dir, 'maplify.sqlite');
    clock = Date.parse('2026-10-03T12:00:00Z');
});

afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
});

const published = async (): Promise<RunsFile> =>
    JSON.parse(await readFile(runsPaths(mirror).json, 'utf8')) as RunsFile;

test('a run that succeeds is recorded with what it changed, and is the source\'s last success', async () => {
    const result = await recordedRun(mirror, 'maplify', 'cron', async () => { tick(1); return 3; }, now);
    expect(result).toEqual({ok: true, changed: 3});
    const file = await published();
    expect(file.runs).toEqual([expect.objectContaining({
        source: 'maplify', trigger: 'cron', outcome: 'success', rows_changed: 3,
        started_at: '2026-10-03T12:00:00.000Z', finished_at: '2026-10-03T12:01:00.000Z',
    })]);
    expect(file.last_success).toEqual({maplify: '2026-10-03T12:01:00.000Z'});
});

test('a failure is recorded, not thrown, and says whether it was the source\'s fault', async () => {
    const down = await recordedRun(mirror, 'maplify', 'cron',
        async () => { throw markTransientUpstream(new Error('HTTP 503')); }, now);
    const broken = await recordedRun(mirror, 'maplify', 'cron',
        async () => { throw new Error('maplify parse failed: bad'); }, now);
    expect(down.ok).toBe(false);
    expect(broken.ok).toBe(false);
    const runs = (await published()).runs;
    expect(runs.map(r => [r.outcome, r.transient, r.error])).toEqual([
        ['failed', true, 'HTTP 503'],
        ['failed', false, 'maplify parse failed: bad'],
    ]);
    expect((await published()).last_success).toEqual({});
});

test('while a run is in flight it is published unfinished, which the heartbeat calls stuck if it stays so', async () => {
    let seen: RunsFile | undefined;
    await recordedRun(mirror, 'maplify', 'cron', async () => { seen = await published(); return 0; }, now);
    expect(seen!.runs).toEqual([expect.objectContaining({finished_at: null, outcome: null})]);
});

test('the next run closes one that never recorded its outcome, as interrupted', async () => {
    // A run killed mid-flight: started, never finished. Simulated by a work function that
    // records the start and then never lets recordedRun finish (the process "dies").
    const killed = recordedRun(mirror, 'maplify', 'cron', () => new Promise<number>(() => {}), now);
    void killed;
    tick(5);
    await recordedRun(mirror, 'maplify', 'cron', async () => 0, now);
    const runs = (await published()).runs;
    expect(runs.map(r => [r.outcome, r.transient, r.error?.slice(0, 11) ?? null])).toEqual([
        ['failed', false, 'interrupted'],
        ['success', null, null],
    ]);
});

test('another source\'s unfinished run is not this one\'s to close', async () => {
    void recordedRun(path.join(dir, 'inaturalist.sqlite'), 'inaturalist', 'cron', () => new Promise<number>(() => {}), now);
    await recordedRun(mirror, 'maplify', 'cron', async () => 0, now);
    const runs = (await published()).runs;
    expect(runs.find(r => r.source === 'inaturalist')).toMatchObject({finished_at: null});
});

test('the file holds two days of runs, the log a week, and last success reaches back further', async () => {
    await recordedRun(mirror, 'maplify', 'cron', async () => 0, now);
    tick(3 * 24 * 60);
    await recordedRun(mirror, 'maplify', 'cron', async () => { throw new Error('x'); }, now);
    let file = await published();
    expect(file.runs).toHaveLength(1);
    expect(file.last_success).toEqual({maplify: '2026-10-03T12:00:00.000Z'});
    tick(5 * 24 * 60);
    await recordedRun(mirror, 'maplify', 'cron', async () => { throw new Error('y'); }, now);
    file = await published();
    // The success eight days ago has been pruned from the log, so there is no last success.
    expect(file.last_success).toEqual({});
});
