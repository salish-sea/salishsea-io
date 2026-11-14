# Facebook sightings demo

A trial of [decision 117](../../docs/decisions/117-sightings-from-a-facebook-group-arrive-when-a-signed-in-person-sends-the-days-post.md), for a week or two from 2026-11-13, so that Scott and Orca Network's staff can try sending the Orca Network Community Group's day post and see what SalishSea.io would read from it. Tracked as bd `salish-i1a.3.10`. It writes nothing to production; the real build-out is `salish-i1a.3.3` to `.9`.

## What it does

A sender drags their own **Send to SalishSea** bookmarklet from their install page, and clicks it on the day's post. If Facebook is hiding comments, the bookmarklet opens them and asks for another click. Otherwise it compresses the post's HTML into the address of a window on this server, after the `#`, which reads it and sends it here (decision 117 says why it travels that way).

The server reads the post into its lines and its comments ([`read.mjs`](read.mjs)), and runs each through the site's reader of sighting text, [`src/sighting-text.ts`](../../src/sighting-text.ts). It also finds the clock time a text gives, and the place names it uses from the site's gazetteers ([`places.mjs`](places.mjs)); the reader itself gives no position. It keeps each line and comment once, in SQLite ([`store.mjs`](store.mjs)): comments by Facebook's `comment_id`, lines by their text. The viewing page lists everything with what was found, lets people mark whether the reader got it right, and offers it all as CSV for a spreadsheet. Text that appears in two posts or more, such as Orca Network's standing notes on the laws, is folded and left out of the figures.

## Running it

It runs on Maderas as a `systemd --user` service, behind Apache at `https://peter.amandrai.net/fb-demo/`, which hands the path to it through an `.htaccess` file. [`deploy.sh`](deploy.sh) does everything from a checkout:

- `tools/facebook-demo/deploy.sh` copies `src/` and this folder, installs, and restarts.
- `deploy.sh sender NAME` adds a sender and prints their install link. Each sender has their own secret; a link should go only to them.
- `deploy.sh view` prints the viewing link, which carries the secret for reading and marking.
- `deploy.sh retire` stops the service and takes it off the web, keeping the data.

The data lives on Maderas in `~/fb-demo-data`: `config.json` (the secrets), `demo.sqlite`, and `raw/`, the posts as sent, kept for seven days so a fix to the reading can be checked against them. It holds members' names and comments, so delete it when the trial is over.

`pnpm install && pnpm test` here runs the tests, on a made-up post in the shape of Facebook's markup; real posts are not checked in. To run it locally, put a `config.json` in a folder and start `FB_DEMO_DATA=<folder> node server.mjs`.
