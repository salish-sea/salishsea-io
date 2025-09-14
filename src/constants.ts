// [minx, miny, maxx, maxy]
export type Extent = [number, number, number, number];

// https://github.com/salish-sea/acartia/wiki/1.-Context-for-SSEMMI-&-Acartia#spatial-boundaries-related-to-acartia
export const acartiaExtent: Extent = [-136, 36, -120, 54];
export const srkwExtent: Extent = [-125.5, 36, -122, 54];
export const salishSeaExtent: Extent = [-126, 47, -122, 50.5];
export const salishSRKWExtent: Extent = [-124, 47, -122, 49.5];
export const licenseCodes = {
  "none": "None (all rights reserved)",
  "cc0": "CC0 (public domain)",
  "cc-by": "CC-BY (attribution)",
  "cc-by-nc": "CC-BY-NC (attribution, non-commercial)",
  "cc-by-nc-sa": "CC-BY-NC-SA (attribution, non-commercial, share-alike)",
  "cc-by-nc-nd": "CC-BY-NC-ND (attribution, non-commercial, no derivatives)",
  "cc-by-nd": "CC-BY-ND (attribution, no derivatives)",
  "cc-by-sa": "CC-BY-SA (attribution, share-alike)",
};
