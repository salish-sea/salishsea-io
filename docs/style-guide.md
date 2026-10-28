# Style guide

How SalishSea.io sets text, links, colour and space. Read it before changing anything a visitor sees. Each rule gives its reason, so a case it doesn't cover can be decided the same way. The values live in [`src/site.css`](../src/site.css), and the link rule in [`src/icons.ts`](../src/icons.ts) as well; [`src/style-guide.test.ts`](../src/style-guide.test.ts) fails a build that breaks the rules it can check. Why we follow Orcasound, and what was rejected: [decision 094](decisions/094-the-site-follows-orcasounds-typography.md).

Not yet covered: icons other than the link mark, and motion. Until they are, match what the component's neighbours do.

## The rules in brief

1. One typeface, Work Sans. Weight, not family, carries the hierarchy.
2. Light for running text, Regular for labels, buttons, headings and emphasis, Bold for a page's title.
3. Every size is a step of the scale. Never write a size in a component.
4. A list of records is set one step smaller than prose.
5. Text at 12px is Regular, except text meant to be passed over, which is Light in a darker grey.
6. Values a machine produced (times, coordinates) are Noto Sans Mono at `--fs-mono`. Counts and estimates are not.
7. Headings are in sentence case. Capitals only for a kicker, the label above a page's title.
8. A link in running text is underlined, or, if it leaves the site, ends in the "open in new" mark instead. A link that stands on its own is neither. A link that leaves the site opens a new tab.
9. A component names a colour's role (`var(--color-text-muted)`), never its value. Only a colour that encodes data says its value, and says why.
10. Text a visitor must read is at least 4.5:1 against every background it can sit on (white, the pale grey, and the teal and grey washes); a field's edge, at least 3:1.
11. Space between components is a multiple of 8px; space inside one, a multiple of 4px, or of 2px on a dense line. Corners are 4px for a control, 8px for a card or dialog, round for a pill or a dot.
12. Anything a visitor taps is at least 44px each way.

## Typeface and weight

Work Sans, from Orcasound's brand, in three weights:

| Weight | For | Why |
|---|---|---|
| Light 300 | running text: paragraphs, a sighting's comment, descriptions; the page default | The text a visitor reads at length should be the quietest, so labels and headings stand out from it by weight alone. |
| Regular 400 | labels, buttons, form fields' labels, section headings, `<b>` and `<strong>` | One step up from the running text is enough to mark something to act on or to find. |
| Bold 700 | a page's title, or a subject's name heading its view in the sidebar; today on the calendar | Reserved so it means "the one thing on this screen". Bold at text size reads as shouting. |

A component never names a typeface: it inherits Work Sans, or asks for `var(--font-mono)`. A button or input doesn't inherit a font by default, so give it `font-family: inherit` (it then takes Regular, the browser's default weight for controls).

## Sizes

| Property | Size | For |
|---|---|---|
| `--fs-h4` | 34px | a page's title |
| `--fs-h5` | 24px | the sidebar's title; a subject's name in the sidebar |
| `--fs-h6` | 20px | a section's heading |
| `--fs-body1` | 16px | prose: the about page, profile pages |
| `--fs-body2` | 14px | a list of records (rule 4); secondary text beside prose; most buttons |
| `--fs-caption` | 12px | attribution, hints, field errors, table headings |
| `--fs-mono` | 13px | times and coordinates (rule 6) |

These are Orcasound's (Material UI's) steps, plus `--fs-mono`. Text set side by side takes the same step: a sighting's count and the time beside it once differed by a pixel, and it showed. If nothing fits, the design is asking for a new step; add it to `src/site.css` with its reason, rather than writing a size in place.

## A list of records is set smaller than prose (rule 4)

The day's sightings are a list a visitor scans, comparing one record with the next, rather than reads. A sighting card is set at `--fs-body2`, its name in Regular and its comment in Light.

Why: scanning wants more records on a screen and each record's heading on one line, so the eye can run down a column. The right-aligned times make the list a timeline. Orcasound's app shows one feed at a time and never needed this. At 16px, Work Sans, about 15% wider than the Mukta it replaced, wrapped "Southern Resident killer whale" in the sidebar; at 14px no heading wraps (223 sightings over five days).

On one heading line, the name, count and standing are one run of text, and the time keeps the line's right edge. When something has to give, the run wraps and the time stays put.

## Small text (rule 5)

Text at `--fs-caption` is Regular. Light's stroke is 0.05em, 0.6px at 12px, which anti-aliasing turns grey; Regular's is 0.08em, about 1px. At 14px and up, words are read by their shape, and Light holds; at 12px, text is read letter by letter (a hint, a number, an error), so it needs the stroke.

The exception is text meant to be passed over, like a sighting card's attribution ("via Orca Network", "Added via Maplify"). Such text has to be quieter than the Light comment above it, and the other ways to quieten it are used up: it is already the smallest size, and a paler grey would take it under 4.5:1 contrast (WCAG AA). So it is Light, in a darker grey (`#475569`, 6.6:1 or better on every card background), and reads as thinner rather than paler. The rule's CSS says "Light at 12px" and why; the test accepts nothing else.

## Values (rule 6)

Times and coordinates are Noto Sans Mono, at `--fs-mono`. Its digits are all one width, so times line up down the list and a coordinate reads as something to copy exactly. Its lowercase letters are 9% taller than Work Sans's, so 13px mono matches 14px Work Sans (both 7px tall).

A count is not mono: "×27" is someone's estimate of what they saw, part of the name, not a value a machine produced. A date written out ("Tue, Oct 20, 2026") is prose, not mono.

## Headings and capitals (rule 7)

Headings are in sentence case. Capitals, letter-spaced 0.08em, are kept for a kicker, the label above a page's title naming what kind of thing the page is ("Species"). Capitals elsewhere are harder to read and compete with the title.

## Links (rule 8)

A link is blue (`#1976d2`). Inside running text, colour alone doesn't mark it: our blue is only 2.7:1 against our body text (`#213547`), and WCAG asks for 3:1 or a cue besides colour. No blue reaches 3:1 against that text while keeping 4.5:1 against white, so the cue is an underline, or the mark:

- **A link to another page of SalishSea.io, in running text,** is underlined, a little below the baseline (`text-underline-offset: 0.15em`): "Biggs T65A5" in a sighting's comment, "Last reported October 27" on a profile.
- **A link that leaves the site** opens a new tab and ends in Material Symbols' "open in new" mark instead of an underline, so the visitor knows they are leaving; it is underlined on hover. In grey secondary text, such as a card's "via Orca Network", it takes the text's grey, turns blue on hover, and the mark alone says it is a link.
- **A link that stands on its own,** where its place says it is a link (the nav, a chip, a heading, a list of names, a button-like "Open the full page →"), has no underline and no mark. Its rule sets `text-decoration: none`.

`linkStyles` in `src/icons.ts` sets the first two for a component; include it, as `src/obs-summary.ts`, `src/obs-panel.ts` and the profile pages' styles do. `src/site.css` sets them for the plain pages, outside any shadow root, and a test keeps its mark the same as `src/icons.ts`'s.

## Colour (rules 9 and 10)

Every colour is a custom property in `src/site.css`, named by its role. A component names the role, so a change of palette is one edit and two shades can't drift apart doing one job; a test fails a component that writes a colour of its own. The palette is Orcasound's where it passes the contrast rule (rule 10), and adjusted where it doesn't:

| Role | Value | Why |
|---|---|---|
| `--color-text` | Orca Black | Most contrast for Light, the thinnest weight. |
| `--color-text-secondary`, `--color-text-muted` | slate `#475569`, `#607086` | Orcasound's only grey, Seal Grey, is 2.8:1 on white: too light for text. The muted grey is the lightest slate that passes on the washes as well as on white. |
| `--color-text-disabled` | `#cbd5e1` | A disabled control is exempt from the contrast rule, and should look unavailable. |
| `--color-primary` | `#1f7893`, Pacific Teal darkened | One colour for everything a visitor can act on: links, buttons, the focus ring, a selection. It is the lightest Pacific Teal that passes 4.5:1 on every background a link sits on, and it is 4.2:1 against black text, so a link reads as one by colour as well as by its underline; white on it, for a button's label, is 5.0:1. Deep Blue, Orcasound's choice for links, is 1.5:1 against black text: a link in it is told apart by nothing but its underline, and a list of names can't show which are links. |
| `--color-primary-hover` | Deep Blue | Darker on hover, as the brand's other blue. |
| `--color-primary-tint` | `#eff7f7`, Kelp Green at 18% | Behind a selection or a highlighted card. Light enough for teal text on it to pass 4.5:1. |
| `--color-chrome`, `--color-chrome-accent` | Orca Black, Kelp Green | The header and the controls that float over the map; Kelp Green, 12.8:1 on black, marks the current page. Orcasound's own pairing for dark surfaces. |
| `--color-border` | black at 12% | Dividers and cards: hairlines, not boxes, as Orcasound has them. |
| `--color-border-strong` | black at 32% | Outlined buttons and chips. Their label shows they are there, so their edge needn't pass 3:1. |
| `--color-border-field` | `#7f8ca0` (3.4:1 on white, 3.0:1 on the form's grey) | An empty field shows nothing but its edge, so its edge is the one border held to 3:1 (WCAG 1.4.11). |
| `--color-error`, `--color-warning`, `--color-success` | `#d81f2b`, `#9f5e22`, `#007f48` | Orcasound's state colours, darkened just enough to pass 4.5:1 as text on every background: as given they are 4.4:1, 2.3:1 and 2.3:1 on white, and a field's error sits on the form's grey. The originals are `--color-error-border` and `--color-warning-border`, for borders, which carry no text. |
| `--color-surface`, `-subtle`, `-tint`, `--color-fill`, `--color-scrim` | white; pale greys; black at 40% | Backgrounds, from the page to a hovered row to the shade behind a dialog. |

**Data colours** are not interface colours: the map's symbols for each kind of animal ([`src/symbology.ts`](../src/symbology.ts), [decision 029](decisions/029-map-symbology.md)), the maps drawn on profile and species pages, and encodings such as the calendar's activity dots and a profile's presence table. They keep their values in place, with a comment saying "data colour" and why. Where an encoding echoes the interface, it takes the interface's teal: the calendar's dots, and the presence table's steps (teal over white at 15%, 30% and 50%).

## Space and corners (rules 11 and 12)

Space is written in `rem` (or `px` for a hairline nudge), never named: unlike a colour, a step of space has no role beyond its size, so a name would only hide the number.

- **Between components and sections: multiples of 8px** (`0.5rem`, `1rem`, `1.5rem`, `2rem`, …). Orcasound's grid; a coarse step keeps the rhythm of a page visible.
- **Inside a component: multiples of 4px,** because 8px is too coarse beside 14px text on a 21px line. **2px** is allowed where a dense line needs it or to align something optically: the gaps on a sighting card's heading are 6px, because 8px wraps "Southern Resident killer whale ×27" and 4px crowds it.
- **Corners:** 4px for a control (a button, a field), 8px for a card or a dialog (Orcasound's two), `999px` for a pill (a region button, a chip), `50%` for a dot.
- **Touch targets:** 44px each way at least, by padding or by `min-height`/`min-width`, even where the visible control is smaller (a card's "…" button is 44px around a 20px mark).

The test holds every margin, padding and gap to whole steps of 2px, and every corner to the four above. Values written before the rule, which it lists, are converted when their component is next changed; the list only shrinks. Whether a gap sits between components or inside one, the test can't tell, so the 8px rule is the reviewer's.

