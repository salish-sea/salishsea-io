---
phase: 03-partner-org-hyperlinking
reviewed: 2026-04-17T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/partners.csv
  - src/partner-links.ts
  - src/partner-links.test.ts
  - src/obs-summary.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-04-17
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the partner-org hyperlinking feature: a CSV-driven partner registry, a text-transformation module that injects markdown links, a test suite, and the `obs-summary` component that integrates the pipeline.

The core `injectPartnerLinks` logic in `partner-links.ts` is well-structured — the regex approach, the "already linked" guard, and the longest-name-first sort are all correct. The DOMPurify + marked pipeline in `obs-summary.ts` is used correctly (inject links → parse markdown → sanitize HTML → `unsafeHTML`).

Three bugs are worth fixing before shipping: two `target="_new"` typos in `obs-summary.ts` that silently misbehave in browsers, one unhandled async error path in the delete handler, and one regex edge case in `partner-links.ts` where partner names could match inside markdown link URLs.

---

## Warnings

### WR-01: `target="_new"` is not a standard HTML target value

**File:** `src/obs-summary.ts:179`, `src/obs-summary.ts:192`

**Issue:** Both the attribution link and the photo links use `target="_new"`. `_new` is not a reserved browsing context name like `_blank`. Browsers treat it as a named window, so the first click opens a new tab named "new" and every subsequent `_new` link reuses that same tab — overwriting whatever was there. The intent is clearly `_blank` (open in a fresh tab each time).

**Fix:**
```html
<!-- line 179 -->
<a target="_blank" href=${url}>${attribution}</a>

<!-- line 192 -->
<a target="_blank" href=${url || src}><img ...></a>
```

---

### WR-02: Unhandled promise rejection in `onDelete`

**File:** `src/obs-summary.ts:233-238`

**Issue:** `onDelete` is an `async` method bound as a Lit event handler. When the Supabase delete returns an error, the method throws `new Error(...)`. Because no caller awaits or `.catch()`es this handler, the thrown error becomes an unhandled promise rejection — it is silently swallowed in production builds and gives the user no feedback that the deletion failed.

```typescript
// current — error is thrown into the void
private async onDelete(e: Event) {
  e.preventDefault();
  const {error} = await supabase().from('observations').delete().eq('id', this.sighting.id);
  if (error)
    throw new Error(`Error deleting observation: ${error}`);
}
```

**Fix:** Dispatch a custom event or set a reactive state property to surface the error to the user. At minimum, log it so it is observable:

```typescript
private async onDelete(e: Event) {
  e.preventDefault();
  const {error} = await supabase().from('observations').delete().eq('id', this.sighting.id);
  if (error) {
    console.error('Error deleting observation:', error);
    // TODO: surface to user via a toast/state property
    return;
  }
}
```

---

### WR-03: Partner name regex can match inside markdown link URLs

**File:** `src/partner-links.ts:33-38`

**Issue:** The replacement regex uses `(?<!\[)\b(name)\b(?!\])` to match plain text occurrences. This lookbehind prevents matching inside `[text]` but does not prevent matching inside a URL in an already-formed markdown link such as `[some text](https://fisheries.noaa.gov/NOAA-report)`. If a partner's name (e.g. `NOAA`) appears in a URL in the body text, the regex will match it and corrupt the markdown syntax.

Example:
```
Input:  "See [report](https://fisheries.noaa.gov/NOAA-data)"
Output: "See [report](https://fisheries.[NOAA Fisheries](https://fisheries.noaa.gov)/NOAA-data)"
```

**Fix:** Extend the regex to also exclude matches preceded by `(` or `/` (URL context), or use a single-pass approach that splits the body on existing markdown link syntax before processing:

```typescript
// Simple guard: also exclude matches inside parentheses (URL context)
const re = new RegExp(
  '(\\[' + e + '\\](?!\\())|(?<!\\[)(?<!\\()(?<!/)\\b(' + e + ')\\b(?!\\])',
  'gi'
);
```

A more robust approach is to split on `\[.*?\]\(.*?\)` to skip existing links entirely before applying substitution.

---

## Info

### IN-01: Redundant `|| false` in editable expression

**File:** `src/obs-summary.ts:166`

**Issue:** `this.contributor && canEdit(this.sighting, this.contributor) || false` — the `|| false` is a no-op. The `&&` expression already produces a falsy value (`undefined`) when `this.contributor` is falsy, and `undefined || false` evaluates to `false`. The intent is presumably to ensure a boolean type, but the redundant clause adds noise.

**Fix:**
```typescript
const editable = !!(this.contributor && canEdit(this.sighting, this.contributor));
```

---

### IN-02: Missing clipboard error handling in `onCopyLink`

**File:** `src/obs-summary.ts:209-214`

**Issue:** `navigator.clipboard.writeText(url)` is awaited without a try/catch. The Clipboard API can be rejected if the document does not have clipboard-write permission (e.g. in some iframe contexts or after a browser permission denial). The unhandled rejection would leave `this.copied` as `false` with no user feedback.

**Fix:**
```typescript
private async onCopyLink(e: Event): Promise<void> {
  e.preventDefault();
  const url = buildShareUrl(this.sighting.id);
  try {
    await navigator.clipboard.writeText(url);
    this.copied = true;
    setTimeout(() => { this.copied = false; }, 2000);
  } catch {
    // Clipboard unavailable — optionally surface an error state
  }
}
```

---

_Reviewed: 2026-04-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
