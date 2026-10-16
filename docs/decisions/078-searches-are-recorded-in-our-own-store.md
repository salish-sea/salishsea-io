# 078 — What people search for is recorded in our own store, without who searched

**Status:** accepted · **Decided:** 2026-10-16, by Peter · **Relates:** [071](071-a-search-field-in-the-nav.md) (the search field), [039](039-feedback-goes-to-our-own-database.md) (feedback goes to our own database), [065](065-the-store-and-write-api.md) (the store and write API)

## Context

The search field finds animals, groups, haul-out sites, regions, hydrophones and the places the basemap labels (071). Which places it should offer was decided by measuring what sighting reports name, because nothing recorded what people search for: the field searches an index in the browser, so the server sees one download and never a query. Peter wanted to learn what people actually search for, and under what words.

## Decision

**The field sends the write API one record per search, and the API keeps it in its store** ([`src/search-log.ts`](../../src/search-log.ts), [`api/searches.ts`](../../api/searches.ts), the `searches` table). Like feedback (039), it goes to our own store, not a third party's, so an ad blocker that blocks Sentry doesn't hide it, and it is kept as long as we choose. It is read with SQL on the store; nothing reads it back through the API.

**A search is recorded when it ends:** when someone chooses a result, with what they typed and what they chose; or when they give up, with what they typed and that nothing was chosen. Peter chose to record the misses too, because a search that found nothing, or found something nobody chose, says what is missing. They give up by closing the field or leaving the page, or by pausing three seconds and then typing other words: "jeff head", a pause, then "jefferson" and a choice records the miss and then the hit. Going on to type more of the same words gives nothing up. Peter first chose "pausing three seconds without choosing" as giving up; review showed that reading the results takes that long too, so a pause followed by a choice would have recorded one search twice, as a miss and a hit. A pause alone now records nothing. A query is recorded once.

**Each record holds only the words typed, how many results they listed (at most eight, or none known if the index hadn't loaded yet), the kind and name of the result chosen, if any, and the kind of page the field was on** ("map", "individuals"). No account, address, cookie or browser is kept. The API sees the sender's address only to cap how many searches one address may send, 120 in ten minutes, in memory.

## Rejected

- **Sentry's logs.** No server work, but kept about thirty days, counted against Sentry's quota, held by a third party, and silenced by the blockers that hid feedback (039).
- **Recording only searches that end in a choice.** Smaller, but blind to what people looked for and didn't find.
- **Recording every keystroke.** A search typed a letter at a time would be a dozen records.
- **Not recording.** The place lists would be judged by reports alone, which name places in their own words.

## Consequences

- To read it, on the Fly machine (`fly ssh console -a salishsea-io`), which has Node's SQLite but no `sqlite3` command:

  ```sh
  node -e "const db = new (require('node:sqlite').DatabaseSync)('/data/store/salishsea.db', {readOnly: true});
    console.table(db.prepare('SELECT created_at, query, results, chosen_kind, chosen_label, page FROM searches ORDER BY id DESC LIMIT 50').all())"
  ```

  The store is replicated by Litestream with everything else in it, so a restored copy can be read the same way anywhere.
- The read-path snapshot reads only the tables it names (`scripts/read-path/snapshot.ts`, `FROM_STORE`), so searches are never published.
- Records are stamped to the microsecond, so a run of them from one page in a few seconds can be read as one person's searches. Nothing ties a run to a person, but "without who searched" is not "unlinkable".
- A middle-click on a result records it as chosen; a choice that leaves the page in an old browser without `keepalive` (Firefox before 133) may be lost.
- The site says nowhere what it records. Whether the About page should say so is open.
