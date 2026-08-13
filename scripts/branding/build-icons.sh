#!/usr/bin/env bash
# Regenerate the site's icon assets from the brand sources in docs/branding/source.
# Requires python3, rsvg-convert, and ImageMagick
# (brew install python librsvg imagemagick).
set -euo pipefail
cd "$(dirname "$0")/../.."

src=docs/branding/source
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

# The tab icon is the bare mark — at 16px the diamond crowds it. One SVG covers
# both themes: blue on light tab bars, teal on dark, tracking the same setting
# that colors the tab bar itself.
python3 - "$src/mark-blue.svg" > public/favicon.svg <<'PY'
import re, sys

svg = open(sys.argv[1]).read()
view_box = re.search(r'viewBox="([^"]+)"', svg).group(1)
paths = re.findall(r'<path[^>]*\bd="([^"]+)"', svg)

print(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}">')
print('  <style>')
print('    path { fill: #3968ea; }')
print('    @media (prefers-color-scheme: dark) { path { fill: #4bd6dd; } }')
print('  </style>')
for d in paths:
    print(f'  <path d="{d}"/>')
print('</svg>')
PY

# Safari ignores SVG favicons, so it gets the diamond icon as a classic .ico.
for size in 16 32 48; do
  rsvg-convert -w "$size" -h "$size" "$src/icon-diamond-light.svg" -o "$out/$size.png"
done
magick "$out/16.png" "$out/32.png" "$out/48.png" public/favicon.ico

# iOS fills transparency with black, which is where the diamond earns its keep.
rsvg-convert -w 180 -h 180 "$src/icon-diamond-light.svg" -o public/apple-touch-icon.png

# og:image. The delivered card is 1201x631; crawlers want exactly 1200x630.
magick "$src/social-preview.png" -resize 1200x630! \
  -background white -alpha remove -alpha off -quality 92 public/social-card.jpg

# The same card at GitHub's preferred 2:1. Scale to cover, then center-crop the
# ~16px of white margin off top and bottom — the composition is centered and the
# pattern sits in the corners, so nothing meaningful is lost. Distorting to 2:1
# the way the og:image does would visibly stretch the wordmark.
magick "$src/social-preview.png" -resize 1280x640^ -gravity center -extent 1280x640 \
  -background white -alpha remove -alpha off docs/branding/github-social-preview.png

# GitHub renders README images but its sanitizer strips the <style> block these
# lockups color themselves with, so the README gets PNGs, not the SVGs.
rsvg-convert -w 840 "$src/lockup-horizontal-blue-teal.svg" -o docs/branding/lockup-readme-light.png
rsvg-convert -w 840 "$src/lockup-horizontal-teal-white.svg" -o docs/branding/lockup-readme-dark.png

cp "$src/lockup-horizontal-teal-white.svg" src/assets/lockup-dark.svg
