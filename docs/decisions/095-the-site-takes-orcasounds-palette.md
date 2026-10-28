# 095 — The site takes Orcasound's palette, adjusted to pass contrast, and names its colours by role

**Status:** accepted · **Decided:** 2026-10-27, by Peter · **Work:** bd `salish-0v8h` · **Follows:** [094](094-the-site-follows-orcasounds-typography.md) (Orcasound's typography)

The rules themselves, each with its reason, are in the [style guide](../style-guide.md#colour-rules-9-and-10); this record says why we chose them.

## Context

About 70 colour values were written into 27 files. They came from three places: Material UI's blues (`#1976d2`), Tailwind's slate greys, and Vite's starter template (`#213547` for body text), with orcasite's navy (`#080D26`) for the header. Several did one job in different shades: seven near-blacks for text, eight border greys, two blues for "selected". Text at `#94a3b8` was 2.6:1 on white. The sighting form's fields named `var(--slate-300)`, which nothing defines, so they had no border at all.

Orcasound's palette has Orca Black, Deep Blue and white as primaries, with Seal Grey, Kelp Green and Pacific Teal as accents; its design system puts links and buttons in Deep Blue and dark surfaces in Orca Black with Kelp Green.

## Decision

**Colours are named by role** (`--color-text`, `--color-primary`, `--color-border-field`, …) in [`src/site.css`](../../src/site.css), and components name the role. Colours that encode data (the map's symbols, the calendar's activity, a profile's presence table) keep their values in place and say so.

**The palette is Orcasound's, adjusted where it fails contrast.** Peter chose it from three rendered side by side: today's, Orcasound's as written, and this one ("C is fine, I don't feel strongly").

- Text and the header are Orca Black; the current page is marked in Kelp Green.
- Links, buttons, focus rings and selections are Pacific Teal darkened to `#1f7893`, the lightest that passes 4.5:1 on every background text sits on. Deep Blue is the hover.
- Muted text is a slate grey, since Seal Grey is 2.8:1 on white.
- Orcasound's error, warning and success colours are darkened to pass as text; the originals are kept for borders.
- A field's edge is 3:1, by WCAG 1.4.11; outlined buttons, which their label identifies, keep a lighter edge.

**Space and corners follow Orcasound's grid,** relaxed for density: 8px between components, 4px inside one, 2px on a dense line; corners of 4px and 8px. Spacing written before the rule is converted when its component next changes, rather than all at once (Peter, 2026-10-27).

[`src/style-guide.test.ts`](../../src/style-guide.test.ts) checks the palette's contrast from `src/site.css`, that no component writes an interface colour, that every `var()` names a defined property, and the steps of space and corners.

## Rejected

- **Orcasound's palette as written:** Deep Blue is 1.5:1 against black text, so in a list of names (a matriline's members) the links can't be told from the name that isn't one.
- **Keeping Material UI's blue and the slate text:** it works, but nothing ties it to Orcasound.
- **Converting all spacing now:** about 70 values, each moving the sidebar by a pixel or two, for no visible gain.

## Consequences

- The site's blue becomes teal everywhere: links, buttons, the calendar's selected day and its activity dots, a profile's presence table.
- The sighting form's fields have visible edges for the first time.
- The maps drawn on profile and species pages keep their blue dots; whether they follow is a question for the map's own symbology ([029](029-map-symbology.md)).
