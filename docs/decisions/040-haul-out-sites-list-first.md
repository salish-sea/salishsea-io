# 040 — Haul-out sites are a list we hold, not clusters we compute; each gets a page

**Status:** accepted · **Decided:** 2026-09-11 · **Context:** GitHub [#385](https://github.com/salish-sea/salishsea-io/issues/385) (haul-out clustering), [#453](https://github.com/salish-sea/salishsea-io/issues/453) (map layer toggle) · **Extends:** [027](027-marine-mammal-scope-whale-centric-identity.md) (haul-out clustering filed as the pinniped-shaped analogue of a segment)

## Decision

A **haul-out site** is a first-class row in our own database (`public.haulouts`): a name, a point, a radius, and what the reference literature says about it. The list is seeded from the WDFW atlas ([Jeffries et al. 2000](https://github.com/user-attachments/files/31973228/Jeffries%2B2000.pdf)) and extended by hand. A pinniped report belongs to a site when it falls within the site's radius (`public.haulout_occurrences`). Each site gets a page at `/haulouts/<id>/<slug>`, shaped like the individual and matriline pages.

Unsupervised clustering, which #385 opened with, is deferred. When it comes, its job is to *propose* sites the list lacks, and to flag listed sites the reports never touch. It does not replace the list.

Otters are out. A river otter's latrine or den is not a haul-out, and sea otters number in the dozens here. Both wait for their own treatment.

## Why

**Building pages first answers the clustering question by default.** A page needs a name, a stable identifier, and a footprint, and a cluster has none of those until a person gives it them. The atlas already has them for 370 sites across Washington and the southern Strait of Georgia: names, coordinates, species, a peak-count class, tidal use, a sentence of description. Starting from it costs a spreadsheet import. Starting from clustering costs an algorithm, a naming pass, and a reconciliation against the same atlas afterwards, which is what #385's first open question asked for anyway.

**Attribution by radius is a view, not an algorithm.** With a site list, "which reports belong here" is a spatial join. That is honest about what it claims: this report was made within a few hundred metres of a known site. It makes no claim about which animals, or how many, which is exactly the claim [027](027-marine-mammal-scope-whale-centric-identity.md) says we cannot make for pinnipeds.

**What the data supports, measured in production 2026-09-11.** The iNaturalist mirror holds about 14,500 pinniped reports since 2025-01-01, so a page has roughly twenty months of history and the four-year presence grid the other profile pages draw would be mostly blank. Only 10% of reports carry any text and 2% mention a count, so animal counts cannot be derived and are not shown. Nearly every report (97%) carries an openly licensed photo, so photos are the content. About 60% of reports state a positional accuracy of 100 m or better and 5% state none, which is why a page separates reports it is confident about from ones it is not.

```text
Shilshole Bay, within 1.2 km of the marina, since 2025-01:
  97 reports from 46 observers
  California sea lion, harbor seal, Steller sea lion
  36 sea lion reports in April and May 2026; one or two a month otherwise
```

That seasonal spike is what a page makes legible and the map does not.

**The atlas is a 1999 survey, and that is a feature.** Comparing what it recorded against what people report now is the page's most interesting content: a site the atlas lists that nobody has reported at in twenty months is a finding. The Shilshole north jetty, listed in the atlas, has not held a sea lion in five years of weekly observation (Scott Veirs, #385).

## Shape

**Site.** `name`, `location` (a point; the atlas gives NAD27 coordinates, offset up to about 200 m from WGS84, and no site is precise enough for that to matter), `radius_m` (500 by default, tuned per site), `region` (the atlas's fourteen), and the atlas fields verbatim: `atlas_code`, `atlas_species`, `atlas_count`, `atlas_tidal_use`, `atlas_description`. The atlas lists some sites at more than one point (Desdemona Sands has three); each point is a row, and rows sharing an `atlas_code` are shown as one another's neighbours. `verified` is false until a person has checked the row against the atlas; the spreadsheet the seed comes from was machine-extracted from the PDF and Scott has offered to proof it. `story` holds our own curated prose in Markdown, for the narrative, viewing access and links to survey reports that #385 asks for.

**Attribution.** `public.haulout_occurrences` joins `public.occurrences` to sites: pinniped taxa only, within `radius_m` of the point. It exposes the report's stated accuracy so the page can label a report whose accuracy exceeds the radius as approximately located. Reports with obscured coordinates never reach the mirror at their true position and are simply absent.

**Seed.** The atlas regions inside the site's coverage (regions 6 to 14: the Strait of Juan de Fuca, Hood Canal, the eastern bays, Puget Sound, the San Juans, and the Canadian side to Race Rocks). The Pacific coast and the Columbia are out of scope per [036](036-ingest-scope-killer-whales-range-wide.md).

**URL.** `/haulouts/<id>/<slug>`, the id-plus-slug shape of [034](034-profile-urls-key-on-the-register-identifier.md), except the key is our own integer rather than a register identifier: haul-out sites are not animals and the register does not hold them. Only the id is read; the slug is composed from the name. Resolved at the edge and rewritten to `haulout.html`, fail-open, as [015](015-individual-profile-pages.md) describes.

**Page.** Masthead (name, region, species seen, report and observer counts, first and last report), a map centred on the site, an "In the atlas" section with the 1999 record, one presence grid per species trimmed to the years we cover, a photo strip and report list, a coverage note, the story when there is one, and neighbouring sites.

## Rejected

- **Clustering first.** See above: it produces the same list, later, with more work.
- **A static GeoJSON asset, like the Orca Network viewing locations.** Attribution needs a spatial join against 14,500 reports, which is a database job. The map layer (#453) can still be fed from the table.
- **A polygon footprint.** Nothing we hold is precise enough to draw one, and a point plus radius is what the atlas gives. Revisit when WDFW's drone surveys publish outlines.
- **Widening the radius by each report's stated accuracy.** A report with 5 km accuracy would then attach to every site along a shoreline. Strict radius, accuracy shown.
- **Counting animals from report text.** 2% of reports mention a count; the rest would be silence presented as zero.

## Consequences

- A new table and view with SELECT grants in the same migration; the pinned set in `supabase/read-grants.test.ts` grows by two.
- The edge handler gains a fourth profile family whose key pattern differs from the register's.
- Curated `story` text is the first prose we hold that is neither a nickname fact nor a sighting; it is ours, so no rights question arises, but it needs an editing path that does not yet exist (a migration, for now).
- #385 stays open for the clustering that proposes new sites; #453 carries the map layer.
