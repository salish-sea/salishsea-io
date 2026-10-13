import { createContext } from '@lit/context';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapTouchEvent, PointLike } from 'maplibre-gl';
import type { Feature } from 'geojson';
import { bearing as getBearing } from '@turf/bearing';
import { distance as getDistance } from '@turf/distance';
import { occurrenceProperties } from './style.ts';
import type { Occurrence } from './types.ts';

export type LonLat = [number, number];

/** As much of an occurrence as the form knows before it is saved. */
export type SubjectOccurrence = {
  direction?: Occurrence['direction'] | '';
  identifiers?: string[];
  taxon?: Pick<Occurrence['taxon'], 'scientific_name'>;
};
export type DraftPoint = 'observer' | 'subject';

/** What a form hears whenever one of its points moves, however it was moved. */
export type DraftPoints = Record<DraftPoint, LonLat | null>;

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
  #dragging: {draft: SightingDraft, which: DraftPoint} | null = null;
  /** The point to place with the next click or tap. */
  #placing: {draft: SightingDraft, which: DraftPoint} | null = null;
  #hover: string | null = null;
  #suppressClick = false;

  /** Start drawing a form's sighting, at the points it already holds. `onChange` hears of every later move. */
  create(id: string, onChange: (points: DraftPoints) => void, initial: Partial<DraftPoints> = {}): SightingDraft {
    const draft = new SightingDraft(this, id, onChange);
    draft.observer = initial.observer ?? null;
    draft.subject = initial.subject ?? null;
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
    window.addEventListener('mouseup', () => this.#stop());
    window.addEventListener('blur', () => this.#stop());
    this.render();
  }

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

  /** @internal Start placing a point, or stop if any placement is under way. */
  place(draft: SightingDraft, which: DraftPoint) {
    this.#placing = this.#placing ? null : {draft, which};
    this.#cursor();
  }

  #nearest(point: PointLike): {draft: SightingDraft, which: DraftPoint} | null {
    const [px, py] = Array.isArray(point) ? point : [point.x, point.y];
    let best: {draft: SightingDraft, which: DraftPoint} | null = null;
    let bestDistance = GRAB_TOLERANCE;
    for (const draft of this.#drafts) {
      for (const which of ['subject', 'observer'] as const) {
        const lonLat = draft[which];
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
    this.#dragging = target;
    target.draft.set(target.which, e.lngLat.toArray());
    this.#cursor();
  }

  #move(e: MapMouseEvent | MapTouchEvent) {
    if (this.#dragging) {
      this.#dragging.draft.set(this.#dragging.which, e.lngLat.toArray());
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
    if (e.lngLat) this.#dragging.draft.set(this.#dragging.which, e.lngLat.toArray());
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
    source.setData({type: 'FeatureCollection', features: [...this.#drafts].flatMap(draftFeatures)});
  }
}

/** One open form's sighting, as the map draws it. */
export class SightingDraft {
  observer: LonLat | null = null;
  subject: LonLat | null = null;
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
    this.drafts.render();
    this.onChange({observer: this.observer, subject: this.subject});
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

const featureId = (draft: SightingDraft, which: DraftPoint) => `${draft.id}/${which}`;

function draftFeatures(draft: SightingDraft): Feature[] {
  const {observer, subject} = draft;
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
    features.push({type: 'Feature', geometry: {type: 'Point', coordinates: subject},
      properties: {...occurrenceProperties(occurrence), kind: 'Sighting'}});
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
