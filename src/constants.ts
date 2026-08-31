import { Temporal } from "temporal-polyfill";
import { type Extent, acartiaExtent, pugetSoundExtent, sanJuansExtent, srkwExtent, salishSeaExtent, salishSRKWExtent } from './extents.ts';

/**
 * Every calendar date this app shows is a *local* date in the Salish Sea, not in
 * the viewer's zone: `?d=`, the occurrences query's day boundaries, the DwC
 * export, and `occurrence_days`. A viewer in Tokyo asking for July 30 means the
 * region's July 30.
 */
export const OBSERVATION_TIME_ZONE = 'PST8PDT';

/**
 * Today, in the zone above.
 *
 * Call this — don't hoist it into a module constant. A module constant is
 * evaluated once at load, and this is a long-lived SPA: a tab left open across
 * local midnight would keep offering yesterday as the latest day there is.
 */
export function observationToday(): Temporal.PlainDate {
  return Temporal.Now.plainDateISO(OBSERVATION_TIME_ZONE);
}

/**
 * The oldest day the date controls will navigate to — inherited from the `min`
 * on the date input the calendar replaced. Nothing in the corpus predates it by
 * much (earliest occurrence: 2012).
 *
 * Every control that moves the day shares this bound and {@link observationToday}
 * as its other end. Miss one and it walks the selection outside the range the
 * calendar will render, which is how the day steppers ended up able to leave it.
 */
export const EARLIEST_OBSERVATION_DATE = Temporal.PlainDate.from('2000-01-01');

// The extents live in a dependency-free module so the ingest core can share
// them under Deno; re-exported here so callers keep one import.
export {
  type Extent, isExtent,
  acartiaExtent, pugetSoundExtent, sanJuansExtent, srkwExtent, salishSeaExtent, salishSRKWExtent,
} from './extents.ts';

/**
 * A region is the scope of the query, not just a place to look at.
 *
 * Selecting one filters the occurrences the map draws, the list shows and the
 * calendar counts, and shades the map outside itself so that empty water reads
 * as "we are not showing you anything here" rather than "nothing was seen
 * here". That distinction is the whole point — see GH #16.
 *
 * `extent` is the filter — what we will show you. `zoomExtent` is the framing —
 * where the map goes. They are usually the same, and only differ where the
 * honest filter bounds make a poor viewport.
 *
 * Salish Sea is that case. Filtering on the narrow SRKW-clipped box would drop
 * real data (the Strait of Georgia north of 49.5, the western Strait of Juan de
 * Fuca), so the filter is wide. But fitting the map to that wide box pulls the
 * view half a zoom level further out than the framing #352 chose deliberately —
 * "the water the sightings are actually in" — and leaves most of a large screen
 * outside the region, and therefore shaded.
 *
 * Framing tighter than the filter is safe in a way the reverse is not. The
 * viewport is not a promise about what exists; the mask is. Landing inside the
 * region means no shading on load, and panning outward reveals more clear water
 * before it reveals the boundary — which is the right order to meet them in.
 */
export type RegionSlug = 'salish-sea' | 'puget-sound' | 'san-juans' | 'srkw-range' | 'everywhere';

export type Region = {
  slug: RegionSlug;
  label: string;
  /** `null` means no filter and no mask — every occurrence we hold. */
  extent: Extent | null;
  /** Where the map goes on selection. Equals `extent` unless that is null. */
  zoomExtent: Extent;
};

/**
 * In the order the bubbles are drawn, which is the order the select they
 * replaced offered.
 *
 * Note "Salish Sea" filters on {@link salishSeaExtent}, NOT the tighter
 * {@link salishSRKWExtent} the Go-to bubble used before it became a filter.
 * The clipped extent frames the water sightings are usually in, which is right
 * for a viewport and wrong for a filter: as the default it would silently drop
 * the Strait of Georgia north of 49.5 and the western Strait of Juan de Fuca.
 * A default that hides real data without saying so is the bug this feature
 * exists to fix.
 */
export const REGIONS: readonly Region[] = Object.freeze([
  {slug: 'puget-sound', label: 'Puget Sound', extent: pugetSoundExtent, zoomExtent: pugetSoundExtent},
  // The one region whose framing and filter differ — see the note above.
  {slug: 'salish-sea',  label: 'Salish Sea',  extent: salishSeaExtent,  zoomExtent: salishSRKWExtent},
  {slug: 'san-juans',   label: 'San Juans',   extent: sanJuansExtent,   zoomExtent: sanJuansExtent},
  {slug: 'srkw-range',  label: 'SRKW Range',  extent: srkwExtent,       zoomExtent: srkwExtent},
  // Without this, everything between the SRKW range and where ingest actually
  // reaches (acartiaExtent) would be permanently unreachable from the UI.
  {slug: 'everywhere',  label: 'Everywhere',  extent: null,             zoomExtent: acartiaExtent},
]);

export const DEFAULT_REGION_SLUG: RegionSlug = 'salish-sea';

export function regionBySlug(slug: string | null | undefined): Region {
  return REGIONS.find(r => r.slug === slug)
    ?? REGIONS.find(r => r.slug === DEFAULT_REGION_SLUG)!;
}

export const licenseCodes = Object.freeze({
  "none": "None (all rights reserved)",
  "cc0": "CC0 (public domain)",
  "cc-by": "CC-BY (attribution)",
  "cc-by-nc": "CC-BY-NC (attribution, non-commercial)",
  "cc-by-nc-sa": "CC-BY-NC-SA (attribution, non-commercial, share-alike)",
  "cc-by-nc-nd": "CC-BY-NC-ND (attribution, non-commercial, no derivatives)",
  "cc-by-nd": "CC-BY-ND (attribution, no derivatives)",
  "cc-by-sa": "CC-BY-SA (attribution, share-alike)",
});

/**
 * Scientific name -> mean travel speed in km/h.
 *
 * Absence is load-bearing. A taxon with no entry can never seed a travel
 * segment, which is how [027](../docs/decisions/027-marine-mammal-scope-whale-centric-identity.md)
 * keeps pinnipeds and otters off the travel lines: they are sighted, not
 * tracked. Adding a key here is a decision that the animal's movement between
 * two sightings is a claim we are willing to draw.
 *
 * Read it through {@link travelSpeedFor}, never by direct subscript.
 */
export const travelSpeedKmH: {[k: string]: number} = {
  "Balaenoptera acutorostrata": 3.0,
  "Eschrichtius robustus": 4.0,
  "Megaptera novaeangliae": 5.0,
  "Orcinus orca": 6.8,
  "Orcinus orca ater": 6.6,
  "Orcinus orca rectipinnus": 6.8,
};

/**
 * The mean travel speed for a taxon, or `undefined` if it does not travel on
 * this map.
 *
 * Falls back from a trinomial to its binomial, because the table is keyed by
 * name while iNaturalist reports some sightings at subspecies rank. Without
 * that fallback `Megaptera novaeangliae kuzira` (342 occurrences) could never
 * START a segment though `Megaptera novaeangliae` could, so North Pacific
 * Humpbacks silently drew no travel lines at all — an accident of exact-string
 * matching, not the deliberate omission above (salish-fll.2).
 *
 * The fallback only reaches species that are already listed, so it inherits the
 * intent rather than widening it: `Phoca vitulina richardii` still finds
 * nothing. Where a subspecies' speed is genuinely different — the two orca
 * ecotypes — an explicit key still wins over the binomial.
 */
export function travelSpeedFor(scientificName: string): number | undefined {
  const exact = travelSpeedKmH[scientificName];
  if (exact !== undefined)
    return exact;
  const [genus, species, ...rest] = scientificName.split(' ');
  if (!genus || !species || rest.length === 0)
    return undefined;
  return travelSpeedKmH[`${genus} ${species}`];
}
