# 071 — A search button in the nav finds animals and places, from an index the build writes

**Status:** accepted · **Decided:** 2026-10-07 · **Context:** GitHub [#640](https://github.com/salish-sea/salishsea-io/issues/640) · **Follows:** [BeeAtlas ADR 0021](https://github.com/rainhead/beeatlas/blob/7fd8d251514f1752f3a8e760997a855da6b4ec05/docs/adr/0021-search-is-a-header-affordance.md) (search is one field in the header) · **Relates:** [057](057-profile-pages-are-prerendered.md) (a prerendered page's scripts are islands), [070](070-southern-residents-are-generated-from-the-register.md) (the populations it finds)

## Context

Someone who arrives knowing a name, such as "J35", "T65As", "Fingers" or "Lime Kiln", had to know our URL scheme or click around the map to find it. BeeAtlas answered the same need with one query field in its header that serves every kind of named thing. The question here was what it finds, what choosing a result does, and where its data comes from, given that most visitors are signed out and the site reads no database for them (056).

## Decision

**A search button in the site nav, on every page, that opens the field in a popover.** The nav takes BeeAtlas's header look along with its search (its `bee-header.ts`): each item is a 44px target with a 24px outline icon, dimmed until it is the page you are on, which is full strength and underlined in the accent (the lockup's teal on the map's dark header). The icons are BeeAtlas's map and taxonomy symbols, plus heroicons' information circle; each item also says its name, and drops it below 40rem ([`src/site-nav.ts`](../../src/site-nav.ts)). Search is the last item, a magnifier button. Its popover hangs from the button's right edge and is kept on screen, which matters on a phone, where the login button sits to its right. A field inline in the row was tried first and rejected on sight: it set its own baseline against the links, and on a phone it wrapped or went off somewhere unrelated. On a phone the map's header shows the lockup's mark without its wordmark, so the mark, three icons, search and the login button fit in 360 pixels. The results are an ARIA combobox: the arrow keys move, Enter follows, Escape closes.

**It finds whatever has a page, and the map's regions.** That means individuals, matrilines, populations and haul-out sites, plus the regions the map filters to. An animal answers to every code it has carried, folded as the register compares names (so `T65A` finds `T065A`), to its nicknames, and to the register's own search names (its `hidden` and `historical` ones, such as "SRKW"). It does not answer to the register's `common` names: for the Southern Residents those are nicknames with no rights entry yet (#511). Animals rank before places when two match equally well. Viewing locations and hydrophones are left out, because choosing one would only frame the map, and they would crowd out the animals.

**An animal offers both of its destinations** (Peter's call): its page, and beneath it its most recent sighting, which opens the map on that day with the report focused. An animal never sighted offers only its page. A region opens the map filtered to it, and a haul-out site opens its page. The atlas maps some sites at several points under one name, and those appear as one result.

**The index is a file the build writes**, `search-index.json`, served beside the day files ([`scripts/read-path/search-index.ts`](../../scripts/read-path/search-index.ts)). The field fetches it the first time someone focuses it, so search works signed out with no database, and a page nobody searches never loads it. It is a Stelis task of its own rather than part of the profile index, because it carries each animal's newest report, which moves with every build that brings one, while the profile index cuts off when the catalogue holds still. It is not an input to the manifest: if it fails, search runs a build behind rather than holding the map's files back (the lesson of #634). The shape and the matching are one module, [`src/search.ts`](../../src/search.ts), shared by the build and the browser.

**On a prerendered page the field is an island** (057), its own Vite entry. A page with no map loads only it: about 25 KB uncompressed, 9 KB gzipped.

## Rejected

- **Search in Supabase, or any database query.** Signed-out visitors read static files (056). The whole index is about 175 KB, small enough to fetch whole.
- **Folding "latest sighting" into the profile index.** That index would then rewrite every build. Computing the newest report in the browser instead would mean fetching a file per result, just to decide whether to offer it.
- **Only one destination per animal**, page or latest sighting. Peter chose both.
- **A field inline in the nav.** It fought the nav's alignment and had nowhere to go on a phone.
- **A search page, or search only on the map.** Search is a way in, and visitors arrive on profile pages from shared links as often as on the map.

## Consequences

- Every page has a search button and icons in its nav, and every prerendered page loads one more small script.
- "Log in" is the one text button left in the map's header; #644 replaces it with an account menu like BeeAtlas's.
- A name the register gains reaches search on the next build, with no change here.
- Southern Resident nicknames ("Tahlequah") become searchable when #511's names step gives them a source.
