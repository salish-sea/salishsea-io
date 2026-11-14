// What the demo keeps: each send, and each line of a post and each comment, as first seen
// and as last seen. Comments are known by Facebook's comment_id; a post's lines by their
// text, with their order among identical lines (decision 117).
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sends (
      id INTEGER PRIMARY KEY, at INTEGER NOT NULL, sender TEXT NOT NULL, post_id TEXT, url TEXT, title TEXT,
      bytes INTEGER, lines INTEGER, comments INTEGER, added INTEGER, changed INTEGER, gone INTEGER,
      collapsed INTEGER, sort TEXT);
    CREATE TABLE IF NOT EXISTS items (
      key TEXT PRIMARY KEY, post_id TEXT NOT NULL, post_title TEXT, kind TEXT NOT NULL,
      comment_id TEXT, reply_to TEXT, author TEXT, ago TEXT, est_time INTEGER,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, gone INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL, text TEXT NOT NULL, clock TEXT, reading TEXT, places TEXT,
      mark TEXT, note TEXT, marked_by TEXT, marked_at INTEGER);
    CREATE INDEX IF NOT EXISTS items_post ON items (post_id, first_seen, seq);
  `);
  return db;
}

const lineKey = (postId, text, n) => `l:${postId}:${createHash('sha1').update(text).digest('hex').slice(0, 16)}:${n}`;

/**
 * Records one send. `read` is readPost's result; `enrich(text)` gives what the reader makes
 * of a text: {clock, reading, places}. Returns the counts and the keys this send carried.
 */
export function recordSend(db, { at, sender, postId, url, title, bytes, read, agoToTime, enrich }) {
  const get = db.prepare('SELECT text FROM items WHERE key = ?');
  const insert = db.prepare(`INSERT INTO items (key, post_id, post_title, kind, comment_id, reply_to, author, ago, est_time,
      first_seen, last_seen, seq, text, clock, reading, places)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const touch = db.prepare('UPDATE items SET last_seen = ?, gone = 0, ago = ?, post_title = ? WHERE key = ?');
  const rewrite = db.prepare('UPDATE items SET last_seen = ?, gone = 0, ago = ?, post_title = ?, text = ?, clock = ?, reading = ?, places = ? WHERE key = ?');

  let added = 0, changed = 0, gone = 0;
  const keys = [];
  db.exec('BEGIN');
  try {
    const put = (key, row, seq) => {
      keys.push(key);
      const old = get.get(key);
      const e = enrich(row.text);
      if (!old) {
        insert.run(key, postId, title, row.kind, row.commentId ?? null, row.replyTo ?? null, row.author ?? null, row.ago ?? null,
          row.ago ? agoToTime(row.ago, at) : null, at, at, seq, row.text, e.clock, JSON.stringify(e.reading), JSON.stringify(e.places));
        added++;
      } else if (old.text !== row.text) {
        rewrite.run(at, row.ago ?? null, title, row.text, e.clock, JSON.stringify(e.reading), JSON.stringify(e.places), key);
        changed++;
      } else {
        touch.run(at, row.ago ?? null, title, key);
      }
    };

    const seen = new Map();
    read.lines.forEach((text, i) => {
      const n = seen.get(text) ?? 0;
      seen.set(text, n + 1);
      put(lineKey(postId, text, n), { kind: 'line', text }, i);
    });
    read.comments.forEach((c, i) => put(`c:${c.id}`, { kind: c.kind, commentId: c.id, replyTo: c.replyTo, author: c.author, ago: c.ago, text: c.text }, 1000 + i));

    // A line of the post that this send no longer carries has been edited away. Only lines:
    // a comment missing from one send may just not have been loaded on the page.
    if (read.lines.length) {
      const lineKeys = new Set(keys.filter((k) => k.startsWith('l:')));
      for (const { key } of db.prepare("SELECT key FROM items WHERE post_id = ? AND kind = 'line' AND gone = 0").all(postId)) {
        if (!lineKeys.has(key)) {
          db.prepare('UPDATE items SET gone = 1 WHERE key = ?').run(key);
          gone++;
        }
      }
    }

    db.prepare(`INSERT INTO sends (at, sender, post_id, url, title, bytes, lines, comments, added, changed, gone, collapsed, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(at, sender, postId, url, title, bytes, read.lines.length, read.comments.length, added, changed, gone, read.collapsed, read.sort);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { added, changed, gone, keys };
}
