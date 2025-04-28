import { Store, type SessionData } from "express-session";
import { db } from "./database.ts";
import { Temporal } from "temporal-polyfill";


const noop = (_err?: unknown, _data?: any) => {};

type SessionId = string;
type SessionArgs = [string, number | null, string, number];
type SessionRow = {id: string, user_id: number | null, data: string, expires: number};

const destroySessionStmt = db.prepare<SessionId>(`DELETE FROM sessions WHERE id=?`);
const clearSessionsStmt = db.prepare(`DELETE FROM sessions`);
const updateExpiryStmt = db.prepare<{id: SessionId, expires: number}>(`UPDATE sessions SET expires=@expires WHERE id=@id`);
const upsertSessionStmt = db.prepare<SessionArgs>(`INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?)`);
const getSessionStmt = db.prepare<SessionId, SessionRow>(`SELECT id, user_id, data, expires FROM sessions WHERE id = ?`);

export const sessionDuration = Temporal.Duration.from({hours: 30 * 24});

export default class SqliteStore extends Store {
  set(id: string, session: SessionData, cb = noop) {
    const expires = Temporal.Now.instant().add(sessionDuration);
    const expiresSec = Math.ceil(expires.epochMilliseconds / 1000);
    const {user_id, ...data} = session;

    try {
      upsertSessionStmt.run(id, user_id || null, JSON.stringify(data), expiresSec);
      return cb();
    } catch (err) {
      return cb(err);
    }
  }

  get(id: string, cb = noop) {
    try {
      const row = getSessionStmt.get(id);
      if (!row)
        return cb();
      const data = {...JSON.parse(row.data), user_id: row.user_id};
      return cb(null, data);
    } catch (err) {
      return cb(err);
    }
  }

  destroy(id: string, cb = noop) {
    try {
      destroySessionStmt.run(id);
    } catch (err) {
      return cb(err);
    }
    return cb();
  }

  clear(cb = noop) {
    try {
      clearSessionsStmt.run();
    } catch (err) {
      return cb(err);
    }

    return cb();
  }

  touch(id: string, session: SessionData, cb = noop) {
    const expires = Temporal.Now.instant().add(sessionDuration);
    const expiresSec = Math.ceil(expires.epochMilliseconds / 1000);

    try {
      updateExpiryStmt.run({id, expires: expiresSec});
    } catch (err) {
      return cb(err);
    }

    return cb();
  }
}

declare module 'express-session' {
  interface SessionData {
    user_id?: number;
  }
}
