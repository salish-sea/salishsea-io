# 001 — Product framing: two audiences, web-first, cetaceans only

**Status:** accepted · **Decided:** ~2026-03 (v1.0 project inception), reaffirmed through v1.3

## Decision

SalishSea.io serves two audiences with meaningfully different needs — **sighters** (speed and convenience in the field) and **researchers** (completeness, reliability, downloadability) — from one platform. Web-first; scope limited to cetaceans; Google Sign-In only.

## Rationale

- The same person is often both audiences in different modes; splitting products would fragment the data that makes each side valuable.
- **Web-first, no native app:** mobile web is sufficient for in-the-moment sighting; a native app is ongoing cost with no capability we need.
- **Cetaceans only:** focus keeps curation, taxonomy, and community identity coherent. One recorded exception: Lutrinae (otters) added to the iNaturalist ingest query (2026-05-27, commit 370c786).
- **Google Sign-In only:** simple auth; target audience uses Google. Flagged "pending evaluation" — revisit if partnership work surfaces users without Google accounts.

## Rejected

- Native mobile app; real-time push notifications; non-cetacean species.
