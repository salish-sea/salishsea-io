# 052 — Designations are compared by the register's fold

**Status:** accepted · **Decided:** 2026-09-23 · **Extends:** [051](051-group-hierarchy-is-the-registers.md) · **Answers:** `salish-8vr.18`

## Decision

**Wherever we decide whether a written code names a catalogued animal or group, we compare the register's fold of both sides** ([ADR-0019](https://github.com/salish-sea/animals/blob/main/decisions/0019-names-are-compared-by-folding.md)). The fold lower-cases a code, drops apostrophes and hyphens, collapses whitespace, and compares digit runs as numbers, so `T065A5`, `T65A5` and `t65a5` are the same. Our own `normalize_designation()`, which upper-cased a code and padded its first number to three digits, is gone.

- **Where:** sighting codes are matched in SQL by `register.fold` (migration [20260923040000](../../supabase/migrations/20260923040000_designations_compared_by_the_registers_fold.sql)). Profile paths and prose links are resolved in TypeScript by [`src/fold.ts`](../../src/fold.ts). The edge handler keeps a hand copy. `designations.code_folded` and `social_groups.designation_folded` store the folded forms that lookups filter on.
- **The trailing `s` still decides what kind of thing a code names.** `T65As` is only ever compared against groups (as the group's designation plus `s`), and `T65A` only against animals. Nothing drops the `s` to merge a matriline with its matriarch, which is the clause ADR-0019 refuses. The one exception is the `/matrilines/` route: there, a trailing `s` is dropped before lookup, because the route has already said the subject is a group.

## Why

It follows 051: the register publishes the rule, so we use it instead of keeping one of our own. Two rules for one question is how two systems come to disagree about which animal a report named.

## What it changed (production, 469 distinct codes in sighting text)

Two codes changed, and the old rule had both wrong. `lpad()` truncates as well as pads, so `T1242s` (9 reports) was read as the T124 matriline and `T1241` (1 report) as the animal T124. Neither names anything in the catalogue, and neither matches under the fold. Every other code matches exactly as before, and no two designations fold together.
