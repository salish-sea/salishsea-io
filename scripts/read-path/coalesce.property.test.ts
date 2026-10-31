/**
 * Property tests for BuildCoalescer (discovery suite, salish-us33). Generated option sets,
 * histories of changed()/stop() at generated times, and builds that answer 'done', 'busy' or
 * throw after generated durations, run in fake time. Each run's log is checked against the
 * module doc comment's promises, stated independently of the implementation, and against an
 * exact timing model.
 *
 *   pnpm exec vitest run scripts/read-path/coalesce.property.test.ts
 *   NUM_RUNS=20000 COVERAGE=1 pnpm exec vitest run scripts/read-path/coalesce.property.test.ts
 */

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { BuildCoalescer, DEFAULT_OPTIONS, SAVE_OPTIONS, type CoalescerOptions } from './coalesce.ts';

const NUM_RUNS = Number(process.env['NUM_RUNS'] ?? 500);

type Result = 'done' | 'busy' | 'throw';
/** A wait or a duration, picked relative to the options so boundaries are hit: options[k] + delta, or a raw small number. */
type Span = {base: 'raw' | keyof CoalescerOptions, n: number};
type Op = {kind: 'wait', span: Span} | {kind: 'change'} | {kind: 'stop'};
type BuildPlan = {duration: Span, result: Result};
type Case = {options: CoalescerOptions, ops: Op[], builds: BuildPlan[]};

type Event =
    | {kind: 'change', t: number, running: boolean}
    | {kind: 'stop', t: number}
    | {kind: 'start', t: number, n: number}
    | {kind: 'end', t: number, n: number, result: Result};

const small = fc.integer({min: 0, max: 40});
const optionsArb: fc.Arbitrary<CoalescerOptions> = fc.oneof(
    fc.constant(SAVE_OPTIONS),
    fc.constant(DEFAULT_OPTIONS),
    fc.record({quietMs: small, maxWaitMs: small, busyRetryMs: small, minIntervalMs: small}),
    fc.record({
        quietMs: fc.constantFrom(0, 1, 10), maxWaitMs: fc.constantFrom(0, 1, 10),
        busyRetryMs: fc.constantFrom(0, 1, 10), minIntervalMs: fc.constantFrom(0, 1, 10),
    }),
);
const spanArb: fc.Arbitrary<Span> = fc.oneof(
    fc.record({base: fc.constant('raw' as const), n: fc.integer({min: 0, max: 15})}),
    fc.record({
        base: fc.constantFrom('quietMs', 'maxWaitMs', 'busyRetryMs', 'minIntervalMs') as fc.Arbitrary<keyof CoalescerOptions>,
        n: fc.integer({min: -2, max: 2}),
    }),
);
const resolveSpan = (s: Span, o: CoalescerOptions) => Math.max(0, (s.base === 'raw' ? 0 : o[s.base]) + s.n);

/** Swarm: each case enables its own mix of stop, busy and throw, at its own weights. */
const caseArb: fc.Arbitrary<Case> = fc.record({
    stop: fc.boolean(), busy: fc.integer({min: 0, max: 3}), fail: fc.integer({min: 0, max: 2}),
    changeWeight: fc.integer({min: 1, max: 4}),
}).chain(mix => fc.record({
    options: optionsArb,
    ops: fc.array(fc.oneof(
        {weight: 4, arbitrary: fc.record({kind: fc.constant('wait' as const), span: spanArb})},
        {weight: mix.changeWeight, arbitrary: fc.constant({kind: 'change' as const})},
        {weight: mix.stop ? 1 : 0, arbitrary: fc.constant({kind: 'stop' as const})},
    ), {maxLength: 40}),
    builds: fc.array(fc.record({
        duration: spanArb,
        result: fc.oneof(
            {weight: 3, arbitrary: fc.constant('done' as const)},
            {weight: mix.busy, arbitrary: fc.constant('busy' as const)},
            {weight: mix.fail, arbitrary: fc.constant('throw' as const)},
        ),
    }), {maxLength: 12}),
}));

/** Runs a case against the real coalescer in fake time; the log, in the order things happened. */
async function runCase(c: Case): Promise<Event[]> {
    const t0 = Date.now();
    const now = () => Date.now() - t0;
    const log: Event[] = [];
    let running = false;
    let n = 0;
    const plans = [...c.builds];
    const build = () => {
        const i = n++;
        if (running) throw new Error('two builds at once');
        running = true;
        log.push({kind: 'start', t: now(), n: i});
        const plan = plans.shift() ?? {duration: {base: 'raw', n: 0}, result: 'done'};
        const duration = resolveSpan(plan.duration, c.options);
        const finish = () => {
            running = false;
            log.push({kind: 'end', t: now(), n: i, result: plan.result});
            if (plan.result === 'throw') throw new Error('boom');
            return plan.result;
        };
        // As coalesce.test.ts's fakeBuild: an instant build resolves without a timer.
        return duration === 0
            ? Promise.resolve().then(finish)
            : new Promise<'done' | 'busy'>((resolve, reject) => setTimeout(() => { try { resolve(finish()); } catch (e) { reject(e); } }, duration));
    };
    const coalescer = new BuildCoalescer(build, c.options, Date.now);
    for (const op of c.ops) {
        if (op.kind === 'wait') await vi.advanceTimersByTimeAsync(resolveSpan(op.span, c.options));
        else if (op.kind === 'change') { log.push({kind: 'change', t: now(), running}); coalescer.changed(); }
        else { log.push({kind: 'stop', t: now()}); coalescer.stop(); }
    }
    // Run to quiescence: the scripted builds are finite, and every one after them is 'done'.
    const step = Math.max(1, ...Object.values(c.options)) * 4 + 50;
    for (let i = 0; i < 200 && (running || vi.getTimerCount() > 0); i++) await vi.advanceTimersByTimeAsync(step);
    expect(running || vi.getTimerCount() > 0, 'quiescent').toBe(false);
    coalescer.stop();
    return log;
}

/**
 * The doc comment's promises, checked on a log without reference to how the coalescer keeps
 * its state. `strictStop` adds what stop() might be read to promise: no build after a stop
 * until a later change.
 */
function checkContract(c: Case, log: Event[], {strictStop = false} = {}): void {
    const o = c.options;
    const starts = log.filter(e => e.kind === 'start');
    const endOf = (n: number) => log.find((e): e is Extract<Event, {kind: 'end'}> => e.kind === 'end' && e.n === n)!;

    // Nothing is dropped: every change is followed by the start of a build that didn't find the
    // lock held, unless a stop came between.
    log.forEach((e, i) => {
        if (e.kind !== 'change') return;
        const rest = log.slice(i + 1);
        const served = rest.findIndex(r => r.kind === 'start' && endOf(r.n).result !== 'busy');
        const stopped = rest.findIndex(r => r.kind === 'stop');
        if (stopped !== -1 && (served === -1 || stopped < served)) return;
        expect(served, `change #${i} at ${e.t} is served`).not.toBe(-1);
    });

    // No build without cause: since the previous start, a change, or a 'busy' still to retry.
    // This is "exactly one more build, however many changes arrive" together with the above.
    let cause = false;
    let stoppedSinceChange = false;
    for (const e of log) {
        if (e.kind === 'change') { cause = true; stoppedSinceChange = false; }
        else if (e.kind === 'stop') stoppedSinceChange = true;
        else if (e.kind === 'start') {
            expect(cause, `build ${e.n} at ${e.t} has a cause`).toBe(true);
            if (strictStop) expect(stoppedSinceChange, `build ${e.n} at ${e.t} comes after a stop with no change since`).toBe(false);
            cause = false;
        } else if (e.result === 'busy') cause = true;
    }

    // Spacing: a build that ran holds the next off minIntervalMs from its start; one that found
    // the lock held, busyRetryMs from its end.
    for (let i = 1; i < starts.length; i++) {
        const prev = starts[i - 1]!, next = starts[i]!;
        const prevEnd = endOf(prev.n);
        if (prevEnd.result === 'busy') expect(next.t - prevEnd.t, `retry ${next.n} waits busyRetryMs`).toBeGreaterThanOrEqual(o.busyRetryMs);
        else expect(next.t - prev.t, `build ${next.n} is spaced from ${prev.n}`).toBeGreaterThanOrEqual(o.minIntervalMs);
    }

    // Quiet: a build that follows a build that ran (or none) starts no sooner than quietMs after
    // the last change before it, or maxWaitMs after the first change it covers.
    let first: number | null = null, last: number | null = null;
    let afterBusy = false;
    for (const e of log) {
        if (e.kind === 'change') { first ??= e.t; last = e.t; }
        else if (e.kind === 'start') {
            if (!afterBusy && first !== null && last !== null)
                expect(e.t, `build ${e.n} waits for quiet`).toBeGreaterThanOrEqual(Math.min(last + o.quietMs, first + o.maxWaitMs));
            first = last = null;
        } else if (e.kind === 'end') afterBusy = e.result === 'busy';
    }
}

/**
 * The exact start times, from a plain discrete-event reading of the rules: when idle with
 * something pending, a build is due at the later of the debounce deadline and the not-before
 * time; a change during a build is carried to its end; 'busy' retries busyRetryMs after.
 */
function modelStarts(c: Case): number[] {
    const o = c.options;
    const plans = [...c.builds];
    const starts: number[] = [];
    let t = 0;
    let due: number | null = null;
    let run: {end: number, result: Result} | null = null;
    let pendingSince: number | null = null;
    let carried = false;
    let notBefore = -Infinity;
    const change = () => {
        if (run) { carried = true; return; }
        pendingSince ??= t;
        due = Math.max(t, Math.max(Math.min(t + o.quietMs, pendingSince + o.maxWaitMs), notBefore));
    };
    const settle = (until: number) => {
        for (;;) {
            const next = run ? run.end : due;
            if (next === null || next > until) break;
            t = next;
            if (run) {
                const {result} = run;
                run = null;
                if (result === 'busy') {
                    pendingSince ??= t;
                    notBefore = t + o.busyRetryMs;
                    carried = false;
                    due = t + o.busyRetryMs;
                } else {
                    pendingSince = null;
                    if (carried) { carried = false; change(); }
                }
            } else {
                due = null;
                starts.push(t);
                notBefore = t + o.minIntervalMs;
                const plan = plans.shift() ?? {duration: {base: 'raw', n: 0} as Span, result: 'done' as Result};
                run = {end: t + resolveSpan(plan.duration, o), result: plan.result};
            }
        }
        t = until;
    };
    for (const op of c.ops) {
        if (op.kind === 'wait') settle(t + resolveSpan(op.span, o));
        else if (op.kind === 'change') change();
        else due = null;
    }
    settle(Infinity);
    return starts;
}

const coverage = new Map<string, number>();
const count = (k: string) => coverage.set(k, (coverage.get(k) ?? 0) + 1);
function measure(log: Event[]): void {
    count('cases');
    const starts = log.filter(e => e.kind === 'start').length;
    count(starts === 0 ? 'no build' : starts === 1 ? '1 build' : '2+ builds');
    if (log.some(e => e.kind === 'change' && e.running)) count('change during run');
    if (log.some(e => e.kind === 'end' && e.result === 'busy')) count('busy');
    if (log.some(e => e.kind === 'end' && e.result === 'throw')) count('throw');
    if (log.some((e, i) => e.kind === 'stop' && log.slice(i + 1).some(r => r.kind === 'start'))) count('build after stop');
    if (log.some((e, i) => e.kind === 'end' && e.result === 'busy' && log[i + 1]?.kind === 'change')) count('change while retry waits');
}

describe('BuildCoalescer properties', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    test('keeps the doc comment\'s promises', async () => {
        await fc.assert(fc.asyncProperty(caseArb, async c => {
            const log = await runCase(c);
            measure(log);
            checkContract(c, log);
        }), {numRuns: NUM_RUNS});
        if (process.env['COVERAGE']) console.log(Object.fromEntries(coverage));
    });

    test('starts builds exactly when the timing model says', async () => {
        await fc.assert(fc.asyncProperty(caseArb, async c => {
            const log = await runCase(c);
            expect(log.filter(e => e.kind === 'start').map(e => e.t)).toEqual(modelStarts(c));
        }), {numRuns: NUM_RUNS});
    });

    // Ambiguity, not a promise the doc comment makes plainly: see the report. Skipped so the
    // suite stays green; run with STRICT_STOP=1.
    test.runIf(process.env['STRICT_STOP'])('starts no build after stop() without a later change', async () => {
        await fc.assert(fc.asyncProperty(caseArb, async c => {
            checkContract(c, await runCase(c), {strictStop: true});
        }), {numRuns: NUM_RUNS});
    });
});
