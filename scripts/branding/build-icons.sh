#!/usr/bin/env bash
# Regenerate the site's icon assets from the brand sources in docs/branding/source.
# Requires rsvg-convert and ImageMagick (brew install librsvg imagemagick).
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

cp "$src/lockup-horizontal-teal-white.svg" src/assets/lockup-dark.svg
