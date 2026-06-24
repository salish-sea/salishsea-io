# Roadmap: SalishSea.io

## Milestones

- ✅ **v1.0 Link Shareability** — Phases 1-2 (shipped 2026-04-17)
- ✅ **v1.1 Partner Org Links** — Phase 3 (shipped 2026-04-18)
- ✅ **v1.2 Export to DarwinCore Archive** — Phases 4-8 (shipped 2026-06-18) — see [.planning/milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Providers, Collections & Contributors** — Phases 9-14 (shipped 2026-06-24) — see [.planning/milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

## Phases

<details>
<summary>✅ v1.0 Link Shareability (Phases 1-2) — SHIPPED 2026-04-17</summary>

- [x] Phase 1: Occurrence Links (2/2 plans) — completed 2026-03-04
- [x] Phase 2: Rich Previews (5/5 plans) — completed 2026-04-17

</details>

<details>
<summary>✅ v1.1 Partner Org Links (Phase 3) — SHIPPED 2026-04-18</summary>

- [x] Phase 3: Partner Org Hyperlinking (2/2 plans) — completed 2026-04-18

</details>

<details>
<summary>✅ v1.2 Export to DarwinCore Archive (Phases 4-8) — SHIPPED 2026-06-18</summary>

- [x] Phase 4: Rights & Data-Model Policy (1/1 plan) — completed 2026-06-10
- [x] Phase 5: DB Projection (`dwc` schema) (4/4 plans) — completed 2026-06-17
- [x] Phase 6: Archive Generation (6/6 plans) — completed 2026-06-18
- [x] Phase 7: Nightly Workflow & Hosting (3/3 plans) — completed 2026-06-18
- [x] Phase 8: Frontend Download Link (2/2 plans) — completed 2026-06-18

Full milestone details: [.planning/milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

<details>
<summary>✅ v1.3 Providers, Collections & Contributors (Phases 9-14) — SHIPPED 2026-06-24</summary>

- [x] Phase 9: Reference Table Foundation (1/1 plan) — completed 2026-06-19
- [x] Phase 10: Source Table FK Columns (1/1 plan) — completed 2026-06-19
- [x] Phase 11: Resolution & Backfill (4/4 plans) — completed 2026-06-21
- [x] Phase 12: DwC View Rebuild (3/3 plans) — completed 2026-06-21
- [x] Phase 13: Verification & GBIF Re-validation (3/3 plans) — completed 2026-06-21
- [x] Phase 14: DwC-A Build Pre-Prod Gate (Seeded Local DB) (2/2 plans) — completed 2026-06-22

Full milestone details: [.planning/milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

</details>

## Backlog

Candidate phases not yet assigned to a milestone. Promote with `/gsd-review-backlog`.

*(Backlog item 999.1 Collections and Contributors promoted into v1.3 Phases 9-13.)*

### Phase 999.2: ingest in-region Orca sightings from GBIF (BACKLOG)

**Goal:** [Captured for future planning] — pull occurrence records for Salish Sea cetaceans that already live in GBIF (e.g. from datasets we don't otherwise ingest) and surface the in-region ones on the platform. Note v1.3 context: iNaturalist + HappyWhale are deliberately export-*excluded* from our DwC-A because they self-publish to GBIF — an inbound GBIF ingest is the mirror-image idea and must avoid re-importing our own contributed records (provenance/dedup against provider+source_url).
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Occurrence Links | v1.0 | 2/2 | Complete | 2026-03-04 |
| 2. Rich Previews | v1.0 | 5/5 | Complete | 2026-04-17 |
| 3. Partner Org Hyperlinking | v1.1 | 2/2 | Complete | 2026-04-18 |
| 4. Rights & Data-Model Policy | v1.2 | 1/1 | Complete | 2026-06-10 |
| 5. DB Projection (`dwc` schema) | v1.2 | 4/4 | Complete | 2026-06-17 |
| 6. Archive Generation | v1.2 | 6/6 | Complete | 2026-06-18 |
| 7. Nightly Workflow & Hosting | v1.2 | 3/3 | Complete | 2026-06-18 |
| 8. Frontend Download Link | v1.2 | 2/2 | Complete | 2026-06-18 |
| 9. Reference Table Foundation | v1.3 | 1/1 | Complete | 2026-06-19 |
| 10. Source Table FK Columns | v1.3 | 1/1 | Complete | 2026-06-19 |
| 11. Resolution & Backfill | v1.3 | 4/4 | Complete | 2026-06-21 |
| 12. DwC View Rebuild | v1.3 | 3/3 | Complete | 2026-06-21 |
| 13. Verification & GBIF Re-validation | v1.3 | 3/3 | Complete | 2026-06-21 |
| 14. DwC-A Build Pre-Prod Gate (Seeded Local DB) | v1.3 | 2/2 | Complete | 2026-06-22 |
