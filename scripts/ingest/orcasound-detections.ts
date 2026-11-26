/**
 * Orcasound's detections — functional core (salish-fizm.1, decision 122).
 *
 * Pure transforms over orcasite's `/api/json/detections` JSON:API pages; the fetch is
 * scripts/ingest/fetch-orcasound-detections.ts and the mirror scripts/read-path/
 * ingest-orcasound-detections.ts.
 *
 * What a detection is here: the moment a listener pressed the button, or the moment
 * OrcaHello's model heard a call, at one hydrophone, marked whale, vessel or other. A
 * machine detection is OrcaHello's: its `idempotency_key` is OrcaHello's id for it, which
 * is how the derivation joins the two (the mirror calls it `orcahello_id`). A detection
 * reaches its hydrophone through `feed_id`, so the page includes each feed only for its
 * name and position.
 *
 * Not read, on purpose: `description` (a listener's free text, or OrcaHello's moderator's
 * comment copied over; decision 122 shows neither) and `source_ip` (not public). The
 * fetch asks for sparse fieldsets that leave both out, and this schema would not carry
 * them if they came.
 *
 * Unlike the bouts there is a count to hold a fetch to: with `page[count]=true` orcasite
 * says how many detections match the filter, so the shell can prove a window complete
 * before the mirror deletes anything from it (decision 011).
 */

import { z } from 'zod';

export const DETECTION_CATEGORIES = ['whale', 'vessel', 'other'] as const;
export type DetectionCategory = (typeof DETECTION_CATEGORIES)[number];

/** orcasite's prefixed ids. */
const DETECTION_ID = /^det_[0-9A-Za-z]+$/;

/**
 * One detection resource. Strict enough that a malformed one fails the whole page rather
 * than being dropped: a dropped detection would become a reconcile delete-candidate, and
 * a transient upstream glitch must never delete data (decision 011). A category outside
 * the three fails the page too, as an unknown bout category does.
 */
export const DetectionResourceSchema = z.object({
    type: z.literal('detection'),
    id: z.string().regex(DETECTION_ID, 'not an orcasite detection id'),
    attributes: z.object({
        timestamp: z.iso.datetime(),
        source: z.enum(['human', 'machine']),
        category: z.enum(DETECTION_CATEGORIES).nullish(),
        listener_count: z.number().int().nullish(),
        visible: z.boolean(),
        idempotency_key: z.string().nullish(),
        feed_id: z.string(),
        candidate_id: z.string().nullish(),
    }),
});

/** A feed (hydrophone) as included by `include=feed`. GeoJSON: [lon, lat]. */
export const FeedResourceSchema = z.object({
    type: z.literal('feed'),
    id: z.string(),
    attributes: z.object({
        name: z.string(),
        location_point: z.object({
            type: z.literal('Point'),
            coordinates: z.tuple([z.number(), z.number()]),
        }),
    }),
});

export const DetectionsPageSchema = z.object({
    data: z.array(DetectionResourceSchema),
    included: z.array(FeedResourceSchema).default([]),
    links: z.object({ next: z.string().nullish() }).default({}),
    // `page[count]=true` adds `total`: how many detections match the filter, all pages.
    meta: z.object({ page: z.object({ total: z.number().int().nonnegative().nullish() }).default({}) }).default({ page: {} }),
});

/** Our normalized detection. */
export type NormalizedDetection = {
    readonly id: string;
    readonly feedId: string;
    /** ISO-8601 UTC, as orcasite sends it. */
    readonly timestamp: string;
    readonly source: 'human' | 'machine';
    readonly category: DetectionCategory | null;
    readonly listenerCount: number | null;
    /** orcasite's own flag for whether to show the detection; decision 122 shows only those it keeps visible. */
    readonly visible: boolean;
    /** OrcaHello's id for a machine detection: orcasite's idempotency key. Null for a listener's. */
    readonly orcahelloId: string | null;
    readonly candidateId: string | null;
};

export type NormalizedFeed = {
    readonly id: string;
    readonly name: string;
    readonly lon: number;
    readonly lat: number;
};

export type ParseResult =
    | { readonly ok: true; readonly detections: readonly NormalizedDetection[]; readonly feeds: readonly NormalizedFeed[];
        readonly next: string | null; readonly total: number | null }
    | { readonly ok: false; readonly error: string };

/**
 * Validate and normalize one page. Returns ok:false if the envelope or ANY detection is
 * malformed, or a detection's feed is missing from `included` — the shell then aborts
 * and writes nothing.
 */
export function parseDetectionsPage(raw: unknown): ParseResult {
    const parsed = DetectionsPageSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };

    const feeds = new Map<string, NormalizedFeed>();
    for (const f of parsed.data.included) {
        const [lon, lat] = f.attributes.location_point.coordinates;
        feeds.set(f.id, { id: f.id, name: f.attributes.name, lon, lat });
    }

    const detections: NormalizedDetection[] = [];
    for (const d of parsed.data.data) {
        const a = d.attributes;
        if (!feeds.has(a.feed_id)) return { ok: false, error: `detection ${d.id}: feed ${a.feed_id} is not in included` };
        detections.push({
            id: d.id,
            feedId: a.feed_id,
            timestamp: a.timestamp,
            source: a.source,
            category: a.category ?? null,
            listenerCount: a.listener_count ?? null,
            visible: a.visible,
            // Only a machine detection's key is OrcaHello's; a listener's would be the app's own.
            orcahelloId: a.source === 'machine' ? (a.idempotency_key ?? null) : null,
            candidateId: a.candidate_id ?? null,
        });
    }
    return {
        ok: true, detections, feeds: [...feeds.values()],
        next: parsed.data.links.next ?? null, total: parsed.data.meta.page.total ?? null,
    };
}

export type ReconcilePlan = {
    readonly upsert: readonly NormalizedDetection[];
    readonly delete: readonly string[];
};

/**
 * The reconcile plan for one window's complete fetch: upsert everything fetched, one for
 * each id, and delete every stored detection the fetch no longer contains (one orcasite
 * deleted). Every category is kept: which detections are occurrences is the derivation's
 * call (decision 122).
 *
 * Precondition (enforced by the shell and the mirror, not here): `fetched` is the
 * window's complete, parsed answer.
 */
export function reconcile(fetched: readonly NormalizedDetection[], existingIds: readonly string[]): ReconcilePlan {
    const upsert = [...new Map(fetched.map(d => [d.id, d])).values()];
    const kept = new Set(upsert.map(d => d.id));
    return { upsert, delete: existingIds.filter(id => !kept.has(id)) };
}
