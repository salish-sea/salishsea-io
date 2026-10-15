<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/branding/lockup-readme-dark.png">
    <img src="docs/branding/lockup-readme-light.png" alt="salishsea.io" width="420">
  </picture>
</p>

<p align="center">
  Whale sightings across the Salish Sea — an interactive map, a curated
  marine-mammal record, and a nightly DarwinCore Archive.
  <br>
  <a href="https://salishsea.io/">salishsea.io</a>
</p>

Welcome! This is a new project, started in 2025, to gather sightings and information about whales in the Salish Sea. There is a ton of useful and interesting information about this ecosystem that would reach a greater audience if it were all in one place and cross-referenced. Over time, we hope the site can develop into a place for the people who live in the region to come connect, deepen their understanding of the ecology, and fight to protect it.

This codebase was started by Peter Abrahamsen. My goals for the codebase are to keep it relatively light, nimble, and maintainable, minimizing the number of abstractions or volatile third-party dependencies. Right now, I'm using:
- [typescript](https://www.typescriptlang.org/) for better refactoring and quality control than vanilla JS
- [Stelis](https://github.com/rainhead/stelis), [DuckDB](https://duckdb.org/) and SQLite for building the site's data from its sources, and a small write API for what people submit
- [vite](https://vite.dev/) for building out assets
- [lit](https://lit.dev/) for templating and scoped styles
- [MapLibre GL](https://maplibre.org/) for drawing and interacting with a map in the browser ([decision 076](docs/decisions/076-the-map-moves-to-maplibre.md))
- [temporal-polyfill](https://www.npmjs.com/package/temporal-polyfill) for early access to the sane date/time manipulation interface [Temporal](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal)
- [turf](https://turfjs.org/) for a few GIS utility functions

They are (mostly) simple, fast, well-understood, long-lived, and easily-replaced projects appropriate to take as dependencies.

Most project planning currently happens on Zulip. You are welcome to join us there: https://orcasound.zulipchat.com/#narrow/channel/494032-salishsea-io

The visual identity above — the two-herring mark, the wordmark, and the pattern — was contributed by [Liam Reese](https://github.com/liamreese). Its sources and the script that derives every shipped asset from them live in [docs/branding](docs/branding/README.md).

## Setup

Prerequisites:
- `nvm` (or install the version of node from `.nvmrc` yourself)
- `pnpm` — the package manager for this repo, npm is not usable here
  ([decision 025](docs/decisions/025-pnpm-over-npm.md))

Prep the environment:
```
$ nvm install
$ nvm use
$ pnpm install
```

## Running

For development mode, run `pnpm dev`, with `READ_PATH_DIR` naming a read-path build's export directory: the site reads its sightings, calendar and profile pages from those files ([decision 056](docs/decisions/056-the-logged-out-read-path-is-built-as-static-files.md)), and without them the map has nothing to show.

Before committing, try building with `pnpm build`.

## Data sources

- [iNaturalist](https://www.inaturalist.org/) observations and taxonomy
- [Conserve](https://conserve.io) aggregates sightings from various places, including Orca Network's [Facebook group](https://www.facebook.com/groups/564701038927716)
- [Happywhale](https://happywhale.com) seems particularly tapped into the community, who add observations of various cetaceans
- The map page is drawn on our own basemap, [salish-sea/basemap](https://github.com/salish-sea/basemap), built from OpenStreetMap, NOAA, Natural Resources Canada and GEBCO and served from tiles.salishsea.io. The profile pages' maps, the ecotype page's small maps and the preview cards still use Esri's ocean basemap, until the basemap publishes image tiles ([decision 074](docs/decisions/074-the-basemap-is-its-own-project-and-the-cards-draw-on-it.md))
- Viewing locations are defined by [Orca Network](https://www.orcanetwork.org/)

## Data

The fetch reaches [Acartia](https://github.com/salish-sea/acartia/wiki/1.-Context-for-SSEMMI-&-Acartia#spatial-boundaries-related-to-acartia)'s boundaries — the full range of Southern Resident Killer Whales — but what we keep is narrower: killer whales from that whole range, everything else only from the Salish Sea and the Strait of Juan de Fuca ([decision 036](docs/decisions/036-ingest-scope-killer-whales-range-wide.md)). That rule is applied to Maplify and iNaturalist alike ([decision 044](docs/decisions/044-inat-ingest-scope.md)); HappyWhale ingest is off.

Geographic coordinates are decimal longitudes and latitudes with respect to WGS84. The map is drawn in Web Mercator ([EPSG:3857](https://spatialreference.org/ref/epsg/3857/)), the projection the basemap's tiles are in. UTM zone 10N ([EPSG:32610](https://spatialreference.org/ref/epsg/32610/)) was once considered, but MapLibre can't draw it and it fits only 126–120°W ([basemap decision 013](https://github.com/salish-sea/basemap/blob/main/decisions/013-the-tiles-are-in-web-mercator.md)).

Temporal coordinates are UNIX Epoch time—integer seconds since midnight, January 1, 1970, GMT. This format is widely supported, and allows for cheap calculation of intervals in SQL queries.

Occurrence records are published nightly as a [DarwinCore Archive](https://salishsea.io/dwca/) (with a GeoParquet sidecar and sha256 checksums). For how a sighting's provenance is tracked and how attribution appears in that archive — providers, collections, organizations, contributors, and what is included vs. excluded — see [docs/data-provenance.md](docs/data-provenance.md).

## Production deployment

The production environment consists of:
- The `salishsea-io` Fly app: the site, the read-path build that rewrites its data every five minutes, and the write API with its SQLite store ([runbook](docs/runbook/read-path-build.md))
- A Cloudfront distribution `EQ0KYC2Y6IUYU`
- An S3 bucket `salishsea-io` in `us-west-2` for assets
