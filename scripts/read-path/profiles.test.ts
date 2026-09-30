/**
 * Assembling the profile pages from the snapshot: the shapes the pages' templates
 * expect, the order they appear in, and output that depends on the data alone.
 */

import { describe, expect, test } from 'vitest';

import {
    assembleEcotypes, assembleHaulouts, assembleHauloutSites, assembleIndividuals, assembleMatrilines,
    renderEcotypePage, renderHauloutPage, renderIndividualPage, renderMatrilinePage,
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

const site = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
    id, name, story: null, region: 'Strait of Juan de Fuca', location: {lon: -122.92, lat: 48.12}, radius_m: 500,
    verified: false, atlas_code: null, created_at: '2026-09-19T01:06:00+00:00', atlas_count: '<100',
    atlas_species: ['PV'], atlas_tidal_use: 'ALL', atlas_description: null, ...extra,
});

const report = (hauloutId: number, id: string, observedAt: string, extra: Record<string, unknown> = {}) => ({
    url: `https://www.inaturalist.org/observations/${id.slice(5)}`, body: null,
    taxon: {entity_id: null, species_id: 41755, scientific_name: 'Phoca vitulina', vernacular_name: 'Harbor Seal'},
    photos: [], accuracy: 10, location: {lon: -122.92, lat: 48.12}, observer: 'someone', distance_m: 120,
    haulout_id: hauloutId, attribution: '(c) someone', observed_at: observedAt, species_name: 'Harbor Seal',
    occurrence_id: id, ...extra,
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
        haulouts: [
            site(12, 'Protection Island', {atlas_code: '6.10', story: 'Harbor seals *pup* here & rest.'}),
            site(11, 'Protection Island Spit', {atlas_code: '6.10', location: {lon: -122.93, lat: 48.13}}),
            site(13, 'Smith Island', {atlas_code: '6.20', location: {lon: -122.9, lat: 48.15}}),
            site(14, 'Far Away Rock', {atlas_code: '9.99', location: {lon: -124.7, lat: 48.4}}),
        ],
        haulout_occurrences: [
            report(12, 'inat:2', '2026-05-01T18:00:00+00:00', {photos: [{src: 'https://static.inaturalist.org/photos/7/square.jpg', thumb: null, license: null, mimetype: null, attribution: '(c) someone'}]}),
            report(12, 'inat:1', '2026-05-01T18:00:00+00:00'),
            report(12, 'inat:3', '2024-03-01T18:00:00+00:00', {location: null, accuracy: 2000}),
            report(11, 'inat:9', '2026-01-01T18:00:00+00:00', {distance_m: null}),
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

describe('assembleHaulouts and renderHauloutPage', () => {
    const protection = () => assembleHaulouts(tables()).find(p => p.id === '12')!;
    const doc = () => renderHauloutPage(shellFor('haulout-page'), protection(), 2026);

    test('one page per site, named by its id', () => {
        expect(assembleHaulouts(tables()).map(p => p.id)).toEqual(['11', '12', '13', '14']);
    });

    test('the atlas\'s other point for the site, and its neighbours within reach, as the client computes them', () => {
        const {siblings, neighbours} = protection().data;
        expect(siblings.map(s => s.name)).toEqual(['Protection Island Spit']);
        expect(neighbours.map(n => n.site.name)).toEqual(['Smith Island']);
    });

    test('reports newest first, a tie by occurrence; the map\'s dots only the located ones, only what it reads', () => {
        expect(protection().data.reports.map(r => r.occurrence_id)).toEqual(['inat:1', 'inat:2', 'inat:3']);
        expect(protection().links).toEqual([
            {occurrence_id: 'inat:1', observed_at: '2026-05-01T18:00:00+00:00', location: {lon: -122.92, lat: 48.12}},
            {occurrence_id: 'inat:2', observed_at: '2026-05-01T18:00:00+00:00', location: {lon: -122.92, lat: 48.12}},
        ]);
    });

    test('a row the page cannot use is dropped, as the client drops it', () => {
        expect(assembleHaulouts(tables()).find(p => p.id === '11')!.data.reports).toEqual([]);
    });

    test('the page previews as the edge function does', () => {
        expect(doc()).toContain('<title>Protection Island haul-out · SalishSea.io</title>');
        expect(doc()).toContain('<meta name="description" content="Harbor seal haul-out site in the Strait of Juan de Fuca: what the 1999 WDFW atlas recorded, and what people report there now.">');
        expect(doc()).toContain('<link rel="canonical" href="https://salishsea.io/haulouts/12/Protection-Island">');
    });

    test('the map is handed its site and its dots\' file, as attributes a prerendered page can carry', () => {
        expect(doc()).toContain('src="/read-path/profiles/haulouts/12.links.json"');
        expect(doc()).toContain('site="{&quot;lon&quot;:-122.92,&quot;lat&quot;:48.12,&quot;radius_m&quot;:500}"');
    });

    test('the story as markdown, the photo strip at medium size, the grid ending on the snapshot\'s year', () => {
        expect(doc()).toContain('<p>Harbor seals <em>pup</em> here &amp; rest.</p>');
        expect(doc()).toContain('src="https://static.inaturalist.org/photos/7/medium.jpg"');
        expect(doc()).toMatch(/<th scope="row">2026<\/th>/);
        expect(doc()).toContain('3 reports from 1 observer, March 2024 to May 2026');
    });

    test('depends on the data alone: shuffled snapshot rows render the same bytes', () => {
        const shuffled = tables();
        for (const rows of Object.values(shuffled)) rows.reverse();
        const again = assembleHaulouts(shuffled).find(p => p.id === '12')!;
        expect(renderHauloutPage(shellFor('haulout-page'), again, 2026)).toBe(doc());
    });
});

describe('assembleHauloutSites', () => {
    test('every site, by id, with only what the main map\'s layer reads', () => {
        const sites = assembleHauloutSites(tables());
        expect(sites.map(s => s.id)).toEqual([11, 12, 13, 14]);
        expect(sites[1]).toEqual({id: 12, name: 'Protection Island', location: {lon: -122.92, lat: 48.12}, radius_m: 500});
    });
});
