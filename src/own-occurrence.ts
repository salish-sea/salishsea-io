/**
 * A sighting as the store holds it, shaped as the occurrence the build will publish
 * (decision 065). Two readers use it: the map, laying a contributor's own saves over the
 * published files until a build carries them (write-api.ts), and the API, answering
 * anyone's `GET /api/sightings/<id>` for a sighting no file holds yet (salish-9uu.5), so a
 * link shared the moment it is saved opens, and its preview renders, before the build.
 *
 * No Vite or browser dependency: api/server.ts runs this under node.
 */

import { detectIndividuals } from './identifiers.ts';
import type { Contributor, Occurrence } from './types.ts';

/** A sighting as the store holds it (api/sightings.ts's OwnSighting). */
export type OwnSighting = {
  id: string, observed_at: string, location: {lon: number, lat: number},
  observed_from: {lon: number, lat: number} | null, body: string | null, count: number | null,
  direction: string | null, url: string | null, entity_id: string,
  photos: {src: string, license: string}[], contributor_id: number, updated_at: string,
};

/** What the form shows of a species, as the build publishes it (animal-names.json). */
export type SpeciesNames = {common_name: string | null, taxon_common_name: string | null, inaturalist_scientific_name: string | null};

/**
 * A sighting as saved, shaped as the map's occurrence, until a build publishes the
 * build's own version of it. What the build derives is approximated from what the page
 * has: the species' names from the published names, identifiers as the form detects
 * them, the attribution from the contributor's name.
 */
export function ownOccurrence(sighting: OwnSighting, contributor: Pick<Contributor, 'name'>,
  names: ReadonlyMap<string, SpeciesNames> | undefined): Occurrence {
  const species = names?.get(sighting.entity_id);
  return {
    id: sighting.id,
    url: sighting.url,
    attribution: `${contributor.name} on SalishSea.io`,
    body: sighting.body,
    count: sighting.count,
    direction: sighting.direction as Occurrence['direction'],
    location: sighting.location,
    accuracy: null,
    photos: sighting.photos.map(p => ({src: p.src, thumb: null, license: p.license as Occurrence['photos'][number]['license'],
      mimetype: null, attribution: 'someone'})),
    observed_at: sighting.observed_at,
    observed_at_ms: Date.parse(sighting.observed_at),
    observed_from: sighting.observed_from,
    taxon: {
      entity_id: sighting.entity_id,
      species_id: null,
      scientific_name: species?.inaturalist_scientific_name ?? null,
      vernacular_name: species?.common_name ?? species?.taxon_common_name ?? null,
    } as Occurrence['taxon'],
    identifiers: detectIndividuals(sighting.body ?? ''),
    contributor_id: sighting.contributor_id,
    observer: contributor.name,
    collection: null,
    source_url: null,
    organization: null,
    organization_url: null,
    provider: null,
    provider_slug: null,
    observed_until: null,
    certainty: null,
  };
}
