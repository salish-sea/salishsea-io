/**
 *  [minx, miny, maxx, maxy]
 */
type Extent = [number, number, number, number];

export function isExtent(input: number[]): input is Extent {
  const [minx, miny, maxx, maxy] = input;
  return input.length === 4 && minx && miny && maxx && maxy &&
    minx < maxx && miny < maxy &&
    minx >= -180 && minx <= 180 && maxx >= -180 && maxx <= 180 &&
    miny >= -90 && miny <= 90 && maxy >= -90 && maxy <= 90 ||
    false;
}

// https://github.com/salish-sea/acartia/wiki/1.-Context-for-SSEMMI-&-Acartia#spatial-boundaries-related-to-acartia
// export const acartiaExtent: Extent = [-136, 36, -120, 54];
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
