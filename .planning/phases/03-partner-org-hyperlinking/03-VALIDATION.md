---
phase: 3
slug: partner-org-hyperlinking
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vite.config.ts (or vitest.config.ts if exists) |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | PARTNER-01 | — | CSV parsed correctly at import | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | PARTNER-02 | — | Org name appears as hyperlink in rendered output | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | PARTNER-03 | — | Case-insensitive match links org names | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 3-01-04 | 01 | 1 | PARTNER-04 | — | Bracket pattern [Org Name] converts to [Org Name](url) | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 3-01-05 | 01 | 1 | PARTNER-05 | — | Already-linked text is not double-linked | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 3-01-06 | 01 | 1 | PARTNER-06 | — | target=_blank and rel=noopener noreferrer preserved through DOMPurify | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/test/partner-links.test.ts` — unit tests for link injection utility (PARTNER-01 through PARTNER-06)

*If no existing test infrastructure: install vitest first.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Links open in a new browser tab | PARTNER-02 | target=_blank behavior requires browser | Open app, find occurrence with a partner org name, click the link, verify new tab opens |
| CSV editable by non-technical contributor | PARTNER-01 | Content workflow, not code | Edit partners.csv, rebuild, verify org name appears as link |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
