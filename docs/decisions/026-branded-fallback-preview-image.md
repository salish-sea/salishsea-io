# 026 — Branded fallback link-preview image

**Status:** accepted (2026-08-12)
**Context:** GitHub issue [#286](https://github.com/salish-sea/salishsea-io/issues/286)
(branding contribution by Liam Reese); PR #381. Supersedes
[decision 019](019-no-fallback-preview-image.md).

Decision 019 removed the site-wide fallback `og:image` because the only
available asset was a stale April-2026 map screenshot: a preview reads as a
picture *of the post*, and a content-shaped screenshot attached to an unrelated
post is misleading. Cards without a real image became text-only summaries.

## Decision

**With a real brand identity in hand, cards that lack an image of the thing
shared carry the branded card instead of no image.** The 1200×630 card —
the designer's own composition of the two-herring mark, the wordmark, and the
herring pattern (`public/social-card.jpg`) — is identity-shaped, not
content-shaped: it says
"this is SalishSea.io", which is true of every link, rather than pretending to
depict the post.

Rolled out in two steps, both shipped:

1. **Static shells (PRs #381, #383):** every shell — `index.html`, `about.html`,
   and the `individual`/`matriline`/`ecotype` profile shells — declares the card
   and `twitter:card=summary_large_image`. This reaches non-bot scrapes, the
   pages the edge handler never intercepts (`about.html`), and, importantly, any
   crawler served the raw shell because the handler failed open.
2. **Edge handler (PR #383):** the synthesized cards that had no image — bare
   homepage, individual/matriline/ecotype profiles, and an occurrence with
   neither an open-licensed photo nor coordinates to render a map from —
   declare the branded card and flip to `summary_large_image`.

The order within a card is unchanged and matters: an open-licensed photo of the
animal, else a rendered map of where it was seen, else the brand card. The brand
card is the floor, not a competitor to either — a map of the actual sighting is
closer to a picture of the thing shared than a logo is.

What 019 got right and this record keeps:

- **An image only counts if platforms render it.** The card is 1200×630,
  comfortably above Facebook's 200×200 floor and matched to
  `summary_large_image`.
- **A real photo of the thing shared always wins.** The branded card is a
  fallback, never a replacement for the open-licensed occurrence photo or the
  rendered day/occurrence map cards.
- The `STATIC_ASSET_RE` carve-out serves the card bytes to crawlers.

## Consequences

- Every shared link renders a rich card; none degrade to bare text. That holds
  on the handler's failure paths too, because the shell it falls open to
  declares the same card.
- The card must stay current with the brand. It is a brand asset rather than a
  screenshot, and it is built from a checked-in source
  ([docs/branding](../branding/README.md)), so a brand change regenerates it
  rather than orphaning it.
- Facebook's sticky image-verdict caching (019's runbook note) applies to the
  transition in reverse: text-only-scraped links may lag in picking up the card.
