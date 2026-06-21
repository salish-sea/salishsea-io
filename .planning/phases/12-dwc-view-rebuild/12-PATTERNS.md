# Phase 12: DwC View Rebuild — Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/20260621NNNNNN_dwc_view_rebuild.sql` | migration | transform | `supabase/migrations/20260617203900_dwc_schema.sql` | exact |
| `scripts/dwca/fields.ts` | config | transform | itself (current 25-entry array) | exact |
| `scripts/dwca/fields.test.ts` | test | transform | itself (current test shape) | exact |
| `scripts/dwca/meta-xml.test.ts` | test | transform | itself (current test shape) | exact |
| `scripts/dwca/eml.ts` | utility | request-response | itself (current buildEml) | exact |
| `scripts/dwca/eml.test.ts` | test | request-response | itself (current test shape) | exact |
| `scripts/dwca/guard.ts` | utility | request-response | itself (no code change needed) | exact |
| `scripts/dwca/guard.test.ts` | test | request-response | itself (no code change needed) | exact |
| `scripts/dwca/build.ts` | utility | CRUD | itself + `scripts/dwca/eml.ts` step 16-17 | exact |
| `supabase/snippets/12_dwc_attribution_assertions.sql` | config | CRUD | `supabase/snippets/11_resolution_assertions.sql` | exact |

---

## Pattern Assignments

### `supabase/migrations/20260621NNNNNN_dwc_view_rebuild.sql` (migration, transform)

**Analog:** `supabase/migrations/20260617203900_dwc_schema.sql` (lines 219–500)

**DROP order pattern** — must drop `dwc.occurrences` first (it depends on the branches):
```sql
DROP VIEW IF EXISTS dwc.occurrences;
DROP VIEW IF EXISTS dwc._maplify_occurrences;
DROP VIEW IF EXISTS dwc._native_occurrences;
```

**Native branch columns 19–25 (current, lines 266–302)** — replace cols 20–21 and add col 19:
```sql
  -- 19. recordedBy (D-09 / POLICY §2.1) — unchanged
  c.name::text                                                                  AS "recordedBy",
  -- 20. rightsHolder (D-09 / POLICY §2.1) — same value as recordedBy
  c.name::text                                                                  AS "rightsHolder",
  -- 21. datasetName
  'SalishSea.io Cetacean Occurrences (v1.2)'::text                              AS "datasetName",
  -- 22. datasetID (D-17 / POLICY §6.3)
  'https://salishsea.io/datasets/occurrences-v1'::text                          AS "datasetID",
  -- 23. license
  'https://creativecommons.org/licenses/by-nc/4.0/legalcode'::text              AS "license",
  -- 24. dynamicProperties
  NULLIF(jsonb_strip_nulls(...)::text, '{}') AS "dynamicProperties",
  -- 25. informationWithheld
  NULL::text                                                                    AS "informationWithheld"
FROM public.observations o
JOIN public.contributors c       ON c.id = o.contributor_id
JOIN dwc.taxa_classification tc  ON tc.taxon_id = o.taxon_id;
```

**New native branch cols 19–25 after Phase 12** — insert `institutionCode` at 19, flip `rightsHolder` to constant, replace `datasetName` with FK join:
```sql
  -- 19 (NEW): institutionCode
  'SalishSea'::text                                                              AS "institutionCode",
  -- 20 (was 20): rightsHolder — CONSTANT (was c.name)
  'SalishSea.io'::text                                                           AS "rightsHolder",
  -- 21 (was 21): datasetName — per-collection via FK join
  ('SalishSea.io — ' || c_coll.name)::text                                       AS "datasetName",
  -- 22 (unchanged): datasetID
  'https://salishsea.io/datasets/occurrences-v1'::text                           AS "datasetID",
  -- 23 (unchanged): license
  'https://creativecommons.org/licenses/by-nc/4.0/legalcode'::text               AS "license",
  -- 24 (unchanged): dynamicProperties
  ...
  -- 25 (unchanged): informationWithheld
  NULL::text                                                                     AS "informationWithheld"
FROM public.observations o
JOIN public.contributors c       ON c.id = o.contributor_id
JOIN dwc.taxa_classification tc  ON tc.taxon_id = o.taxon_id
JOIN public.collections c_coll   ON c_coll.id = o.collection_id;
-- Note: public.observations.collection_id has NOT NULL DEFAULT pointing to 'salishsea-direct'
-- so a plain JOIN (not LEFT JOIN) is correct here.
```

**Maplify branch WHERE clause (current, around line 490):**
```sql
WHERE NOT s.is_test
  AND s.number_sighted BETWEEN 1 AND 1000
  AND s.source != 'rwsas'
```

**New Maplify WHERE clause (Phase 12):**
```sql
WHERE NOT s.is_test
  AND s.number_sighted BETWEEN 1 AND 1000
  AND s.source != 'rwsas'
  AND s.trusted                            -- D-05: trusted-only export
```

**Maplify cols 19–21 replacement** — current CROSS JOIN LATERAL `dn.display_name` pattern replaced with FK join + regex:
```sql
  -- 19 (NEW): recordedBy extracted from comments headline
  NULLIF(
    (CASE
      WHEN (regexp_match(split_part(s.comments, '<br>', 1),
                         '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ '[,]'
        OR (regexp_match(split_part(s.comments, '<br>', 1),
                         '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ '^IDs?\s'
      THEN NULL
      ELSE (regexp_match(split_part(s.comments, '<br>', 1),
                         '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1]
    END)::text,
    NULL
  )                                                                              AS "recordedBy",
  -- 20 (NEW): institutionCode — CONSTANT
  'SalishSea'::text                                                              AS "institutionCode",
  -- 21 (was rightsHolder): rightsHolder — CONSTANT (was dn.display_name)
  'SalishSea.io'::text                                                           AS "rightsHolder",
  -- 22 (was datasetName): datasetName — per-collection via FK join + COALESCE fallback
  ('SalishSea.io — ' || COALESCE(c_coll.name, 'Whale Alert (Global)'))::text    AS "datasetName",
  -- 23 (unchanged): datasetID
  'https://salishsea.io/datasets/occurrences-v1'::text                           AS "datasetID",
  ...
LEFT JOIN public.collections c_coll ON c_coll.id = s.collection_id
-- LEFT JOIN required: s.collection_id can be NULL (FARPB rows)
```

**UNION view pattern (unchanged structure):**
```sql
CREATE VIEW dwc.occurrences AS
  SELECT * FROM dwc._native_occurrences
  UNION ALL
  SELECT * FROM dwc._maplify_occurrences;
```

**`dwc.datasets` version bump (CREATE OR REPLACE is fine here — column count unchanged):**
```sql
CREATE OR REPLACE VIEW dwc.datasets AS
SELECT * FROM (VALUES (
  'https://salishsea.io/datasets/occurrences-v1'::text,
  NULL::text,
  'SalishSea.io Cetacean Occurrences (v1.3)'::text,   -- v1.2 → v1.3
  ...  -- all other columns identical to current migration
)) AS d (...);
```

---

### `scripts/dwca/fields.ts` (config, transform)

**Analog:** itself — `scripts/dwca/fields.ts` lines 48–76

**Current 25-entry array tail (lines 67–76):**
```typescript
    { name: 'recordedBy', termUri: 'http://rs.tdwg.org/dwc/terms/recordedBy' },
    // dcterms — NOT dwc/terms; per F-03 the URI is carried literally per entry.
    { name: 'rightsHolder', termUri: 'http://purl.org/dc/terms/rightsHolder' },
    { name: 'datasetName', termUri: 'http://rs.tdwg.org/dwc/terms/datasetName' },
    { name: 'datasetID', termUri: 'http://rs.tdwg.org/dwc/terms/datasetID' },
    // dcterms — NOT dwc/terms; per F-03 the URI is carried literally per entry.
    { name: 'license', termUri: 'http://purl.org/dc/terms/license' },
    { name: 'dynamicProperties', termUri: 'http://rs.tdwg.org/dwc/terms/dynamicProperties' },
    { name: 'informationWithheld', termUri: 'http://rs.tdwg.org/dwc/terms/informationWithheld' },
] as const satisfies readonly OccurrenceField[];
```

**New 26-entry array tail (Phase 12)** — insert `institutionCode` at index 19, shift dcterms pair to {20, 23}:
```typescript
    { name: 'recordedBy',         termUri: 'http://rs.tdwg.org/dwc/terms/recordedBy' },         // 18
    { name: 'institutionCode',    termUri: 'http://rs.tdwg.org/dwc/terms/institutionCode' },     // 19 NEW
    // dcterms — NOT dwc/terms; per F-03 the URI is carried literally per entry.
    { name: 'rightsHolder',       termUri: 'http://purl.org/dc/terms/rightsHolder' },            // 20 (was 19)
    { name: 'datasetName',        termUri: 'http://rs.tdwg.org/dwc/terms/datasetName' },         // 21 (was 20)
    { name: 'datasetID',          termUri: 'http://rs.tdwg.org/dwc/terms/datasetID' },           // 22 (was 21)
    // dcterms — NOT dwc/terms; per F-03 the URI is carried literally per entry.
    { name: 'license',            termUri: 'http://purl.org/dc/terms/license' },                 // 23 (was 22)
    { name: 'dynamicProperties',  termUri: 'http://rs.tdwg.org/dwc/terms/dynamicProperties' },   // 24 (was 23)
    { name: 'informationWithheld',termUri: 'http://rs.tdwg.org/dwc/terms/informationWithheld' }, // 25 (was 24)
] as const satisfies readonly OccurrenceField[];
```

**Header comment update** — the current header (lines 43–46) says "25-entry" and "index 19 (`rightsHolder`) and 22 (`license`)". Update to "26-entry" and "index 20 (`rightsHolder`) and 23 (`license`)".

---

### `scripts/dwca/fields.test.ts` (test, transform)

**Analog:** itself — `scripts/dwca/fields.test.ts` lines 16–101

**`EXPECTED_OCCURRENCE_NAMES` array (lines 16–42)** — insert `'institutionCode'` at index 19:
```typescript
const EXPECTED_OCCURRENCE_NAMES = [
    // ... indices 0-18 unchanged ...
    'recordedBy',        // 18
    'institutionCode',   // 19 NEW
    'rightsHolder',      // 20 (was 19)
    'datasetName',       // 21 (was 20)
    'datasetID',         // 22 (was 21)
    'license',           // 23 (was 22)
    'dynamicProperties', // 24 (was 23)
    'informationWithheld', // 25 (was 24)
] as const;
```

**Length assertion (line 61)** — update `25` to `26`:
```typescript
    test('contains exactly 26 entries matching RESEARCH §T4 occurrence table', () => {
        expect(OCCURRENCE_FIELDS.length).toBe(26);
    });
```

**Dcterms position test (lines 77–82)** — update positions from {19, 22} to {20, 23}:
```typescript
    test('positions 20 and 23 are the dcterms pair (rightsHolder, license)', () => {
        expect(OCCURRENCE_FIELDS[20]?.name).toBe('rightsHolder');
        expect(OCCURRENCE_FIELDS[20]?.termUri).toBe('http://purl.org/dc/terms/rightsHolder');
        expect(OCCURRENCE_FIELDS[23]?.name).toBe('license');
        expect(OCCURRENCE_FIELDS[23]?.termUri).toBe('http://purl.org/dc/terms/license');
    });
```

**Non-dcterms URI invariant (lines 84–91)** — update exclusion set from `{19, 22}` to `{20, 23}`:
```typescript
    test('every non-dcterms index (i.e. i ∉ {20, 23}) carries a dwc/terms URI', () => {
        OCCURRENCE_FIELDS.forEach((field, i) => {
            if (i === 20 || i === 23) return;
            expect(
                field.termUri.startsWith('http://rs.tdwg.org/dwc/terms/'),
                `index ${i} (${field.name}) should use dwc/terms but is "${field.termUri}"`,
            ).toBe(true);
        });
    });
```

**Add a new test for `institutionCode` at index 19** (following the pattern of the `occurrenceID` test at lines 72–75):
```typescript
    test('index 19 is institutionCode with dwc/terms URI', () => {
        expect(OCCURRENCE_FIELDS[19]?.name).toBe('institutionCode');
        expect(OCCURRENCE_FIELDS[19]?.termUri).toBe('http://rs.tdwg.org/dwc/terms/institutionCode');
    });
```

---

### `scripts/dwca/meta-xml.test.ts` (test, transform)

**Analog:** itself — `scripts/dwca/meta-xml.test.ts` lines 66–105

**Field count assertion (lines 66–71)** — update hardcoded `31` to `32`:
```typescript
    test('total `<field index="…"` count equals OCCURRENCE_FIELDS.length + MULTIMEDIA_FIELDS.length (= 32)', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const count = (xml.match(/<field index="/g) ?? []).length;
        expect(count).toBe(OCCURRENCE_FIELDS.length + MULTIMEDIA_FIELDS.length);
        expect(count).toBe(32);
    });
```

**Dcterms position tests (lines 93–105)** — update from {19, 22} to {20, 23}:
```typescript
    test('core index 20 is dcterms rightsHolder', () => {
        ...
        expect(pairs[20]).toEqual(['20', 'http://purl.org/dc/terms/rightsHolder']);
    });

    test('core index 23 is dcterms license', () => {
        ...
        expect(pairs[23]).toEqual(['23', 'http://purl.org/dc/terms/license']);
    });
```

**Add a new test for `institutionCode` at index 19** (following same pattern as the dcterms tests):
```typescript
    test('core index 19 is dwc/terms institutionCode', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const coreBlock = sliceBetween(xml, /<core\b[^>]*>/, '</core>');
        const pairs = extractFields(coreBlock);
        expect(pairs[19]).toEqual(['19', 'http://rs.tdwg.org/dwc/terms/institutionCode']);
    });
```

The ordinal alignment test (lines 75–90) that iterates `OCCURRENCE_FIELDS.map((f, i) => [String(i), f.termUri])` requires NO changes — it derives expected pairs dynamically from the array.

---

### `scripts/dwca/eml.ts` (utility, request-response)

**Analog:** itself — `scripts/dwca/eml.ts`

**New `AssociatedParty` interface** — add after the existing `EmlInput` interface (lines 75–81):
```typescript
export interface AssociatedParty {
    readonly name: string;
    readonly url: string;
    readonly role: 'contentProvider';
}
```

**Extended `EmlInput` interface** (lines 75–81):
```typescript
export interface EmlInput {
    readonly datasets: DatasetsRow;
    readonly temporalCoverage: {
        readonly begin: string;
        readonly end: string;
    };
    readonly associatedParties: readonly AssociatedParty[];   // NEW
}
```

**`buildEml` function signature** — receives `input.associatedParties` from the new field.

**Placement in EML document** — the `<associatedParty>` block goes after `<metadataProvider>` and before `<pubDate>` per GBIF EML 2.1.1 schema sequence. Current structure (lines 152–163):
```typescript
    return `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml ...>
  <dataset>
    <title>${xmlEsc(d.title)}</title>
    <creator>...</creator>
    <metadataProvider>...</metadataProvider>
    <pubDate>...                   ← insert associatedParty block BEFORE this
```

**New `<associatedParty>` block** using the same `xmlEsc` pattern already established:
```typescript
    const associatedPartyXml = input.associatedParties
        .map(
            (p) =>
                `    <associatedParty>\n` +
                `      <organizationName>${xmlEsc(p.name)}</organizationName>\n` +
                `      <onlineUrl>${xmlEsc(p.url)}</onlineUrl>\n` +
                `      <role>contentProvider</role>\n` +
                `    </associatedParty>`,
        )
        .join('\n');
```

Then interpolate `${associatedPartyXml}` between `<metadataProvider>` block and `<pubDate>`.

**Hardcoded org prose at lines 134–142** (`methodsPara2` mentioning "Orca Network and Cascadia Research Collective") — leave unchanged this phase; it remains factually accurate per RESEARCH §Pattern 6.

---

### `scripts/dwca/eml.test.ts` (test, request-response)

**Analog:** itself — `scripts/dwca/eml.test.ts`

**`mockInput` update (lines 48–51)** — add `associatedParties` field:
```typescript
const mockInput: EmlInput = {
    datasets: mockDatasets,
    temporalCoverage: { begin: '2020-01-01', end: '2026-06-17' },
    associatedParties: [
        { name: 'Orca Network', url: 'https://orcanetwork.org', role: 'contentProvider' },
        { name: 'Cascadia Research Collective', url: 'https://cascadiaresearch.org', role: 'contentProvider' },
    ],
};
```

**Version string update (line 26 and line 78)** — `v1.2` → `v1.3`:
```typescript
    title: 'SalishSea.io Cetacean Occurrences (v1.3)',  // line 26 in mockDatasets
```
```typescript
        expect(xml).toContain('<title>SalishSea.io Cetacean Occurrences (v1.3)</title>');  // line 78
```

**New `associatedParty` tests** — follow the pattern of "required elements present" tests (lines 53–119), using `toContain` on substring matches:
```typescript
describe('buildEml — associatedParty (ATTR-04)', () => {
    test('associatedParty block is present for each party in the input', () => {
        const xml = buildEml(mockInput);
        expect(xml).toContain('<associatedParty>');
        expect(xml).toContain('<organizationName>Orca Network</organizationName>');
        expect(xml).toContain('<onlineUrl>https://orcanetwork.org</onlineUrl>');
        expect(xml).toContain('<role>contentProvider</role>');
    });

    test('associatedParty is placed before <coverage> in the document', () => {
        const xml = buildEml(mockInput);
        const apIdx = xml.indexOf('<associatedParty>');
        const covIdx = xml.indexOf('<coverage>');
        expect(apIdx).toBeGreaterThan(0);
        expect(apIdx).toBeLessThan(covIdx);
    });

    test('empty associatedParties produces no <associatedParty> element', () => {
        const xml = buildEml({ ...mockInput, associatedParties: [] });
        expect(xml).not.toContain('<associatedParty>');
    });

    test('org name/URL in associatedParty are XML-escaped', () => {
        const xml = buildEml({
            ...mockInput,
            associatedParties: [{ name: 'Org & Co', url: 'https://example.com/?a=1&b=2', role: 'contentProvider' }],
        });
        expect(xml).toContain('<organizationName>Org &amp; Co</organizationName>');
        expect(xml).toContain('<onlineUrl>https://example.com/?a=1&amp;b=2</onlineUrl>');
    });
});
```

---

### `scripts/dwca/guard.ts` and `scripts/dwca/guard.test.ts` (utility + test, request-response)

**Analog:** themselves — no code changes required per RESEARCH §Pattern 8.

The guard queries `COUNT(*) FROM pgdb.dwc.occurrences` (line 104) and the `ROW_FLOOR = 1000` (line 41). After Phase 12, the view's Maplify branch emits only trusted rows, reducing the row count. The 1,000 floor remains valid (prod has ~6,800 total rows, trusted-only Maplify expected well above 1,000).

`guard.test.ts` mocks DuckDB and does not hardcode expected row counts — no changes needed.

**No-change confirmation pattern** — the guard's row-count query:
```typescript
        const result = await conn.runAndReadAll(
            'SELECT COUNT(*) FROM pgdb.dwc.occurrences',
        );
```
This query reads the rebuilt view automatically. No SQL change required.

---

### `scripts/dwca/build.ts` (utility, CRUD)

**Analog:** itself — specifically Step 15–17 (lines 308–348) which pattern the new associated parties query.

**Current Step 16 pattern** (lines 335–344) — reads a single view into typed row:
```typescript
        const datasetsReader = await conn.runAndReadAll(
            'SELECT * FROM pgdb.dwc.datasets LIMIT 1',
        );
        const datasetsRows = datasetsReader.getRowObjects();
        if (datasetsRows.length === 0) {
            throw new Error('dwc.datasets is empty ...');
        }
        const datasetsRow = datasetsRows[0] as unknown as DatasetsRow;
```

**New Step 15.5** — add associated parties query between Step 15 (temporal coverage) and Step 16 (datasets read), following the same `runAndReadAll` + `getRowObjects()` pattern:
```typescript
        // Step 15.5: Query associated parties (D-08 — data-driven, trusted rows only).
        const partiesReader = await conn.runAndReadAll(`
            SELECT DISTINCT org.name, org.url
            FROM maplify.sightings s
            JOIN public.collections c ON c.id = s.collection_id
            JOIN public.organizations org ON org.id = c.organization_id
            WHERE s.trusted = TRUE
              AND NOT s.is_test
              AND s.number_sighted BETWEEN 1 AND 1000
              AND s.source != 'rwsas'
            UNION
            SELECT DISTINCT org.name, org.url
            FROM public.observations o
            JOIN public.collections c ON c.id = o.collection_id
            JOIN public.organizations org ON org.id = c.organization_id
            ORDER BY name
        `);
        const associatedParties = partiesReader.getRowObjects().map((row) => ({
            name: String(row['name']),
            url: String(row['url']),
            role: 'contentProvider' as const,
        }));
```

**Step 17 update** — pass `associatedParties` to `buildEml` (line 348):
```typescript
        // Before:
        const emlXml = buildEml({ datasets: datasetsRow, temporalCoverage });
        // After:
        const emlXml = buildEml({ datasets: datasetsRow, temporalCoverage, associatedParties });
```

**`TAB_COLLAPSE_COLS` update (lines 60–66)** — `'datasetName'` is already in the set; no change needed. `'institutionCode'` is a constant `'SalishSea'` — no tabs possible, does NOT need to be added.

---

### `supabase/snippets/12_dwc_attribution_assertions.sql` (config, CRUD)

**Analog:** `supabase/snippets/11_resolution_assertions.sql` (the full file)

**File header pattern** (lines 1–27 of `11_resolution_assertions.sql`):
```sql
\set ON_ERROR_STOP on
\echo === Phase 12 DwC view rebuild verification ===
--
-- Validates the Phase 12 DwC view rebuild migration.
-- Every block corresponds to a success criterion in
-- .planning/phases/12-dwc-view-rebuild/12-NN-PLAN.md.
--
-- Run (local):
--   npx supabase db reset
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/snippets/12_dwc_attribution_assertions.sql
--
-- LOCAL vs PROD: Some SC blocks require prod data. Mark with PROD-ONLY comment
-- and comment out locally.
```

**SC block pattern** (DO $$ ... $$ from `11_resolution_assertions.sql` lines 40–64):
```sql
\echo SC#N: <description>
DO $$
DECLARE
  n BIGINT;
  v TEXT;
BEGIN
  <assertion body>;
  IF <fail condition> THEN
    RAISE EXCEPTION 'SC#N FAIL: <message>', <values>;
  END IF;
END $$;
```

**SC#1 — institutionCode is always 'SalishSea' (ATTR-01):**
```sql
\echo SC#1: institutionCode is always SalishSea on all rows
DO $$ DECLARE n BIGINT; BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences WHERE "institutionCode" IS DISTINCT FROM 'SalishSea';
  IF n > 0 THEN
    RAISE EXCEPTION 'SC#1 FAIL: % rows have institutionCode != SalishSea', n;
  END IF;
END $$;
```

**SC#2 — rightsHolder is always 'SalishSea.io' (ATTR-01):**
```sql
\echo SC#2: rightsHolder is always SalishSea.io on all rows
DO $$ DECLARE n BIGINT; BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences WHERE "rightsHolder" IS DISTINCT FROM 'SalishSea.io';
  IF n > 0 THEN
    RAISE EXCEPTION 'SC#2 FAIL: % rows have rightsHolder != SalishSea.io', n;
  END IF;
END $$;
```

**SC#3 — datasetName always prefixed 'SalishSea.io — ' and no NULL (ATTR-02):**
```sql
\echo SC#3: datasetName always prefixed SalishSea.io — , no NULL
DO $$ DECLARE n BIGINT; BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences
   WHERE "datasetName" IS NULL OR "datasetName" NOT LIKE 'SalishSea.io — %';
  IF n > 0 THEN
    RAISE EXCEPTION 'SC#3 FAIL: % rows have NULL or wrong-prefix datasetName', n;
  END IF;
END $$;
```

**SC#4 — `dwc.occurrences` has 26 columns (field contract, ATTR-03):**
```sql
\echo SC#4: dwc.occurrences has exactly 26 columns
DO $$ DECLARE n INT; BEGIN
  SELECT COUNT(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'dwc' AND table_name = 'occurrences';
  IF n <> 26 THEN
    RAISE EXCEPTION 'SC#4 FAIL: dwc.occurrences has % columns (expected 26)', n;
  END IF;
END $$;
```

**SC#5 — row count > 0 (ATTR-03, PROD-ONLY for meaningful floor):**
```sql
\echo SC#5 (local/smoke): dwc.occurrences is non-empty
DO $$ DECLARE n BIGINT; BEGIN
  SELECT COUNT(*) INTO n FROM dwc.occurrences;
  IF n = 0 THEN
    RAISE EXCEPTION 'SC#5 FAIL: dwc.occurrences is empty';
  END IF;
END $$;

-- PROD-ONLY: meaningful floor check (trusted-only Maplify baseline)
-- DO $$ DECLARE n BIGINT; BEGIN
--   SELECT COUNT(*) INTO n FROM dwc.occurrences;
--   IF n < 1000 THEN
--     RAISE EXCEPTION 'SC#5 PROD FAIL: only % rows in dwc.occurrences (floor 1000)', n;
--   END IF;
-- END $$;
```

**SC#6 — version string is v1.3 in dwc.datasets:**
```sql
\echo SC#6: dwc.datasets title contains v1.3
DO $$ DECLARE v TEXT; BEGIN
  SELECT title INTO v FROM dwc.datasets LIMIT 1;
  IF v NOT LIKE '%v1.3%' THEN
    RAISE EXCEPTION 'SC#6 FAIL: dwc.datasets title is "%" (expected v1.3)', v;
  END IF;
END $$;
```

**D-03 census snippet** — separate file `supabase/snippets/12_comments_census.sql`:
```sql
-- D-03: Census of parenthetical patterns in trusted maplify.sightings.comments
-- Read-only prod query. Commit output as maplify_trusted_comments_census.tsv.
-- Run BEFORE finalizing the recordedBy regex in the migration.
SELECT
  (regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] AS extracted,
  COUNT(*) AS n
FROM maplify.sightings
WHERE trusted = TRUE
GROUP BY 1
ORDER BY n DESC;
```

**Footer pattern** (line 310 of `11_resolution_assertions.sql`):
```sql
\echo === All Phase 12 local assertions passed ===
```

---

## Shared Patterns

### Cast discipline for UNION ALL
**Source:** `supabase/migrations/20260617203900_dwc_schema.sql` lines 222–302
**Apply to:** every new or changed expression in both branch views

Every scalar carries an explicit `::text`, `::double precision`, or `::integer` cast. New expressions `'SalishSea'`, `'SalishSea.io'`, the `datasetName` concatenation, and the recordedBy regex result must ALL carry `::text`. The UNION view enforces type parity at `CREATE VIEW` time.

### `DO $$ ... $$ RAISE EXCEPTION` assertion pattern
**Source:** `supabase/snippets/11_resolution_assertions.sql` (throughout)
**Apply to:** all SC blocks in `12_dwc_attribution_assertions.sql`

Pattern: `\echo SC#N: description` → `DO $$ DECLARE ... BEGIN ... IF <fail> THEN RAISE EXCEPTION 'SC#N FAIL: ...'; END IF; END $$;`

### PROD-ONLY comment-out pattern
**Source:** `supabase/snippets/11_resolution_assertions.sql` lines 293–308
**Apply to:** any assertion in `12_dwc_attribution_assertions.sql` that requires prod row counts

Comment out with `-- PROD-ONLY:` header and a clear note not to uncomment against `db reset`.

### `xmlEsc()` for all EML string interpolation
**Source:** `scripts/dwca/eml.ts` lines 91–98
**Apply to:** all `associatedParty` field values in the new `<associatedParty>` block

The existing `xmlEsc` function handles `&`, `<`, `>`, `"`. Apply to both `p.name` and `p.url` before interpolation.

### `runAndReadAll` + `getRowObjects()` for DuckDB queries
**Source:** `scripts/dwca/build.ts` lines 335–344 (Step 16 datasets query)
**Apply to:** Step 15.5 associated parties query in `build.ts`

Pattern: `await conn.runAndReadAll(sql)` → `.getRowObjects()` → map to typed objects.

---

## No Analog Found

All files have close analogs in the codebase. No new patterns need to be imported from RESEARCH.md's external references.

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/snippets/`, `scripts/dwca/`
**Files read:** 10 source files
**Pattern extraction date:** 2026-06-21
