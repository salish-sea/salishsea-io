/**
 * The map's reference layers: places that are always there, drawn under the
 * sightings as context, each of which a visitor can switch on and off (GH #453,
 * decision 058).
 *
 * ONE spelling of the set, imported by the map, the control and the URL code,
 * so adding a layer is adding a row here.
 *
 * A layer's visibility is in the URL as `l=`, the visible layers in this order,
 * separated by spaces, which a URL spells `+` (`l=viewpoints+haulouts`); a comma
 * would be escaped to `%2C`. A typed comma is read too. The parameter is absent
 * while the set is the default, so an ordinary link stays as short as it was,
 * and `l=` with nothing after it means every layer off.
 */

export type ReferenceLayer = 'viewpoints' | 'hydrophones' | 'salmon' | 'haulouts';

export const REFERENCE_LAYERS: readonly {id: ReferenceLayer, label: string, visibleByDefault: boolean}[] = [
  {id: 'viewpoints', label: 'Viewing locations', visibleByDefault: true},
  {id: 'hydrophones', label: 'Hydrophones', visibleByDefault: true},
  {id: 'salmon', label: 'Salmon counting sites', visibleByDefault: true},
  // Off by default: 362 sites along every shoreline would bury the sightings,
  // and the question they answer ("is this a known haul-out?") is occasional.
  {id: 'haulouts', label: 'Haul-out sites', visibleByDefault: false},
];

export const LAYERS_PARAM = 'l';

export const DEFAULT_LAYERS: ReadonlySet<ReferenceLayer> =
  new Set(REFERENCE_LAYERS.filter(l => l.visibleByDefault).map(l => l.id));

const isReferenceLayer = (s: string): s is ReferenceLayer => REFERENCE_LAYERS.some(l => l.id === s);

/**
 * The visible set a URL asks for. An unknown name is dropped rather than
 * failing the rest, so a link survives a layer being renamed or retired.
 */
export function parseLayersParam(value: string | null): Set<ReferenceLayer> {
  if (value === null)
    return new Set(DEFAULT_LAYERS);
  return new Set(value.split(/[\s,]+/).filter(isReferenceLayer));
}

/** The `l=` value for a visible set, or null when it is the default and the parameter should go. */
export function layersParam(visible: ReadonlySet<ReferenceLayer>): string | null {
  const same = visible.size === DEFAULT_LAYERS.size && [...visible].every(l => DEFAULT_LAYERS.has(l));
  if (same)
    return null;
  return REFERENCE_LAYERS.filter(l => visible.has(l.id)).map(l => l.id).join(' ');
}
