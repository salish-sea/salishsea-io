import { describe, test, expect } from 'vitest';
import { buildMetaXml } from './meta-xml.ts';
import { OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS } from './fields.ts';
import type { OccurrenceField, MultimediaField } from './fields.ts';

/**
 * DWCA-01 / DWCA-02 unit surface for the meta.xml descriptor generator.
 *
 * These tests are pure string-shape assertions on the output of
 * `buildMetaXml(...)`. They guard:
 *   - field-count alignment with the input arrays,
 *   - ordinal/term alignment (Plan 02's `fields.ts` invariants flow through),
 *   - presence of the structural elements GBIF's validator looks for
 *     (`<id>`, `<coreid>`, `metadata="eml.xml"`, rowType URIs, fileterminator
 *     escapes),
 *   - determinism (byte-identical output for identical input).
 *
 * No I/O. No actual XML parser — we treat the output as a string and reach in
 * with `.includes(...)` and a single regex to extract `<field index="N" term="U"/>`
 * pairs. This is enough for the structural invariants; the GBIF DwC-A
 * validator will catch any deeper schema problems at the manual checkpoint.
 */

const FIELD_RE = /<field index="(\d+)" term="([^"]+)"\/>/g;

/**
 * Extract the [index, term] pairs from a sub-block of the meta.xml output.
 * Returned in source order — caller decides whether to compare directly or
 * sort by index first.
 */
const extractFields = (block: string): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    for (const m of block.matchAll(FIELD_RE)) {
        const idx = m[1];
        const term = m[2];
        if (idx !== undefined && term !== undefined) {
            out.push([idx, term]);
        }
    }
    return out;
};

/** Slice `xml` between the first occurrence of `start` and the next `end`. */
const sliceBetween = (xml: string, start: RegExp, end: string): string => {
    const startMatch = xml.match(start);
    if (!startMatch || startMatch.index === undefined) {
        throw new Error(`sliceBetween: opening tag matching ${start} not found`);
    }
    const after = startMatch.index + startMatch[0].length;
    const endIdx = xml.indexOf(end, after);
    if (endIdx === -1) {
        throw new Error(`sliceBetween: closing tag "${end}" not found after opening`);
    }
    return xml.slice(after, endIdx);
};

describe('buildMetaXml — smoke', () => {
    test('returns a string that starts with the XML prolog', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        expect(typeof xml).toBe('string');
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    });
});

describe('buildMetaXml — field count', () => {
    test('total `<field index="…"` count equals OCCURRENCE_FIELDS.length + MULTIMEDIA_FIELDS.length (= 31)', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const count = (xml.match(/<field index="/g) ?? []).length;
        expect(count).toBe(OCCURRENCE_FIELDS.length + MULTIMEDIA_FIELDS.length);
        expect(count).toBe(31);
    });
});

describe('buildMetaXml — ordinal alignment', () => {
    test('core block <field index="N" term="…"/> pairs match OCCURRENCE_FIELDS in order', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const coreBlock = sliceBetween(xml, /<core\b[^>]*>/, '</core>');
        const pairs = extractFields(coreBlock);
        const expected: Array<[string, string]> = OCCURRENCE_FIELDS.map((f, i) => [String(i), f.termUri]);
        expect(pairs).toEqual(expected);
    });

    test('extension block <field index="N" term="…"/> pairs match MULTIMEDIA_FIELDS in order', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const extBlock = sliceBetween(xml, /<extension\b[^>]*>/, '</extension>');
        const pairs = extractFields(extBlock);
        const expected: Array<[string, string]> = MULTIMEDIA_FIELDS.map((f, i) => [String(i), f.termUri]);
        expect(pairs).toEqual(expected);
    });
});

describe('buildMetaXml — dcterms / GBIF extension invariants', () => {
    test('core index 19 is dcterms rightsHolder', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const coreBlock = sliceBetween(xml, /<core\b[^>]*>/, '</core>');
        const pairs = extractFields(coreBlock);
        expect(pairs[19]).toEqual(['19', 'http://purl.org/dc/terms/rightsHolder']);
    });

    test('core index 22 is dcterms license', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const coreBlock = sliceBetween(xml, /<core\b[^>]*>/, '</core>');
        const pairs = extractFields(coreBlock);
        expect(pairs[22]).toEqual(['22', 'http://purl.org/dc/terms/license']);
    });

    test('extension index 0 is the GBIF coreid term URI', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const extBlock = sliceBetween(xml, /<extension\b[^>]*>/, '</extension>');
        const pairs = extractFields(extBlock);
        expect(pairs[0]).toEqual(['0', 'http://rs.gbif.org/terms/1.0/coreid']);
    });
});

describe('buildMetaXml — structural attributes and markers', () => {
    test('contains core rowType=Occurrence and extension rowType=Multimedia', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        expect(xml).toContain('rowType="http://rs.tdwg.org/dwc/terms/Occurrence"');
        expect(xml).toContain('rowType="http://rs.tdwg.org/dwc/terms/Multimedia"');
    });

    test('archive carries metadata="eml.xml"', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        expect(xml).toContain('metadata="eml.xml"');
    });

    test('contains <id index="0"/> in core and <coreid index="0"/> in extension', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        expect(xml).toContain('<id index="0"/>');
        expect(xml).toContain('<coreid index="0"/>');
    });

    test('fieldsTerminatedBy carries the literal two-character backslash-t (not a tab byte)', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        // Source string "\\t" produces one backslash + one 't' at runtime.
        // The expected substring is therefore 'fieldsTerminatedBy="\t"' where
        // the `\t` after the quote is a literal backslash followed by 't'.
        expect(xml).toContain('fieldsTerminatedBy="\\t"');
        expect(xml).toContain('linesTerminatedBy="\\n"');
        // And the output must NOT carry an actual tab byte in that attribute.
        expect(xml).not.toContain('fieldsTerminatedBy="\t"');
    });

    test('contains <location>occurrence.txt</location> and <location>multimedia.txt</location>', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        expect(xml).toContain('<location>occurrence.txt</location>');
        expect(xml).toContain('<location>multimedia.txt</location>');
    });

    test('archive carries the DwC text namespace and XSI schemaLocation', () => {
        const xml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        expect(xml).toContain('xmlns="http://rs.tdwg.org/dwc/text/"');
        expect(xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
        expect(xml).toContain(
            'xsi:schemaLocation="http://rs.tdwg.org/dwc/text/ http://rs.tdwg.org/dwc/text/tdwg_dwc_text.xsd"',
        );
    });
});

describe('buildMetaXml — pure-function behavior', () => {
    test('determinism: two calls with identical input return byte-identical output', () => {
        const a = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const b = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        expect(a).toBe(b);
    });

    test('accepts empty arrays — still emits well-formed <core> and <extension> with zero <field> elements', () => {
        const emptyOcc: readonly OccurrenceField[] = [];
        const emptyMm: readonly MultimediaField[] = [];
        const xml = buildMetaXml(emptyOcc, emptyMm);

        // Core and extension blocks still present with their structural markers.
        expect(xml).toContain('<core ');
        expect(xml).toContain('</core>');
        expect(xml).toContain('<extension ');
        expect(xml).toContain('</extension>');
        expect(xml).toContain('<id index="0"/>');
        expect(xml).toContain('<coreid index="0"/>');

        // Zero `<field index="…"` elements total.
        const count = (xml.match(/<field index="/g) ?? []).length;
        expect(count).toBe(0);
    });
});
