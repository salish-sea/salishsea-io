# 057 — Profile pages are prerendered: real HTML from the read-path build, with the map as the only client-side part

**Status:** accepted; step 1 of 5 built · **Decided:** 2026-09-29 · **Answers:** `salish-t3g.7` · **Extends:** [056](056-the-logged-out-read-path-is-built-as-static-files.md) · **Amends:** [015](015-individual-profile-pages.md), [016](016-matriline-profile-pages.md), [017](017-ecotype-profile-pages.md), [040](040-haul-out-sites-list-first.md) (how their pages are rendered, not what they show)

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

**The map is the only client-side part.** The OpenLayers map on each page is a small island that loads its points from a per-profile data file. Nothing else on the page needs the browser. Pages stop preloading Sentry and the Supabase client, which profiles don't use.

**Plain string templates, not Lit's server renderer.** The page components can't be rendered on a server as they stand. Each reads `window.location` when constructed, sets `document.title` and `history`, and loads its data in async tasks that server rendering never awaits. Making them renderable would mean restructuring them anyway, and `@lit-labs/ssr` is Lit's experimental line, against the README's rule to minimize volatile dependencies. So the static sections are TypeScript functions returning escaped HTML strings, in the style the edge handler and the DarwinCore Archive builders already use. That means one renderer for the static sections. The client components stay only for production's Supabase mode, frozen, until cutover, and are deleted then.

**A page the build hasn't produced is a "not published yet" 404.** That's an animal added to the register since the last build, at most about an hour. The page says so with the right status. Falling back to the client-rendered shell would have kept those components, and a Supabase dependency, alive indefinitely beside the new renderer.

**The snapshot reads what the pages show, and nothing more.** Migration `20260929120000_read_path_profiles.sql` grants `read_path` the catalogue tables and the four sighting-link views.
- `nicknames` is limited to the columns anon reads, so `story` stays withheld (rights policy D-21, decision [015](015-individual-profile-pages.md)).
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
- **Lit's server renderer.** See above: the same restructuring, plus an experimental dependency.
- **Fall back to the client page for a profile not yet built.** See above: a second renderer and a Supabase dependency kept forever, to cover a gap of about an hour.

## Consequences

- Until step 2 lands, nothing a visitor sees changes. The snapshot reads fourteen relations instead of one, which takes about 6 s against a mirror of production.
- The presence table needs a "current year". It comes from the snapshot's time, not the clock, so the same snapshot always renders the same pages.
- Crawler previews of *map* links (`?o=`, `?d=`) and the `/cards/*` images still exist only on AWS. They are a separate question from this one.
