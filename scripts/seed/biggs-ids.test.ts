/**
 * Unit tests for the Bigg's catalog pure core (decision 011): parseBiggsIds and
 * its helpers. No DB — small inline TSV fixtures exercise the real source quirks
 * (blank/section rows, slash-aligned multi-value cells, birth bounds, renamings).
 */

import { describe, test, expect } from 'vitest';
import {
    parseBiggsIds,
    padDesignation,
    motherDesignation,
    parseBirth,
    parseSex,
    parseLifeStatus,
    schemeFor,
    splitOutsideParens,
    partyKind,
} from './biggs-ids.ts';

const HEADER =
    'D if Deceased, PD is Presumed Deceased\tLocal ID designation (BC and WA)\tAdditional Designations\tGender\tBirth Year\tNicknames\tStory Behind the Nickname\tWho Nicknamed\tOther Notes or Comments';

/** Build a data row from cells (pads to 9). */
const row = (...cells: string[]): string => [...cells, '', '', '', '', '', '', '', '', ''].slice(0, 9).join('\t');
/** Assemble a TSV with the legend header + a blank spacer between groups. */
const tsv = (...rows: string[]): string => [HEADER, ...rows].join('\n');

describe('pure helpers', () => {
    test('padDesignation pads the numeric block to 3 digits', () => {
        expect(padDesignation('T46A')).toBe('T046A');
        expect(padDesignation('T065A5')).toBe('T065A5');
        expect(padDesignation('T2')).toBe('T002');
    });

    test('motherDesignation peels the trailing genealogy segment', () => {
        expect(motherDesignation('T065A5')).toBe('T065A');
        expect(motherDesignation('T065A')).toBe('T065');
        expect(motherDesignation('T036B1A')).toBe('T036B1');
        expect(motherDesignation('T002C2')).toBe('T002C');
        expect(motherDesignation('T124A2A')).toBe('T124A2');
        expect(motherDesignation('T065')).toBeNull(); // matriarch
    });

    test('parseBirth returns a bound pair', () => {
        expect(parseBirth('1979')).toEqual({ earliest: 1979, latest: 1979 });
        expect(parseBirth('≤1961')).toEqual({ earliest: null, latest: 1961 });
        expect(parseBirth('<1968')).toEqual({ earliest: null, latest: 1967 });
        expect(parseBirth('UNK')).toEqual({ earliest: null, latest: null });
        expect(parseBirth('')).toEqual({ earliest: null, latest: null });
    });

    test('parseSex handles F/M/F?/unknown', () => {
        expect(parseSex('F')).toEqual({ sex: 'female', uncertain: false });
        expect(parseSex('M')).toEqual({ sex: 'male', uncertain: false });
        expect(parseSex('F?')).toEqual({ sex: 'female', uncertain: true });
        expect(parseSex('unknown')).toEqual({ sex: null, uncertain: false });
        expect(parseSex('')).toEqual({ sex: null, uncertain: false });
    });

    test('parseLifeStatus maps the deceased flag', () => {
        expect(parseLifeStatus('D')).toBe('deceased');
        expect(parseLifeStatus('PD')).toBe('presumed_deceased');
        expect(parseLifeStatus('')).toBe('alive');
        expect(parseLifeStatus('?')).toBe('unknown');
    });

    test('schemeFor maps designation prefixes', () => {
        expect(schemeFor('AM3')).toBe('alaska');
        expect(schemeFor('U41')).toBe('alaska');
        expect(schemeFor('CA20')).toBe('california');
        expect(schemeFor('Z9')).toBe('other');
    });

    test('splitOutsideParens ignores slashes inside parentheses', () => {
        expect(splitOutsideParens("Andy Scheffler (Transient/Bigg's Orca Nick Naming Page)/Dena Matkin"))
            .toEqual(["Andy Scheffler (Transient/Bigg's Orca Nick Naming Page)", 'Dena Matkin']);
        expect(splitOutsideParens('VanAqua/Dena Matkin')).toEqual(['VanAqua', 'Dena Matkin']);
    });

    test('partyKind classifies namers', () => {
        expect(partyKind('Dena Matkin')).toBe('researcher');
        expect(partyKind('DFO')).toBe('agency');
        expect(partyKind('VanAqua')).toBe('organization');
        expect(partyKind("Transient/Bigg's Orca Nick Naming Page")).toBe('community_project');
        expect(partyKind('Ehattesaht Nation')).toBe('first_nation');
    });
});

describe('parseBiggsIds', () => {
    test('skips the header and blank spacer rows', () => {
        const cat = parseBiggsIds(tsv('', row('', 'T010', '', 'F', ''), ''));
        expect(cat.individuals.map((i) => i.primary_designation)).toEqual(['T010']);
    });

    test('parses an individual with mother, birth, life status', () => {
        const cat = parseBiggsIds(tsv(row('D', 'T065A5', '', 'M', '2014')));
        const ind = cat.individuals[0];
        expect(ind).toMatchObject({
            primary_designation: 'T065A5', sex: 'male', life_status: 'deceased',
            born_earliest: 2014, born_latest: 2014, mother_designation: 'T065A',
        });
        const primary = cat.designations.find((d) => d.code === 'T065A5');
        expect(primary).toMatchObject({ scheme: 'bc_wa', is_primary: true, status: 'active', in_catalog: true });
    });

    test('uncertain deceased flag marks the primary designation uncertain', () => {
        const cat = parseBiggsIds(tsv(row('?', 'T112', '', 'F', '≤1974', '', '', '', 'Not in the Catalogue')));
        const d = cat.designations.find((x) => x.code === 'T112')!;
        expect(d.status).toBe('uncertain');
        expect(d.in_catalog).toBe(false);
    });

    test('splits alt designations by scheme (AO10/CA20)', () => {
        const cat = parseBiggsIds(tsv(row('', 'T132', 'AO10/CA20', 'M', '<1969')));
        const alts = cat.designations.filter((d) => !d.is_primary);
        expect(alts).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'AO10', scheme: 'alaska' }),
            expect.objectContaining({ code: 'CA20', scheme: 'california' }),
        ]));
    });

    test('splits multi-value nicknames, stories, and namers positionally', () => {
        const cat = parseBiggsIds(tsv(row(
            '', 'T065A5', '', 'M', '2014',
            'Indy/Elsie',
            'Adventurous like Indiana Jones/A Tlingit grandmother',
            "Andy Scheffler (Transient/Bigg's Orca Nick Naming Page)/Dena Matkin",
        )));
        const nn = cat.nicknames.filter((n) => n.individual_designation === 'T065A5');
        expect(nn.map((n) => n.name)).toEqual(['Indy', 'Elsie']);
        expect(nn.map((n) => n.namer_name)).toEqual(['Andy Scheffler', 'Dena Matkin']);
        expect(nn[0]?.story).toBe('Adventurous like Indiana Jones');
        // the community naming page is registered as its own party
        expect(cat.parties.some((p) => /Nick Naming Page/i.test(p.name) && p.kind === 'community_project')).toBe(true);
    });

    test('F? sets female with an uncertainty note; unknown clears sex', () => {
        const cat = parseBiggsIds(tsv(
            row('', 'T109A3A', '', 'F?', '2022'),
            row('', 'T046B5', '', 'unknown', '2015'),
        ));
        const a = cat.individuals.find((i) => i.primary_designation === 'T109A3A')!;
        expect(a.sex).toBe('female');
        expect(a.notes).toMatch(/sex uncertain/i);
        expect(cat.individuals.find((i) => i.primary_designation === 'T046B5')!.sex).toBeNull();
    });

    test('routes a collective-label row to a named group + themed nickname', () => {
        const cat = parseBiggsIds(tsv(row('', 'Known as the Secret Agents', '', '', '', '', 'for the #007 same as James Bond')));
        expect(cat.individuals).toHaveLength(0);
        const g = cat.socialGroups.find((x) => x.kind === 'named_group')!;
        expect(g.designation).toBe('Secret Agents');
        const nn = cat.nicknames.find((n) => n.group_designation === 'Secret Agents')!;
        expect(nn.theme).toBe('James Bond');
    });

    test('synthesizes a superseded designation from a rename note', () => {
        const cat = parseBiggsIds(tsv(row(
            '', 'T122', '', 'F', '≤1982', 'Centeki',
            'T122 was originally designated T46A, but was renamed after re-appearing after a 13 year absence.',
            'Monika Wieland Shields',
        )));
        const old = cat.designations.find((d) => d.code === 'T046A')!;
        expect(old).toMatchObject({ status: 'superseded', superseded_by_code: 'T122', individual_designation: 'T122' });
    });

    test('scaffolds matriline groups, an ecotype parent, and maternal memberships', () => {
        const cat = parseBiggsIds(tsv(
            row('', 'T065', '', 'F', '<1968'),
            row('', 'T065A', '', 'F', '1986'),
            row('', 'T065A5', '', 'M', '2014'),
        ));
        expect(cat.socialGroups.find((g) => g.designation === 'Biggs')?.kind).toBe('ecotype');
        const matriline = cat.socialGroups.find((g) => g.designation === 'T065')!;
        expect(matriline).toMatchObject({ kind: 'matriline', anchor_designation: 'T065', parent_designation: 'Biggs' });
        const members = cat.memberships.filter((m) => m.group_designation === 'T065');
        expect(members.map((m) => m.individual_designation).sort()).toEqual(['T065', 'T065A', 'T065A5']);
        expect(members.every((m) => m.is_current !== undefined)).toBe(true);
    });
});
