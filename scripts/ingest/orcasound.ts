/**
 * Orcasound ingest — functional core (salish-8vr.26 / decision 013, amended 2026-09-20).
 *
 * Pure, runtime-agnostic transforms over orcasite's `/api/json/bouts` JSON:API pages.
 * No I/O, no DB, no Deno/Node APIs — importable unchanged by the Deno Edge Function
 * shell and by vitest. All effects (fetch, retry, persist, log) live in the shell.
 *
 * What a bout is here: one moderator-curated `biophony` bout at one hydrophone, from a
 * start to an end, citing zero or more register entities through its tags. That is the
 * whole of an acoustic occurrence (CONTEXT.md "Acoustic detection").
 *
 * A bout reaches its tags through its tag APPLICATIONS (`item_tags`), because certainty is a
 * property of the application, not of the tag (decision 054, orcasound/orcasite#1014).
 *
 * What is deliberately NOT read (013):
 *   - the bout's free-text name, for identity. It is carried as the title and never parsed.
 *   - a tag's name, slug or kind, for identity. A tag identifies an animal only by citing a
 *     register identifier in `iri`; a tag with none contributes nothing, and the gap is
 *     closed upstream (orcasound/orcasite#1016), not matched around here.
 *
 * Unlike Maplify and iNaturalist there is no window: the whole corpus is a few hundred
 * bouts and one request, so every tick reads all of it and reconciles against everything
 * stored. The safety that a window gives the other sources — a bad fetch can only damage
 * ten days — is replaced by two rules the shell enforces: reconcile only after the last
 * page (`next` is null), and never against an empty corpus.
 */

import { z } from 'zod';

export const AUDIO_CATEGORIES = ['biophony', 'anthrophony', 'geophony'] as const;
export type AudioCategory = (typeof AUDIO_CATEGORIES)[number];

/**
 * How sure the moderator was of a tag application (decision 054; the values of
 * orcasound/orcasite#1014), ascending, as public.identification_certainty declares them.
 * `null` is "nobody asked", which is every application a moderator applied without choosing.
 */
export const CERTAINTIES = ['possible', 'probable', 'certain'] as const;
export type Certainty = (typeof CERTAINTIES)[number];

/** One cited register entity, with the moderator's certainty about it. */
export type BoutEntity = {
    readonly entityId: string;
    readonly certainty: Certainty | null;
};

/** orcasite's prefixed ids; the same pattern public.acoustic_bouts.id checks. */
const BOUT_ID = /^bout_[0-9A-Za-z]+$/;
/** A register identifier; the same pattern public.acoustic_bout_entities.entity_id checks. */
const ENTITY_ID = /^SSA:[0-9]{7}$/;

const ResourceRef = z.object({ id: z.string(), type: z.string() });

/**
 * One bout resource. Strict enough that a malformed bout fails the whole page rather than
 * being dropped: a dropped bout would become a reconcile delete-candidate, and a transient
 * upstream glitch must never delete data (decision 011).
 */
export const BoutResourceSchema = z.object({
    type: z.literal('bout'),
    id: z.string().regex(BOUT_ID, 'not an orcasite bout id'),
    attributes: z.object({
        name: z.string().nullish(),
        category: z.enum(AUDIO_CATEGORIES),
        start_time: z.iso.datetime(),
        end_time: z.iso.datetime().nullish(),
        feed_id: z.string(),
    }),
    relationships: z.object({
        feed: z.object({ data: ResourceRef.nullish() }).optional(),
        item_tags: z.object({ data: z.array(ResourceRef).default([]) }).optional(),
    }),
}).refine(
    // As instants, not strings: ISO datetimes of different fractional precision do not
    // sort lexically ('.' precedes 'Z'), and orcasite may not always send six digits.
    (b) => b.attributes.end_time == null
        || Date.parse(b.attributes.end_time) > Date.parse(b.attributes.start_time),
    'end_time is not after start_time',
);

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

/** A tag as included by `include=item_tags.tag`. `iri` is the only field identity is read from. */
export const TagResourceSchema = z.object({
    type: z.literal('tag'),
    id: z.string(),
    attributes: z.object({
        name: z.string(),
        kind: z.string().nullish(),
        iri: z.string().nullish(),
    }),
});

/**
 * One application of a tag to a bout, as included by `include=item_tags.tag`. A certainty
 * outside the enum fails the page, as an unknown category does: the database would refuse
 * it anyway, and a new value upstream is a question for decision 054, not a default.
 */
export const ItemTagResourceSchema = z.object({
    type: z.literal('item_tag'),
    id: z.string(),
    attributes: z.object({
        certainty: z.enum(CERTAINTIES).nullish(),
    }),
    relationships: z.object({
        tag: z.object({ data: ResourceRef }),
    }),
});

/**
 * One page of `/api/json/bouts?include=feed,item_tags.tag`. Only the three included types
 * we ask for are accepted; anything else in `included` is a change upstream worth failing
 * loudly on.
 */
export const BoutsPageSchema = z.object({
    data: z.array(BoutResourceSchema),
    included: z.array(
        z.discriminatedUnion('type', [FeedResourceSchema, TagResourceSchema, ItemTagResourceSchema]),
    ).default([]),
    links: z.object({ next: z.string().nullish() }).default({}),
});

/** Our normalized bout — maps 1:1 to acoustic_bouts plus its acoustic_bout_entities. */
export type NormalizedBout = {
    readonly id: string;
    readonly feedId: string;
    readonly feedName: string;
    readonly lon: number;
    readonly lat: number;
    /** ISO-8601 UTC, as orcasite sends it. */
    readonly startedAt: string;
    /** NULL while a moderator still has the bout open. */
    readonly endedAt: string | null;
    /** The moderator's free-text name, shown as the occurrence's body. Never parsed. */
    readonly title: string | null;
    readonly category: AudioCategory;
    /**
     * Register entities the bout's tags cite, unique by identifier and sorted by it, each
     * with the moderator's certainty. Empty is legitimate (053: the bout is held, not shown).
     */
    readonly entities: readonly BoutEntity[];
};

export type ParseResult =
    | { readonly ok: true; readonly bouts: readonly NormalizedBout[]; readonly next: string | null }
    | { readonly ok: false; readonly error: string };

const blankToNull = (s: string | null | undefined): string | null => {
    const t = s?.trim();
    return t ? t : null;
};

/**
 * Validate and normalize one page. Returns ok:false if the envelope, ANY bout, or ANY
 * reference a bout makes (its feed, its tag applications, their tags) is malformed or missing from `included` —
 * the shell then aborts and writes nothing, never reconciling against a page it cannot
 * fully account for.
 *
 * Category is not filtered here; that is `isIngestable`'s job, kept separate so
 * validation stays total and the shell can count what upstream holds.
 */
export function parseBoutsPage(raw: unknown): ParseResult {
    const parsed = BoutsPageSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };

    const feeds = new Map<string, z.infer<typeof FeedResourceSchema>>();
    const tags = new Map<string, z.infer<typeof TagResourceSchema>>();
    const itemTags = new Map<string, z.infer<typeof ItemTagResourceSchema>>();
    for (const inc of parsed.data.included) {
        if (inc.type === 'feed') feeds.set(inc.id, inc);
        else if (inc.type === 'tag') tags.set(inc.id, inc);
        else itemTags.set(inc.id, inc);
    }

    const bouts: NormalizedBout[] = [];
    for (const b of parsed.data.data) {
        const feed = feeds.get(b.attributes.feed_id);
        if (!feed) return { ok: false, error: `bout ${b.id}: feed ${b.attributes.feed_id} is not in included` };

        const entities = new Map<string, BoutEntity>();
        for (const ref of b.relationships.item_tags?.data ?? []) {
            const itemTag = itemTags.get(ref.id);
            if (!itemTag) return { ok: false, error: `bout ${b.id}: item_tag ${ref.id} is not in included` };
            const tagId = itemTag.relationships.tag.data.id;
            const tag = tags.get(tagId);
            if (!tag) return { ok: false, error: `bout ${b.id}: tag ${tagId} is not in included` };
            const iri = tag.attributes.iri;
            // The identifier is the identity; `kind` is a display facet of the tag and is
            // not consulted. A register identifier names an animal or a group of animals
            // whatever the tag is filed under (animals ADR-0010).
            if (iri == null || !ENTITY_ID.test(iri)) continue;
            const certainty = itemTag.attributes.certainty ?? null;
            const prior = entities.get(iri);
            // Two applications citing one entity are one claim here; keep the surer of the two.
            if (!prior || rank(certainty) > rank(prior.certainty)) entities.set(iri, { entityId: iri, certainty });
        }

        const [lon, lat] = feed.attributes.location_point.coordinates;
        bouts.push({
            id: b.id,
            feedId: feed.id,
            feedName: feed.attributes.name,
            lon,
            lat,
            startedAt: b.attributes.start_time,
            endedAt: b.attributes.end_time ?? null,
            title: blankToNull(b.attributes.name),
            category: b.attributes.category,
            entities: [...entities.values()].sort((x, y) => x.entityId.localeCompare(y.entityId)),
        });
    }

    return { ok: true, bouts, next: parsed.data.links.next ?? null };
}

/** Ascending; null (nobody asked) ranks below every stated value. */
const rank = (c: Certainty | null): number => (c === null ? -1 : CERTAINTIES.indexOf(c));

/** Only biophony bouts are occurrences (013): the other two categories name no organism. */
export function isIngestable(b: NormalizedBout): boolean {
    return b.category === 'biophony';
}

export type ReconcilePlan = {
    readonly upsert: readonly NormalizedBout[];
    readonly delete: readonly string[];
};

/**
 * The reconcile plan for the whole corpus: upsert everything fetched and ingestable; delete
 * every stored bout the fetch no longer contains — which covers a bout deleted upstream and
 * a bout re-filed as anthrophony or geophony alike.
 *
 * Precondition (enforced by the shell, not here): `fetched` is the complete, parsed corpus.
 * Given an empty `fetched`, every stored bout is a delete — which is why the shell refuses
 * an empty corpus before reaching this.
 */
export function reconcile(
    fetched: readonly NormalizedBout[],
    existingIds: readonly string[],
): ReconcilePlan {
    const upsert = fetched.filter(isIngestable);
    const kept = new Set(upsert.map((b) => b.id));
    return { upsert, delete: existingIds.filter((id) => !kept.has(id)) };
}

/** A bout as a store holds it: Postgres's public.acoustic_bouts, or the build's mirror. */
export type BoutRow = {
    readonly id: string;
    readonly feed_id: string;
    readonly feed_name: string;
    readonly lon: number;
    readonly lat: number;
    readonly started_at: string;
    readonly ended_at: string | null;
    readonly title: string | null;
};

/** One register entity a bout's tags cite, with the moderator's certainty (054). */
export type BoutEntityRow = {
    readonly bout_id: string;
    readonly entity_id: string;
    readonly certainty: Certainty | null;
};

/**
 * The rows a store holds for the bouts a reconcile keeps: the read-path build's mirror
 * (decision 061), as Postgres's ingest held them until it retired (salish-9uu.11).
 */
export function boutRows(bouts: readonly NormalizedBout[]): {bouts: BoutRow[], entities: BoutEntityRow[]} {
    return {
        bouts: bouts.map((b) => ({
            id: b.id, feed_id: b.feedId, feed_name: b.feedName, lon: b.lon, lat: b.lat,
            started_at: b.startedAt, ended_at: b.endedAt, title: b.title,
        })),
        entities: bouts.flatMap((b) => b.entities.map((e) => ({bout_id: b.id, entity_id: e.entityId, certainty: e.certainty}))),
    };
}
