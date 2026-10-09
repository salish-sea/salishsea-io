/**
 * The shapes the site reads and writes, written out by hand since Postgres stopped being
 * their source (salish-9uu.10): a day file's occurrence as the read-path build writes it
 * (scripts/read-path/derive/occurrences.sql, ported from Postgres's public.occurrences),
 * and a sighting as the write API takes it (api/sightings.ts). The vocabularies are the
 * ones checked in at data/reference/enums.tsv (decision 064).
 */

export type License = 'cc0' | 'cc-by' | 'cc-by-nc' | 'cc-by-sa' | 'cc-by-nd' | 'cc-by-nc-sa' | 'cc-by-nc-nd' | 'none';
export type TravelDirection = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';
export type IdentificationCertainty = 'possible' | 'probable' | 'certain';

/** Who is signed in, as GET /api/me names their contributor (decision 065). */
export type Contributor = {id: number, name: string, picture: string | null, editor: boolean, orcid: string | null};

type LonLat = {lat: number; lon: number;};
export type OccurrencePhoto = {
  src: string;
  thumb: string | null;
  attribution: string | null;
  mimetype: string | null;
  license: License | null;
};
type Taxon = {
  scientific_name: string;
  vernacular_name: string | null;
  species_id: number | null;
  entity_id: string | null;
};
export type Occurrence = {
  id: string;
  url: string | null;
  attribution: string | null;
  body: string | null;
  accuracy: number | null;
  certainty: IdentificationCertainty | null;
  collection: string | null;
  contributor_id: number | null;
  count: number | null;
  direction: TravelDirection | null;
  identifiers: string[] | null;
  location: LonLat;
  observed_at: string;
  observed_from: LonLat | null;
  observed_until: string | null;
  observer: string | null;
  organization: string | null;
  organization_url: string | null;
  photos: OccurrencePhoto[];
  provider: string | null;
  provider_slug: string | null;
  source_url: string | null;
  taxon: Taxon;
} & {
  observed_at_ms: number;
} & SegmentPlacement;

/**
 * Where an occurrence sits in its travel segment, hung on the map feature by
 * {@link segment2features} and read back out by the style.
 *
 * It is not part of the record. A sighting has no intrinsic "last": the same
 * occurrence is a segment head on a day's map and a mid-track point once the
 * next sighting arrives. It lives on the Occurrence because the style receives
 * `feature.getProperties()`, and OpenLayers gives it no other channel.
 *
 * The head is the LAST point, not the first — the most recent place the animal
 * was, which is what a reader is looking for and what the label speaks for.
 */
export type SegmentPlacement = {
  isFirst?: true;
  isLast?: true;
  /** Occurrences in the segment. 1 for a singleton, which is a segment of one. */
  segmentLength?: number;
  /** Identifiers pooled across the whole segment, deduplicated and sorted. */
  segmentIdentifiers?: string[];
  /** The identity line for the whole track — see `labelForSegment`. */
  segmentIdentity?: string;
  /** First sighting to last, in hours. 0 for a singleton. */
  segmentSpanHours?: number;
};


/**
 * A sighting as the form saves it and the write API takes it (PUT /api/sightings/<id>,
 * decision 065). Named for the Postgres function it was first written for.
 */
export type UpsertObservationArgs = {
  id: string;
  body: string;
  count: number | null;
  direction: TravelDirection | null;
  entity_id: string;
  location: LonLat;
  observed_at: string;
  observed_from: LonLat | null;
  photos: OccurrencePhoto[];
  url: string;
  /** Accepted and never stored, as Postgres's function did. */
  accuracy: number | null;
};
