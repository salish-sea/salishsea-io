---
phase: 6
slug: archive-generation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing project default) |
| **Config file** | `vitest.config.ts` (root) — already globs `scripts/**/*.test.ts` per project default |
| **Quick run command** | `npx vitest run scripts/dwca` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~10–30 seconds for `scripts/dwca` slice (build.test.ts requires a local Supabase + DuckDB roundtrip; ~10s) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run scripts/dwca`
- **After every plan wave:** Run `npm test -- --run`
- **Before `/gsd-verify-work`:** Full suite must be green AND a manual GBIF validator upload of the produced zip succeeds (DWCA-05)
- **Max feedback latency:** 30 seconds

---

## Validation Layers (Architecture)

1. **Build-time schema assertion (F-02).** `assertions.ts` queries `information_schema.columns` via DuckDB ATTACH, compares to `OCCURRENCE_FIELDS` / `MULTIMEDIA_FIELDS`, emits a structured diff on any name/ordinal drift. **Unskippable** in CI — no `--skip-assertions` flag. Covers DWCA-02.
2. **Runtime row-count + zero-byte guards.** After each COPY, `build.ts` reads `COUNT(*)` from `dwc.occurrences` / `dwc.multimedia` and `stat()`s the output file. Non-zero exit on `count == 0` or `size == 0`. Covers DWCA-01.
3. **Round-trip parse Vitest tests.** `build.test.ts` reads the produced `occurrence.txt` and `multimedia.txt` back; asserts (a) field-index → DwC term URI mapping for a known seed record (DWCA-02), (b) `multimedia.coreId ⊆ occurrence.occurrenceID` anti-join is empty (DWCA-03), (c) UTF-8 no BOM + emoji/accent round-trip (DWCA-04).
4. **GeoParquet conformance tests.** `build.test.ts` calls `parquet_kv_metadata` for the `geo` key, asserts version `1.0.0`, primary_column `geometry`, WKB encoding, geometry_types includes `Point`. Round-trip count parity vs source view. Covers DWCA-06.
5. **Manual GBIF validator upload.** During plan-phase verification and after each archive regeneration in dev, upload `dist/dwca/salishsea-occurrences-v1.zip` to `https://www.gbif.org/tools/data-validator`. Required green before `/gsd-verify-work`. Covers DWCA-05 (the structural-correctness end gate).

---

## Per-Task Verification Map

> Populated by the planner against the final task IDs. Each PLAN.md task either has an `<automated>` verify command (test or assertion run) or declares a Wave-0 dependency in the wave-0 setup plan.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (populated during planning) | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/dwca/fields.test.ts` — pure unit tests for `OCCURRENCE_FIELDS` / `MULTIMEDIA_FIELDS` shape (entry count, URI base for dcterms pair, no duplicates) — runnable without DB
- [ ] `scripts/dwca/build.test.ts` — integration test scaffold that asserts the produced archive (DWCA-02/03/04/06) — assumes a local Supabase + ≥1 seeded observation with photo
- [ ] Local Supabase reachable on port 54322 with at least one `public.observations` row + one `public.observation_photos` row (so `dwc.occurrences` and `dwc.multimedia` are non-empty) — captured as a dev README note, not a code dep
- [ ] `@duckdb/node-api` + `yazl` installed as `devDependencies`; `tsx` (or equivalent runner) available

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Produced zip passes GBIF DwC-A validator with no blocking structural errors | DWCA-05 | The online validator (`gbif.org/tools/data-validator`) does not expose a stable programmatic API for v1.2; automation is explicitly deferred per CONTEXT.md Claude's Discretion | Run `npm run build:dwca` locally → upload `dist/dwca/salishsea-occurrences-v1.zip` to `https://www.gbif.org/tools/data-validator` → confirm zero blocking errors |
| `meta.xml` field URIs map to expected DwC/dcterms terms for a known seed record | DWCA-02 | Round-trip parse test (#3 above) covers it automatically; manual review of one full seed-record dump recommended on first run | Run `npm run build:dwca` → unzip → inspect `occurrence.txt` row for known `occurrenceID` → cross-check column N against `meta.xml` `<field index="N" term="...">` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
