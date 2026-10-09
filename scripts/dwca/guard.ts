/**
 * The Darwin Core archive's hard floors (G-02): the zip, the parquet sidecar and the
 * occurrence count must each be strictly greater, or the archive is not published.
 *
 * The read-path build applies them (scripts/read-path/dwca.ts) to the archive it has
 * just written; this module only reads and validates them. Until salish-9uu.13 it was
 * also the nightly workflow's guard, which counted rows in Postgres's dwc.occurrences;
 * that workflow and its Postgres read are retired (decision 003, amended).
 */

/** The three G-02 hard floors. A metric must be strictly greater to pass. */
export interface GuardFloors {
    /** G-02: 50 KB floor for the zip archive. */
    zipBytes: number;
    /** CONTEXT: 10 KB floor for the parquet sidecar (symmetry with the zip floor). */
    parquetBytes: number;
    /** G-02: 1,000 row floor for dwc.occurrences. */
    rows: bigint;
}

/**
 * Read the floors from the environment, applying the G-02 defaults, and refuse any
 * that would quietly weaken the guard.
 *
 * A function rather than module-level `const`s: as constants they were frozen at
 * import time, which silently made the floors untestable (salish-52s).
 */
export function floorsFromEnv(env: NodeJS.ProcessEnv = process.env): GuardFloors {
    const floors: GuardFloors = {
        zipBytes: Number(env['ZIP_FLOOR_BYTES'] ?? 51200),
        parquetBytes: Number(env['PARQUET_FLOOR_BYTES'] ?? 10240),
        rows: parseRowFloor(env['ROW_FLOOR']),
    };
    // A silently NaN or zero floor returned to the caller would pass everything.
    assertValidFloors(floors);
    return floors;
}

/**
 * Parse ROW_FLOOR, rejecting anything that is not a positive integer.
 *
 * Screened with a regex before `BigInt()` because BigInt throws on non-integral
 * input — `BigInt('1.5')` and `BigInt('abc')` are both SyntaxErrors — which would
 * escape as an opaque stack trace while a malformed ZIP_FLOOR_BYTES gets a clear
 * message. Number() needs no equivalent: it yields NaN, which assertValidFloors
 * rejects. The range check lives here too so that a bad *value* from the
 * environment always reports the same way, whether it is '0' or 'lots'.
 *
 * Stricter than a bare BigInt(): '+1' and '0x10' were previously accepted and are
 * now refused. Nothing in the repo uses those forms, and refusing them loudly
 * beats accepting a form nobody intended.
 */
function parseRowFloor(raw: string | undefined): bigint {
    if (raw === undefined) return 1000n;
    if (/^\s*\d+\s*$/.test(raw)) {
        const parsed = BigInt(raw);
        if (parsed >= 1n) return parsed;
    }
    rejectFloors([`rows must be a positive integer, got ${JSON.stringify(raw)}`]);
}

/** Report invalid floors by throwing: the task that read them fails, naming them. */
function rejectFloors(problems: string[]): never {
    throw new Error(`guard floors are invalid: ${problems.join('; ')}`);
}

/**
 * Reject floors that would quietly weaken or disable the guard.
 *
 * The dangerous input is not a wild value but an empty one: `Number('')` is `0`
 * and `BigInt('')` is `0n`, so a workflow that references an unset variable —
 * `ZIP_FLOOR_BYTES: ${{ vars.SOMETHING_MISSING }}` — yields a floor of zero, and
 * a zero floor passes everything. The guard would go on reporting "guard ok" for
 * an empty archive, which is the single outcome it exists to prevent.
 *
 * Floors must therefore be positive: zero is rejected rather than treated as
 * "disable this check". Disabling a floor is not a supported configuration,
 * precisely because it is indistinguishable from the misconfiguration above.
 * NaN (from an unparseable value) is rejected for the same reason, though it
 * fails safe rather than open — every comparison against it is false, so the
 * guard would trip on a healthy archive.
 */
export function assertValidFloors(floors: GuardFloors): void {
    const problems: string[] = [];

    for (const key of ['zipBytes', 'parquetBytes'] as const) {
        const value = floors[key];
        if (!Number.isSafeInteger(value) || value < 1) {
            problems.push(`${key} must be a positive integer, got ${value}`);
        }
    }
    // `typeof` matters as much as the range here. GuardFloors is erased at
    // runtime, so a JavaScript caller can pass `rows: NaN`; `NaN < 1n` is false,
    // which would slip an unusable floor past a bare range check even though the
    // same value in zipBytes is caught by Number.isSafeInteger. Reported
    // separately so a wrong type and a wrong value do not share one message.
    if (typeof floors.rows !== 'bigint') {
        problems.push(`rows must be a bigint, got ${typeof floors.rows} (${String(floors.rows)})`);
    } else if (floors.rows < 1n) {
        problems.push(`rows must be a positive integer, got ${floors.rows}`);
    }

    if (problems.length > 0) rejectFloors(problems);
}
