/**
 * Assembling the profile pages from the snapshot: the shapes the pages' templates
 * expect, the order they appear in, and output that depends on the data alone.
 */

import { describe, expect, test } from 'vitest';

import {
    assembleEcotypes, assembleIndividuals, assembleMatrilines, renderEcotypePage, renderIndividualPage, renderMatrilinePage,
    type Tables,
} from './profiles.ts';

const shellFor = (element: string) => `<!DOCTYPE html><html><head><title>x</title><meta name="description" content="x">
<meta property="og:title" content="x"><meta property="og:description" content="x">
<script type="module" src="/assets/i.js"></script></head><body><${element}></${element}></body></html>`;
const SHELL = shellFor('individual-page');

const person = (id: number, designation: string, extra: Record<string, unknown> = {}) => ({
    id, entity_id: `SSA:${String(10000 + id).padStart(7, '0')}`, primary_designation: designation,
    sex: 'female', born_earliest: null, born_latest: null, life_status: 'alive',
    mother_id: null, maternity_certainty: 'confirmed', father_id: null, paternity_certainty: null, ...extra,
});

function tables(): Tables {
    return {
        individuals: [
            person(1, 'T065A', {born_earliest: 1986, born_latest: 1986}),
            person(3, 'T065A3', {mother_id: 1, born_earliest: 2012, born_latest: 2012}),
            person(2, 'T065A2', {mother_id: 1, born_earliest: 2006, born_latest: 2006, sex: 'male'}),
            person(4, 'T065A5', {mother_id: 1}),
        ],
        designations: [
            {id: 11, individual_id: 1, code: 'T065A', scheme: 'bc_wa', is_primary: true, status: 'current', in_catalog: true, authority_id: null},
            {id: 10, individual_id: 1, code: 'T65A', scheme: 'alaska', is_primary: false, status: 'current', in_catalog: true, authority_id: 1},
        ],
        nicknames: [
            {id: 21, individual_id: 1, name: 'Fingers', named_year: 2010, namer_id: 1, social_group_id: null, status: 'official', theme: null},
            {id: 20, individual_id: 1, name: 'Old Name', named_year: null, namer_id: null, social_group_id: null, status: 'deprecated', theme: null},
            {id: 22, individual_id: null, name: 'The Fingers Family', named_year: 2015, namer_id: 1, social_group_id: 100, status: 'official', theme: null},
        ],
        parties: [{id: 1, name: 'Some Researcher', kind: 'person', url: 'https://example.org'}],
        social_groups: [
            {id: 100, kind: 'matriline', anchor_individual_id: 1, designation: 'T065A', entity_id: 'SSA:0020001', designation_folded: 't65a', notes: 'VERBATIM SHEET TEXT'},
            {id: 200, kind: 'ecotype', anchor_individual_id: null, designation: 'Biggs', entity_id: 'SSA:0000901', designation_folded: 'biggs', notes: 'ECOTYPE SHEET TEXT'},
            {id: 101, kind: 'matriline', anchor_individual_id: 2, designation: 'T065A2', entity_id: null, designation_folded: 't65a2', notes: null},
        ],
        group_parents: [{group_id: 100, parent_group_id: 200}],
        matriline_members: [1, 2, 3, 4].map(id => ({group_id: 100, individual_id: id, innermost_group_id: 100})),
        animal_names: [{entity_id: 'SSA:0000901', common_name: "Bigg's killer whale", taxon_entity_id: null, taxon_common_name: null, inaturalist_scientific_name: null}],
        individual_occurrences: [
            {individual_id: 1, occurrence_id: 'maplify:1', observed_at: '2026-09-04T20:00:00+00:00', location: {lon: -123, lat: 48.5}, is_present: true, status: 'candidate', via_group: 'T065As'},
            {individual_id: 1, occurrence_id: 'maplify:1', observed_at: '2026-09-04T20:00:00+00:00', location: {lon: -123, lat: 48.5}, is_present: true, status: 'candidate', via_group: null},
            {individual_id: 1, occurrence_id: 'maplify:2', observed_at: '2026-08-01T20:00:00+00:00', location: null, is_present: false, status: 'candidate', via_group: null},
        ],
        group_occurrences: [
            {social_group_id: 100, occurrence_id: 'maplify:3', observed_at: '2025-06-01T20:00:00+00:00', location: {lon: -123, lat: 48.5}, is_present: true, status: 'candidate', code: 'T65As'},
            {social_group_id: 100, occurrence_id: 'maplify:4', observed_at: '2026-07-01T20:00:00+00:00', location: null, is_present: true, status: 'candidate', code: 'T65As'},
            {social_group_id: 101, occurrence_id: 'maplify:5', observed_at: '2026-07-02T20:00:00+00:00', location: null, is_present: true, status: 'rejected', code: 'T65A2s'},
        ],
        ecotype_occurrences: [
            {ecotype_id: 200, occurrence_id: 'maplify:3', observed_at: '2025-06-01T20:00:00+00:00', location: {lon: -123, lat: 48.5}, is_present: true, status: 'candidate'},
        ],
    };
}

const fingers = () => assembleIndividuals(tables()).find(p => p.data.profile.primary_designation === 'T065A')!;

describe('assembleIndividuals', () => {
    test('one page per individual, named by the register identifier\'s digits', () => {
        expect(assembleIndividuals(tables()).map(p => p.id)).toEqual(['0010001', '0010002', '0010003', '0010004']);
    });

    test('the name the page shows, and the ecotype the register names the animal by', () => {
        expect(fingers().data.name).toBe('Fingers');
        expect(fingers().data.species).toBe("Bigg's killer whale");
    });

    test('offspring oldest first, the undated first of all, as fetchOffspring orders', () => {
        expect(fingers().data.offspring.map(o => o.primary_designation)).toEqual(['T065A5', 'T065A2', 'T065A3']);
    });

    test('embedded parties resolve, and names keep a fixed order', () => {
        const {designations, nicknames} = fingers().data.profile;
        expect(designations.map(d => [d.code, d.authority?.name ?? null])).toEqual([['T65A', 'Some Researcher'], ['T065A', null]]);
        expect(nicknames.map(n => n.name)).toEqual(['Old Name', 'Fingers']);
    });

    test('links deduplicated as the client does: a direct claim over a via-group one, absences dropped', () => {
        expect(fingers().links).toEqual([
            {occurrence_id: 'maplify:1', observed_at: '2026-09-04T20:00:00+00:00', location: {lon: -123, lat: 48.5},
                is_present: true, status: 'candidate', via_group: null},
        ]);
    });
});

describe('renderIndividualPage', () => {
    test('the page shows the profile, and previews as it', () => {
        const doc = renderIndividualPage(SHELL, fingers(), 2026);
        expect(doc).toContain('<title>Fingers (T065A) · SalishSea.io</title>');
        expect(doc).toContain('<h1>Fingers</h1>');
        expect(doc).toContain('T065A2');
        expect(doc).toContain('src="/read-path/profiles/individuals/0010001.links.json"');
    });

    test('depends on the data alone: shuffled snapshot rows render the same bytes', () => {
        const shuffled = tables();
        for (const rows of Object.values(shuffled)) rows.reverse();
        const again = assembleIndividuals(shuffled).find(p => p.data.profile.primary_designation === 'T065A')!;
        expect(renderIndividualPage(SHELL, again, 2026)).toBe(renderIndividualPage(SHELL, fingers(), 2026));
    });

    // Orders the live page left to the database, fixed in the shared templates so the
    // prerendered page and the live one agree (found comparing all 510, decision 057).
    test('aliases by code, and calves born the same year by designation', () => {
        const t = tables();
        t.individuals.push(person(5, 'T065A2B', {mother_id: 1, born_earliest: 2006, born_latest: 2006}));
        t.matriline_members.push({group_id: 100, individual_id: 5, innermost_group_id: 100});
        // A lower id than T65A's, so id order and code order disagree.
        t.designations.push({id: 9, individual_id: 1, code: 'Z9', scheme: 'other', is_primary: false,
            status: 'current', in_catalog: false, authority_id: null});
        const page = assembleIndividuals(t).find(p => p.data.profile.primary_designation === 'T065A')!;
        const doc = renderIndividualPage(SHELL, page, 2026);
        expect(doc).toMatch(/Also cataloged as <b>T65A<\/b>.*<b>Z9<\/b>/);
        const members = [...doc.matchAll(/individuals\/\d+\/(T065A[0-9B]*)/g)].map(m => m[1]);
        expect(members.indexOf('T065A2')).toBeLessThan(members.indexOf('T065A2B'));
    });
});


const t065as = () => assembleMatrilines(tables()).find(p => p.data.group.designation === 'T065A')!;

describe('assembleMatrilines', () => {
    test('one page per matriline with a register identifier, named by its digits', () => {
        expect(assembleMatrilines(tables()).map(p => p.id)).toEqual(['0020001']);
    });

    test('its names, its anchor, and its members as fetchGroupMembers shapes them', () => {
        const {group, members, name} = t065as().data;
        expect(name).toBe('The Fingers Family');
        expect(group.nicknames).toEqual([{name: 'The Fingers Family', theme: null, status: 'official', named_year: 2015,
            namer: {name: 'Some Researcher', url: 'https://example.org'}}]);
        expect(group.anchor).toEqual({id: 1, entity_id: 'SSA:0010001', primary_designation: 'T065A', life_status: 'alive',
            nicknames: [{name: 'Old Name', status: 'deprecated'}, {name: 'Fingers', status: 'official'}]});
        expect(members.map(m => m.individual.primary_designation)).toEqual(['T065A', 'T065A2', 'T065A3', 'T065A5']);
    });

    test('its links are the group\'s own mentions, newest first', () => {
        expect(t065as().links.map(l => l.occurrence_id)).toEqual(['maplify:4', 'maplify:3']);
    });
});

describe('renderMatrilinePage', () => {
    const doc = () => renderMatrilinePage(shellFor('matriline-page'), t065as(), 2026);

    test('the page shows the matriline, and previews as the edge function does', () => {
        expect(doc()).toContain('<title>The Fingers Family (T065A matriline) · SalishSea.io</title>');
        expect(doc()).toContain(`<meta name="description" content="Members, naming, and sighting history of the T065A matriline of Bigg's killer whales in the Salish Sea.">`);
        expect(doc()).toContain('<link rel="canonical" href="https://salishsea.io/matrilines/0020001/T065As">');
        expect(doc()).toContain('src="/read-path/profiles/matrilines/0020001.links.json"');
    });

    test('never the group\'s notes (D-21)', () => {
        expect(doc()).not.toContain('VERBATIM SHEET TEXT');
    });

    test('depends on the data alone: shuffled snapshot rows render the same bytes', () => {
        const shuffled = tables();
        for (const rows of Object.values(shuffled)) rows.reverse();
        const again = assembleMatrilines(shuffled).find(p => p.data.group.designation === 'T065A')!;
        expect(renderMatrilinePage(shellFor('matriline-page'), again, 2026)).toBe(doc());
    });
});

describe('assembleEcotypes and renderEcotypePage', () => {
    const biggs = () => assembleEcotypes(tables())[0]!;

    test('one page per ecotype, listing the matrilines beneath it, and its pooled links', () => {
        expect(assembleEcotypes(tables()).map(p => p.id)).toEqual(['0000901']);
        expect(biggs().data.matrilines.map(g => g.designation)).toEqual(['T065A']);
        expect(biggs().links.map(l => l.occurrence_id)).toEqual(['maplify:3']);
    });

    test('the page previews as the edge function does, and shows no notes', () => {
        const doc = renderEcotypePage(shellFor('ecotype-page'), biggs(), 2026);
        expect(doc).toContain("<title>Bigg's (transient) killer whales · SalishSea.io</title>");
        expect(doc).toContain('<link rel="canonical" href="https://salishsea.io/ecotypes/0000901/Biggs">');
        expect(doc).toContain('<h1>Bigg&#39;s (transient) killer whales</h1>');
        expect(doc).not.toContain('ECOTYPE SHEET TEXT');
    });
});
