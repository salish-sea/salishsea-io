# Roadmap: SalishSea.io

## Milestones

- ✅ **v1.0 Link Shareability** — Phases 1-2 (shipped 2026-04-17)
- 🚧 **v1.1 Partner Org Links** — Phase 3 (in progress)

## Phases

<details>
<summary>✅ v1.0 Link Shareability (Phases 1-2) — SHIPPED 2026-04-17</summary>

- [x] Phase 1: Occurrence Links (2/2 plans) — completed 2026-03-04
- [x] Phase 2: Rich Previews (5/5 plans) — completed 2026-04-17

</details>

### 🚧 v1.1 Partner Org Links (In Progress)

**Milestone Goal:** Partner organization names appearing in occurrence body text are automatically hyperlinked to their websites.

- [ ] **Phase 3: Partner Org Hyperlinking** - CSV-driven org name detection pre-processes body text into markdown links before rendering

## Phase Details

### Phase 3: Partner Org Hyperlinking
**Goal**: Occurrence body text automatically hyperlinks known partner org names to their websites
**Depends on**: Phase 2
**Requirements**: PARTNER-01, PARTNER-02, PARTNER-03, PARTNER-04, PARTNER-05, PARTNER-06
**Success Criteria** (what must be TRUE):
  1. A non-technical contributor can add a new partner org by editing a CSV file (name and URL columns) without touching TypeScript
  2. Partner org names appearing in occurrence body text render as clickable links that open the org website in a new tab
  3. Org name matching works regardless of capitalization in the body text
  4. The bracketed pattern `[Org Name]` converts to a link without producing malformed `[[Org Name](url)]` output
  5. Body text already containing a markdown hyperlink for an org is not double-linked
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Occurrence Links | v1.0 | 2/2 | Complete | 2026-03-04 |
| 2. Rich Previews | v1.0 | 5/5 | Complete | 2026-04-17 |
| 3. Partner Org Hyperlinking | v1.1 | 0/? | Not started | - |
