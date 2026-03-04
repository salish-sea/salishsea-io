# Requirements: SalishSea.io

**Defined:** 2026-03-04
**Core Value:** The most convenient place to share and discover whale sightings in the Salish Sea — combining real-time community reporting with curated, authoritative cetacean data.

## v1 Requirements

Requirements for the link shareability milestone.

### Occurrence Links

- [x] **LINK-01**: User can copy a shareable link to a specific occurrence from its summary card in the sidebar
- [x] **LINK-02**: Shareable occurrence link encodes only the occurrence ID (e.g. `?o=<id>`)
- [x] **LINK-03**: Following an occurrence link sets the date from that occurrence's observed_at timestamp
- [x] **LINK-04**: Following an occurrence link sets the map center and zoom to that occurrence's location

### Rich Previews

- [ ] **PREV-01**: A link to the app shared in RCS, Facebook, or Bluesky shows a rich preview (title, description, image)
- [ ] **PREV-02**: Rich preview for an occurrence-specific link includes species, date, and location context
- [ ] **PREV-03**: Rich preview infrastructure works with the existing static S3/CloudFront deployment

## v2 Requirements

Deferred to future milestones.

### Sighter Experience Enrichment

- **ENRICH-01**: Sighter sees nearby historical sightings relevant to their current observation
- **ENRICH-02**: Sighter sees salmon run data contextualizing their sighting
- **ENRICH-03**: Sighter sees tide data at the time and location of their sighting
- **ENRICH-04**: Sighter sees biographical information about likely individual whales in their sighting

### Community Data Sourcing

- **SOCIAL-01**: Sightings from Facebook community groups are surfaced on the platform
- **SOCIAL-02**: Imported sightings are attributed to their original source

### Whale Catalog

- **CATALOG-01**: Platform hosts a database of known individual Salish Sea cetaceans (all species)
- **CATALOG-02**: Occurrences can be linked to individual whale records
- **CATALOG-03**: User can browse individual whale profiles with biographical data

### Data Access

- **DATA-01**: Data consumer can download occurrence records in a standard format (CSV or similar)
- **DATA-02**: Platform links to existing external cetacean databases and resources

## Out of Scope

| Feature | Reason |
|---------|--------|
| Native mobile app | Web-first; mobile web sufficient for in-the-moment sighting |
| Real-time push notifications | Not needed for current use cases |
| Non-cetacean marine species | Focus stays on whales and dolphins |
| Email/password auth | Google Sign-In is sufficient and reduces auth complexity |

## Traceability

Which phases cover which requirements. Confirmed during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LINK-01 | Phase 1 | Complete |
| LINK-02 | Phase 1 | Complete |
| LINK-03 | Phase 1 | Complete |
| LINK-04 | Phase 1 | Complete |
| PREV-01 | Phase 2 | Pending |
| PREV-02 | Phase 2 | Pending |
| PREV-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after roadmap creation*
