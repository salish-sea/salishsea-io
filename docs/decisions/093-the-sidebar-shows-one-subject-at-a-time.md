# 093 — The map page's sidebar shows one subject at a time, drawn from its page's own data

**Status:** accepted · **Decided:** 2026-10-26 and 27, by Peter · **Work:** bd `salish-7ds1.1` (epic `salish-fwyt`) · **Builds on:** [057](057-profile-pages-are-prerendered.md) (profile pages are prerendered), [034](034-profile-urls-key-on-the-register-identifier.md) (profile URLs key on the register identifier)

## Context

Every link to an animal on the map page left the map. A chip on a sighting card, a designation in a sighting's text, a relative on a profile: each opened the animal's page, and the visitor had to find their way back to the day they were looking at. Several things Peter wants next need somewhere on the map page to show one thing in detail: a watershed's events and news (`salish-7ds1`), a hydrophone, a haul-out site. The sidebar already held the day's list, and only that.

A clickable mockup settled how it should behave (2026-10-26). People should mostly stay one level deep, so there is no trail of where they have been, only a way back. A sighting listed under a subject belongs to a day, so going to it changes the map's date rather than opening another view.

## Decision

**Every subject has a page and a sidebar view.** Animals and matrilines are the first. Watersheds, hydrophones, haul-out sites and the rest follow, each with both. What each view holds, and how much the sidebar's should differ from the page's, is design work still to come. For now the sidebar shows the page's own content.

**A link to a subject the sidebar can show opens it there,** in place of the day's list: a chip on a sighting card, a designation in a sighting's text, a relative or a matriline in another subject's view. A click with a modifier key, or with a button other than the first, opens the page as any link does.

**The view is drawn from the page's own data, with the page's own templates.** The read-path build writes each individual's and matriline's page data as `profiles/<kind>/<id>.json` beside the page and its `.links.json` ([`scripts/read-path/profiles.ts`](../../scripts/read-path/profiles.ts)). It keeps only the groups the templates look up, the chains above the subject's group and above each member's, and never a group's notes (D-21). Every individual and matriline page in the 27 October 2026 snapshot, 938 of them, renders identically from this data as from the full data. The site already serves that folder under `/read-path/`, so no server change is needed. The view ([`src/subject-view.ts`](../../src/subject-view.ts)) renders it with the page's templates, so the two can't drift apart. Two things differ from the page:

- **The small map is left out,** because the big map is beside it.
- **Sightings starts with "Last reported" and that sighting's full card,** the map's own, ahead of the table (Peter, 2026-10-27). "Last reported", or the card's dot, moves the map to that day and selects the sighting, which closes the subject.

**Navigation.**
- **Back names where it returns to:** the day, as in "‹ Sat, Oct 24", or the subject before.
- **No trail of earlier views.** Opening a relative from a subject nests, and Back steps out one level at a time.
- **Focus follows the view.** Opening a subject moves keyboard focus to its Back button, and closing it returns focus to the link it was opened from.
- **The subject is in the URL as `s=`,** as in `s=individuals/0010082`, with its slash left unescaped so a link reads like the page's own address. A link with `s=` opens the subject directly. The browser's Back leaves a subject opened on the page. Opened from a link, the sidebar's Back takes the subject out of the URL instead, so the browser's Back still leaves the site.

## Rejected

- **Fetching the prerendered page and lifting its sections out.** No build change, but the sidebar would depend on the page's markup, which nothing checks.
- **A trail of where the visitor has been.** People mostly stay one level deep, and Back already says where it goes (Peter, 2026-10-26).
- **A list of recent sightings that opens each one in the sidebar.** A sighting belongs to a day, so going to it changes the date (Peter, 2026-10-26).
- **A shorter sidebar view, designed separately, from the start.** Possibly later. The page's content is good enough for now (Peter, 2026-10-27).

## Consequences

- A data file is a few kilobytes: T037's is 4.6 KB. On the 27 October 2026 snapshot, the individuals' task peaked at 602 MB against 594 MB before, and its folder grew from 41 MB to 44 MB. Writing the whole table of groups into each file instead had cost 650 MB and 79 MB.
- The view keeps what it loaded while hidden, so Back to the same subject is instant, but an edit or a new build shows only once another subject is opened or the page is reloaded.
- Populations, pods and haul-out sites still open their pages until each gets a sidebar view.
- The full pages don't show the latest sighting's card: they are prerendered, and the card is a live component.
