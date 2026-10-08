# 072 — dev.salishsea.io is a branch build over production's data, deployed by hand

**Status:** accepted · **Decided:** 2026-10-08 · **Context:** the basemap prototype (`salish-3zok`), which needs somewhere to be seen at full size on real sightings · **Relates:** [056](056-the-logged-out-read-path-is-built-as-static-files.md) (signed-out visitors read static files), [061](061-ingest-and-derivation-move-into-the-build.md) (the Fly app serves them), [065](065-the-store-and-write-api.md) (the write API and its allowed origins), [068](068-the-map-stays-on-openlayers.md) (the basemap work this serves first)

## Context

dev.salishsea.io existed: a CloudFront distribution and a public bucket, both made by hand in September 2025, deployed by two package.json scripts that were deleted in #149. Nothing had been put there since 28 September 2025, and it was in no stack. Meanwhile production moved to the Fly app, so syncing a build into that bucket would no longer have given a working site: the map reads the read-path build's files, which exist only on the Fly machine.

A signed-out visitor's site is static, though (056). Everything it reads is a file the Fly app serves — the day files, calendar and indexes under `/read-path/`, the status files, the archive — and the one dynamic call it makes, `GET /api/me`, answers "nobody" when there is no session.

## Decision

**dev.salishsea.io serves the app built from any checkout, in front of production's files.** Its distribution is in the CDK stack ([`infra/lib/infra-stack.ts`](../../infra/lib/infra-stack.ts)). The default behavior serves the app from a private bucket, `salishsea-io-dev-site`, through origin access control. `/read-path/*`, `/status/*` and `/dwca/*` pass through to the Fly app, as production's default behavior does. So a branch is seen on today's sightings without a second read-path build, a second database or seed data.

**It is read-only by construction.** `/api/*` passes only `GET` and `HEAD`, forwards no cookies and carries no CloudFront secret, so `/api/me` always answers "nobody" and no write reaches the API. The API would refuse one anyway: dev.salishsea.io is not among its allowed origins (`DEFAULT_ORIGINS` in [`api/server.ts`](../../api/server.ts)).

**It is deployed by hand,** with [`scripts/deploy-dev.sh`](../../scripts/deploy-dev.sh): build as the Fly image does (`VITE_READ_SOURCE=static`, `VITE_WRITE_SOURCE=api`, production's public Supabase client), but in Vite mode `dev`, so Sentry files its errors under that environment; sync to the bucket; invalidate. Nothing deploys it on push. Whoever deploys last owns what it shows.

**It asks not to be indexed** (`X-Robots-Tag: noindex, nofollow` on every response), and has no edge function, so links to it get no preview card.

**What it lacks:** profile pages, because the Fly app prerenders them around its own build's hashed assets, which the dev bucket doesn't hold; signing in and anything that needs it; and preview cards.

## Rejected

- **Reviving the old bucket sync as it was.** The bundle alone has no data to read since 056 and 061, and the bucket is public.
- **A second Fly app as staging.** A full copy (its own read-path build, store, API and sign-in) is what testing a write path or the build would need. The basemap needs neither, and a second machine is a second set of secrets, volumes and schedules to keep alive. Revisit when a change needs one.
- **Deploying it from CI on every push to a branch.** Several branches would race for one hostname, and the last push would win silently.
- **Adopting the hand-made distribution with `cdk import`.** It held only an S3 origin and a public bucket policy; a new distribution is less work than an import that must first match it exactly, then change it.
