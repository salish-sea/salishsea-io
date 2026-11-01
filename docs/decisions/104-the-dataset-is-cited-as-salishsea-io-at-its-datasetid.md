# 104 — The dataset is cited as SalishSea.io's, at the address every record already names, which is now its page

**Status:** accepted · **Decided:** 2026-11-01, by Peter · **Work:** bd `salish-8ws`, `salish-rine`

## Context

Neither the About page, the archive's metadata (`eml.xml`) nor [data-provenance.md](../data-provenance.md) told a researcher how to cite the Darwin Core archive. Datasets on GBIF normally carry a citation, and the archive's audience is the people who would write one. A citation needs two things the archive didn't settle: who it names as the author, and an address that leads somewhere. Every record's `datasetID` is `https://salishsea.io/datasets/occurrences-v1`, which returned 404. Separately, search engines' indexes of datasets (Google Dataset Search) find a dataset by a schema.org `Dataset` block on its landing page, and the archive had neither the block nor a page of its own: its downloads were a section of the About page (`salish-rine`).

## Decision

**The citation names SalishSea.io as the author**, as the archive's metadata already names it creator and every record names it `rightsHolder`. The recommended form is:

> SalishSea.io (*year*). SalishSea.io Marine Mammal Occurrences (v1.3). Darwin Core Archive, version of *date*. https://salishsea.io/datasets/occurrences-v1

The date is the day the reader downloaded the archive, because the build rewrites it as sightings arrive. Each `eml.xml` carries the citation filled in with the day it was built, in GBIF's `<citation>` element.

**The address is the `datasetID`, and it is now the archive's own page** (`dataset.html`, served there by `fly/Caddyfile`): what the archive holds and leaves out, its downloads, its licence, the citation, and a schema.org `Dataset` block for search engines. The About page's "Data download" section shrinks to a sentence that links it. One page about exactly this dataset is what a dataset index expects as the block's home, and it gives the identifier every record carries somewhere to lead.

The block names as `isBasedOn` the Whale Alert feed shared through Acartia and the animals register, not each organization the archive credits: that list follows the data (the archive's `eml.xml` credits only organizations with records in it), and a hand-kept copy would fall behind. If the archive is registered with GBIF (`salish-1bb`), its DOI goes into the block as `identifier` and `sameAs`, so that the index doesn't list GBIF's page and ours as two datasets.

## Rejected

- **Beam Reach as author.** It is the legal entity behind the site, but naming it would disagree with the creator and rights holder the archive already gives, or mean changing them.
- **Peter as a personal author.** It ties the dataset to one person rather than the project that publishes it.
- **The block on the About page, the `datasetID` redirecting there.** Less to build, but the canonical page would be a page about the whole site, and the identifier would land mid-page.
- **Citing the zip directly.** It lands a reader on a download rather than a description.
- **A w3id.org address for the dataset, now.** The namespace `w3id.org/salish-sea/` isn't merged yet ([perma-id/w3id.org#7039](https://github.com/perma-id/w3id.org/pull/7039)), and adding the dataset to that pull request would widen a review under way. Deferred rather than rejected: see the next section.

## Deferred: the w3id.org address

Peter asked whether the `datasetID` should use the `w3id.org/salish-sea/` namespace being registered for the animals register. It should: an identifier there outlives a change of domain or host, and with no GBIF registration planned soon there is no DOI to be the dataset's lasting identifier instead. Every citation printed with the `salishsea.io` address keeps it, so the move is worth making early. Once #7039 merges, a second w3id pull request adds `/salish-sea/datasets/occurrences-v1`, redirecting to this page; then the `datasetID`, the citation and the page's `@id` and `identifier` change to the w3id address together. The page stays at `https://salishsea.io/datasets/occurrences-v1` as the redirect's target and its own canonical URL. Tracked in bd `salish-a249`.

## Consequences

- The dataset's page and data-provenance.md give the citation. `src/dataset.test.ts` fails when the page's citation, its block's name, address, licence, box or downloads, or its description, no longer match the dataset row in `scripts/read-path/derive/dwc.sql`, `scripts/dwca/eml.ts` or the page's own text.
- The block's start date (2014-04-20, the archive's earliest record on 2026-11-01) is typed by hand; an older record added later would leave it short.
- A new version of the dataset (its title carries `v1.3`) changes the citation and the block with it.
