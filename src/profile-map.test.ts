import { describe, expect, it } from 'vitest';
import { profileMapSvg, project, type MapDot } from './profile-map.ts';

const dot = (id: string, lon: number, lat: number, observed_at = '2026-09-20T18:00:00Z'): MapDot =>
  ({ occurrence_id: id, observed_at, location: { lon, lat } });

describe('profileMapSvg', () => {
  it('draws nothing when no report has a location and there is no site', () => {
    expect(profileMapSvg([{ occurrence_id: 'a', observed_at: '2026-09-20T18:00:00Z', location: null }])).toBe('');
  });

  it('frames one report at zoom 10, as close as the interactive map came', () => {
    const svg = profileMapSvg([dot('a', -123, 48.5)]);
    expect(svg).toMatch(/\/images\/\w+\/10\/\d+\/\d+\.webp"/);
    expect(svg).not.toMatch(/\/images\/\w+\/11\//);
  });

  it('comes in to zoom 15 for a haul-out site, to show its radius', () => {
    const svg = profileMapSvg([], { lon: -122.92, lat: 48.12, radius_m: 50 });
    expect(svg).toMatch(/\/images\/\w+\/15\//);
    expect(svg).toContain('<path class="site"');
  });

  it('fits reports far apart, from a lower zoom', () => {
    const svg = profileMapSvg([dot('a', -123, 48.5), dot('b', -122.3, 47.6)]);
    const zooms = [...svg.matchAll(/\/images\/\w+\/(\d+)\//g)].map(m => Number(m[1]));
    expect(Math.max(...zooms)).toBeLessThan(10);
  });

  it('links each dot to its day on the main map, escaped for markup', () => {
    const svg = profileMapSvg([dot('inat:1', -123, 48.5), dot('maplify:2', -122.3, 47.6, '2026-09-19T18:00:00Z')]);
    expect(svg).toContain('<a href="/?d=2026-09-20&amp;o=inat%3A1" tabindex="-1">');
    expect(svg).toContain('<a href="/?d=2026-09-19&amp;o=maplify%3A2" tabindex="-1">');
  });

  it('draws the newest report last, so it is on top', () => {
    const svg = profileMapSvg([dot('new', -123, 48.5), dot('old', -122.3, 47.6, '2026-09-19T18:00:00Z')]);
    expect(svg.lastIndexOf('class="newest"')).toBeGreaterThan(svg.lastIndexOf('class="dot"'));
  });

  it('draws reports on the same spot as one dot, darker, linking to the newest of them', () => {
    const svg = profileMapSvg([
      dot('newest', -122.3, 47.6),
      dot('b', -123, 48.5, '2026-09-19T18:00:00Z'),
      dot('c', -123, 48.5, '2026-09-18T18:00:00Z'),
      dot('d', -123, 48.5, '2026-09-17T18:00:00Z'),
    ]);
    expect(svg.match(/class="dot"/g)).toHaveLength(1);
    expect(svg).toContain('o=b" tabindex="-1"><title>3 reports, the newest on Sep 19, 2026</title>');
    expect(svg).toMatch(/fill-opacity="0\.91"/);
  });

  it('counts older reports at the newest\'s spot in the newest\'s dot, which covers theirs', () => {
    const svg = profileMapSvg([dot('newest', -123, 48.5), dot('b', -123, 48.5, '2026-09-19T18:00:00Z')]);
    expect(svg).not.toContain('class="dot"');
    expect(svg).toContain('<title>2 reports, the newest on Sep 20, 2026</title><circle class="newest"');
  });

  it('keeps the dots out of the tab order, each with a tap target wider than itself', () => {
    const svg = profileMapSvg([dot('a', -123, 48.5), dot('b', -122.3, 47.6)]);
    expect(svg.match(/<a [^>]*><title>/g)).toHaveLength(2);
    expect(svg.match(/<a [^>]*tabindex="-1"/g)).toHaveLength(4);
    expect(svg.match(/class="hit"[^>]*r="12"/g)).toHaveLength(2);
    // Every target under every dot, so one dot's target never covers another dot.
    expect(svg.lastIndexOf('class="hit"')).toBeLessThan(svg.indexOf('class="dot"'));
  });

  it('wraps tile columns across the antimeridian', () => {
    const svg = profileMapSvg([dot('a', 179.9, 52), dot('b', -179.9, 52)]);
    const columns = [...svg.matchAll(/\/images\/\w+\/(\d+)\/(-?\d+)\/\d+\.webp"/g)].map(m => [Number(m[1]), Number(m[2])]);
    expect(columns.every(([z, x]) => x! >= 0 && x! < 2 ** z!)).toBe(true);
  });

  it('lets clicks through the site\'s radius to the reports inside it', () => {
    const svg = profileMapSvg([dot('a', -123, 48.5)], { lon: -123, lat: 48.5, radius_m: 500 });
    expect(svg.indexOf('class="site"')).toBeGreaterThan(-1);
  });

  it('closes every element, since the server renderer parses it as HTML', () => {
    const svg = profileMapSvg([dot('a', -123, 48.5), dot('b', -122.3, 47.6)], { lon: -123, lat: 48.5, radius_m: 500 });
    expect(svg).not.toMatch(/\/>/);
  });
});

describe('project', () => {
  it('puts the antimeridian and equator where the tiles do', () => {
    expect(project(-180, 0, 0)).toEqual([0, 128]);
    expect(project(0, 0, 1)).toEqual([256, 256]);
  });
});
