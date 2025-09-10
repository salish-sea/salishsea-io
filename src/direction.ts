import type { TravelDirection } from "./database.ts";

function degToRad(degrees: number) {
  return degrees * (Math.PI / 180);
}

// How many radians to rotate a thing that was pointing east (i.e. direction of text writing) to point instead in the given direction
// Used to rotate textual symbols in OpenLayers
export function directionToRads (direction: TravelDirection): number {
  switch (direction) {
    case 'east': return 0;
    case 'southeast': return degToRad(45);
    case 'south': return degToRad(90);
    case 'southwest': return degToRad(135);
    case 'west': return degToRad(180);
    case 'northwest': return degToRad(-135);
    case 'north': return degToRad(-90);
    case 'northeast': return degToRad(-45);
  }
}
