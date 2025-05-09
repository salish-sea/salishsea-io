import type { Point } from "ol/geom.js";
import PointerInteraction from "ol/interaction/Pointer.js";
import type MapBrowserEvent from "ol/MapBrowserEvent.js";


export default class PlacePoint extends PointerInteraction {
  private onComplete: () => void
  private point: Point

  constructor({onComplete, point}: {onComplete: () => void, point: Point}) {
    super();
    this.onComplete = onComplete;
    this.point = point;
  }

  protected handleMoveEvent({coordinate}: MapBrowserEvent): void {
    this.point.setCoordinates(coordinate);
  }

  protected handleDownEvent(_mapBrowserEvent: MapBrowserEvent): boolean {
    return true;
  }

  protected handleUpEvent(_mapBrowserEvent: MapBrowserEvent): boolean {
    this.onComplete();
    return false;
  }
}
