# 094 — The site follows Orcasound's typography, with a denser register for the sidebar

**Status:** accepted · **Decided:** 2026-10-27, by Peter · **Work:** bd `salish-hdhv` · **Amends:** the choice of Mukta made in `salish-74v6` (#781)

The rules themselves, with their reasons, are in the [style guide](../style-guide.md); this record says why we adopted them.

## Context

SalishSea.io was set in Mukta, the base face of orcasite's theme, which it named from the start but only began loading in #781. Each component set its own sizes: 16 of them, most between 11px and 17px, so text set side by side didn't match. A sighting card put its count (×4) at 13px beside its time at 12px. Some buttons, "Add a Sighting" among them, didn't take the page's font at all and drew in the browser's default.

Orcasound's [2023 brand guidelines](https://github.com/orcasound/orca-branding/blob/main/Orcasound-Brand-Guidelines-2023.pdf) (pages 5 and 6) name one typeface, Work Sans, in three weights with a role each: Light for paragraphs and descriptions, Regular for headings, labels and emphasis, Bold for titles. Orcasound's newer design system, which reconciles the guide with orcasite's theme and says the guide wins where they differ, adds Noto Sans Mono for machine values (times, coordinates, identifiers) and Material UI's type scale. None of Orcasound's own sites follows the guide yet: orcasite uses Mukta and Montserrat, and orcasound.net uses Cabin and Alegreya.

## Decision

**Work Sans, with weight carrying the hierarchy.** Running text is Light, labels, buttons, headings and emphasis are Regular, and only titles are Bold. Times and coordinates are Noto Sans Mono. Both are served from this site from the @fontsource packages, as Mukta was.

**One scale, defined once.** [`src/fonts.css`](../../src/fonts.css) defines the design system's sizes as custom properties (`--fs-h4` 34px, `--fs-h5` 24px, `--fs-h6` 20px, `--fs-body1` 16px, `--fs-body2` 14px, `--fs-caption` 12px, and `--fs-mono` 13px, the design system's size for mono, which looks as large as 14px Work Sans). Every component names a step; a shadow root inherits them as it inherits the font. A page's title is Bold at `--fs-h4`; a section's heading is Regular at `--fs-h6`, in sentence case, since the design system keeps capitals for the mobile menu.

**A denser register for the sidebar.** Orcasound's app is not content-heavy, so its system has nothing as dense as a day's sightings (Peter: "I wouldn't rule out extending that system to fit our needs"). Work Sans is about 15% wider than Mukta, and at the design system's sizes "Southern Resident killer whale" wrapped. Three departures:

- A sighting card is set at `--fs-body2`. Its name, count and standing are one run of text, so a long name has the count's room; the time keeps the heading's right edge on the first line, since the right-aligned times are what make the list read as a timeline (Peter).
- Text at 12px is Regular, not Light, which is too thin there, except a card's two source lines ("via Orca Network", "Added via Maplify"), which are Light in a darker grey so they read as thinner rather than paler and still pass WCAG AA on every card background.
- A link in running text needs a cue besides colour, since our blue is only 2.7:1 against our body text: a link to another of our pages is underlined, and a link that leaves the site ends in Material Symbols' "open in new" mark instead ([`src/icons.ts`](../../src/icons.ts)). Links that stand on their own (nav, chips, lists of names) have neither.

Tests in [`src/fonts.test.ts`](../../src/fonts.test.ts) hold every size to the scale, keep the families in `src/fonts.css`, and keep 12px text Regular unless its rule says why.

## Rejected

- **Keeping Mukta** to match orcasite: orcasite doesn't follow the guide either, and the guide is the brand.
- **Moving a card's count and time below a long name:** it keeps the name whole but breaks the timeline down the right edge (Peter).
- **Mono for the count:** a count is an observer's estimate and reads as part of the name, not a value a machine produced.
- **A paler grey for the source lines:** it takes them under 4.5:1 contrast.

## Consequences

- Over five sample days (223 sightings), no card's heading takes two lines; the cards are shorter than with Mukta at 16px.
- The header's labels sit on the wordmark's baseline at 0.25em below the middle, re-measured for Work Sans ([`src/salish-sea.ts`](../../src/salish-sea.ts)).
- The map's own labels are untouched: they come from the basemap's glyphs.
- The sighting form's labels "Observer location" and "Subject location" take two lines, since widening their column clipped the coordinates.
