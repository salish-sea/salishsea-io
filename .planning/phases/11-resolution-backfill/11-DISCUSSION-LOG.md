# Phase 11: Resolution & Backfill - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 11-resolution-backfill
**Areas discussed:** Maplify reinsert landmine, Backfill artifact & delivery, Dictionary content & precedence, contributor_id scope

---

## Maplify reinsert landmine

### Where Maplify collection_id gets (re)populated

| Option | Description | Selected |
|--------|-------------|----------|
| Resolve inside the INSERT | Wire resolution into `maplify.update_sightings`; INSERT joins a DB-side dictionary. One path for backfill + ongoing. | ✓ |
| Post-ingest sweep | Separate idempotent UPDATE function scheduled after ingest. | |
| MERGE-preserve + resolve | Rewrite DELETE+INSERT to MERGE so existing rows keep collection_id. | |

**User's choice:** Resolve inside the INSERT
**Notes:** Discovered the landmine while scouting: `cron.schedule(..., '*/5 * * * *', ...)` runs `maplify.update_sightings`, which DELETE+INSERTs the last 10 days — wiping any backfilled `collection_id`. Inline resolution makes ongoing correctness automatic.

### DB-side dictionary form

| Option | Description | Selected |
|--------|-------------|----------|
| Lookup table + SQL fn | `maplify.collection_rule` table seeded by migration + thin resolver applying precedence. | ✓ |
| SQL function w/ inline VALUES | Single function with dictionary as inline VALUES + CASE. | |

**User's choice:** Lookup table + SQL fn
**Notes:** Data-driven, FK-checked, reviewable as rows; adding a tag is one INSERT.

### Role of the TS URL-pattern resolver

| Option | Description | Selected |
|--------|-------------|----------|
| DEFAULT for ongoing, TS for backfill+future | Migration-resolved column DEFAULT for single-collection tables; TS resolver for backfill + future FB. | ✓ |
| DEFAULT does it all; TS is the future-FB stub | Constants only; TS file exists but off all current paths. | |
| Let's discuss / different split | — | |

**User's choice:** DEFAULT for ongoing, TS for backfill+future
**Notes:** Reconciles the locked "TS pure function" decision with the discovery that ingest is DB-side pg_cron SQL.

---

## Backfill artifact & delivery

### Packaging / application to prod

| Option | Description | Selected |
|--------|-------------|----------|
| Idempotent SQL migration | Backfill UPDATEs in a timestamped migration, guarded by `WHERE collection_id IS NULL`; no-op locally, runs on deploy. | ✓ |
| Migration for schema, manual one-shot for data | Schema/seed as migration; bulk UPDATE run by hand against prod. | |

**User's choice:** Idempotent SQL migration

### Census handling

| Option | Description | Selected |
|--------|-------------|----------|
| Commit census output + diff-gate | Commit raw census artifact; assertion FAILS if any prod tag/attribution/source not covered by `collection_rule`. | ✓ |
| Commit census output, no gate | Commit artifact, no standing tripwire. | |
| Trust existing §3 census | Build rules from exec-summary §3 without a fresh run. | |

**User's choice:** Commit census output + diff-gate
**Notes:** Directly enforces SC#1 and turns new upstream tags into a loud failure rather than silent NULL.

---

## Dictionary content & precedence

### SC#1 strict-zero vs one-offs / empties

| Option | Description | Selected |
|--------|-------------|----------|
| Seed collections for real one-offs, relax empties | Hand-seed real channels (incl. one-offs); empty/`[NULL]` brackets treated as untagged via tightened regex `^\[[^\]]+\]`, allowed NULL. | ✓ |
| Relax SC#1 to documented-unresolved | SC#1 becomes "0 or documented known-unresolved count". | |
| Seed collections for ALL distinct tags | Every non-empty distinct tag → a collection, even singletons. | |

**User's choice:** Seed collections for real one-offs, relax empties
**Notes:** SC#1 regex tightening flagged as a documented deviation for the verifier.

### Structured `source` code fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Curated source-code rules | `match_kind='source'` rules mapping opaque codes to collections via curation; diff-gated. | ✓ |
| Map only unambiguous codes, rest NULL | Precision over recall on the long tail. | |
| Skip source code entirely | Only bracket tag + attribution resolve. | |

**User's choice:** Curated source-code rules
**Notes:** Precedence order itself was already locked (`source_url` → bracket → attribution → source → NULL), so only the source-code content was open.

---

## contributor_id scope

### iNat / HappyWhale contributor population

| Option | Description | Selected |
|--------|-------------|----------|
| Defer iNat/HW contributor_id | Both NULL this phase. | |
| Populate iNat/HW now | Mint contributors from both providers. | |
| iNat only, HW deferred | Populate iNat; defer HappyWhale's separate users table. | ✓ |

**User's choice:** iNat only, HW deferred

### iNat identity / dedup mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Generic external-identity columns | provider_id + external_key UNIQUE on contributors. | |
| Single inat_login column | One nullable `inat_login text UNIQUE`. | ✓ |
| Separate iNat identity table | Dedicated mapping table. | |

**User's choice:** Single inat_login column
**Notes:** Minimal for an iNat-only scope; jmaughn ↔ James Maughn stays unlinked (unification deferred).

### Ongoing iNat resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Idempotent sweep function | Cron'd `resolve_inat_contributors()` mints + links NULLs; doesn't touch the MERGE. | |
| Wire into the MERGE upsert | Resolve `contributor_id` inline in `upsert_observation_page`. | ✓ |
| Backfill only, defer ongoing | New iNat rows NULL until a later phase. | |

**User's choice:** Wire into the MERGE upsert
**Notes:** Deliberately overrides Phase 10's D-14 ("don't touch ingest RPCs") — Phase 11 edits two ingest functions (Maplify INSERT + iNat MERGE) by design.

---

## Claude's Discretion

- Exact migration split (census-assertion / rules+resolver / backfill / ingest-wiring).
- Diff-gate as a `supabase/snippets/11_*` assertion vs an in-migration `DO $$ … RAISE EXCEPTION … $$` check.
- Census artifact location and the exact tag/attribution extraction regex.

## Deferred Ideas

- HappyWhale `contributor_id` population (export-excluded; later phase).
- Cross-provider contributor unification (jmaughn ↔ James Maughn); `contributor_links`.
- Generalized external-identity columns on `public.contributors` (chose minimal `inat_login`).
- ORCID population for native contributors (column exists; data entry later).
- Layer 2 URL → whole-occurrence importer (seeded; out of milestone).
