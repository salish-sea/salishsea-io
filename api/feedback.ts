/**
 * Feedback (decision 039, as 065 moves it): anyone may write, signed in or not; nobody
 * reads it back through the API. Postgres's submit_feedback, ported: every field trimmed,
 * an empty optional one none, the sender's user stamped by the server when they are
 * signed in. The lengths are the store's CHECKs, the same as Postgres's.
 *
 * Open to anyone means open to a flood, so a sender is held to a few messages in a
 * window, by the address CloudFront saw.
 */

import type { DatabaseSync } from 'node:sqlite';

import { Refused } from './sightings.ts';

export type FeedbackInput = {name: string, email: string | null, message: string, page_url: string | null,
    user_agent: string | null, release: string | null};

const text = (value: unknown): string | null => typeof value === 'string' ? value.trim() : null;
const optional = (value: unknown): string | null => text(value) || null;

export function parseFeedback(body: Record<string, unknown>): FeedbackInput {
    const name = text(body['name']);
    const message = text(body['message']);
    if (!name || !message) throw new Refused(400, 'feedback needs a name and a message');
    return {
        name, message,
        email: optional(body['email']),
        page_url: optional(body['page_url']),
        user_agent: optional(body['user_agent']),
        release: optional(body['release']),
    };
}

export function submitFeedback(store: DatabaseSync, userId: string | null, input: FeedbackInput, now = new Date()): void {
    try {
        store.prepare(`INSERT INTO feedback (created_at, name, email, message, page_url, user_agent, release, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(now.toISOString(), input.name, input.email, input.message, input.page_url, input.user_agent,
                input.release, userId);
    } catch (error) {
        if (error instanceof Error && /CHECK constraint failed/.test(error.message))
            throw new Refused(400, 'a field is too long');
        throw error;
    }
}

/** At most `limit` messages per sender in `windowMs`. In memory: a restart forgives everyone. */
export function rateLimiter(limit = 5, windowMs = 10 * 60_000) {
    const seen = new Map<string, number[]>();
    return (sender: string, now = Date.now()): boolean => {
        const recent = (seen.get(sender) ?? []).filter(t => now - t < windowMs);
        if (recent.length >= limit) {
            seen.set(sender, recent);
            return false;
        }
        recent.push(now);
        seen.set(sender, recent);
        if (seen.size > 10_000) for (const [k, v] of seen) if (v.every(t => now - t >= windowMs)) seen.delete(k);
        return true;
    };
}
