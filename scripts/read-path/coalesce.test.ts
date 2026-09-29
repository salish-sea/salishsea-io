import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { BuildCoalescer, type BuildResult } from './coalesce.ts';

const OPTIONS = {quietMs: 10_000, maxWaitMs: 60_000, busyRetryMs: 30_000, minIntervalMs: 0};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/**
 * A build that takes `durationMs` and answers from `results`, counting its runs.
 * An instant one resolves without a timer: a zero-delay timer fires a millisecond
 * later, in Node and in fake time, which would skew every deadline after it.
 */
function fakeBuild(durationMs = 0, results: BuildResult[] = []) {
    const answer = () => results.shift() ?? 'done';
    return vi.fn(() => durationMs === 0
        ? Promise.resolve(answer())
        : new Promise<BuildResult>(resolve => setTimeout(() => resolve(answer()), durationMs)));
}

describe('BuildCoalescer', () => {
    test('a burst of changes is one build, after the quiet period', async () => {
        const build = fakeBuild();
        const c = new BuildCoalescer(build, OPTIONS, Date.now);
        c.changed();
        await vi.advanceTimersByTimeAsync(3_000);
        c.changed();
        await vi.advanceTimersByTimeAsync(3_000);
        c.changed();
        await vi.advanceTimersByTimeAsync(9_999);
        expect(build).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(build).toHaveBeenCalledTimes(1);
    });

    test('a steady trickle still builds by the maximum wait', async () => {
        const build = fakeBuild();
        const c = new BuildCoalescer(build, OPTIONS, Date.now);
        for (let t = 0; t < 60_000; t += 5_000) {
            c.changed();
            await vi.advanceTimersByTimeAsync(5_000);
        }
        expect(build).toHaveBeenCalledTimes(1);
    });

    test('changes during a build earn exactly one more build after it', async () => {
        const build = fakeBuild(30_000);
        const c = new BuildCoalescer(build, OPTIONS, Date.now);
        c.changed();
        await vi.advanceTimersByTimeAsync(10_000);   // the first build starts
        c.changed();
        c.changed();
        await vi.advanceTimersByTimeAsync(30_000);   // it finishes
        await vi.advanceTimersByTimeAsync(10_000);   // the follow-up, after quiet
        expect(build).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(build).toHaveBeenCalledTimes(2);
    });

    test('a build that found the lock held is retried, not dropped', async () => {
        const build = fakeBuild(0, ['busy', 'done']);
        const c = new BuildCoalescer(build, OPTIONS, Date.now);
        c.changed();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(build).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(build).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(build).toHaveBeenCalledTimes(2);
    });

    test('a build that throws leaves the listener working', async () => {
        const build = vi.fn(async (): Promise<BuildResult> => { throw new Error('boom'); });
        const c = new BuildCoalescer(build, OPTIONS, Date.now);
        c.changed();
        await vi.advanceTimersByTimeAsync(10_000);
        c.changed();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(build).toHaveBeenCalledTimes(2);
    });

    test('no change, no build', async () => {
        const build = fakeBuild();
        new BuildCoalescer(build, OPTIONS, Date.now);
        await vi.advanceTimersByTimeAsync(600_000);
        expect(build).not.toHaveBeenCalled();
    });

    test('signals during a long lock conflict do not bring retries forward', async () => {
        const build = fakeBuild(0, ['busy', 'busy', 'busy', 'busy', 'done']);
        const c = new BuildCoalescer(build, OPTIONS, Date.now);
        c.changed();
        // Two minutes of a signal every second while the hourly build holds the lock.
        for (let t = 0; t < 120_000; t += 1_000) {
            c.changed();
            await vi.advanceTimersByTimeAsync(1_000);
        }
        // The signals never go quiet, so the first attempt waits the full 60 s;
        // then one per 30 s retry: 60, 90, 120. Without the retry deadline, every
        // signal after 60 s would start another attempt.
        expect(build).toHaveBeenCalledTimes(3);
    });

    test('a flood of signals is at most one build per minimum interval', async () => {
        const build = fakeBuild();
        const c = new BuildCoalescer(build, {...OPTIONS, minIntervalMs: 120_000}, Date.now);
        // An hour of a forged signal every second.
        for (let t = 0; t < 3_600_000; t += 1_000) {
            c.changed();
            await vi.advanceTimersByTimeAsync(1_000);
        }
        expect(build.mock.calls.length).toBeLessThanOrEqual(30);
        expect(build.mock.calls.length).toBeGreaterThanOrEqual(29);
    });

    test('a signal during an attempt that found the lock held is covered by the retry', async () => {
        // The attempt takes a moment to find the lock held; a signal lands then.
        const results: BuildResult[] = ['busy', 'done'];
        const build = vi.fn(() => new Promise<BuildResult>(resolve =>
            setTimeout(() => resolve(results.shift() ?? 'done'), 1_000)));
        const c = new BuildCoalescer(build, OPTIONS, Date.now);
        c.changed();
        await vi.advanceTimersByTimeAsync(10_500);   // the attempt is under way
        c.changed();
        await vi.advanceTimersByTimeAsync(600_000);
        expect(build).toHaveBeenCalledTimes(2);      // the busy attempt and its retry
    });
});

