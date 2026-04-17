---
plan: 02-03
phase: 02-rich-previews
status: complete
completed: 2026-04-17
---

## Summary

Created the static branded OG fallback image (`public/preview.jpg`) used when an occurrence has no openly-licensed photo. The image is a 1200×630px JPEG screenshot of the SalishSea.io map interface showing the Salish Sea, Puget Sound, and surrounding geography — establishing clear brand identity for preview cards.

## What was built

- `public/preview.jpg` — 1200×630px JPEG (1.91:1 OG aspect ratio), Salish Sea map view

## How it deploys

Vite copies `public/` to `dist/` verbatim (no content-hash renaming), and the existing S3 deploy sync uploads `dist/` to `s3://salishsea-io/site/`. The image will be served at `https://salishsea.io/preview.jpg` automatically on every deploy — no manual upload needed.

## Key files

- `public/preview.jpg` — committed to repo, deployed via existing Vite + S3 pipeline

## Self-Check: PASSED

- [x] `public/preview.jpg` exists (1200×630px JPEG)
- [x] Correct dimensions for OG image (1.91:1 aspect ratio)
- [x] Placed in `public/` (not `src/assets/`) to avoid content-hash renaming
- [x] Committed to repository
