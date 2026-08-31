// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// The module registers <sighting-form> and reaches for a Supabase client at
// import; neither is exercised by these tests.
vi.mock('./supabase.ts', () => ({supabase: () => ({rpc: async () => ({data: null, error: null})})}));

const { latLonInBoundsValidator } = await import('./sighting-form.ts');

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
