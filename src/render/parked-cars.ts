import type { Vec2 } from '../geo/vec2';
import { pointInPolygon } from '../geo/polyline';
import type { CompiledCity } from '../network';
import { vehicleClasses } from '../schema/city';
import { style } from './style';
import type { ParkedCarsSnapshot } from './types';

export function occupiedSpaces(snapshot: ParkedCarsSnapshot | null, count: number): number[] {
  const spaces: number[] = [];
  if (snapshot)
    for (let i = 0; i < count; i++) if (snapshot.occupied[i >> 3]! & (1 << (i & 7))) spaces.push(i);
  return spaces;
}

export function parkedColour(snapshot: ParkedCarsSnapshot, space: number, byClass: boolean) {
  const colour = byClass
    ? style.vehicleClasses[vehicleClasses[snapshot.vclass[space]!]!].color
    : snapshot.hues[space] || style.driving;
  return (
    ((((colour >> 16) & 255) * 0.82) << 16) |
    ((((colour >> 8) & 255) * 0.82) << 8) |
    ((colour & 255) * 0.82)
  );
}

export function pickParkedCar(
  city: CompiledCity,
  spaces: readonly number[],
  snapshot: ParkedCarsSnapshot,
  point: Vec2,
  zoom: number,
): number | null {
  let hit: number | null = null;
  let nearest = Infinity;
  let onAsphalt: boolean | undefined;
  for (const index of spaces) {
    const space = city.parkingSpaces![index]!;
    const dx = point.x - space.position.x,
      dy = point.y - space.position.y;
    const c = Math.cos(space.heading),
      s = Math.sin(space.heading);
    const dimensions = style.vehicleClasses[vehicleClasses[snapshot.vclass[index]!]!];
    const along = dx * c + dy * s,
      across = -dx * s + dy * c;
    const distance = dx * dx + dy * dy;
    let inside =
      Math.abs(along) <= dimensions.lengthM / 2 && Math.abs(across) <= dimensions.widthM / 2;
    if (!inside && zoom < style.detailZoom && distance <= (style.vehiclePickRadiusPx / zoom) ** 2) {
      // Overview tolerance helps select a small dot without stealing road-editing clicks.
      onAsphalt ??=
        city.roads.some((road) => pointInPolygon(point, [...road.surface, road.surface[0]!])) ||
        city.nodes.some(
          (node) =>
            node.outline.length > 2 && pointInPolygon(point, [...node.outline, node.outline[0]!]),
        );
      inside = !onAsphalt;
    }
    if (inside && distance < nearest) {
      hit = index;
      nearest = distance;
    }
  }
  return hit;
}
