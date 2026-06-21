/**
 * Artifact-level verifier for the built DarwinCore Archive — Phase 13 Plan 01.
 *
 * Parses `dist/dwca/occurrence.txt` (tab-delimited, header row) and
 * `dist/dwca/eml.xml` and asserts:
 *
 *   SC#2  — No occurrenceID is prefixed 'inaturalist:' or 'happywhale:'
 *   SC#3a — Every row's institutionCode === 'SalishSea'
 *   SC#3b — Every row's rightsHolder === 'SalishSea.io'
 *   SC#3c — Every row's datasetName starts with 'SalishSea.io — '
 *   SC#3d — recordedBy spot-check: none of the known opaque source codes
 *   SC#4b — eml.xml contains the v1.3 title literal
 *   SC#4a — eml.xml contains >=1 <associatedParty> crediting an upstream org
 *            AND no upstream org name appears in any institutionCode element
 *
 * Columns are resolved BY NAME via `buildHeaderIndex` keyed off
 * `OCCURRENCE_FIELDS` from `./fields.ts` — never by hardcoded integer index
 * (Pitfall 6 off-by-one prevention).
 *
 * CLI invocation:
 *   npx tsx scripts/dwca/verify-artifact.ts
 *   npx tsx scripts/dwca/verify-artifact.ts --occurrence dist/dwca/occurrence.txt --eml dist/dwca/eml.xml
 *
 * Cross-reference:
 *   - 13-01-PLAN.md Task 1 for the full behavior spec.
 *   - .planning/research/PITFALLS.md §"Looks Done But Isn't Checklist" items 4/5/6/10.
 *   - scripts/dwca/fields.ts — OCCURRENCE_FIELDS canonical ordered contract.
 *   - scripts/dwca/eml.ts — associatedParty block shape.
 */

import { readFileSync } from 'node:fs';
import { OCCURRENCE_FIELDS } from './fields.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default paths — relative to the repo root when invoked as a CLI script. */
const DEFAULT_OCCURRENCE_PATH = 'dist/dwca/occurrence.txt';
const DEFAULT_EML_PATH = 'dist/dwca/eml.xml';

/** v1.3 archive title that must appear verbatim in eml.xml (SC#4b). */
const EML_V13_TITLE = 'SalishSea.io Cetacean Occurrences (v1.3)';

/** Known opaque source codes that must NOT appear as recordedBy values (SC#3d). */
const OPAQUE_SOURCE_CODES = ['whalealertoa', 'whalealertak', 'rwsas'] as const;

// ---------------------------------------------------------------------------
// Column index resolution
// ---------------------------------------------------------------------------

/**
 * Build a map from column name → 0-based index by splitting the TSV header
 * line on '\t'. Throws if any name in OCCURRENCE_FIELDS is absent from the
 * header — a drift guard so a shifted column cannot silently pass an assertion.
 *
 * @param headerLine — The first (header) line of occurrence.txt, without a trailing newline.
 * @returns Map from column name to 0-based index.
 * @throws Error if any OCCURRENCE_FIELDS column name is absent from the header.
 */
export function buildHeaderIndex(headerLine: string): Map<string, number> {
    const columns = headerLine.split('\t');
    const index = new Map<string, number>();
    for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (col !== undefined) {
            index.set(col, i);
        }
    }
    // Drift guard: every OCCURRENCE_FIELDS name must be present.
    const missing: string[] = [];
    for (const field of OCCURRENCE_FIELDS) {
        if (!index.has(field.name)) {
            missing.push(field.name);
        }
    }
    if (missing.length > 0) {
        throw new Error(
            `buildHeaderIndex: occurrence.txt header is missing columns required by OCCURRENCE_FIELDS: ${missing.join(', ')}`,
        );
    }
    return index;
}

// ---------------------------------------------------------------------------
// Occurrence row assertions (pure — receives already-read content)
// ---------------------------------------------------------------------------

/**
 * Assert SC#2: no occurrenceID is prefixed 'inaturalist:' or 'happywhale:'.
 *
 * @param headerLine — Header line (without newline).
 * @param dataLines  — Array of data lines (without newlines; empty lines ignored).
 * @throws Error with the first offending occurrenceID and total count.
 */
export function assertNoExcludedOccurrenceIDs(
    headerLine: string,
    dataLines: readonly string[],
): void {
    const idx = buildHeaderIndex(headerLine);
    const occIdx = idx.get('occurrenceID')!;
    const offenders: string[] = [];

    for (const line of dataLines) {
        if (!line) continue;
        const fields = line.split('\t');
        const id = fields[occIdx] ?? '';
        if (/^(inaturalist|happywhale):/.test(id)) {
            offenders.push(id);
        }
    }

    if (offenders.length > 0) {
        throw new Error(
            `SC#2 FAIL: ${offenders.length} occurrence(s) have excluded occurrenceID prefix. ` +
            `First offender: "${offenders[0]}"`,
        );
    }
}

/**
 * Assert SC#3a: every row's institutionCode === 'SalishSea'.
 *
 * @throws Error with count and sample of distinct offending values.
 */
export function assertInstitutionCode(
    headerLine: string,
    dataLines: readonly string[],
): void {
    const idx = buildHeaderIndex(headerLine);
    const colIdx = idx.get('institutionCode')!;
    let badCount = 0;
    const badValues = new Set<string>();

    for (const line of dataLines) {
        if (!line) continue;
        const fields = line.split('\t');
        const val = fields[colIdx] ?? '';
        if (val !== 'SalishSea') {
            badCount++;
            badValues.add(val || '(empty)');
        }
    }

    if (badCount > 0) {
        const sample = [...badValues].slice(0, 5).join(', ');
        throw new Error(
            `SC#3a FAIL: ${badCount} row(s) have institutionCode !== 'SalishSea'. ` +
            `Distinct offending values (sample): ${sample}`,
        );
    }
}

/**
 * Assert SC#3b: every row's rightsHolder === 'SalishSea.io'.
 *
 * @throws Error with distinct offending values.
 */
export function assertRightsHolder(
    headerLine: string,
    dataLines: readonly string[],
): void {
    const idx = buildHeaderIndex(headerLine);
    const colIdx = idx.get('rightsHolder')!;
    const badValues = new Set<string>();

    for (const line of dataLines) {
        if (!line) continue;
        const fields = line.split('\t');
        const val = fields[colIdx] ?? '';
        if (val !== 'SalishSea.io') {
            badValues.add(val || '(empty)');
        }
    }

    if (badValues.size > 0) {
        const sample = [...badValues].slice(0, 5).join(', ');
        throw new Error(
            `SC#3b FAIL: rows have rightsHolder !== 'SalishSea.io'. ` +
            `Distinct offending values: ${sample}`,
        );
    }
}

/**
 * Assert SC#3c: every row's datasetName starts with 'SalishSea.io — '.
 *
 * @throws Error with count and sample of offending values.
 */
export function assertDatasetNamePrefix(
    headerLine: string,
    dataLines: readonly string[],
): void {
    const idx = buildHeaderIndex(headerLine);
    const colIdx = idx.get('datasetName')!;
    let badCount = 0;
    const badSamples: string[] = [];

    for (const line of dataLines) {
        if (!line) continue;
        const fields = line.split('\t');
        const val = fields[colIdx] ?? '';
        if (!val.startsWith('SalishSea.io — ')) {
            badCount++;
            if (badSamples.length < 5) badSamples.push(`"${val}"`);
        }
    }

    if (badCount > 0) {
        throw new Error(
            `SC#3c FAIL: ${badCount} row(s) have datasetName not starting with 'SalishSea.io — '. ` +
            `Sample offenders: ${badSamples.join(', ')}`,
        );
    }
}

/**
 * Spot-check SC#3d: emit up to 5 sample maplify-prefixed rows to stdout,
 * showing recordedBy is either a human-name string or empty (NULL).
 * Non-fatal: logs a warning if any of the known opaque source codes appear
 * as recordedBy, but does NOT throw (it is a spot-check/report, not a hard gate).
 *
 * @returns true if opaque codes were found (for testing), false otherwise.
 */
export function spotCheckRecordedBy(
    headerLine: string,
    dataLines: readonly string[],
): boolean {
    const idx = buildHeaderIndex(headerLine);
    const occIdx = idx.get('occurrenceID')!;
    const recordedByIdx = idx.get('recordedBy')!;

    const maplifyRows = dataLines
        .filter((l) => l && l.startsWith('maplify:'))
        .slice(0, 5);

    if (maplifyRows.length > 0) {
        console.log('SC#3d spot-check — maplify recordedBy sample:');
        for (const row of maplifyRows) {
            const fields = row.split('\t');
            const id = fields[occIdx] ?? '';
            const rb = fields[recordedByIdx] ?? '';
            console.log(`  ${id}: recordedBy=${rb || '(empty)'}`);
        }
    }

    // Check for opaque codes
    let foundOpaque = false;
    for (const line of dataLines) {
        if (!line) continue;
        const fields = line.split('\t');
        const rb = fields[recordedByIdx] ?? '';
        if ((OPAQUE_SOURCE_CODES as readonly string[]).includes(rb)) {
            console.warn(`SC#3d WARNING: opaque recordedBy code found: "${rb}"`);
            foundOpaque = true;
        }
    }

    return foundOpaque;
}

// ---------------------------------------------------------------------------
// EML assertions (pure — receives already-read XML string)
// ---------------------------------------------------------------------------

/**
 * Assert SC#4b: the EML XML contains the v1.3 archive title verbatim.
 *
 * @param xml — Full eml.xml content as a string.
 * @throws Error if the v1.3 title element is absent.
 */
export function assertEmlTitle(xml: string): void {
    const expected = `<title>${EML_V13_TITLE}</title>`;
    if (!xml.includes(expected)) {
        throw new Error(
            `SC#4b FAIL: eml.xml does not contain the expected v1.3 title element. ` +
            `Expected: "${expected}"`,
        );
    }
}

/**
 * Extract organization names from `<associatedParty>` blocks in the EML XML.
 *
 * Each block has the shape:
 *   <associatedParty>
 *     <organizationName>…</organizationName>
 *     <onlineUrl>…</onlineUrl>
 *     <role>contentProvider</role>
 *   </associatedParty>
 *
 * We extract every `<organizationName>` that sits INSIDE an `<associatedParty>`
 * span using a simple regex over each block — mirroring the literal shape in eml.ts.
 *
 * @returns Array of org names extracted from associatedParty blocks (may be empty).
 */
function extractAssociatedPartyOrgNames(xml: string): string[] {
    const orgNames: string[] = [];
    // Match each <associatedParty>...</associatedParty> span (non-greedy).
    const blockRe = /<associatedParty>([\s\S]*?)<\/associatedParty>/g;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRe.exec(xml)) !== null) {
        const block = blockMatch[1] ?? '';
        // Within the block, extract <organizationName>...</organizationName>.
        const orgRe = /<organizationName>([\s\S]*?)<\/organizationName>/g;
        let orgMatch: RegExpExecArray | null;
        while ((orgMatch = orgRe.exec(block)) !== null) {
            const name = orgMatch[1]?.trim() ?? '';
            if (name) orgNames.push(name);
        }
    }
    return orgNames;
}

/**
 * Assert SC#4a (two components):
 *   (a) The EML contains >=1 `<associatedParty>` element with a non-empty
 *       `<organizationName>` — at least one upstream org is credited.
 *   (b) None of the upstream org names collected from `<associatedParty>` blocks
 *       appears inside any `<institutionCode>` element in the XML.
 *       The only legitimate institutionCode in the artifact is 'SalishSea'.
 *
 * @param xml — Full eml.xml content as a string.
 * @throws Error if zero associatedParty elements are present, or if an upstream
 *         org name leaks into an institutionCode element.
 */
export function assertEmlAssociatedParties(xml: string): void {
    const orgNames = extractAssociatedPartyOrgNames(xml);

    // (a) At least one associatedParty with an organizationName must be present.
    if (orgNames.length === 0) {
        throw new Error(
            `SC#4a FAIL: eml.xml contains no <associatedParty> elements with an ` +
            `<organizationName> — at least one upstream organization must be credited.`,
        );
    }

    // (b) No upstream org name may appear inside an <institutionCode> element.
    // Extract all <institutionCode> values from the XML (the EML profile itself
    // does not use institutionCode, but we check the full XML defensively).
    const institutionCodeRe = /<institutionCode>([\s\S]*?)<\/institutionCode>/g;
    const institutionCodeValues: string[] = [];
    let icMatch: RegExpExecArray | null;
    while ((icMatch = institutionCodeRe.exec(xml)) !== null) {
        const val = icMatch[1]?.trim() ?? '';
        if (val) institutionCodeValues.push(val);
    }

    for (const orgName of orgNames) {
        for (const icVal of institutionCodeValues) {
            if (icVal.includes(orgName) || orgName.includes(icVal)) {
                // Only flag if the org name is the same (not a substring coincidence for 'SalishSea')
                if (icVal === orgName) {
                    throw new Error(
                        `SC#4a FAIL: upstream org name "${orgName}" appears inside an ` +
                        `<institutionCode> element in eml.xml. Org credit belongs in ` +
                        `<associatedParty>, not institutionCode.`,
                    );
                }
            }
        }
        // More robust check: look for the org name directly in institutionCode content
        if (institutionCodeValues.some((v) => v === orgName)) {
            throw new Error(
                `SC#4a FAIL: upstream org name "${orgName}" appears inside an ` +
                `<institutionCode> element in eml.xml. Org credit belongs in ` +
                `<associatedParty>, not institutionCode.`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Top-level verifier
// ---------------------------------------------------------------------------

/**
 * Run all artifact-level verification checks.
 *
 * @param opts.occurrencePath — Path to occurrence.txt (defaults to dist/dwca/occurrence.txt).
 * @param opts.emlPath        — Path to eml.xml (defaults to dist/dwca/eml.xml).
 * @param opts.emlXml         — EML XML content as a string (overrides emlPath if provided).
 */
export async function verifyArtifact(opts: {
    occurrencePath?: string;
    emlPath?: string;
    emlXml?: string;
} = {}): Promise<void> {
    const occPath = opts.occurrencePath ?? DEFAULT_OCCURRENCE_PATH;

    // Read occurrence.txt.
    const occContent = readFileSync(occPath, 'utf8');
    const lines = occContent.split('\n');
    const [headerLine, ...dataLinesRaw] = lines;
    if (!headerLine) {
        throw new Error(`verifyArtifact: ${occPath} is empty or has no header line`);
    }
    // Filter out empty trailing lines.
    const dataLines = dataLinesRaw.filter((l) => l.length > 0);

    // Run occurrence.txt assertions.
    assertNoExcludedOccurrenceIDs(headerLine, dataLines);
    console.log(`SC#2 OK: no occurrenceID prefixed 'inaturalist:' or 'happywhale:' (${dataLines.length} rows)`);

    assertInstitutionCode(headerLine, dataLines);
    console.log(`SC#3a OK: all ${dataLines.length} rows have institutionCode='SalishSea'`);

    assertRightsHolder(headerLine, dataLines);
    console.log(`SC#3b OK: all ${dataLines.length} rows have rightsHolder='SalishSea.io'`);

    assertDatasetNamePrefix(headerLine, dataLines);
    console.log(`SC#3c OK: all ${dataLines.length} rows have datasetName starting with 'SalishSea.io — '`);

    const hasOpaque = spotCheckRecordedBy(headerLine, dataLines);
    if (!hasOpaque) {
        console.log('SC#3d OK: no opaque source codes found in recordedBy');
    }

    // Read EML.
    const emlXml = opts.emlXml ?? readFileSync(opts.emlPath ?? DEFAULT_EML_PATH, 'utf8');

    // Run EML assertions.
    assertEmlTitle(emlXml);
    console.log(`SC#4b OK: eml.xml contains the v1.3 title`);

    assertEmlAssociatedParties(emlXml);
    console.log(`SC#4a OK: eml.xml contains >=1 <associatedParty> and no upstream org in institutionCode`);
}

// ---------------------------------------------------------------------------
// main — CLI entry point
// ---------------------------------------------------------------------------

/**
 * CLI entry point. Parses --occurrence and --eml argv flags; falls back to
 * defaults. Exits non-zero on any assertion failure.
 */
export async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const occurrenceFlag = args.indexOf('--occurrence');
    const emlFlag = args.indexOf('--eml');

    const occurrencePath =
        occurrenceFlag !== -1 && args[occurrenceFlag + 1]
            ? args[occurrenceFlag + 1]
            : DEFAULT_OCCURRENCE_PATH;
    const emlPath =
        emlFlag !== -1 && args[emlFlag + 1]
            ? args[emlFlag + 1]
            : DEFAULT_EML_PATH;

    await verifyArtifact({ occurrencePath, emlPath });
    console.log('\nAll artifact checks passed.');
}

// ---------------------------------------------------------------------------
// CLI guard — only runs when invoked directly, not when imported.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
