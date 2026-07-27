# 019 — No fallback link-preview image

**Status:** accepted (2026-07-26)
**Context:** GitHub issue [#38](https://github.com/salish-sea/salishsea-io/issues/38)
(link previews); bd `salishsea-io-adx`. Builds on the OG-meta edge handler
(decision 002, 015–017).

Every card the edge handler synthesized — the homepage, individual, matriline
and ecotype profiles, and any occurrence without an open-licensed photo — set
`og:image` to a single branded fallback, `/preview.jpg`: a screenshot of the map
taken in April 2026. The static HTML shells declared the same image, so it also
reached search-engine and non-bot scrapes.

## Decision

**A card carries `og:image` only when we hold an image of the thing being
shared.** Today that is exactly one case: an occurrence whose photos include a
`cc0` or `cc-by` one (decision 004 — only those are unambiguously open for
re-use). Everything else is a text-only card: title, description, URL,
`fb:app_id`, and `twitter:card=summary`.

The fallback image and the `/preview.jpg` asset are removed.

### Why no image beats a generic one

A link preview is read as a picture *of the post*. A months-old map screenshot
attached to "here are 3 orcas off Point Robinson" doesn't say "this is
SalishSea.io" — it says "this is what you're sharing", and it isn't. That is
actively misleading in a way a text-only card is not: a summary card with a
good title and description is compact and honest, and the platforms render it
cleanly. The stale shot was worse than no preview at all.

### Why `twitter:card=summary` and not `summary_large_image`

`summary_large_image` promises a large picture; with no `og:image` the platforms
render a blank or broken image well. `summary` is the correct declaration for a
text-only card, so cards degrade to a tidy title/description block instead. Only
the photo-bearing occurrence card keeps `summary_large_image`.

## Consequences

- Occurrence links with an open-licensed photo are unchanged — the one case
  where the preview image really is the thing shared.
- Facebook caches image verdicts stickily and independently of the page scrape,
  so already-shared links may keep showing the old image for a while even though
  the card no longer declares one. See [the deploy runbook](../runbook/deploys.md).
- The edge handler's image-asset carve-out (`STATIC_ASSET_RE`, added when
  crawlers fetching `/preview.jpg` were answered with OG-meta HTML) stays: it is
  still correct for any on-origin image, and cheap.

## Rejected alternatives

- **Keep the map screenshot but regenerate it nightly.** Fresher, still not a
  picture of what was shared — a map of the whole Salish Sea says nothing about
  one sighting.
- **Render a per-sighting map card at request time** (headless capture, the
  original sketch in issue #38). This is the *right* long-term answer and issue
  #38 stays open for it, but it needs an image-generation service and a cache;
  it cannot live in a 128MB viewer-request Lambda under a 5s kill. Shipping "no
  image" now is not a step away from it.
- **A plain logo/wordmark card.** Adds no information the title and site name
  don't already carry, and eats the whole card area to do it.
