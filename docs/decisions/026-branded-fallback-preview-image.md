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

Rollout in two steps:

1. **Static shells (PR #381):** `index.html` declares the card and
   `twitter:card=summary_large_image`, reaching non-bot scrapes.
2. **Edge handler (follow-up):** the synthesized text-only cards — bare
   homepage, individual/matriline/ecotype profiles without an open-licensed
   photo, license-restricted occurrences — declare the branded card and flip to
   `summary_large_image`. Updates the edge-handler tests and
   `e2e/og-previews.spec.ts`, which currently pin the text-only behavior.

What 019 got right and this record keeps:

- **An image only counts if platforms render it.** The card is 1200×630,
  comfortably above Facebook's 200×200 floor and matched to
  `summary_large_image`.
- **A real photo of the thing shared always wins.** The branded card is a
  fallback, never a replacement for the open-licensed occurrence photo or the
  rendered day/occurrence map cards.
- The `STATIC_ASSET_RE` carve-out serves the card bytes to crawlers.

## Consequences

- Once both rollout steps land, every shared link renders a rich card; none
  degrade to bare text. Until the edge handler follows, that holds for scrapes
  that read the static shell, and crawler-served cards stay text-only.
- The card must stay current with the brand. It is a brand asset rather than a
  screenshot, and it is built from a checked-in source
  ([docs/branding](../branding/README.md)), so a brand change regenerates it
  rather than orphaning it.
- Facebook's sticky image-verdict caching (019's runbook note) applies to the
  transition in reverse: text-only-scraped links may lag in picking up the card.
