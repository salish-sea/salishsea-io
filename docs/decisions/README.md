# Decision Records

Product and technical decisions with rationale and rejected alternatives. Add a new numbered record when a decision is made; mark superseded records rather than deleting them.

| # | Decision | Status |
|---|----------|--------|
| [001](001-product-framing.md) | Two audiences, web-first, cetaceans only, Google-only auth | accepted (scope superseded by 009) |
| [002](002-static-spa-edge-architecture.md) | Static SPA on S3/CloudFront; Lambda@Edge for crawler-facing behavior | accepted |
| [003](003-dwc-export-pipeline.md) | DwC-A export: view-as-contract, hybrid TS+DuckDB, nightly publication | accepted |
| [004](004-rights-and-licensing.md) | Policy-first rights gate; per-source licenses ([full policy](../rights-policy.md)) | accepted |
| [005](005-export-exclusion-src-01.md) | SRC-01: iNaturalist and HappyWhale modeled but not exported | accepted |
| [006](006-provenance-graph.md) | Provenance graph: provider · collection · organization · contributor | accepted |
| [007](007-community-uptake-strategy.md) | Community uptake: partnership-first with Orca Network | proposed |
| [008](008-source-schemas-are-upstream-mirrors.md) | Source schemas are verbatim upstream mirrors (anti-corruption layer) | accepted |
| [009](009-taxonomic-scope-marine-mammals.md) | Taxonomic scope: PSEMP Marine Mammal Working Group (supersedes 001 scope) | accepted |
| [010](010-fresh-codebase-vs-acartia.md) | SalishSea.io is a fresh codebase, not an extension of acartia.io | accepted |
| [011](011-ingest-imperative-shell.md) | Network ingest as a TypeScript imperative shell over a functional core | accepted |
| [012](012-ingest-heartbeat.md) | Ingest heartbeat: external observer via scheduled GitHub Action | accepted |
| [013](013-orcasound-acoustic-occurrences.md) | OrcaSound acoustic occurrences from curated biophony bouts, identified by upstream tags (amended 2026-08-14: identifications arrive typed) | accepted (our side); pending upstream adoption |
| [014](014-trust-and-curation-model.md) | Trust & curation: claims have status, people have reputation, curators assert both | proposed (direction) |
| [015](015-individual-profile-pages.md) | Individual profile pages at `/individuals/<designation>` | accepted (amended by 034) |
| [016](016-matriline-profile-pages.md) | Matriline profile pages | accepted (amended by 034) |
| [017](017-ecotype-profile-pages.md) | Ecotype profile pages | accepted (amended by 034) |
| [018](018-inat-id-keyset-pagination.md) | iNaturalist ingest paginates by id-keyset, not page number (amends 011) | accepted |
| [019](019-no-fallback-preview-image.md) | No fallback link-preview image: `og:image` only for a photo of the thing shared | superseded by 026 |
| [020](020-map-preview-cards.md) | Map-rendered link preview cards; Esri basemap, day cards, basemap sourcing | accepted |
| [021](021-calendar-date-picker.md) | Calendar date picker; day circles sized by sighting volume, live `occurrence_days` view | accepted |
| [022](022-regions-filter-data.md) | Regions filter the data (map, list, calendar); map outside the active region is shaded | accepted |
| [023](023-region-framing-vs-filtering.md) | A region's framing is not its filter; frame the region on load (supersedes part of 022) | accepted |
| [024](024-deploy-gating-and-alerting.md) | Deploys gate on the full test suite, verify themselves, and alert by labeled issue | accepted |
| [025](025-pnpm-over-npm.md) | pnpm replaces npm; `infra/` is a separate pnpm project | accepted |
| [026](026-branded-fallback-preview-image.md) | Branded fallback link-preview image: the brand card where no image of the thing shared exists | accepted |
| [027](027-marine-mammal-scope-whale-centric-identity.md) | Marine-mammal scope, whale-centric identity; PSEMP is a boundary, not a data source (extends 009) | accepted |
| [028](028-salishsea-io-speaks-to-orcasound.md) | SalishSea.io is the single voice recommending an identification schema to OrcaSound | accepted |
| [029](029-map-symbology.md) | Map symbology: colour carries the taxon, labels carry the specifics; uncertainty not encoded | accepted |
| [030](030-google-signin-nonce.md) | Google sign-in carries a real nonce; GSI configured in code, not markup | accepted |
| [031](031-surfacing-failures.md) | Failures reach the user through one toast, and Sentry through the same call | accepted |
| [032](032-retired-taxa-resolved-on-read.md) | A retired taxon is resolved on read, not rewritten on write (applies 008) | accepted |
| [033](033-register-names-the-animals.md) | The register names the animals, we compose the display (applies 008, extends 029) | accepted |
| [034](034-profile-urls-key-on-the-register-identifier.md) | A profile URL keys on the register identifier; the designation is a slug (amends 015, 016, 017) | accepted, not yet implemented |
