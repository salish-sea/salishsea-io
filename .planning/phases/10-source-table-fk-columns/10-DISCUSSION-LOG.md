# Phase 10: Source Table FK Columns - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 10-source-table-fk-columns
**Areas discussed:** Native column collisions, source_url mechanism, provider_id backfill

---

## Gray-area selection

Offered: Native column collisions / source_url mechanism / provider_id backfill now / collection_id index type.
**Selected:** Native column collisions, source_url mechanism, provider_id backfill now.
(Index type left to Claude's discretion.)

---

## Native column collisions

### Native `contributor_id` (already exists, NOT NULL)
| Option | Description | Selected |
|--------|-------------|----------|
| Keep existing NOT NULL | Leave native's contributor_id as-is; read SC#1 'nullable' as applying to the 3 new tables | |
| Relax to nullable | DROP NOT NULL so the column is uniformly nullable across all four tables | ✓ |

**User's choice:** Relax to nullable.
**Notes:** Only loosens the constraint; native rows stay 100% populated.

### Native `url` vs `source_url`
| Option | Description | Selected |
|--------|-------------|----------|
| Add separate source_url, backfill from url | New column alongside url, backfilled via UPDATE | |
| Reuse url as source_url | Don't add source_url; read existing url downstream | ✓ |

**User's choice:** Reuse url as source_url.
**Notes:** Flagged conflict with SC#1/SC#3 (which require a source_url column on every
table). Reconciled in the next area via a GENERATED column — source_url exists but is
definitionally identical to url, so no redundant maintained field. User accepted that path.

---

## source_url mechanism

### native + inat
| Option | Description | Selected |
|--------|-------------|----------|
| Generated column (mirror url/uri) | `GENERATED ALWAYS AS (url) STORED` / `(uri)`; auto-populated, can't drift, no ingest edits | ✓ |
| Plain column + one-time backfill | Plain nullable text + UPDATE; Phase 11 can override; new rows NULL unless ingest edited | |

**User's choice:** Generated column. *(Re-asked — first pass omitted an answer for this question.)*

### maplify + happywhale
| Option | Description | Selected |
|--------|-------------|----------|
| Plain nullable column, left NULL | Plain column on both; both NULL this phase, Phase 11 fills Maplify | |
| Plain nullable, plus a HW backfill attempt now | Same plain column, but derive HappyWhale source_url from id now | ✓ |

**User's choice:** Plain nullable, plus a HW backfill attempt now.
**Notes:** Claude flagged HW derivation as arguably Phase-11 scope (HW is export-excluded);
user chose to populate now. Planner must verify the HW URL pattern before backfilling.

### Ingest upsert edits
| Option | Description | Selected |
|--------|-------------|----------|
| No — defer ingest wiring to Phase 11 | Phase 10 = schema + backfill only | ✓ |
| Yes — wire provider_id into upserts now | Edit the 4 upsert RPCs so new rows get provider_id | |

**User's choice:** No — defer ingest wiring to Phase 11.
**Notes:** Generated source_url + provider_id DEFAULT cover forward-population without RPC edits.

---

## provider_id backfill

### How far to take provider_id
| Option | Description | Selected |
|--------|-------------|----------|
| Backfill all rows now, leave nullable | Slug-join UPDATE per table; column stays nullable | |
| Backfill now + NOT NULL DEFAULT | Slug-join + NOT NULL + per-table default | (user's intent) |
| Add column only, defer backfill to Phase 11 | Just the nullable column | |

**User's choice (free text):** "Add a generated column, non-null."
**Notes:** Claude flagged that a true Postgres generated column for a FK requires a hardcoded
magic integer (no subquery allowed) that breaks if providers are re-seeded — unlike source_url,
which mirrors a sibling column. Re-asked for a robust expression of the same "intrinsic,
non-null, no per-row maintenance" intent.

### Robust realization (follow-up)
| Option | Description | Selected |
|--------|-------------|----------|
| Backfill by slug + NOT NULL + migration-resolved DEFAULT | Slug-join backfill, SET NOT NULL, DEFAULT resolved by slug→id via migration-time dynamic SQL | ✓ |
| Backfill by slug + NOT NULL (no default) | Same but no default; new rows must supply provider_id | |
| Accept literal generated column | GENERATED with magic integer anyway | |

**User's choice:** Backfill by slug + NOT NULL + migration-resolved DEFAULT.
**Notes:** Achieves generated-column intent (structural, non-null, new rows auto-filled,
no maintenance) without the magic-integer FK fragility. Deviation from SC#1 'nullable'
recorded in CONTEXT (D-05) as intentional.

---

## Claude's Discretion

- `collection_id` index form — partial btree `WHERE collection_id IS NOT NULL` recommended
  on the two exported tables (CONTEXT D-13).
- HappyWhale source_url as plain-column-UPDATE vs generated column — pending URL-pattern
  verification (CONTEXT D-09).
- Migration structure and assertion-snippet shape — follow Phase 5/9 precedent.

## Deferred Ideas

- Maplify source_url derivation (from comments) — Phase 11.
- collection_id / contributor_id backfill — Phase 11.
- Ingest-RPC wiring of collection_id/contributor_id — Phase 11.
- NOT NULL on collection_id — deferred indefinitely.
- Cross-provider contributor unification — out of milestone.
