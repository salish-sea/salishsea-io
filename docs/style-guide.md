# Style guide

How SalishSea.io sets text and links. Read it before changing anything a visitor sees. Each rule gives its reason, so a case it doesn't cover can be decided the same way. The values live in [`src/fonts.css`](../src/fonts.css) and [`src/icons.ts`](../src/icons.ts); [`src/fonts.test.ts`](../src/fonts.test.ts) fails a build that breaks the rules it can check. Why we follow Orcasound, and what was rejected: [decision 094](decisions/094-the-site-follows-orcasounds-typography.md).

Not yet covered: colour, spacing, and icons other than the link mark. Until they are, match what the component's neighbours do.

## The rules in brief

1. One typeface, Work Sans. Weight, not family, carries the hierarchy.
2. Light for running text, Regular for labels, buttons, headings and emphasis, Bold for a page's title.
3. Every size is a step of the scale. Never write a size in a component.
4. A list of records is set one step smaller than prose.
5. Text at 12px is Regular, except text meant to be passed over, which is Light in a darker grey.
6. Values a machine produced (times, coordinates) are Noto Sans Mono at `--fs-mono`. Counts and estimates are not.
7. Headings are in sentence case. Capitals only for a kicker, the label above a page's title.
8. Links are coloured, not underlined. A link that leaves the site opens a new tab and ends in the "open in new" mark.

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

These are Orcasound's (Material UI's) steps, plus `--fs-mono`. Text set side by side takes the same step: a sighting's count and the time beside it once differed by a pixel, and it showed. If nothing fits, the design is asking for a new step; add it to `src/fonts.css` with its reason, rather than writing a size in place.

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

A link is blue (`#1976d2`) and not underlined; it is underlined on hover. In grey secondary text, a link takes the text's grey and turns blue on hover.

Why: underlines in dense text add weight and clutter. Colour marks a link in running text. Where colour can't (grey text), and wherever a link leaves the site, the "open in new" mark does: `offsiteLinkStyles` in `src/icons.ts` adds it to every link with `target="_blank"` and text. A link to a page on SalishSea.io opens in the same tab and has no mark. A component with such links includes `offsiteLinkStyles`, as `src/obs-summary.ts` and the profile pages' styles do; a plain HTML page copies the rule, as `about.html` does.
