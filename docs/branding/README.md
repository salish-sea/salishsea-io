# Branding

The identity — the two-herring "S" mark, the wordmark, and the seamless pattern
built from the mark — was designed and contributed by
[Liam Reese](https://github.com/liamreese) on
[issue #286](https://github.com/salish-sea/salishsea-io/issues/286).

## The parts

- **Mark** — two herring forming an "S". Reads at favicon size on its own; that
  is what the tab icon uses.
- **Diamond icon** — the mark inside a rotated rounded square. Earns its keep
  where transparency isn't allowed (iOS home screen) or where the icon needs a
  field of its own.
- **Lockup** — mark plus wordmark, horizontal or vertical.
- **Pattern** — the mark tiled into a school of herring, for backgrounds.

Two colors carry all of it: **blue `#3968ea`** and **teal `#4bd6dd`**. The teal
stands in for the green cast of Salish Sea water. The wordmark is **DIN
Alternate Bold, tracking −50** — use those for any future text set in the
brand's voice.

Which color goes where depends on the background, so each piece ships in
several colorways in [`source/`](source). Pick by contrast: on the navy app
header the blue mark sinks into the background, so the header lockup is the
teal-mark colorway; on white, blue leads and teal follows.

## What the site serves

Everything the site ships is derived from `source/` by
[`scripts/branding/build-icons.sh`](../../scripts/branding/build-icons.sh) —
edit a source file and re-run it rather than editing the outputs:

| Output | Source | Notes |
| --- | --- | --- |
| `public/favicon.svg` | `mark-blue.svg` | Bare mark; `prefers-color-scheme` swaps it to teal on dark tab bars |
| `public/favicon.ico` | `icon-diamond-light.svg` | Safari ignores SVG favicons |
| `public/apple-touch-icon.png` | `icon-diamond-light.svg` | iOS fills transparency with black |
| `public/social-card.jpg` | `social-preview.png` | The `og:image`, resized to exactly 1200×630 ([decision 026](../decisions/026-branded-fallback-preview-image.md)) |
| `src/assets/lockup-dark.svg` | `lockup-horizontal-teal-white.svg` | The app header |
| `github-social-preview.png` | `social-preview.png` | The GitHub repository's social preview, center-cropped to GitHub's 1280×640 |
| `lockup-readme-light.png`, `lockup-readme-dark.png` | `lockup-horizontal-blue-teal.svg`, `lockup-horizontal-teal-white.svg` | The repository README header, one per GitHub theme |

`source/` holds the colorways the site uses plus the near neighbors a future
change is likely to reach for. The complete set — every colorway, PNG exports
at several sizes, the large-format patterns — lives in the designer's
[Drive folder](https://drive.google.com/drive/folders/1u0ZjMRqpR5YhSUV0NyR9GNQY4UlzvbTt).

The remaining PNGs in this directory — `app-with-lockup.png`,
`favicon-tabs.png`, `header-lockup.png` — are review screenshots from PR #381,
not assets.

## The GitHub repository

The repository is the brand's other front door, and its two branded surfaces
are set in different places. The README header is checked in and renders from
the table above. The **social preview is not**: GitHub exposes no REST or
GraphQL endpoint for it, so `github-social-preview.png` has to be uploaded by
hand at
[Settings → General → Social preview](https://github.com/salish-sea/salishsea-io/settings).
Re-run the build script after a brand change and the file is regenerated, but
someone still has to re-upload it — GitHub keeps serving the last upload
otherwise. GitHub's own limits: PNG/JPG/GIF under 1 MB, 1280×640 preferred.
