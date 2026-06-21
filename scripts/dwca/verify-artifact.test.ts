/**
 * Unit tests for `verify-artifact.ts` — fixture-driven, no build / no DB needed.
 *
 * Covers:
 *   - buildHeaderIndex: column name → index map, drift guard (missing column throws)
 *   - assertNoExcludedOccurrenceIDs (SC#2)
 *   - assertInstitutionCode (SC#3a)
 *   - assertRightsHolder (SC#3b)
 *   - assertDatasetNamePrefix (SC#3c)
 *   - assertEmlTitle (SC#4b)
 *   - assertEmlAssociatedParties (SC#4a): presence + no-org-in-institutionCode leak
 *
 * All test data is inline (fixture strings). No file I/O, no network.
 */

import { describe, test, expect } from 'vitest';
import {
    buildHeaderIndex,
    assertNoExcludedOccurrenceIDs,
    assertInstitutionCode,
    assertRightsHolder,
    assertDatasetNamePrefix,
    assertEmlTitle,
    assertEmlAssociatedParties,
} from './verify-artifact.ts';
import { OCCURRENCE_FIELDS } from './fields.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a valid 26-column TSV header line from OCCURRENCE_FIELDS.
 * This guarantees the header is always in sync with the field contract.
 */
const VALID_HEADER = OCCURRENCE_FIELDS.map((f) => f.name).join('\t');

/**
 * Build a minimal valid data row with all required columns set to passing values.
 * Column indices are resolved from OCCURRENCE_FIELDS — never hardcoded.
 */
function makeRow(overrides: Partial<Record<string, string>> = {}): string {
    const defaults: Record<string, string> = {
        occurrenceID: 'maplify:1234',
        basisOfRecord: 'HumanObservation',
        eventDate: '2024-01-15',
        scientificName: 'Orcinus orca',
        taxonRank: 'species',
        kingdom: 'Animalia',
        phylum: 'Chordata',
        class: 'Mammalia',
        order: 'Artiodactyla',
        family: 'Delphinidae',
        genus: 'Orcinus',
        decimalLatitude: '48.5',
        decimalLongitude: '-123.5',
        geodeticDatum: 'WGS84',
        coordinateUncertaintyInMeters: '',
        individualCount: '3',
        occurrenceStatus: 'present',
        occurrenceRemarks: '',
        recordedBy: 'Jane Smith',
        institutionCode: 'SalishSea',
        rightsHolder: 'SalishSea.io',
        datasetName: 'SalishSea.io — Orca Network',
        datasetID: '',
        license: 'https://creativecommons.org/licenses/by/4.0/legalcode',
        dynamicProperties: '',
        informationWithheld: '',
    };

    const merged = { ...defaults, ...overrides };
    return OCCURRENCE_FIELDS.map((f) => merged[f.name] ?? '').join('\t');
}

// ---------------------------------------------------------------------------
// Fixture EML strings
// ---------------------------------------------------------------------------

/**
 * A valid EML XML with the v1.3 title AND two <associatedParty> blocks.
 * No <institutionCode> element is present (EML profile does not use it
 * except as an element inside occurrence extensions, which are absent here).
 */
const VALID_EML = `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1">
  <dataset>
    <title>SalishSea.io Cetacean Occurrences (v1.3)</title>
    <creator>
      <organizationName>SalishSea.io</organizationName>
    </creator>
    <metadataProvider>
      <organizationName>SalishSea.io</organizationName>
    </metadataProvider>
    <associatedParty>
      <organizationName>Orca Network</organizationName>
      <onlineUrl>https://orcanetwork.org</onlineUrl>
      <role>contentProvider</role>
    </associatedParty>
    <associatedParty>
      <organizationName>Cascadia Research Collective</organizationName>
      <onlineUrl>https://cascadiaresearch.org</onlineUrl>
      <role>contentProvider</role>
    </associatedParty>
    <pubDate>2026-06-17</pubDate>
  </dataset>
</eml:eml>`;

/** EML missing the v1.3 title — SC#4b should throw. */
const EML_WRONG_TITLE = `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1">
  <dataset>
    <title>SalishSea.io Cetacean Occurrences (v1.2)</title>
    <associatedParty>
      <organizationName>Orca Network</organizationName>
      <onlineUrl>https://orcanetwork.org</onlineUrl>
      <role>contentProvider</role>
    </associatedParty>
    <pubDate>2026-06-17</pubDate>
  </dataset>
</eml:eml>`;

/** EML with the v1.3 title but ZERO <associatedParty> elements — SC#4a presence should throw. */
const EML_NO_ASSOCIATED_PARTIES = `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1">
  <dataset>
    <title>SalishSea.io Cetacean Occurrences (v1.3)</title>
    <creator>
      <organizationName>SalishSea.io</organizationName>
    </creator>
    <pubDate>2026-06-17</pubDate>
  </dataset>
</eml:eml>`;

/**
 * EML with the v1.3 title AND an <associatedParty> for 'Orca Network',
 * BUT also an <institutionCode> element containing 'Orca Network' —
 * SC#4a leak check should throw.
 */
const EML_ORG_IN_INSTITUTION_CODE = `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1">
  <dataset>
    <title>SalishSea.io Cetacean Occurrences (v1.3)</title>
    <associatedParty>
      <organizationName>Orca Network</organizationName>
      <onlineUrl>https://orcanetwork.org</onlineUrl>
      <role>contentProvider</role>
    </associatedParty>
    <institutionCode>Orca Network</institutionCode>
    <pubDate>2026-06-17</pubDate>
  </dataset>
</eml:eml>`;

// ---------------------------------------------------------------------------
// buildHeaderIndex
// ---------------------------------------------------------------------------

describe('buildHeaderIndex', () => {
    test('builds the correct name→index map for a valid 26-col header', () => {
        const idx = buildHeaderIndex(VALID_HEADER);
        expect(idx.get('occurrenceID')).toBe(0);
        expect(idx.get('recordedBy')).toBe(18);
        expect(idx.get('institutionCode')).toBe(19);
        expect(idx.get('rightsHolder')).toBe(20);
        expect(idx.get('datasetName')).toBe(21);
        expect(idx.size).toBeGreaterThanOrEqual(26);
    });

    test('throws if a required OCCURRENCE_FIELDS column is missing from the header', () => {
        // Remove 'institutionCode' from the header to simulate column drift.
        const badHeader = OCCURRENCE_FIELDS
            .filter((f) => f.name !== 'institutionCode')
            .map((f) => f.name)
            .join('\t');
        expect(() => buildHeaderIndex(badHeader)).toThrowError(/institutionCode/);
    });
});

// ---------------------------------------------------------------------------
// SC#2 — assertNoExcludedOccurrenceIDs
// ---------------------------------------------------------------------------

describe('assertNoExcludedOccurrenceIDs (SC#2)', () => {
    test('passes for rows with no excluded prefixes', () => {
        const rows = [
            makeRow({ occurrenceID: 'maplify:1' }),
            makeRow({ occurrenceID: 'native:2' }),
            makeRow({ occurrenceID: 'salishsea:3' }),
        ];
        expect(() => assertNoExcludedOccurrenceIDs(VALID_HEADER, rows)).not.toThrow();
    });

    test('throws when a row has an inaturalist: occurrenceID', () => {
        const rows = [
            makeRow({ occurrenceID: 'maplify:1' }),
            makeRow({ occurrenceID: 'inaturalist:99999' }),
        ];
        expect(() => assertNoExcludedOccurrenceIDs(VALID_HEADER, rows))
            .toThrowError(/SC#2 FAIL/);
    });

    test('throws when a row has a happywhale: occurrenceID', () => {
        const rows = [makeRow({ occurrenceID: 'happywhale:abc123' })];
        expect(() => assertNoExcludedOccurrenceIDs(VALID_HEADER, rows))
            .toThrowError(/SC#2 FAIL/);
    });

    test('error message includes the first offending occurrenceID', () => {
        const rows = [makeRow({ occurrenceID: 'inaturalist:42' })];
        expect(() => assertNoExcludedOccurrenceIDs(VALID_HEADER, rows))
            .toThrowError(/inaturalist:42/);
    });

    test('handles empty data lines gracefully', () => {
        expect(() => assertNoExcludedOccurrenceIDs(VALID_HEADER, [])).not.toThrow();
        expect(() => assertNoExcludedOccurrenceIDs(VALID_HEADER, ['', '   '])).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// SC#3a — assertInstitutionCode
// ---------------------------------------------------------------------------

describe('assertInstitutionCode (SC#3a)', () => {
    test('passes when all rows have institutionCode=SalishSea', () => {
        const rows = [
            makeRow({ institutionCode: 'SalishSea' }),
            makeRow({ institutionCode: 'SalishSea' }),
        ];
        expect(() => assertInstitutionCode(VALID_HEADER, rows)).not.toThrow();
    });

    test('throws when a row has wrong institutionCode', () => {
        const rows = [
            makeRow({ institutionCode: 'SalishSea' }),
            makeRow({ institutionCode: 'Orca Network' }),
        ];
        expect(() => assertInstitutionCode(VALID_HEADER, rows))
            .toThrowError(/SC#3a FAIL/);
    });

    test('error message includes count of bad rows', () => {
        const rows = [
            makeRow({ institutionCode: 'WrongOrg1' }),
            makeRow({ institutionCode: 'WrongOrg2' }),
        ];
        expect(() => assertInstitutionCode(VALID_HEADER, rows))
            .toThrowError(/2 row/);
    });
});

// ---------------------------------------------------------------------------
// SC#3b — assertRightsHolder
// ---------------------------------------------------------------------------

describe('assertRightsHolder (SC#3b)', () => {
    test('passes when all rows have rightsHolder=SalishSea.io', () => {
        const rows = [makeRow({ rightsHolder: 'SalishSea.io' })];
        expect(() => assertRightsHolder(VALID_HEADER, rows)).not.toThrow();
    });

    test('throws when a row has wrong rightsHolder', () => {
        const rows = [
            makeRow({ rightsHolder: 'SalishSea.io' }),
            makeRow({ rightsHolder: 'Jane Smith' }),
        ];
        expect(() => assertRightsHolder(VALID_HEADER, rows))
            .toThrowError(/SC#3b FAIL/);
    });

    test('error message includes the offending value', () => {
        const rows = [makeRow({ rightsHolder: 'Wrong Owner' })];
        expect(() => assertRightsHolder(VALID_HEADER, rows))
            .toThrowError(/Wrong Owner/);
    });
});

// ---------------------------------------------------------------------------
// SC#3c — assertDatasetNamePrefix
// ---------------------------------------------------------------------------

describe('assertDatasetNamePrefix (SC#3c)', () => {
    test('passes when all rows have datasetName starting with "SalishSea.io — "', () => {
        const rows = [
            makeRow({ datasetName: 'SalishSea.io — Orca Network' }),
            makeRow({ datasetName: 'SalishSea.io — Direct' }),
            makeRow({ datasetName: 'SalishSea.io — Cascadia Research Collective' }),
        ];
        expect(() => assertDatasetNamePrefix(VALID_HEADER, rows)).not.toThrow();
    });

    test('throws when a row has datasetName missing the prefix', () => {
        const rows = [
            makeRow({ datasetName: 'SalishSea.io — Orca Network' }),
            makeRow({ datasetName: 'Orca Network' }),
        ];
        expect(() => assertDatasetNamePrefix(VALID_HEADER, rows))
            .toThrowError(/SC#3c FAIL/);
    });

    test('error includes count of offending rows', () => {
        const rows = [
            makeRow({ datasetName: 'Bad Dataset 1' }),
            makeRow({ datasetName: 'Bad Dataset 2' }),
        ];
        expect(() => assertDatasetNamePrefix(VALID_HEADER, rows))
            .toThrowError(/2 row/);
    });
});

// ---------------------------------------------------------------------------
// SC#4b — assertEmlTitle
// ---------------------------------------------------------------------------

describe('assertEmlTitle (SC#4b)', () => {
    test('passes for EML with the v1.3 title', () => {
        expect(() => assertEmlTitle(VALID_EML)).not.toThrow();
    });

    test('throws for EML with the wrong title (v1.2)', () => {
        expect(() => assertEmlTitle(EML_WRONG_TITLE)).toThrowError(/SC#4b FAIL/);
    });

    test('error message includes the expected title literal', () => {
        expect(() => assertEmlTitle(EML_WRONG_TITLE))
            .toThrowError(/Cetacean Occurrences \(v1\.3\)/);
    });

    test('throws for EML with no title element at all', () => {
        const noTitle = '<eml:eml><dataset><pubDate>2026-01-01</pubDate></dataset></eml:eml>';
        expect(() => assertEmlTitle(noTitle)).toThrowError(/SC#4b FAIL/);
    });
});

// ---------------------------------------------------------------------------
// SC#4a — assertEmlAssociatedParties
// ---------------------------------------------------------------------------

describe('assertEmlAssociatedParties (SC#4a)', () => {
    test('passes for valid EML with >=1 associatedParty and no org in institutionCode', () => {
        expect(() => assertEmlAssociatedParties(VALID_EML)).not.toThrow();
    });

    test('throws when EML has ZERO <associatedParty> elements (presence requirement)', () => {
        expect(() => assertEmlAssociatedParties(EML_NO_ASSOCIATED_PARTIES))
            .toThrowError(/SC#4a FAIL/);
    });

    test('presence-failure error mentions the missing element', () => {
        expect(() => assertEmlAssociatedParties(EML_NO_ASSOCIATED_PARTIES))
            .toThrowError(/associatedParty/);
    });

    test('throws when an upstream org name appears in an <institutionCode> element (leak check)', () => {
        expect(() => assertEmlAssociatedParties(EML_ORG_IN_INSTITUTION_CODE))
            .toThrowError(/SC#4a FAIL/);
    });

    test('leak-check error names the offending org', () => {
        expect(() => assertEmlAssociatedParties(EML_ORG_IN_INSTITUTION_CODE))
            .toThrowError(/Orca Network/);
    });

    test('passing case: EML with two associatedParty blocks and institutionCode=SalishSea does not throw', () => {
        // institutionCode='SalishSea' is not an upstream org name — should pass.
        const emlWithSalishSeaCode = VALID_EML.replace(
            '<pubDate>2026-06-17</pubDate>',
            '<institutionCode>SalishSea</institutionCode>\n    <pubDate>2026-06-17</pubDate>',
        );
        expect(() => assertEmlAssociatedParties(emlWithSalishSeaCode)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Happy path: all checks together
// ---------------------------------------------------------------------------

describe('happy path — all checks pass on valid fixture data', () => {
    const validRows = [
        makeRow({ occurrenceID: 'maplify:1', institutionCode: 'SalishSea', rightsHolder: 'SalishSea.io', datasetName: 'SalishSea.io — Orca Network', recordedBy: 'Jane Smith' }),
        makeRow({ occurrenceID: 'maplify:2', institutionCode: 'SalishSea', rightsHolder: 'SalishSea.io', datasetName: 'SalishSea.io — Direct', recordedBy: '' }),
        makeRow({ occurrenceID: 'native:3',  institutionCode: 'SalishSea', rightsHolder: 'SalishSea.io', datasetName: 'SalishSea.io — SalishSea.io Direct', recordedBy: 'Alice B' }),
    ];

    test('SC#2: no excluded occurrenceIDs', () => {
        expect(() => assertNoExcludedOccurrenceIDs(VALID_HEADER, validRows)).not.toThrow();
    });

    test('SC#3a: all institutionCode=SalishSea', () => {
        expect(() => assertInstitutionCode(VALID_HEADER, validRows)).not.toThrow();
    });

    test('SC#3b: all rightsHolder=SalishSea.io', () => {
        expect(() => assertRightsHolder(VALID_HEADER, validRows)).not.toThrow();
    });

    test('SC#3c: all datasetName prefixed correctly', () => {
        expect(() => assertDatasetNamePrefix(VALID_HEADER, validRows)).not.toThrow();
    });

    test('SC#4b: valid EML passes title check', () => {
        expect(() => assertEmlTitle(VALID_EML)).not.toThrow();
    });

    test('SC#4a: valid EML with two associatedParties passes', () => {
        expect(() => assertEmlAssociatedParties(VALID_EML)).not.toThrow();
    });
});
