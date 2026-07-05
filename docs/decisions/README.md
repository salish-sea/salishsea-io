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
