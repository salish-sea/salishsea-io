# Milestones

## v1.0 Link Shareability (Shipped: 2026-04-17)

**Phases completed:** 2 phases, 7 plans, 12 tasks

**Key accomplishments:**

- Copy-link icon button added to obs-summary header using linkIcon + buildShareUrl helper, producing clean ?o=<id>-only shareable URLs with 2-second checkmark feedback
- Deep-link hydration via ?o=<id>: sets date from occurrence.observed_at and centers map on occurrence location at zoom 12, with silent fallback and no history pollution
- Jest test scaffolds for Lambda@Edge bot detection and OG tag generation (9 unit tests) and CDK InfraStack assertions (3 tests), all in RED state awaiting implementation
- Lambda@Edge viewer-request handler with bot detection, SSM credential caching, Supabase REST fetch, and OG tag generation — all 10 unit tests GREEN
- CDK InfraStack fully wired with CloudFront Distribution, Lambda@Edge VIEWER_REQUEST trigger (NODEJS_22_X), SSM credential parameters, and IAM read grant — all 3 CDK assertion tests GREEN

---
