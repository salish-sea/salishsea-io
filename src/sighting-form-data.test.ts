// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

const { latLonInBoundsValidator, newSighting, observationToFormData, parseLonLat, sightingPayload } = await import('./sighting-form-data.ts');
import type { Occurrence } from './types.ts';
import type { Photo } from './photo-attachment.ts';

// acartiaExtent is [-136, 36, -120, 54] — west, south, east, north. Every
// fixture below carries four decimal places, matching the placeholder the field
// shows: geo-coordinates-parser reads "48.50" as 48° 50' and rejects a value
// whose decimals are all zero, so rounder-looking numbers do not test what they
// appear to.
describe('latLonInBoundsValidator', () => {
  it('accepts a coordinate inside the Salish Sea box', () => {
    expect(latLonInBoundsValidator('47.6845, -122.3037')).toBeUndefined();
  });

  it('accepts an empty value — the field is optional', () => {
    expect(latLonInBoundsValidator('   ')).toBeUndefined();
  });

  it('asks for a comma before trying to parse', () => {
    expect(latLonInBoundsValidator('47.6845 -122.3037')).toBe("Expects coordinates like '47.6845, -122.3037'");
  });

  it('says so when the value is not coordinates at all', () => {
    expect(latLonInBoundsValidator('somewhere, near Orcas')).toBe("Couldn't interpret value as coordinates");
  });

  it('names latitude, and the latitude bounds, when the latitude is out of range', () => {
    expect(latLonInBoundsValidator('12.3456, -122.3037')).toBe('Expected a latitude between 36 and 54');
  });

  it('names longitude, and the longitude bounds, when the longitude is out of range', () => {
    // The bug: this branch said "Expected a latitude between -136 and -120",
    // naming the axis that was fine and quoting bounds that make no sense for
    // it. Both halves of the message have to be the longitude's.
    expect(latLonInBoundsValidator('47.6845, -22.3037')).toBe('Expected a longitude between -136 and -120');
  });

  it('reports latitude first when both are out of range', () => {
    expect(latLonInBoundsValidator('12.3456, -22.3037')).toBe('Expected a latitude between 36 and 54');
  });
});

// The request a save sends (salish-h2n). #742 was the accuracy going missing on this road.
describe('sightingPayload', () => {
  const subject: [number, number] = [-123.1501, 48.5102];
  const observer: [number, number] = [-123.1201, 48.5402];
  const filled = () => ({
    ...newSighting(), body: 'J pod heading north', count: 12, observed_time: '13:45',
    accuracy: '400', entity_id: 'SSA:0000003', travel_direction: 'north' as const, url: 'https://example.org/report',
  });

  it('carries every field the author filled in, the accuracy included', () => {
    expect(sightingPayload(filled(), {id: 'abc', date: '2026-07-04', observer, subject, photos: []})).toEqual({
      id: 'abc', body: 'J pod heading north', count: 12, direction: 'north',
      // 13:45 on 4 July in Pacific daylight time
      observed_at: '2026-07-04T20:45:00Z',
      observed_from: {lon: -123.1201, lat: 48.5402}, location: {lon: -123.1501, lat: 48.5102},
      accuracy: 400, entity_id: 'SSA:0000003', url: 'https://example.org/report', photos: [],
    });
  });

  it('reads the time in Pacific time whatever the season', () => {
    const payload = sightingPayload({...filled(), observed_time: '13:45'}, {id: 'abc', date: '2026-01-15', observer, subject, photos: []});
    expect(payload.observed_at).toBe('2026-01-15T21:45:00Z');
  });

  it('sends nothing for what was left empty', () => {
    const payload = sightingPayload({...newSighting(), observed_time: '09:00'}, {id: 'abc', date: '2026-07-04', observer: null, subject, photos: []});
    expect(payload).toMatchObject({count: null, direction: null, observed_from: null, accuracy: null, body: '', url: ''});
  });

  it('sends only photos that are on the server, each under the chosen licence', () => {
    const photos: Photo[] = [
      {id: '1', state: 'uploaded', thumb: 't1', url: 'https://salishsea.io/media/1.jpg'},
      {id: '2', state: 'attached', thumb: 't2', url: 'https://salishsea.io/media/2.jpg'},
      {id: '3', state: 'uploading', thumb: 't3', file: new File([], '3.jpg')},
      {id: '4', state: 'failed', thumb: 't4', file: new File([], '4.jpg'), error: new Error('no')},
    ] as Photo[];
    const payload = sightingPayload({...filled(), photo_license: 'cc0'}, {id: 'abc', date: '2026-07-04', observer, subject, photos});
    expect(payload.photos).toEqual([
      {src: 'https://salishsea.io/media/1.jpg', thumb: 't1', license: 'cc0', attribution: null, mimetype: null},
      {src: 'https://salishsea.io/media/2.jpg', thumb: 't2', license: 'cc0', attribution: null, mimetype: null},
    ]);
  });

  it('refuses a sighting with no subject point', () => {
    expect(() => sightingPayload(filled(), {id: 'abc', date: '2026-07-04', observer, subject: null, photos: []}))
      .toThrow('Subject coordinates not set');
  });

  it('saves an edited sighting as it was, when nothing was changed', () => {
    const saved = {
      id: 'abc', body: 'Two humpbacks', count: 2, direction: 'southwest', url: 'https://example.org/x',
      location: {lon: -123.1501, lat: 48.5102}, observed_from: {lon: -123.1201, lat: 48.5402},
      observed_at: '2026-07-04T20:45:00Z', accuracy: 250, provider_slug: 'direct',
      taxon: {entity_id: 'SSA:0000901', species_id: 41566, scientific_name: 'Megaptera novaeangliae', vernacular_name: 'Humpback whale'},
      photos: [],
    } as unknown as Occurrence;
    const form = observationToFormData(saved);
    const payload = sightingPayload(form, {
      id: form.id, date: '2026-07-04', photos: form.photos,
      observer: parseLonLat(form.observer_location), subject: parseLonLat(form.subject_location),
    });
    expect(payload).toEqual({
      id: 'abc', body: 'Two humpbacks', count: 2, direction: 'southwest', url: 'https://example.org/x',
      location: {lon: -123.1501, lat: 48.5102}, observed_from: {lon: -123.1201, lat: 48.5402},
      observed_at: '2026-07-04T20:45:00Z', accuracy: 250, entity_id: 'SSA:0000901', photos: [],
    });
  });

  it("doesn't carry another source's accuracy into a copy, since it measures something else (decision 077)", () => {
    const inat = {
      id: 'inaturalist:1', body: null, count: null, direction: null, url: null,
      location: {lon: -123.1501, lat: 48.5102}, observed_from: null, observed_at: '2026-07-04T20:45:00Z',
      accuracy: 30, provider_slug: 'inaturalist', photos: [],
      taxon: {entity_id: 'SSA:0000901', species_id: 41566, scientific_name: null, vernacular_name: null},
    } as unknown as Occurrence;
    expect(observationToFormData(inat).accuracy).toBe('');
  });
});
