/**
 * Which file of the read-path id index holds an occurrence id (decision 056).
 *
 * A `?o=<id>` link names a sighting but not its day, and on the static read path
 * nothing can be asked. So the build writes an index — id to Pacific day — split
 * into ID_SHARDS small files by this hash of the id, and the browser opens one.
 * The build (scripts/read-path/occurrence-ids.ts) and the browser (read-path.ts)
 * both import this, so they cannot disagree about where an id lives.
 *
 * FNV-1a, 32-bit, over the id's UTF-16 code units: tiny, dependency-free, the
 * same in Node and every browser, and spreads short similar strings
 * ("maplify:1", "maplify:2") evenly. Not for anything adversarial — an id can at
 * worst choose its own shard.
 */

export const ID_SHARDS = 256;

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The shard's name: two lowercase hex digits, "00" to "ff". */
export function idShard(id: string): string {
  return (fnv1a32(id) % ID_SHARDS).toString(16).padStart(2, '0');
}
