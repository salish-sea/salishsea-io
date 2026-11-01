# 104 — The dataset is cited as SalishSea.io's, at the address every record already names

**Status:** accepted · **Decided:** 2026-11-01, by Peter · **Work:** bd `salish-8ws`

## Context

Neither the About page, the archive's metadata (`eml.xml`) nor [data-provenance.md](../data-provenance.md) told a researcher how to cite the Darwin Core archive. Datasets on GBIF normally carry a citation, and the archive's audience is the people who would write one. A citation needs two things the archive didn't settle: who it names as the author, and an address that leads somewhere. Every record's `datasetID` is `https://salishsea.io/datasets/occurrences-v1`, which returned 404.

## Decision

**The citation names SalishSea.io as the author**, as the archive's metadata already names it creator and every record names it `rightsHolder`. The recommended form is:

> SalishSea.io (*year*). SalishSea.io Marine Mammal Occurrences (v1.3). Darwin Core Archive, version of *date*. https://salishsea.io/datasets/occurrences-v1

The date is the day the reader downloaded the archive, because the build rewrites it as sightings arrive. Each `eml.xml` carries the citation filled in with the day it was built, in GBIF's `<citation>` element.

**The address is the `datasetID`, which now redirects to the About page's "Data download" section.** The redirect is temporary (302), so the address can later get a page of its own, such as the landing page a schema.org Dataset block would want (`salish-rine`), without browsers having cached a permanent redirect.

## Rejected

- **Beam Reach as author.** It is the legal entity behind the site, but naming it would disagree with the creator and rights holder the archive already gives, or mean changing them.
- **Peter as a personal author.** It ties the dataset to one person rather than the project that publishes it.
- **Citing the About page or the zip directly.** Either leaves the identifier every record carries leading nowhere. The zip also lands a reader on a download rather than a description.

## Consequences

- The About page and data-provenance.md give the citation; `src/about.test.ts` fails when the page's title or address no longer matches the dataset row in `scripts/read-path/derive/dwc.sql`.
- `fly/Caddyfile` redirects `/datasets/occurrences-v1`.
- A new version of the dataset (its title carries `v1.3`) changes the citation with it.
