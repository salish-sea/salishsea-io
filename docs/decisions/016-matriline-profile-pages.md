# 016 — Matriline profile pages

**Status:** accepted (2026-07-07)
**Context:** bd `salishsea-io-w2d`; builds on individual profile pages
(decision 015). Most Bigg's sighting reports name the matriline ("T65As"),
not individuals — the richest identification signal we have — but those codes
were deliberately left unlinked because there was nowhere to send them.

## Decision

Give every cataloged matriline a page at **`/matrilines/<designation>`**
(e.g. `/matrilines/T065A`, the anchor matriarch's designation), rendered
client-side from a fourth Vite HTML entry (`matriline.html` +
`<matriline-page>`), mirroring decision 015's shell/edge pattern.

*Rejected:* `/groups/<designation>` as a single route for every
`social_group` kind. It would have served pods/clans/named groups with no new
infra, but "matrilines" is the meaningful word for the pages that exist today;
each later kind costs one entry in the edge route table and one shell.

### URL scheme: path-based, resolved at the edge route table

The viewer-request Lambda@Edge's individual-page branch became a small route
table (`PROFILE_ROUTES` in `infra/lib/edge-handler/index.ts`): per route, a
path regex, a shell to rewrite humans to, and an OG-preview builder for
crawler user-agents (same fail-open contract; unknown designations get the
generic site card). The Vite dev/preview middleware mirrors both rewrites.

### Read path: `group_occurrences`, direct group claims only — no member fan-out

A new `public.group_occurrences` view (migration `20260708021011`) is the
group analogue of `individual_occurrences`: the same live-stored-claims +
cached-candidates two-branch shape, filtered to rows where `social_group_id`
is set. A matriline's sightings are reports that name the group **as a unit**.

*Rejected:* the union of members' individual sightings. It double-counts
(every member row for one report), blurs whose sighting it was, and is
already presented subject-by-subject on the members' own pages —
`individual_occurrences` fans group claims out to members, so the two views
are complements, not duplicates.

### Group codes now link site-wide

`injectIndividualLinks` previously matched matriline codes ("T65As") only to
leave them untouched. It now resolves them against the matriline catalog and
links to `/matrilines/<designation>`; unresolved codes still pass through as
plain text (linking is a navigation aid, never an identification claim).
Individual pages' matriline section headers link to the matriline page.

### Invariants carried over from 015

- **Honesty:** the sightings section says its counts are mostly unverified
  mentions, and states the no-fan-out semantics (reports naming the group,
  not members' sightings). Absence claims and rejected identifications are
  excluded.
- **D-21:** only naming and genealogy facts are rendered — group nicknames'
  facts via `nicknames.social_group_id`; `social_groups.notes` and nickname
  stories are never rendered.
- Matriline pages are not in `sitemap.xml`.
- Shared rendering (member list, presence grid, common styles) lives in
  `src/profile-shared.ts`; the `<individual-map>` component was already
  subject-agnostic.

## Consequences / follow-ups

- Pod, clan, and named-group pages are follow-ups: one `PROFILE_ROUTES` entry
  + one shell each, reusing the same page structure with a different `kind`
  filter.
- The matriline lookup filters `kind = 'matriline'`, so ecotype/pod
  designations 404 on `/matrilines/*` until those pages exist.
- Only Bigg's matrilines are seeded (they mirror the individuals catalog,
  decision 014).
