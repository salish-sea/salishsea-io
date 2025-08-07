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

  protected handleDragEvent({coordinate}: MapBrowserEvent): void {
    this.point.setCoordinates(coordinate);
  }

  protected handleMoveEvent({coordinate}: MapBrowserEvent): void {
    this.point.setCoordinates(coordinate);
  }

  protected handleDownEvent({coordinate}: MapBrowserEvent): boolean {
    this.point.setCoordinates(coordinate);
    return true;
  }

  protected handleUpEvent({coordinate}: MapBrowserEvent): boolean {
    this.point.setCoordinates(coordinate);
    this.onComplete();
    return false;
  }
}
