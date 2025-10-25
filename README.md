# salishsea-io
Salish Sea Data Explorer

Welcome! This is a new project, started in 2025, to gather sightings and information about whales in the Salish Sea. There is a ton of useful and interesting information about this ecosystem that would reach a greater audience if it were all in one place and cross-referenced. Over time, we hope the site can develop into a place for the people who live in the region to come connect, deepen their understanding of the ecology, and fight to protect it.

This codebase was started by Peter Abrahamsen. My goals for the codebase are to keep it relatively light, nimble, and maintainable, minimizing the number of abstractions or volatile third-party dependencies. Right now, I'm using:
- [typescript](https://www.typescriptlang.org/) for better refactoring and quality control than vanilla JS
- [supabase](https://supabase.com/) for storing and projecting data, and storing and serving user-uploaded photos
- [vite](https://vite.dev/) for building out assets
- [lit](https://lit.dev/) for templating and scoped styles
- [openlayers](https://openlayers.org/) for drawing and interacting with a map in the browser
- [temporal-polyfill](https://www.npmjs.com/package/temporal-polyfill) for early access to the sane date/time manipulation interface [Temporal](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal)
- [turf](https://turfjs.org/) for a few GIS utility functions

They are (mostly) simple, fast, well-understood, long-lived, and easily-replaced projects appropriate to take as dependencies.

Most project planning currently happens on Zulip. You are welcome to join us there: https://orcasound.zulipchat.com/#narrow/channel/494032-salishsea-io

## Setup

Prerequisites:
- `nvm` (or install the version of node from `.nvmrc` yourself)
- `docker`

Prep the nvironment:
```
$ nvm install
$ nvm use
$ npm ci
```

## Running

Control the Supabase local stack with e.g.: `npx supabase start`.

For development mode, run `node run dev`.

Before committing, try building with `node run build`.

## Data sources

- [iNaturalist](https://www.inaturalist.org/) observations and taxonomy
- [Conserve](https://conserve.io) aggregates sightings from various places, including Orca Network's [Facebook group](https://www.facebook.com/groups/564701038927716)
- [Happywhale](https://happywhale.com) seems particularly tapped into the community, who add observations of various cetaceans
- ESRI provides a nice but unmaintained base map with coarse ocean depth
- Viewing locations are defined by [Orca Network](https://www.orcanetwork.org/)

## Data

The scope of data is meant to match those of [Acartia](https://github.com/salish-sea/acartia/wiki/1.-Context-for-SSEMMI-&-Acartia#spatial-boundaries-related-to-acartia), which is meant to capture the full range of Southern Resident Killer Whales.

Geographic coordinates are decimal longitudes and latitudes with respect to WGS84. The projection is [EPSG:3857](https://spatialreference.org/ref/epsg/3857/) (Pseudo-Merctaor). Switching to [EPSG:32610](https://spatialreference.org/ref/epsg/32610/) (UTM 10N) might be nicer, but would require custom raster maps.

Temporal coordinates are UNIX Epoch time—integer seconds since midnight, January 1, 1970, GMT. This format is widely supported, and allows for cheap calculation of intervals in SQL queries.

## Production deployment

The production environment consists of:
- A [Supabase project](https://supabase.com/dashboard/project/grztmjpzamcxlzecmqca)
- A [Cloudfront distribution](https://648183724555-rvfskklb.us-east-1.console.aws.amazon.com/cloudfront/v4/home?region=us-east-1#/distributions/EQ0KYC2Y6IUYU)
- An [S3 bucket](https://648183724555-rvfskklb.us-west-2.console.aws.amazon.com/s3/buckets/salishsea-io?region=us-west-2&bucketType=general) for assets
