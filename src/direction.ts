export function degToRad(degrees: number) {
  return degrees * (Math.PI / 180);
}

// Sightings give
export const directions = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const;
export type Direction = (typeof directions)[number];

// How many radians to rotate a thing that was pointing east (i.e. direction of text writing) to point instead in the given direction
// Used to rotate textual symbols in OpenLayers
export const directionToRads: (direction: Direction) => number = (direction: Direction) => {
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
