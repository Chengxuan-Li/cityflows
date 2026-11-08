import type { CompiledCity } from '../network';
import type { Vec2 } from '../geo/vec2';
import type { CityGeometry } from './types';

/** Only mapped strips receive painted slot separators; inferred stock stays unmarked. */
export function stripTicks(
  city: CompiledCity,
  source?: CityGeometry,
): { road: number; points: Vec2[] }[] {
  return (city.strips ?? []).flatMap((strip) => {
    const facility =
      source?.parking?.[strip.id] ?? city.parking.find((p) => p.id === strip.id)?.source;
    if (facility?.provenance.inferred?.includes('strip')) return [];
    return strip.slots.map((index) => {
      const space = city.parkingSpaces![index]!;
      const c = Math.cos(space.heading),
        s = Math.sin(space.heading);
      const dx = (c * space.lengthM) / 2,
        dy = (s * space.lengthM) / 2;
      const wx = (-s * space.widthM) / 2,
        wy = (c * space.widthM) / 2;
      return {
        road: strip.road,
        points: [
          { x: space.position.x + dx + wx, y: space.position.y + dy + wy },
          strip.layout === 'parallel'
            ? { x: space.position.x + dx - wx, y: space.position.y + dy - wy }
            : { x: space.position.x - dx + wx, y: space.position.y - dy + wy },
        ],
      };
    });
  });
}
