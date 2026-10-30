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
/**
 * Whether anyone but its reporter agrees with what a sighting is shown as (decision 080).
 * Disputed is an iNaturalist observation whose identifications disagree.
 */
export type Confirmation = 'confirmed' | 'unconfirmed' | 'disputed';
export type Vitality = 'alive' | 'dead' | 'undetermined';

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
  scientific_name: string | null;
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
  confirmation: Confirmation;
  /** How many other people's identifications name another branch; null for a source without identifications (decision 080). */
  disagreements: number | null;
  /** Whether the animal was alive, from iNaturalist's annotation; null when no annotation counts, none made or all voted down (salish-1y8). */
  vitality: Vitality | null;
  contributor_id: number | null;
  count: number | null;
  direction: TravelDirection | null;
  identifiers: string[] | null;
  location: LonLat;
  observed_at: string;
  observed_from: LonLat | null;
  observed_until: string | null;
  observer: string | null;
  /**
   * The water region its point is in, as a card says it ("Haro Strait", "off Vancouver
   * Island"), named by the read-path build from the basemap's regions (salish-fwyt.2).
   * Null where no region is; absent from a sighting the build hasn't seen yet.
   */
  place?: string | null;
  /**
   * The name reporters use nearest its point, in that region, as a card writes it after
   * "off" ("Lime Kiln", "Mukilteo"), named by the build from data/reference/landmarks.tsv
   * (decision 100). Null where none is within 5 km or there is no place; absent likewise.
   */
  landmark?: string | null;
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
 * Where an occurrence sits in its travel segment, set by
 * {@link placeInSegment} and read by the style.
 *
 * It is not part of the record. A sighting has no intrinsic "last": the same
 * occurrence is a segment head on a day's map and a mid-track point once the
 * next sighting arrives.
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
  /** How far the animal may have been from `location`, in metres; null when the author didn't say (decision 077). */
  accuracy: number | null;
};
