# 057 — Profile pages are prerendered: real HTML from the read-path build, with the map as the only client-side part

**Status:** accepted; all five steps built · **Decided:** 2026-09-29 · **Answers:** `salish-t3g.7` · **Extends:** [056](056-the-logged-out-read-path-is-built-as-static-files.md) · **Amends:** [015](015-individual-profile-pages.md), [016](016-matriline-profile-pages.md), [017](017-ecotype-profile-pages.md), [040](040-haul-out-sites-list-first.md) (how their pages are rendered, not what they show)

## Context

The four profile pages (an individual, a matriline, an ecotype, a haul-out site) are client-rendered today. Each HTML file is an empty shell. Its component reads the key from the URL, makes five to eight PostgREST requests with embedded joins, and renders. [056](056-the-logged-out-read-path-is-built-as-static-files.md) takes what a logged-out visitor reads off the database, and it named profiles as one of the remaining reads.

A profile is different from the map in a way that matters here. It is one subject, keyed by the register identifier, and nearly everything on it changes only when the catalogue or its sightings do. It could be a data file the same shells read, or it could be the page itself.

Two facts favoured the page:

- **Link previews.** A crawler reading a profile link today gets its title and description from the Lambda@Edge function, which queries Supabase per request. The Fly app has no edge function, so its profile links preview as the bare site card. A prerendered page carries its own tags.
- **Weight.** Every profile page preloads about 750 KB of JavaScript before it shows anything: OpenLayers, Sentry and the Supabase client. Most of what the page shows is text.

## Decision

**Each profile is a real HTML page, rendered by the read-path build.** The build turns the snapshot into one page per individual, matriline, ecotype and haul-out:

- the masthead, names, family, members, matrilines and atlas text
- the sighting summary (presence table, last reported)
- the page's title, description, Open Graph and canonical tags, computed as the edge function computes them today

It reads correctly with JavaScript off. The render is a task in the Stelis graph, like the day and calendar files, so a page's history traces back to the data that produced it.

**The map is the only client-side part.** The OpenLayers map on each page is a small island that loads its points from a per-profile data file. Nothing else on the page needs the browser. Pages stop preloading Sentry and the Supabase client, which profiles don't use. The island is its own Vite entry, [`src/map-island.ts`](../../src/map-island.ts), which defines only `<individual-map>`. The build writes its script tags from Vite's manifest, and only into a page that has a map. Custom elements upgrade inside a declarative shadow root, so the map comes to life where the page rendered it. A haul-out's map also draws the site's radius; its page carries the site as JSON in the map's `site` attribute.

~~**Plain string templates, not Lit's server renderer.**~~ *Amended 2026-09-29:* **lit-html templates, shared by the client page and the build.** Plain string templates would have meant writing each page twice, once for the client components that production keeps until cutover and once for the build. The page components can't be rendered on a server as they stand: each reads `window.location` when constructed, sets `document.title` and `history`, and loads its data in async tasks. But their *templates* can. So each page's render moves into pure functions of its data, which touch no window, document or network ([`src/individual-profile.ts`](../../src/individual-profile.ts), [`src/matriline-profile.ts`](../../src/matriline-profile.ts), [`src/ecotype-profile.ts`](../../src/ecotype-profile.ts), [`src/haulout-profile.ts`](../../src/haulout-profile.ts)). A haul-out site's story is markdown, rendered by `marked` in either place. What the kinds share, the page frame and the sightings summary, is in [`src/profile-shared.ts`](../../src/profile-shared.ts). The client component calls them with what it fetches from Supabase. The build calls them with what it assembles from the snapshot, and turns the result into HTML with `@lit-labs/ssr`'s template renderer ([`scripts/read-path/profile-document.ts`](../../scripts/read-path/profile-document.ts)). That is the one part of the "labs" package used, pinned exactly. Lit's hydration comments are stripped, because nothing on the page is hydrated. The page is written once, and lit-html escapes what it interpolates without a helper. Eleventy with Nunjucks, the stack of BeeAtlas and pnwmoths, was considered too. Both of those projects carry silent Nunjucks bugs on record, and a Nunjucks template can't be shared with a Lit client. Static JSX would have been a second way of writing UI beside Lit.

**A prerendered page is the shell with its content in a declarative shadow root.** The document starts from the shell Vite builds for the page, so its head (CSP, icons, root styles) has one source. Into it go the page's own title, description, preview and canonical tags. In place of the empty custom element goes `<template shadowrootmode="open">`, holding the page's styles and content. Every current browser attaches that as the element's shadow root without JavaScript, so the page's `:host`-scoped CSS applies exactly as it does client-side. The client page's scripts don't load. Every substitution into the shell must match exactly once, so a shell that changes shape fails the build rather than shipping the generic title.

**A page the build hasn't produced is a "not published yet" 404.** That's an animal added to the register since the last build, at most about an hour. The page says so with the right status. Falling back to the client-rendered shell would have kept those components, and a Supabase dependency, alive indefinitely beside the new renderer.

**Designation links redirect from a map the build writes.** Links from before [034](034-profile-urls-key-on-the-register-identifier.md) and typed addresses name a subject by its designation (`/individuals/T65A`, `/matrilines/T065As`). On AWS the edge function looks each one up in the database and answers 301. Here the build writes `redirects.json`: every designation an animal or group has carried, folded as the register compares names ([`src/fold.ts`](../../src/fold.ts)), mapped to the canonical address. A small server beside Caddy ([`scripts/read-path/redirect.ts`](../../scripts/read-path/redirect.ts)) folds the typed segment the same way and answers from the map: a 301 for a known designation, and a 404 "not in our catalog" page for an unknown one, where AWS serves the client page with a 200. Caddy can do neither the fold nor reload a table the build rewrites hourly, so the server exists for exactly this and nothing else. The same build step writes the sitemap: Vite's own entries, then every published profile.

**The snapshot reads what the pages show, and nothing more.** Migration `20260929120000_read_path_profiles.sql` grants `read_path` the catalogue tables and the four sighting-link views.
- Rights policy D-21 keeps verbatim Bigg's-sheet text off every page (decision [015](015-individual-profile-pages.md)), so the build never holds it. `nicknames.story` is withheld, as it is from anon, and so is `individuals.notes`, which anon can read but no page renders.
- Five of the tables have row-level security whose read policies name anon and authenticated, so the migration adds a read policy for `read_path` to each. Without it, the role would see no rows and raise no error.
- The one function a published view calls without a public grant, `register.inaturalist_taxon_for`, is granted too. It is `SECURITY DEFINER`, so it gives the role no table.

[`supabase/read-path-grants.test.ts`](../../supabase/read-path-grants.test.ts) pins what the role may read, and checks that it sees every row anon does in each published relation. Dropping one of the new policies makes that test fail with "public.individuals: expected 0 to be 510".

## Steps

1. **Snapshot the catalogue and the four sighting-link views,** with `read_path`'s grants and policies widened and pinned (this record's PR).
2. **Individual pages.** The render task; Caddy serving `/individuals/<id>/…` from the build and the 404 for anything it didn't produce; the map island.
3. **Matriline and ecotype pages.**
4. **Haul-out pages:** their story text, nearby sites and report photos.
5. **Old designation URLs and the sitemap.** Legacy `/<family>/<designation>` paths redirect without a lookup, from a map the build writes. Profile URLs join the sitemap.

## Rejected alternatives

- **One data file per profile, client-rendered as now.** This is the same pattern as the day and calendar files and the least change. It leaves the pages empty without JavaScript, still preloading 750 KB, and still without link previews on Fly.
- ~~**Lit's server renderer.** See above: the same restructuring, plus an experimental dependency.~~ Adopted after all, for templates only (amended 2026-09-29, above).
- **Eleventy with Nunjucks, or static JSX.** See above.
- **Fall back to the client page for a profile not yet built.** See above: a second renderer and a Supabase dependency kept forever, to cover a gap of about an hour.

## Consequences

- The snapshot reads fourteen relations instead of one, which takes about 6 s against a mirror of production.
- The pages are rendered again on every build, because the snapshot's time is one of their inputs (the year). That takes about 2 s for the 510 individuals, and less for the 132 matrilines, the one ecotype and the 362 haul-out sites. When nothing on them changed, the output is byte-identical, and nothing downstream reruns. Each kind is its own Stelis task, reading only its own tables.
- On Fly, all four kinds of profile page are the prerendered ones. A haul-out is addressed by its site id rather than a register identifier (the register holds animals, not places), so it has its own route. The AWS deploy keeps its client-rendered pages until cutover.
- The presence table needs a "current year". It comes from the snapshot's time, not the clock, so the same snapshot always renders the same pages.
- Crawler previews of *map* links (`?o=`, `?d=`) and the `/cards/*` images still exist only on AWS. They are a separate question from this one.
