/**
 * OrcaHello's detections — functional core (salish-fizm.1, decision 122).
 *
 * Pure transforms over the answer of OrcaHello's `/api/detections` (the AI for Orcas
 * moderation API), and the schedule that decides which days to ask for. No I/O: the
 * fetch is scripts/ingest/fetch-orcahello.ts and the mirror scripts/read-path/
 * ingest-orcahello.ts.
 *
 * What OrcaHello says about a detection that orcasite doesn't: the model's confidence, a
 * label for each three-second window, and its moderators' answer to "Was there an SRKW
 * call in this clip?": yes, no, or don't know, with tags. A row is kept for a detection
 * orcasite also holds (a machine detection's idempotency key is OrcaHello's id) and for
 * the many it doesn't.
 *
 * Not kept, on purpose: the moderator (a name or an email address: personal data, not ours
 * to republish), the moderator's comment (free text), and the links to the clip's audio
 * and spectrogram. The schema reads only what is kept, so the rest never reaches the mirror.
 *
 * What the answer fields mean, as the API sends them (checked against 27,605 detections,
 * September 2020 to November 2026): `reviewed` is whether a moderator has answered, and
 * `found` is their answer ('yes', 'no', "don't know") — or, until they do, the default
 * 'No', which is no answer. So "no" means `found` is 'no' and `reviewed` is true.
 */

import { z } from 'zod';

const Annotation = z.object({
    startTime: z.number(),
    endTime: z.number(),
    confidence: z.number(),
    label: z.string(),
});

/**
 * One detection. A malformed one fails the whole page, so a half-read page is never
 * written; this mirror only upserts, so nothing is ever deleted on a page's account either way.
 */
export const OrcaHelloDetectionSchema = z.object({
    id: z.string().min(1),
    modelId: z.string().nullish(),
    aiModel: z.string().nullish(),
    timestamp: z.iso.datetime(),
    location: z.object({
        id: z.string(),
        name: z.string().nullish(),
        longitude: z.number().nullish(),
        latitude: z.number().nullish(),
    }),
    annotations: z.array(Annotation).default([]),
    reviewed: z.boolean(),
    found: z.string().nullish(),
    confidence: z.number().nullish(),
    moderated: z.string().nullish(),
    tagList: z.array(z.string()).default([]),
    globalPredictionLabel: z.string().nullish(),
});

/** A detection as the mirror stores it: SQLite has no boolean, and lists are JSON text. */
export type OrcaHelloRow = {
    id: string, location_id: string, location_name: string | null, lon: number | null, lat: number | null,
    timestamp: string, model_id: string | null, ai_model: string | null, confidence: number | null,
    global_prediction_label: string | null, reviewed: number, found: string | null,
    /** When a moderator answered; null until one has (the API sends 0001-01-01 for "never"). */
    moderated_at: string | null,
    /** The moderator's tags, a JSON array of text. */
    tags: string,
    /** Each three-second window's start, end, confidence and label, a JSON array of objects. */
    annotations: string,
};

export type ParseResult =
    | { readonly ok: true; readonly rows: readonly OrcaHelloRow[] }
    | { readonly ok: false; readonly error: string };

/** Validate and normalize one page (an array of detections), or say why not. */
export function parseOrcaHelloPage(raw: unknown): ParseResult {
    const parsed = z.array(OrcaHelloDetectionSchema).safeParse(raw);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
    return {
        ok: true,
        rows: parsed.data.map(d => ({
            id: d.id,
            location_id: d.location.id,
            location_name: d.location.name ?? null,
            lon: d.location.longitude ?? null,
            lat: d.location.latitude ?? null,
            timestamp: d.timestamp,
            model_id: d.modelId ?? null,
            ai_model: d.aiModel ?? null,
            confidence: d.confidence ?? null,
            global_prediction_label: d.globalPredictionLabel ?? null,
            reviewed: Number(d.reviewed),
            found: d.found ?? null,
            moderated_at: d.reviewed && d.moderated && !d.moderated.startsWith('0001-') ? d.moderated : null,
            tags: JSON.stringify(d.tagList),
            annotations: JSON.stringify(d.annotations.map(a => ({
                startTime: a.startTime, endTime: a.endTime, confidence: a.confidence, label: a.label,
            }))),
        })),
    };
}

// --- The schedule ----------------------------------------------------------------------
// OrcaHello's API reloads and sorts the whole query's rows in memory for every page, and
// fell over on 2026-11-24 when asked for everything at once. So it is asked for one UTC
// day at a time, a page every couple of seconds, and never faster than the intervals below
// whatever the build's tick (which is five minutes): the state the schedule reads is kept
// in the mirror, and a run that finds nothing due fetches nothing.

/** The first day OrcaHello has a detection (September 2020). */
export const FIRST_DAY = '2020-09-01';
/** Today and yesterday, at most this often. */
export const RECENT_MINUTES = 20;
/** One day of the last thirty, the one fetched longest ago, at most this often. */
export const CYCLE_MINUTES = 4;
/** One older day, chosen at random, at most this often. */
export const OLD_MINUTES = 60;
/** How many days, ending today, the cycle covers. */
export const CYCLE_DAYS = 30;

export type Kind = 'recent' | 'cycle' | 'old';

/** When each kind of fetch was last attempted (ISO), or null if never. */
export type ScheduleState = Readonly<Record<Kind, string | null>>;

const dayOf = (at: Date) => at.toISOString().slice(0, 10);
const plusDays = (day: string, n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
const due = (last: string | null, minutes: number, now: Date) =>
    last === null || now.getTime() - new Date(last).getTime() >= minutes * 60_000;

/**
 * Which days to fetch this run, each with the kind of fetch that chose it, in the order to
 * fetch them. `fetchedAt` is when the mirror last fetched each day completely (ISO), by
 * day; `random` in [0, 1). A pure function of the state and the clock.
 *
 *  - recent: today and yesterday, UTC, so a detection from just before midnight is read
 *    again after it, and a day is never asked for by a range that ends mid-day.
 *  - cycle: of the last thirty days, the one fetched longest ago (never first, then the
 *    most recent of those), so the month is refreshed every few hours.
 *  - old: any day before those, chosen with weight 1 / (1 + age in years), so a moderator's
 *    answer long after the fact is found eventually, recent months more often.
 */
export function plan(state: ScheduleState, fetchedAt: ReadonlyMap<string, string>, now: Date, random: number): {kind: Kind, day: string}[] {
    const today = dayOf(now);
    const days: {kind: Kind, day: string}[] = [];
    if (due(state.recent, RECENT_MINUTES, now))
        days.push({kind: 'recent', day: today}, {kind: 'recent', day: plusDays(today, -1)});
    if (due(state.cycle, CYCLE_MINUTES, now)) {
        const taken = new Set(days.map(d => d.day));
        const candidates = Array.from({length: CYCLE_DAYS}, (_, i) => plusDays(today, -i)).filter(d => !taken.has(d));
        // oldest fetch first; a day never fetched ('') before any fetched; ties by the later day
        candidates.sort((a, b) => (fetchedAt.get(a) ?? '').localeCompare(fetchedAt.get(b) ?? '') || b.localeCompare(a));
        if (candidates[0] !== undefined) days.push({kind: 'cycle', day: candidates[0]});
    }
    if (due(state.old, OLD_MINUTES, now)) {
        const last = plusDays(today, -CYCLE_DAYS);
        const weight = (day: string) => 1 / (1 + (now.getTime() - new Date(`${day}T00:00:00Z`).getTime()) / (365 * 86_400_000));
        const span = (new Date(`${last}T00:00:00Z`).getTime() - new Date(`${FIRST_DAY}T00:00:00Z`).getTime()) / 86_400_000;
        if (span >= 0) {
            // Weights fall smoothly, so a day is drawn by walking the cumulative weight.
            const all = Array.from({length: span + 1}, (_, i) => plusDays(FIRST_DAY, i));
            let at = random * all.reduce((sum, d) => sum + weight(d), 0);
            let pick = all[all.length - 1]!;
            for (const d of all) {
                at -= weight(d);
                if (at < 0) { pick = d; break; }
            }
            days.push({kind: 'old', day: pick});
        }
    }
    return days;
}
