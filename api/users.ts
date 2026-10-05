/**
 * Who signed in, in the store (decision 065, salish-9uu.3.3): Postgres's
 * create_contributor_on_sign_in, ported.
 *
 * A Google account that has signed in before is found by its `sub` — including every
 * account copied from Supabase, whose Google identity moved with it — and keeps its
 * contributor. A new one joins the contributor an email Google has verified already
 * belongs to; otherwise it gets a new contributor named as Google names it ('Anonymous'
 * when Google gives no name, as the trigger did), and a verified email is recorded so a
 * later account with it joins the same contributor.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { GoogleIdentity } from './google.ts';

export type Me = {
    user_id: string,
    contributor: {id: number, name: string, picture: string | null, editor: boolean, orcid: string | null},
};

/** A user's session epoch, or null if the user is gone. */
export function sessionEpoch(store: DatabaseSync, userId: string): number | null {
    const row = store.prepare('SELECT session_epoch FROM users WHERE id = ?').get(userId) as {session_epoch: number} | undefined;
    return row ? row.session_epoch : null;
}

/** End every session the user has: the epoch their cookies carry no longer matches. */
export function signOut(store: DatabaseSync, userId: string): void {
    store.prepare('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?').run(userId);
}

/** The user and contributor a session names, or null if the user is gone. */
export function me(store: DatabaseSync, userId: string): Me | null {
    const row = store.prepare(`
        SELECT u.id AS user_id, c.id, c.name, c.picture, c.editor, c.orcid
        FROM users u JOIN contributors c ON c.id = u.contributor_id WHERE u.id = ?`).get(userId) as
        {user_id: string, id: number, name: string, picture: string | null, editor: number, orcid: string | null} | undefined;
    if (!row) return null;
    return {
        user_id: row.user_id,
        contributor: {id: row.id, name: row.name, picture: row.picture, editor: row.editor === 1, orcid: row.orcid},
    };
}

/** The user for a verified Google identity, made if this is its first sign-in. Returns its id. */
export function signIn(store: DatabaseSync, identity: GoogleIdentity, now = new Date()): string {
    const verifiedEmail = identity.email_verified ? identity.email : null;
    store.exec('BEGIN IMMEDIATE');
    try {
        // looked up under the write lock, so two first sign-ins of one account can't both make it
        const known = store.prepare('SELECT id FROM users WHERE google_sub = ?').get(identity.sub) as {id: string} | undefined;
        if (known) {
            store.exec('COMMIT');
            return known.id;
        }
        const joined = verifiedEmail === null ? undefined : store.prepare(
            'SELECT contributor_id FROM contributor_email_addresses WHERE email_address = ?',
        ).get(verifiedEmail) as {contributor_id: number} | undefined;
        let contributorId = joined?.contributor_id;
        if (contributorId === undefined) {
            const made = store.prepare('INSERT INTO contributors (entity_id, name, picture) VALUES (?, ?, ?) RETURNING id')
                .get(randomUUID(), (identity.name ?? 'Anonymous').slice(0, 200), identity.picture) as {id: number};
            contributorId = made.id;
            if (verifiedEmail !== null)
                store.prepare('INSERT INTO contributor_email_addresses (email_address, contributor_id) VALUES (?, ?)')
                    .run(verifiedEmail, contributorId);
        }
        const id = randomUUID();
        store.prepare('INSERT INTO users (id, google_sub, email, contributor_id, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(id, identity.sub, identity.email, contributorId, now.toISOString());
        store.exec('COMMIT');
        return id;
    } catch (error) {
        store.exec('ROLLBACK');
        throw error;
    }
}
