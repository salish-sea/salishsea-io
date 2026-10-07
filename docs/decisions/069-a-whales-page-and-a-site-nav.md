# 069 — A whales page lists the cetacean species, and every page carries a nav to it

**Status:** accepted; built · **Decided:** 2026-10-06 · **Context:** bd `salish-nkbq` · **Amended by:** [070](070-southern-residents-are-generated-from-the-register.md) (the whales page lists populations' top pages, not ecotypes') · **Builds on:** [067](067-the-ecotype-page-compares-matrilines-with-small-maps.md) (the small maps), [057](057-profile-pages-are-prerendered.md) (prerendered pages), [009](009-taxonomic-scope-marine-mammals.md) (taxonomic scope)

## Context

The site had two ways in: the map, and a profile page someone linked to. Nothing said which animals it covers, or how often each is reported. The only links between pages were the map's ⓘ to About, and "Back to the map" on About and the profile pages.

## Decision

**A page at `/whales` lists every cetacean species someone has reported to us, most-reported first.** Each species shows its common and scientific names, how many reports, when it was last reported (linking to that day on the map), and a small map of where, at decision 067's shared scale. Killer whale also lists its ecotypes that have pages: Bigg's today, and Southern Residents once #511 lands. Species have no pages of their own yet. A line at the end counts the reports that name a cetacean only as a group, such as "baleen whale".

- **Cetaceans only**, as the name says. Our scope is all marine mammals (009), but seals, sea lions and otters would need a page under another name.
- **What a cetacean is comes from the register:** a taxon of species rank whose lineage (`register.taxon_ancestor`) reaches Cetacea (`SSA:0000934`). The build now loads that table with the rest of the register. `register.classification` stops at order, and a whale's order is Artiodactyla, which deer share.
- **A report counts toward its species when it names the species or something beneath it.** A report of the Southern Residents reaches killer whale through `register.ancestor`.
- **Counts differ in scope by species, and the page says so.** Killer whale reports come from their whole range, central California to northern British Columbia, and every other species' only from the Salish Sea ([036](036-ingest-scope-killer-whales-range-wide.md)).
- **Prerendered by the read-path build** ([`scripts/read-path/whales.ts`](../../scripts/read-path/whales.ts)), a task of its own that reads every occurrence. Until the first build has run, Caddy serves the shell, which says the list isn't ready.
- **On a busy map each dot is drawn fainter** (in [`src/small-multiples.ts`](../../src/small-multiples.ts)): above 1,500 reports, by the square root of how many more. Without that, the 22,000 killer whale reports turn the map solid black. Every matriline map has fewer reports than that, so the ecotype page is unchanged.

**Every page carries the nav, About · Map · Whales** ([`src/site-nav.ts`](../../src/site-nav.ts)). It replaces the map header's ⓘ link and the "Back to the map" link on About and the profile pages, and the current page is marked. About is plain HTML, so it carries the same markup by hand, and a test holds the two together. Its script still points the Map link at the map view the visitor came from.

## Rejected alternatives

- **All marine mammals on one page.** It would answer a broader question than "whales", under a name that no longer fits.
- **Species pages now**, prerendered like the ecotype page. They're a larger change, and the list is useful without them.

## Consequences

- Every save's build now also rewrites the whales page, because it reads every occurrence.
- ~~When Southern Residents get a page, killer whale links to it with no further change: the list shows every ecotype that has a page.~~ *Amended by [070](070-southern-residents-are-generated-from-the-register.md) (2026-10-07):* the Southern Residents' top page is their community's, not an ecotype's, so a list of ecotypes would miss it. The list shows each population's top page instead, an ecotype's or a community's, under a label to match ("Populations: Bigg's · Southern Residents"). That change lands with the Southern Residents' pages (`salish-lzi`).
