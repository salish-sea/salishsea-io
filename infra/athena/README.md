# Site monitoring — CloudFront access logs

Basic traffic/referrer/health analytics for salishsea.io, derived from CloudFront standard access
logs. Answers "are people using this, how do they arrive, and is it healthy" — **not** in-app
behaviour (the site is a single-page app, so the edge logs see almost every page view as `/`; use
Sentry or a client-side analytics tool for per-view usage).

## How it's wired

All defined in [`../lib/infra-stack.ts`](../lib/infra-stack.ts):

- CloudFront access logging → `logBucket` under `cloudfront/` (already existed; legacy standard logs).
- A Glue database `salishsea_logs` + external table `cloudfront_logs` over those logs.
- An Athena workgroup `salishsea-monitoring` that writes query results to a dedicated, 30-day-expiry
  results bucket.
- Every `*.sql` file in this directory, saved as an Athena **named query** (the `.sql` files are the
  source of truth; CDK loads them at synth time).

## Usage

1. Select the **`salishsea-monitoring`** workgroup in the Athena console (results location is preset).
2. Run **`human_pageviews_view`** once to (re)create the `human_pageviews` view — it filters out bots,
   scanners, and non-HTML assets. Re-run it whenever you adjust the bot filter.
3. Run any of the numbered queries. All use a rolling 30-day window.

Bots dominate the raw logs (uptime monitors + scanners are the large majority of requests), so the
"human" queries read from the view, while `07_user_agents` and `08_status` read the raw table to keep
the bot/health picture visible. When `07_user_agents` surfaces a new bot, add it to the filter in
`human_pageviews_view.sql`.

"Visitors" = distinct client IP — a rough proxy that overcounts roaming IPs and undercounts shared
NAT. Geo/country is not available in legacy CloudFront logs.
