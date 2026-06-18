/**
 * GBIF DwC-A `meta.xml` descriptor generator — pure function.
 *
 * Generates the meta.xml document that names the core (Occurrence) and
 * extension (GBIF Simple Multimedia) data files inside the DarwinCore Archive
 * zip, lists each column's ordinal index + term URI, and records the
 * text-format conventions (UTF-8, tab-separated, literal `\t` escapes per
 * the GBIF DwC Text Guidelines).
 *
 * The function accepts the field arrays as parameters (not via module
 * side-effect imports) so it is purely a transformation over its inputs.
 * `build.ts` is expected to pass `OCCURRENCE_FIELDS` and `MULTIMEDIA_FIELDS`
 * from `./fields.ts` at call time.
 *
 * Invariants enforced by `meta-xml.test.ts`:
 *   - Output starts with `<?xml version="1.0" encoding="UTF-8"?>`.
 *   - Total `<field index="…"` count equals `occFields.length + mmFields.length`.
 *   - Ordinal alignment: `<field index="N" term="..."/>` matches
 *     `occFields[N].termUri` (and likewise for the extension block).
 *   - `<core>` carries rowType `…/dwc/terms/Occurrence`, `<extension>` carries
 *     rowType `…/dwc/terms/Multimedia`, `<archive>` carries `metadata="eml.xml"`.
 *   - `fieldsTerminatedBy="\t"` and `linesTerminatedBy="\n"` are the literal
 *     two-character strings `\t` and `\n` (NOT actual tab / newline bytes) —
 *     this is the GBIF DwC Text Guidelines convention. See RESEARCH §T4 / §T7.
 *   - `<id index="0"/>` in core; `<coreid index="0"/>` in extension.
 *
 * Cross-reference: `.planning/phases/06-archive-generation/06-RESEARCH.md` §T4
 * for the authoritative XML skeleton; §T7 for the template-literal pattern.
 */

import type { OccurrenceField, MultimediaField } from './fields.ts';

/**
 * Build the GBIF DwC-A `meta.xml` descriptor as a UTF-8 string.
 *
 * @param occFields - core (Occurrence) field list in column order;
 *                    `occFields[i]` becomes `<field index="i" term="..."/>`.
 * @param mmFields  - extension (Simple Multimedia) field list in column
 *                    order; `mmFields[0]` is the coreid column.
 * @returns UTF-8 XML string; deterministic for identical inputs.
 */
export function buildMetaXml(
    occFields: readonly OccurrenceField[],
    mmFields: readonly MultimediaField[],
): string {
    const coreFieldLines = occFields
        .map((f, i) => `    <field index="${i}" term="${f.termUri}"/>`)
        .join('\n');
    const extFieldLines = mmFields
        .map((f, i) => `    <field index="${i}" term="${f.termUri}"/>`)
        .join('\n');

    // Note: `fieldsTerminatedBy="\t"` and `linesTerminatedBy="\n"` MUST appear
    // in the output bytes as the literal two-character sequences backslash-t
    // and backslash-n — NOT actual tab / newline bytes. The TS source escapes
    // each backslash (`"\\t"`) so the runtime string contains one backslash
    // followed by one letter, matching the GBIF DwC Text Guidelines.
    return `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://rs.tdwg.org/dwc/text/ http://rs.tdwg.org/dwc/text/tdwg_dwc_text.xsd" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files>
      <location>occurrence.txt</location>
    </files>
    <id index="0"/>
${coreFieldLines}
  </core>
  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Multimedia">
    <files>
      <location>multimedia.txt</location>
    </files>
    <coreid index="0"/>
${extFieldLines}
  </extension>
</archive>
`;
}
