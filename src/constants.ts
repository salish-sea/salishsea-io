import { Temporal } from "temporal-polyfill";

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

/**
 *  [minx, miny, maxx, maxy]
 */
export type Extent = [number, number, number, number];

export function isExtent(input: number[]): input is Extent {
  const [minx, miny, maxx, maxy] = input;
  return input.length === 4 && minx && miny && maxx && maxy &&
    minx < maxx && miny < maxy &&
    minx >= -180 && minx <= 180 && maxx >= -180 && maxx <= 180 &&
    miny >= -90 && miny <= 90 && maxy >= -90 && maxy <= 90 ||
    false;
}

// https://github.com/salish-sea/acartia/wiki/1.-Context-for-SSEMMI-&-Acartia#spatial-boundaries-related-to-acartia
export const acartiaExtent: Extent = [-136, 36, -120, 54];
export const pugetSoundExtent: Extent = [-123.15, 47.04, -122.20, 48.16];
export const sanJuansExtent: Extent = [-123.25, 48.4, -122.73, 48.79];
export const srkwExtent: Extent = [-125.5, 36, -122, 54];
export const salishSeaExtent: Extent = [-126, 47, -122, 50.5];
export const salishSRKWExtent: Extent = [-124, 47, -122, 49.5];
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

/// species scientifica name -> mean speed in km/h
export const travelSpeedKmH: {[k: string]: number} = {
  "Balaenoptera acutorostrata": 3.0,
  "Eschrichtius robustus": 4.0,
  "Megaptera novaeangliae": 5.0,
  "Orcinus orca": 6.8,
  "Orcinus orca ater": 6.6,
  "Orcinus orca rectipinnus": 6.8,
};
