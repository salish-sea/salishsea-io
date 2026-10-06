/**
 * When to run a read-path build, given a stream of "the data changed" signals
 * (salish-t3g.6). Pure: the listener supplies the signals and the build, and the
 * tests supply the clock.
 *
 * The database announced changes in bursts: an ingest tick committed once per
 * source, a register reload touched everything. A build per signal would read
 * production over and over for one burst, so this waits for `quietMs` of quiet —
 * but never longer than `maxWaitMs` after the first unhandled change, so a
 * steady trickle can't postpone a build forever. Since the cutover the one signal
 * is the write API's own, one per save, and it runs this with no quiet period
 * (api/server.ts, salish-9uu.6); the defaults below are the listener's.
 *
 * Nothing is dropped. A change that arrives while a build runs may have missed
 * its snapshot, so it earns exactly one more build afterwards, however many
 * changes arrive. A build that couldn't start because another holds the lock
 * (the hourly one) is retried after `busyRetryMs`, not forgotten.
 *
 * And builds are spaced at least `minIntervalMs` apart, whatever arrives. The
 * signal is a public broadcast, which anyone holding the publishable key can
 * send, so its rate must not set the rate of production reads: at the default,
 * a flood of forged signals costs at most 30 builds an hour. Neither the quiet
 * period nor a new signal can bring a build forward past that spacing or past a
 * pending lock retry.
 */

import { spawn } from 'node:child_process';

export type BuildResult = 'done' | 'busy';

export type CoalescerOptions = {
    quietMs: number,
    maxWaitMs: number,
    busyRetryMs: number,
    minIntervalMs: number,
};

export const DEFAULT_OPTIONS: CoalescerOptions = {
    quietMs: 10_000,
    maxWaitMs: 60_000,
    busyRetryMs: 30_000,
    minIntervalMs: 120_000,
};

export class BuildCoalescer {
    #pendingSince: number | null = null;
    #timer: ReturnType<typeof setTimeout> | null = null;
    #running = false;
    #changedDuringRun = false;
    /** No build starts before this: the spacing, or a pending lock retry. */
    #notBefore = -Infinity;

    readonly #runBuild: () => Promise<BuildResult>;
    readonly #options: CoalescerOptions;
    readonly #now: () => number;

    constructor(
        runBuild: () => Promise<BuildResult>,
        options: CoalescerOptions = DEFAULT_OPTIONS,
        now: () => number = Date.now,
    ) {
        this.#runBuild = runBuild;
        this.#options = options;
        this.#now = now;
    }

    /** The data changed. */
    changed(): void {
        if (this.#running) {
            this.#changedDuringRun = true;
            return;
        }
        const now = this.#now();
        this.#pendingSince ??= now;
        const debounced = Math.min(now + this.#options.quietMs, this.#pendingSince + this.#options.maxWaitMs);
        this.#schedule(Math.max(debounced, this.#notBefore) - now);
    }

    /** Stop any scheduled build; a running one finishes. */
    stop(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = null;
    }

    #schedule(delayMs: number): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = setTimeout(() => void this.#run(), Math.max(0, delayMs));
    }

    async #run(): Promise<void> {
        this.#timer = null;
        this.#running = true;
        this.#notBefore = this.#now() + this.#options.minIntervalMs;
        let result: BuildResult;
        try {
            result = await this.#runBuild();
        } catch {
            // A failed build is the hourly one's to retry; keep listening.
            result = 'done';
        } finally {
            this.#running = false;
        }
        if (result === 'busy') {
            // Still pending: keep #pendingSince, and try again once the other
            // build has had time to finish. Nothing started, so the retry is
            // bounded by the lock, not by the spacing.
            this.#pendingSince ??= this.#now();
            this.#notBefore = this.#now() + this.#options.busyRetryMs;
            // Nothing ran, so a signal that arrived meanwhile is covered by the
            // retry; left set, it would earn a second build after the retry.
            this.#changedDuringRun = false;
            this.#schedule(this.#options.busyRetryMs);
            return;
        }
        this.#pendingSince = null;
        if (this.#changedDuringRun) {
            this.#changedDuringRun = false;
            this.changed();
        }
    }
}

/** build.sh's answer when another build holds the lock: EX_TEMPFAIL. */
const BUSY = 75;

/**
 * A build as a command to run: 'done' when it exits 0, 'busy' when another build held the
 * lock, an error otherwise. What the change listener and the write API both hand the
 * coalescer.
 */
export function commandBuild(command: readonly string[]): () => Promise<BuildResult> {
    return () => new Promise((resolve, reject) => {
        const child = spawn(command[0]!, command.slice(1), {stdio: 'inherit'});
        child.on('error', reject);
        child.on('exit', code => {
            if (code === BUSY) resolve('busy');
            else if (code === 0) resolve('done');
            else reject(new Error(`build exited ${code}`));
        });
    });
}
