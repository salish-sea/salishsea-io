import { createContext } from '@lit/context';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapTouchEvent, PointLike } from 'maplibre-gl';
import type { Feature, Polygon } from 'geojson';
import { circle } from '@turf/circle';
import { bearing as getBearing } from '@turf/bearing';
import { distance as getDistance } from '@turf/distance';
import { occurrenceProperties, ringColours } from './style.ts';
import type { Occurrence } from './types.ts';

export type LonLat = [number, number];

/** As much of an occurrence as the form knows before it is saved. */
export type SubjectOccurrence = {
  direction?: Occurrence['direction'] | '';
  identifiers?: string[];
  taxon?: Pick<Occurrence['taxon'], 'scientific_name'>;
};
export type DraftPoint = 'observer' | 'subject';
/** What the pointer can take hold of: either point, or the handle on the subject's ring. */
type Grip = DraftPoint | 'radius';

/** What a form hears whenever one of its points, or its subject's ring, changes, however it was changed. */
export type DraftPoints = Record<DraftPoint, LonLat | null> & {
  /** How far the animal may have been from the subject, in metres (decision 077); null when not stated. */
  accuracy: number | null;
  /** True while `accuracy` is our suggestion, which follows the points until the author changes it. */
  suggested: boolean;
};

/**
 * What the pointer holds. A ring's handle remembers the radius and the pointer's
 * distance from the subject when the drag began: the drag changes the radius by how
 * far the pointer moves, so the handle needn't sit exactly on a ring too small to
 * reach, and pressing it changes nothing.
 */
type Held = {draft: SightingDraft, which: Grip, from?: {radius: number, distance: number}};

/** The widest ring the handle draws, as the write API takes it. */
export const MAX_ACCURACY_M = 100_000;
/**
 * The nearest the handle comes to the subject, in pixels: where it waits until a
 * radius is set, and where it stays while the ring is smaller than that on screen, so
 * it never covers the subject's dot or takes its drag.
 */
const HANDLE_MIN_PX = 24;

/** A radius rounded to two significant figures, so a drag lands on 1,200 m and not 1,187. */
export function roundRadius(metres: number): number {
  const scale = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(metres, 1))) - 1);
  return Math.min(MAX_ACCURACY_M, Math.max(1, Math.round(metres / scale) * scale));
}

/**
 * How far off a new sighting's animal may have been when its author hasn't said: a
 * quarter of the distance from observer to subject, since a range judged by eye over
 * water is often 20 to 30% out and a bearing 10° out adds about a sixth sideways. Never
 * under 20 m, about what a phone knows of its own position. Null without both points.
 */
export function suggestedAccuracy(observer: LonLat | null, subject: LonLat | null): number | null {
  if (!observer || !subject) return null;
  return roundRadius(Math.max(SUGGESTED_MIN_M, getDistance(observer, subject) * 1000 * SUGGESTED_FRACTION));
}
export const SUGGESTED_FRACTION = 0.25;
const SUGGESTED_MIN_M = 20;

/** "±250 m", "±1.2 km". */
export function radiusLabel(metres: number): string {
  return metres < 1000 ? `±${metres} m` : `±${(metres / 1000).toLocaleString('en-US', {maximumFractionDigits: 1})} km`;
}

/** "450 m", "2.0 km": a distance as the form's hint says it. */
export function distanceLabel(metres: number): string {
  const rounded = roundRadius(metres);
  return rounded < 1000 ? `${rounded} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** The point `metres` due east of `[lon, lat]`. */
function eastOf([lon, lat]: LonLat, metres: number): LonLat {
  return [lon + metres / (111_320 * Math.cos(lat * Math.PI / 180)), lat];
}

/** How close, in pixels, the pointer has to come to a point to grab it: OpenLayers' `Modify` default. */
const GRAB_TOLERANCE = 10;

/**
 * The sightings being drawn on the map by open sighting forms: each one's
 * observer, subject, and the bearing between them, which can be dragged, or
 * placed with a click or tap after the form's "Locate on map" button.
 *
 * OpenLayers gave us this as its `Modify` interaction and a small pointer
 * interaction of our own; MapLibre has neither, so it is written out here
 * (decision 076). `<obs-map>` owns one, attaches it once its map has loaded,
 * and hands it to the forms through {@link sightingDraftsContext}.
 */
export class SightingDrafts {
  #map: MapLibreMap | undefined;
  readonly #drafts = new Set<SightingDraft>();
  /** The point being dragged, or placed, while a gesture is under way. */
  #dragging: Held | null = null;
  /** The point to place with the next click or tap. */
  #placing: {draft: SightingDraft, which: DraftPoint} | null = null;
  #hover: string | null = null;
  #suppressClick = false;

  /** Start drawing a form's sighting, at the points it already holds. `onChange` hears of every later move. */
  create(id: string, onChange: (points: DraftPoints) => void, initial: Partial<DraftPoints> = {}): SightingDraft {
    const draft = new SightingDraft(this, id, onChange);
    draft.observer = initial.observer ?? null;
    draft.subject = initial.subject ?? null;
    draft.suggested = initial.suggested ?? false;
    draft.accuracy = draft.suggested ? suggestedAccuracy(draft.observer, draft.subject) : initial.accuracy ?? null;
    this.#drafts.add(draft);
    this.render();
    return draft;
  }

  /** @internal */
  remove(draft: SightingDraft) {
    this.#drafts.delete(draft);
    if (this.#placing?.draft === draft) this.#placing = null;
    if (this.#dragging?.draft === draft) this.#dragging = null;
    this.render();
  }

  attach(map: MapLibreMap) {
    this.#map = map;
    map.on('mousedown', e => this.#down(e));
    // Fingers land one at a time: a second one during a drag makes it a pinch,
    // so the drag stops where it is and the map's own pinch zoom takes over.
    map.on('touchstart', e => {
      if (e.points.length === 1) this.#down(e);
      else this.#stop();
    });
    map.on('mousemove', e => this.#move(e));
    map.on('touchmove', e => { if (e.points.length === 1) this.#move(e); });
    map.on('mouseup', e => this.#up(e));
    map.on('touchend', e => this.#up(e));
    map.on('touchcancel', e => this.#up(e));
    // The map hears a mouse released only over itself. Released anywhere else,
    // or with the window losing focus mid-drag, the drag ends where it is.
    // The handle never comes nearer its subject than a fixed distance on screen.
    map.on('zoomend', () => this.render());
    window.addEventListener('mouseup', this.#stopOnWindow);
    window.addEventListener('blur', this.#stopOnWindow);
    this.render();
  }

  /** Let go of the window when the map goes away. */
  detach() {
    window.removeEventListener('mouseup', this.#stopOnWindow);
    window.removeEventListener('blur', this.#stopOnWindow);
    this.#dragging = null;
    this.#placing = null;
    this.#hover = null;
    this.#suppressClick = false;
    this.#map = undefined;
  }

  readonly #stopOnWindow = () => this.#stop();

  /** True once after a drag or a placement, so the click it ends in doesn't also select an occurrence. */
  takeClick(): boolean {
    const suppress = this.#suppressClick;
    this.#suppressClick = false;
    return suppress;
  }

  /** True while the pointer is close enough to a point to grab it. */
  get hovering(): boolean {
    return this.#hover !== null;
  }

  /** While a point is being dragged or placed, the map's own hovering and clicking stand aside. */
  get busy(): boolean {
    return !!(this.#dragging || this.#placing);
  }

  /** @internal Start placing a point; pressed again for the same point, stop. */
  place(draft: SightingDraft, which: DraftPoint) {
    const same = this.#placing?.draft === draft && this.#placing.which === which;
    this.#placing = same ? null : {draft, which};
    this.#cursor();
  }

  #nearest(point: PointLike): {draft: SightingDraft, which: Grip} | null {
    const [px, py] = Array.isArray(point) ? point : [point.x, point.y];
    let best: {draft: SightingDraft, which: Grip} | null = null;
    let bestDistance = GRAB_TOLERANCE;
    for (const draft of this.#drafts) {
      for (const which of ['radius', 'subject', 'observer'] as const) {
        const lonLat = which === 'radius' ? this.#handleAt(draft) : draft[which];
        if (!lonLat) continue;
        const {x, y} = this.#map!.project(lonLat);
        const d = Math.hypot(x - px, y - py);
        if (d <= bestDistance) {
          best = {draft, which};
          bestDistance = d;
        }
      }
    }
    return best;
  }

  #down(e: MapMouseEvent | MapTouchEvent) {
    // A drag ends without a click; only the click that ends a placement may be swallowed.
    this.#suppressClick = false;
    const target = this.#placing ?? this.#nearest(e.point);
    if (!target) return;
    // No pan or box zoom: this gesture is ours.
    e.preventDefault();
    const lonLat: LonLat = e.lngLat.toArray();
    if (target.which === 'radius' && target.draft.subject) {
      this.#dragging = {...target, from: {radius: target.draft.accuracy ?? 0, distance: getDistance(target.draft.subject, lonLat) * 1000}};
    } else {
      this.#dragging = target;
      this.#drag(target, lonLat);
    }
    this.#cursor();
  }

  /**
   * Move what is held to where the pointer is: a point there, or the ring wider or
   * narrower by as much as the pointer has moved away from or toward the subject.
   * Drawn in to nothing, the ring goes, as clearing the field does.
   */
  #drag({draft, which, from}: Held, lonLat: LonLat) {
    if (which !== 'radius') {
      draft.set(which, lonLat);
    } else if (draft.subject && from) {
      const radius = from.radius + getDistance(draft.subject, lonLat) * 1000 - from.distance;
      draft.setAccuracy(radius < 1 ? null : roundRadius(radius));
    }
  }

  /**
   * Where a draft's ring handle is: on the ring's east edge, but never nearer the
   * subject than HANDLE_MIN_PX, a distance on screen that moves with the zoom.
   */
  #handleAt(draft: SightingDraft): LonLat | null {
    if (!draft.subject || !this.#map) return null;
    const {x, y} = this.#map.project(draft.subject);
    const edge = draft.accuracy ? eastOf(draft.subject, draft.accuracy) : null;
    if (edge && this.#map.project(edge).x >= x + HANDLE_MIN_PX) return edge;
    return this.#map.unproject([x + HANDLE_MIN_PX, y]).toArray();
  }

  #move(e: MapMouseEvent | MapTouchEvent) {
    if (this.#dragging) {
      this.#drag(this.#dragging, e.lngLat.toArray());
      return;
    }
    if (e.type !== 'mousemove') return;
    if (this.#placing) {
      this.#placing.draft.set(this.#placing.which, e.lngLat.toArray());
      return;
    }
    const near = this.#nearest(e.point);
    const hover = near ? featureId(near.draft, near.which) : null;
    if (hover !== this.#hover) {
      if (this.#hover) this.#map!.setFeatureState({source: 'drawing', id: this.#hover}, {hover: false});
      if (hover) this.#map!.setFeatureState({source: 'drawing', id: hover}, {hover: true});
      this.#hover = hover;
      this.#cursor();
    }
  }

  #up(e: MapMouseEvent | MapTouchEvent) {
    if (!this.#dragging) return;
    if (e.lngLat) this.#drag(this.#dragging, e.lngLat.toArray());
    this.#dragging = null;
    this.#placing = null;
    this.#suppressClick = true;
    this.#cursor();
  }

  #stop() {
    if (!this.#dragging) return;
    this.#dragging = null;
    this.#placing = null;
    this.#cursor();
  }

  #cursor() {
    if (!this.#map) return;
    this.#map.getCanvas().style.cursor =
      this.#dragging ? 'grabbing' : this.#placing ? 'crosshair' : this.#hover ? 'grab' : '';
  }

  /** @internal Redraw every draft. */
  render() {
    const source = this.#map?.getSource<GeoJSONSource>('drawing');
    if (!source) return;
    source.setData({type: 'FeatureCollection', features: [...this.#drafts].flatMap(draft => draftFeatures(draft, this.#handleAt(draft)))});
  }
}

/** One open form's sighting, as the map draws it. */
export class SightingDraft {
  observer: LonLat | null = null;
  subject: LonLat | null = null;
  /** How far the animal may have been from the subject, in metres; null when not stated. */
  accuracy: number | null = null;
  /**
   * True while `accuracy` is ours, not the author's: a new sighting suggests one from
   * the distance between its points, and follows them, until the author sets or clears it.
   */
  suggested = false;
  /** What the subject's dot is drawn from: its taxon, direction and identifiers. */
  subjectOccurrence: SubjectOccurrence = {};

  private readonly drafts: SightingDrafts;
  readonly id: string;
  private readonly onChange: (points: DraftPoints) => void;

  constructor(drafts: SightingDrafts, id: string, onChange: (points: DraftPoints) => void) {
    this.drafts = drafts;
    this.id = id;
    this.onChange = onChange;
  }

  /** Move a point, or take it off the map with `null`. The form hears about it either way. */
  set(which: DraftPoint, lonLat: LonLat | null) {
    this[which] = lonLat;
    if (this.suggested) this.accuracy = suggestedAccuracy(this.observer, this.subject);
    this.#changed();
  }

  /**
   * Ring the subject with `metres`, or take the ring away with `null`; either way the
   * radius is now the author's. Setting the radius it already has changes nothing, so
   * the form writing a suggestion into its field doesn't adopt it. The form hears about
   * any change.
   */
  setAccuracy(metres: number | null) {
    if (metres === this.accuracy) return;
    this.accuracy = metres;
    this.suggested = false;
    this.#changed();
  }

  /** The author has taken the field over without a usable radius yet: stop suggesting, and keep the ring as it is. */
  keepAccuracy() {
    if (!this.suggested) return;
    this.suggested = false;
    this.#changed();
  }

  #changed() {
    this.drafts.render();
    this.onChange({observer: this.observer, subject: this.subject, accuracy: this.accuracy, suggested: this.suggested});
  }

  setSubjectOccurrence(occurrence: SubjectOccurrence) {
    this.subjectOccurrence = occurrence;
    this.drafts.render();
  }

  /** The "Locate on map" button: the next click or tap places this point. Pressed again, it cancels. */
  place(which: DraftPoint) {
    this.drafts.place(this, which);
  }

  remove() {
    this.drafts.remove(this);
  }
}

const featureId = (draft: SightingDraft, which: Grip) => `${draft.id}/${which}`;

function draftFeatures(draft: SightingDraft, handle: LonLat | null): Feature[] {
  const {observer, subject, accuracy, suggested} = draft;
  const features: Feature[] = [];
  if (observer)
    features.push({type: 'Feature', geometry: {type: 'Point', coordinates: observer},
      properties: {id: featureId(draft, 'observer'), kind: 'Sighter'}});
  if (subject) {
    const {direction, identifiers, taxon} = draft.subjectOccurrence;
    const occurrence = {
      id: featureId(draft, 'subject'),
      direction: direction || null,
      identifiers: identifiers ?? null,
      taxon: taxon ?? {scientific_name: null},
    } as Occurrence;
    const properties = occurrenceProperties(occurrence);
    if (accuracy) {
      const ring = circle(subject, accuracy / 1000, {steps: 64, units: 'kilometers'}) as Feature<Polygon>;
      features.push({...ring, properties: {id: `${draft.id}/ring`, kind: 'DraftRing', ...ringColours(properties.color)}});
    }
    features.push({type: 'Feature', geometry: {type: 'Point', coordinates: subject},
      properties: {...properties, kind: 'Sighting'}});
    if (handle)
      features.push({type: 'Feature', geometry: {type: 'Point', coordinates: handle},
        properties: {id: featureId(draft, 'radius'), kind: 'RadiusHandle', set: !!accuracy, label: accuracy ? `${suggested ? 'suggested ' : ''}${radiusLabel(accuracy)}` : ''}});
  }
  if (observer && subject) {
    const bearing = (getBearing(observer, subject) + 360) % 360;
    const distance = getDistance(observer, subject);
    features.push({type: 'Feature', geometry: {type: 'LineString', coordinates: [observer, subject]},
      properties: {id: `${draft.id}/bearing`, kind: 'Bearing'}});
    // The label is a point of its own at the middle, not placed along the line:
    // MapLibre won't place a label along a line shorter than the label.
    features.push({type: 'Feature',
      geometry: {type: 'Point', coordinates: [(observer[0] + subject[0]) / 2, (observer[1] + subject[1]) / 2]},
      properties: {id: `${draft.id}/bearing-label`, kind: 'BearingLabel', label: `${distance.toFixed(3)} km at ${bearing.toFixed(0)}°`}});
  }
  return features;
}

export const sightingDraftsContext = createContext<SightingDrafts | undefined>('sighting-drafts');
