/**
 * PROTOTYPE — THROWAWAY. Not production code. No tests, no error handling.
 *
 * Three variants of occurrence symbology on the existing map route, switchable
 * via `?variant=A|B|C`. Question being answered: what replaces the single-letter
 * bubble, given that (a) the letters collide badly — `H` is both Humpback Whale
 * and Harbor Porpoise across 18,579 records, `S` covers 10 taxa — and (b) the
 * `accuracy` column cannot carry an uncertainty circle, being NULL for 57% of
 * the corpus and spanning 3 m to 7,313 km where present.
 *
 * The variants disagree about what the map is FOR, not about colour:
 *   A "Category"  — every point is a dot, colour is taxon group, segment heads
 *                   carry the label. Identity-first.
 *   B "Track"     — the segment is the object: prominent line, tail dots recede
 *                   with age, head is a badged code + label. Movement-first.
 *   C "Density"   — no labels at all. Radius by count, opacity by age, legend
 *                   off-map. Answers "where is there a lot happening".
 *
 * Fold the winner into src/style.ts properly; move the rest to a throwaway
 * branch. See docs/decisions/029 (unwritten) for the verdict.
 */

import Style from 'ol/style/Style.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Text from 'ol/style/Text.js';
import Icon from 'ol/style/Icon.js';
import { LineString, Point } from 'ol/geom.js';
import type Feature from 'ol/Feature.js';
import arrowPNG from './assets/arrow.png';
import { directionToRads } from './direction.ts';
import type { Occurrence } from './types.ts';
import { detectPod } from './identifiers.ts';

export type VariantKey = 'A' | 'B' | 'C' | 'D';

export const VARIANTS: {key: VariantKey, name: string, gloss: string}[] = [
  {key: 'A', name: 'Category', gloss: 'dots coloured by taxon group; labels on segment heads'},
  {key: 'B', name: 'Track', gloss: 'segment is the object; tails recede with age'},
  {key: 'C', name: 'Density', gloss: 'no labels; radius by count, opacity by age'},
  {key: 'D', name: 'Tracks only', gloss: 'only multi-point tracks are labelled; singletons stay bare'},
];

/** `null` means "leave the production symbology alone". */
export function activeVariant(): VariantKey | null {
  const v = new URLSearchParams(document.location.search).get('variant');
  return v === 'A' || v === 'B' || v === 'C' || v === 'D' ? v : null;
}

// ---------------------------------------------------------------------------
// Taxon groups
//
// Exhaustive over the 71 distinct scientific names present in the corpus as of
// 2026-08-26. Matched longest-prefix-first, so subspecies and genus-only stubs
// ('Megaptera', 'Orcinus') land with their species. The point of the grouping is
// that a viewer can tell a 15 m baleen whale from a 1.5 m porpoise, which the
// single-letter scheme cannot.
// ---------------------------------------------------------------------------

export type GroupKey =
  | 'orca' | 'baleen' | 'toothed' | 'dolphin' | 'porpoise'
  | 'seal' | 'sealion' | 'otter' | 'unknown';

export const GROUPS: Record<GroupKey, {label: string, code: string, color: string}> = {
  // Okabe–Ito, chosen for colourblind-safe separation against the pale Esri
  // ocean basemap. Orca is near-black because that is what an orca looks like.
  orca:     {label: 'Killer Whale',  code: 'KW', color: '#1a1a1a'},
  baleen:   {label: 'Baleen Whale',  code: 'BW', color: '#0072B2'},
  toothed:  {label: 'Toothed Whale', code: 'TW', color: '#5B2C8D'},
  dolphin:  {label: 'Dolphin',       code: 'DO', color: '#56B4E9'},
  porpoise: {label: 'Porpoise',      code: 'PO', color: '#009E73'},
  seal:     {label: 'Seal',          code: 'SE', color: '#E69F00'},
  sealion:  {label: 'Sea Lion',      code: 'SL', color: '#D55E00'},
  otter:    {label: 'Otter',         code: 'OT', color: '#CC79A7'},
  unknown:  {label: 'Marine Mammal', code: '??', color: '#6B7280'},
};

const GROUP_PREFIXES: [string, GroupKey][] = [
  ['Orcinus', 'orca'],
  ['Megaptera', 'baleen'], ['Eschrichti', 'baleen'], ['Balaenoptera', 'baleen'],
  ['Balaenopteridae', 'baleen'], ['Eubalaena', 'baleen'], ['Mysticeti', 'baleen'],
  ['Physeter', 'toothed'], ['Kogia', 'toothed'], ['Berardius', 'toothed'],
  ['Hyperoodon', 'toothed'], ['Ziphius', 'toothed'], ['Odontoceti', 'toothed'],
  ['Delphin', 'dolphin'], ['Grampus', 'dolphin'], ['Sagmatias', 'dolphin'],
  ['Aethalodelphis', 'dolphin'], ['Lissodelphi', 'dolphin'], ['Tursiops', 'dolphin'],
  ['Stenella', 'dolphin'], ['Globicephal', 'dolphin'],
  ['Phocoena', 'porpoise'], ['Phocoenoides', 'porpoise'], ['Phocoenidae', 'porpoise'],
  ['Phoca ', 'seal'], ['Phoca', 'seal'], ['Phocini', 'seal'], ['Phocidae', 'seal'],
  ['Mirounga', 'seal'],
  ['Zalophus', 'sealion'], ['Eumetopias', 'sealion'], ['Otariidae', 'sealion'],
  ['Arctocephalus', 'sealion'], ['Callorhinus', 'sealion'],
  ['Lontra', 'otter'], ['Enhydra', 'otter'], ['Lutrinae', 'otter'],
  // iNaturalist's 'Phocoidea' is labelled "Pinnipeds" upstream but is strictly
  // the true-seal superfamily (decision 027). Neither seal nor sea lion is
  // honest, so it falls through to unknown.
];

export function taxonGroup(scientificName: string): GroupKey {
  // Longest prefix wins, so 'Phocoenidae' beats 'Phoca'.
  let best: GroupKey = 'unknown';
  let bestLen = 0;
  for (const [prefix, group] of GROUP_PREFIXES) {
    if (scientificName.startsWith(prefix) && prefix.length > bestLen) {
      best = group;
      bestLen = prefix.length;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Short map names
//
// PROTOTYPE STAND-IN for two things that do not exist yet, so variant A can be
// judged with realistic strings instead of iNaturalist's:
//
//   1. The register's curated common name (salish-ayb.5). "River otter" is
//      SSA:0000906's `common` row in the animals repo, not something invented
//      here. Marked (reg) below.
//   2. Our own short map form (salish-ayb.6), which ADR-0011 explicitly leaves
//      to the consumer — it names truncation as a consumer concern. Marked
//      (ours).
//
// Keyed on scientific name here because that is what an Occurrence carries
// today. The real implementation keys on the SSA identifier; nothing should
// join on these strings. Longest-prefix match, so subspecies inherit their
// species' name — 'Lontra canadensis pacifica' is still a river otter.
//
// Names NOT yet in the register are marked (gap) and are tracked in
// salish-ayb.2; they are my guesses, not curated data.
// ---------------------------------------------------------------------------

const SHORT_NAMES: [string, string][] = [
  ['Megaptera novaeangliae', 'Humpback'],            // (reg "Humpback whale") + (ours)
  ['Eschrichtius robustus', 'Gray whale'],           // (reg) — "Gray" alone is an adjective
  ['Balaenoptera acutorostrata', 'Minke'],           // (reg "Minke whale") + (ours)
  ['Balaenoptera physalus', 'Fin whale'],            // (reg)
  ['Balaenoptera musculus', 'Blue whale'],           // (gap)
  ['Phoca vitulina', 'Harbour seal'],                // (reg)
  ['Mirounga angustirostris', 'Elephant seal'],      // (reg "Northern elephant seal") + (ours)
  ['Zalophus californianus', 'California sea lion'], // (reg)
  ['Eumetopias', 'Steller sea lion'],                // (reg) — covers the genus-only stub
  ['Lontra canadensis', 'River otter'],              // (reg) — the name that started this
  ['Enhydra lutris', 'Sea otter'],                   // (reg)
  ['Phocoena phocoena', 'Harbour porpoise'],         // (reg)
  ['Phocoenoides dalli', "Dall's porpoise"],         // (reg)
  ['Sagmatias obliquidens', 'White-sided dolphin'],  // (reg "Pacific white-sided dolphin") + (ours)
  ['Aethalodelphis obliquidens', 'White-sided dolphin'],
  ['Grampus griseus', "Risso's dolphin"],            // (gap)
  ['Tursiops', 'Bottlenose'],                        // (gap) + (ours)
  ['Delphinus delphis', 'Common dolphin'],           // (gap)
  ['Lissodelphis borealis', 'Right whale dolphin'],  // (gap) + (ours)
  ['Physeter macrocephalus', 'Sperm whale'],         // (gap)
  // Unresolvable stubs — "sighted but not identified further". The register
  // already plays this role with Aves and Laridae; decision 027 warns that
  // iNaturalist's "Phocoidea/Pinnipeds" is a misnomer, so it is not repeated.
  ['Otariidae', 'Sea lion'],                         // (gap)
  ['Phocidae', 'Seal'],                              // (gap)
  ['Phocoidea', 'Seal or sea lion'],                 // (gap)
  ['Lutrinae', 'Otter'],                             // (gap)
  ['Mysticeti', 'Baleen whale'],                     // (gap)
  ['Cetacea', 'Whale or dolphin'],                   // (gap)
  ['Odontoceti', 'Toothed whale'],                   // (gap)
  ['Delphinoidea', 'Dolphin or porpoise'],           // (gap)
  ['Phocoenidae', 'Porpoise'],                       // (gap)
  ['Delphinidae', 'Dolphin'],                        // (gap)
  ['Delphininae', 'Dolphin'],                        // (gap)
  ['Lissodelphininae', 'Dolphin'],                   // (gap)
  ['Globicephal', 'Pilot whale'],                    // (gap)
  ['Kogia', 'Pygmy sperm whale'],                    // (gap)
  ['Berardius bairdii', "Baird's beaked whale"],     // (gap)
  ['Ziphius cavirostris', "Cuvier's beaked whale"],  // (gap)
  ['Hyperoodon', 'Bottlenose whale'],                // (gap)
  ['Eubalaena', 'Right whale'],                      // (gap)
  ['Balaenoptera borealis', 'Sei whale'],            // (gap)
  ['Stenella coeruleoalba', 'Striped dolphin'],      // (gap)
  ['Arctocephalus', 'Fur seal'],                     // (gap)
  ['Callorhinus ursinus', 'Northern fur seal'],      // (gap)
  // Genus-only stubs. These are what leak iNaturalist's inconsistent casing —
  // 'common seals' (Phoca), 'sea otters' (Enhydra), 'Grey whales'
  // (Eschrichtius) — and they are the `c` and `s` glyphs in the production
  // symbol scheme. Shorter prefixes than their species, so longest-prefix
  // matching still resolves 'Phoca vitulina' to "Harbour seal".
  ['Phoca', 'Seal'],
  ['Phocini', 'Seal'],
  ['Enhydra', 'Sea otter'],
  ['Lontra', 'River otter'],
  ['Eschrichtius', 'Gray whale'],
  ['Megaptera', 'Humpback'],
  ['Mirounga', 'Elephant seal'],
  ['Zalophus', 'Sea lion'],
  ['Phocoena', 'Harbour porpoise'],
  ['Phocoenoides', "Dall's porpoise"],
  ['Sagmatias', 'White-sided dolphin'],
  ['Delphinus', 'Common dolphin'],
  ['Balaenoptera', 'Baleen whale'],
  ['Balaenopteridae', 'Baleen whale'],
];

function shortName(scientificName: string): string | null {
  let best: string | null = null;
  let bestLen = 0;
  for (const [prefix, name] of SHORT_NAMES) {
    if (scientificName.startsWith(prefix) && prefix.length > bestLen) {
      best = name;
      bestLen = prefix.length;
    }
  }
  return best;
}

/**
 * What a marker actually says, in words.
 *
 * Killer whales keep their pod letter because that part of the existing scheme
 * works — a J/K/L/T is real information to the audience. Everything else gets a
 * short curated name rather than a first initial, falling back to iNaturalist's
 * vernacular only where nothing better exists yet.
 */
export function labelFor(occurrence: Occurrence): string {
  const group = taxonGroup(occurrence.taxon.scientific_name);
  if (group === 'orca') {
    const pod = detectPod(occurrence.body || '');
    if (pod)
      return pod === 'T' ? "Biggs" : `${pod} pod`;
    if (occurrence.taxon.scientific_name === 'Orcinus orca rectipinnus')
      return "Biggs";
    if (occurrence.taxon.scientific_name === 'Orcinus orca ater')
      return 'SRKW';
    return 'Orca';
  }
  return shortName(occurrence.taxon.scientific_name)
    || occurrence.taxon.vernacular_name
    || GROUPS[group].label;
}

// ---------------------------------------------------------------------------
// Age
//
// "Now" is the newest occurrence in the loaded day, not wall-clock time —
// otherwise every historical date renders uniformly ancient and the recency
// encoding tests nothing.
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
let referenceMs = 0;

export function setReferenceTime(ms: number) {
  referenceMs = ms;
}

function ageHours(occurrence: Occurrence): number {
  if (!referenceMs)
    return 0;
  return Math.max(0, (referenceMs - occurrence.observed_at_ms) / HOUR_MS);
}

/** 1.0 for the newest point of the day, decaying to 0.25 over 12 hours. */
function agedOpacity(occurrence: Occurrence): number {
  const t = Math.min(1, ageHours(occurrence) / 12);
  return 1 - 0.75 * t;
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(2)})`;
}

// Properties the prototype hangs on features in obs-map.setOccurrences, so a
// head can speak for its whole track rather than only for itself.
export type SegmentMeta = {
  segmentLength?: number;
  segmentIdentifiers?: string[];
  segmentSpanHours?: number;
  /** Set on the non-head members of a multi-point track. */
  trackTail?: true;
};

const yellow = '#ffff00';

function selectedStyle(): Style[] {
  return [new Style({
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({color: 'rgba(255, 255, 0, 0.5)'}),
      stroke: new Stroke({color: yellow, width: 3}),
    }),
  })];
}

/**
 * A track label, optionally over two lines.
 *
 * NOTE: OpenLayers' rich-text form (an array of alternating text and font) does
 * NOT honour '\n' — it lays every chunk out inline, which rendered
 * "Humpback Seen 2× in under an hour" on one line. A plain string with a
 * newline breaks correctly, at the cost of a per-line font. One Text also keeps
 * the label a single declutter unit and a single background box, so the two
 * lines cannot be separated or half-hidden.
 */
function labelText(text: string, color: string, offsetX: number, secondLine?: string): Text {
  return new Text({
    backgroundFill: new Fill({color: 'rgba(255, 255, 255, 0.88)'}),
    backgroundStroke: new Stroke({color: rgba(color, 0.5), width: 1}),
    declutterMode: 'declutter',
    fill: new Fill({color: '#111827'}),
    font: '600 11px system-ui, sans-serif',
    offsetX,
    padding: [2, 4, 1, 4],
    text: secondLine ? `${text}\n${secondLine}` : text,
    textAlign: 'left',
    textBaseline: 'middle',
  });
}

/**
 * "Seen 9× over 10h".
 *
 * The unit is named because a bare number beside an animal's name reads as a
 * count of ANIMALS — and `count` is a real column meaning exactly that. This
 * number is sightings, and has to say so.
 */
function trackSummary(points: number, spanHours: number): string {
  const span = spanHours < 1 ? 'in under an hour' : `over ${spanHours.toFixed(0)}h`;
  return `Seen ${points}× ${span}`;
}

function directionArrow(color: string, direction: Occurrence['direction']): Style | null {
  if (!direction)
    return null;
  return new Style({
    text: new Text({
      declutterMode: 'none',
      fill: new Fill({color}),
      font: '15px monospace',
      rotation: directionToRads(direction),
      text: ' ⇢',
      textAlign: 'left',
    }),
  });
}

// ---------------------------------------------------------------------------
// Variant A — Category
//
// Every occurrence is the same 5 px dot; only the fill says what it is. The
// segment head is a ringed dot carrying one label for the whole track. Tests
// whether colour alone is enough to read taxon at map density, and whether
// hoisting labels to heads clears the collision seen at Victoria today.
// ---------------------------------------------------------------------------

function variantA(occurrence: Occurrence & SegmentMeta, isSelected: boolean): Style[] {
  if (isSelected)
    return selectedStyle();

  const group = taxonGroup(occurrence.taxon.scientific_name);
  const {color} = GROUPS[group];
  const isHead = occurrence.isLast;

  const styles: Style[] = [
    new Style({
      image: new CircleStyle({
        radius: isHead ? 7 : 4.5,
        declutterMode: 'none',
        fill: new Fill({color: rgba(color, isHead ? 0.95 : 0.75)}),
        stroke: new Stroke({color: isHead ? '#ffffff' : rgba(color, 0.9), width: isHead ? 2 : 1}),
      }),
    }),
  ];

  if (isHead) {
    const ids = occurrence.segmentIdentifiers?.length
      ? ` · ${occurrence.segmentIdentifiers.join(', ')}`
      : '';
    const n = occurrence.segmentLength ?? 1;
    // The count moves to its own line with a named unit, for the same reason as
    // in D: "Gray whale (3)" reads as three whales, and `count` is a real
    // column that means exactly that.
    styles.push(new Style({
      text: labelText(
        `${labelFor(occurrence)}${ids}`,
        color,
        11,
        n > 1 ? trackSummary(n, occurrence.segmentSpanHours ?? 0) : undefined,
      ),
    }));
  }

  const arrow = directionArrow(color, occurrence.direction);
  if (arrow)
    styles.push(arrow);

  return styles;
}

// ---------------------------------------------------------------------------
// Variant B — Track
//
// The line is the primary object. Tail points shrink and fade with age so the
// eye runs to the head; the head is a filled badge carrying a two-letter group
// code — deliberately two letters, since the whole defect in production is that
// one letter cannot separate Humpback from Harbor Porpoise. If two letters read
// well here, the icon library in #79 is a polish step rather than a blocker.
// ---------------------------------------------------------------------------

function variantB(occurrence: Occurrence & SegmentMeta, isSelected: boolean): Style[] {
  if (isSelected)
    return selectedStyle();

  const group = taxonGroup(occurrence.taxon.scientific_name);
  const {color, code} = GROUPS[group];
  const opacity = agedOpacity(occurrence);

  if (!occurrence.isLast) {
    return [new Style({
      image: new CircleStyle({
        radius: 3,
        declutterMode: 'none',
        fill: new Fill({color: rgba(color, opacity * 0.55)}),
      }),
    })];
  }

  const styles: Style[] = [
    new Style({
      image: new CircleStyle({
        radius: 11,
        declutterMode: 'none',
        fill: new Fill({color: rgba(color, 0.95)}),
        stroke: new Stroke({color: '#ffffff', width: 2}),
      }),
    }),
    new Style({
      text: new Text({
        declutterMode: 'none',
        fill: new Fill({color: '#ffffff'}),
        font: '700 10px system-ui, sans-serif',
        offsetY: 0.5,
        text: code,
        textBaseline: 'middle',
      }),
    }),
  ];

  const ids = occurrence.segmentIdentifiers?.length
    ? occurrence.segmentIdentifiers.join(', ')
    : labelFor(occurrence);
  const n = occurrence.segmentLength ?? 1;
  const span = occurrence.segmentSpanHours ?? 0;
  styles.push(new Style({
    text: labelText(ids, color, 16, n > 1 ? trackSummary(n, span) : undefined),
  }));

  const arrow = directionArrow(color, occurrence.direction);
  if (arrow)
    styles.push(arrow);

  return styles;
}

// ---------------------------------------------------------------------------
// Variant C — Density
//
// Strip every label. Radius carries `count` (66% of the corpus has one),
// opacity carries age, colour carries group, and the legend lives off-map in
// the switcher bar. Tests the hypothesis that the labels were never the point —
// that the map's job is "where is there a lot happening" and identity belongs
// in the panel on selection.
// ---------------------------------------------------------------------------

function variantC(occurrence: Occurrence & SegmentMeta, isSelected: boolean): Style[] {
  if (isSelected)
    return selectedStyle();

  const group = taxonGroup(occurrence.taxon.scientific_name);
  const {color} = GROUPS[group];
  const opacity = agedOpacity(occurrence);
  // sqrt so area, not radius, tracks the count; clamped because `count` runs to
  // 1000 and an honest linear scale would eat the strait.
  const count = Math.min(occurrence.count ?? 1, 60);
  const radius = 4 + Math.sqrt(count) * 1.6;

  return [new Style({
    image: new CircleStyle({
      radius,
      declutterMode: 'none',
      fill: new Fill({color: rgba(color, opacity * 0.55)}),
      stroke: new Stroke({color: rgba(color, opacity), width: 1.25}),
    }),
  })];
}

// ---------------------------------------------------------------------------
// Variant D — Tracks only
//
// Written after A and B were rendered and measured. On seven sampled days the
// segmentation yields 3–10 multi-point tracks against 36–67 singletons, because
// a lone occurrence is still a segment of one. So "label the segment head
// instead of the point" saves ~10 labels out of 83 — A and B both still label
// essentially everything, which is what their screenshots show.
//
// D takes the finding seriously: a label is earned by being a TRACK. Singletons
// are bare dots and say what they are through colour and the panel. That is
// also the honest answer to the pinniped question — an otter sighting is a
// singleton by construction (decision 027 gates segments to six cetacean
// species), so it should not be shouting its full vernacular name at the map.
// ---------------------------------------------------------------------------

function variantD(occurrence: Occurrence & SegmentMeta, isSelected: boolean): Style[] {
  if (isSelected)
    return selectedStyle();

  const group = taxonGroup(occurrence.taxon.scientific_name);
  const {color, code} = GROUPS[group];
  const opacity = agedOpacity(occurrence);
  const inTrack = (occurrence.segmentLength ?? 1) > 1 || !!occurrence.trackTail;

  if (!occurrence.isLast || !inTrack) {
    // Singleton, or a mid-track point: a dot, and nothing else.
    return [new Style({
      image: new CircleStyle({
        radius: inTrack ? 3.5 : 5,
        declutterMode: 'none',
        fill: new Fill({color: rgba(color, opacity * (inTrack ? 0.6 : 0.8))}),
        stroke: new Stroke({color: rgba(color, opacity * 0.9), width: 1}),
      }),
    })];
  }

  const styles: Style[] = [
    new Style({
      image: new CircleStyle({
        radius: 11,
        declutterMode: 'none',
        fill: new Fill({color: rgba(color, 0.95)}),
        stroke: new Stroke({color: '#ffffff', width: 2}),
      }),
    }),
    new Style({
      text: new Text({
        declutterMode: 'none',
        fill: new Fill({color: '#ffffff'}),
        font: '700 10px system-ui, sans-serif',
        offsetY: 0.5,
        text: code,
        textBaseline: 'middle',
      }),
    }),
  ];

  const ids = occurrence.segmentIdentifiers?.length
    ? occurrence.segmentIdentifiers.join(', ')
    : labelFor(occurrence);
  styles.push(new Style({
    text: labelText(
      ids,
      color,
      16,
      trackSummary(occurrence.segmentLength!, occurrence.segmentSpanHours ?? 0),
    ),
  }));

  const arrow = directionArrow(color, occurrence.direction);
  if (arrow)
    styles.push(arrow);

  return styles;
}

const OCCURRENCE_STYLES: Record<VariantKey, (o: Occurrence & SegmentMeta, s: boolean) => Style[]> = {
  A: variantA,
  B: variantB,
  C: variantC,
  D: variantD,
};

export function variantOccurrenceStyle(variant: VariantKey) {
  return (occurrence: Occurrence & SegmentMeta, isSelected = false) =>
    OCCURRENCE_STYLES[variant](occurrence, isSelected);
}

// ---------------------------------------------------------------------------
// Travel lines
//
// Production draws 2 px of #ffcc33, which GH #271 reports as barely visible.
// Each variant takes a different position on how loud the line should be, since
// that is inseparable from whether the segment is the primary object.
// ---------------------------------------------------------------------------

export function variantTravelStyle(variant: VariantKey) {
  return (feature: Feature<LineString>, resolution: number): Style[] | undefined => {
    if (resolution > 100)
      return;
    const lineString = feature.getGeometry()!;
    if (lineString.getCoordinates().length < 2)
      return;

    const taxon = feature.get('taxon') as Occurrence['taxon'] | undefined;
    const group = taxon ? taxonGroup(taxon.scientific_name) : 'unknown';
    const {color} = GROUPS[group];

    if (variant === 'C')
      return [new Style({stroke: new Stroke({color: rgba(color, 0.25), width: 1.5})})];

    const width = variant === 'B' ? 4 : 2.5;
    const styles: Style[] = [
      // A casing under the line: on a busy basemap a bare stroke disappears
      // into coastline, which is most of what #271 is actually reporting.
      new Style({stroke: new Stroke({color: 'rgba(255, 255, 255, 0.7)', width: width + 3})}),
      new Style({stroke: new Stroke({color: rgba(color, 0.9), width})}),
    ];

    if (variant === 'B') {
      lineString.forEachSegment((a, b) => {
        const start = a as [number, number];
        const end = b as [number, number];
        const rotation = Math.atan2(end[1] - start[1], end[0] - start[0]);
        styles.push(new Style({
          geometry: new Point([(end[0] + start[0]) / 2, (end[1] + start[1]) / 2]),
          image: new Icon({
            src: arrowPNG,
            anchor: [0.75, 0.5],
            rotateWithView: true,
            rotation: -rotation,
          }),
        }));
      });
    }

    return styles;
  };
}
