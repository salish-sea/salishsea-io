# Requirements — SalishSea.io

## Milestone v1.1: Partner Org Links

### Partner Org Data

- [ ] **PARTNER-01**: Partner org names and URLs are maintained in a CSV file (`name,url` columns) that non-technical contributors can edit without touching code

### Rendering

- [ ] **PARTNER-02**: User sees partner org names in occurrence body text rendered as clickable hyperlinks to their websites
- [ ] **PARTNER-03**: Org name matching is case-insensitive
- [ ] **PARTNER-04**: Partner links open in a new tab (`target="_blank" rel="noopener noreferrer"`)
- [ ] **PARTNER-05**: The bracketed pattern `[Org Name]` (common in body text) is converted to a link without producing double-bracket rendering
- [ ] **PARTNER-06**: Text already formatted as a markdown hyperlink in the body is not double-linked

## Future Requirements

- Sighter sees contextual data enriching their sighting (nearby historical sightings, salmon run data, tides, individual whale biographical info)
- Sightings from Facebook community groups are surfaced on the platform (cold start / lock-in mitigation)
- Platform hosts a comprehensive catalog of individual Salish Sea cetaceans (all species)
- Data consumers can download occurrence records in standard formats
- Platform links to existing external cetacean resources and databases

## Out of Scope

- Native mobile app — web-first; mobile web is sufficient for in-the-moment sighting
- Real-time push notifications — not needed for current use cases
- Non-cetacean marine species — focus stays on whales and dolphins
- Server-side link resolution — hyperlinking is a pure frontend concern for this milestone
- Admin UI for managing partners — CSV file edit is sufficient

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PARTNER-01 | Phase 3 | Pending |
| PARTNER-02 | Phase 3 | Pending |
| PARTNER-03 | Phase 3 | Pending |
| PARTNER-04 | Phase 3 | Pending |
| PARTNER-05 | Phase 3 | Pending |
| PARTNER-06 | Phase 3 | Pending |
