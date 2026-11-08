import { BufferGeometry, Float32BufferAttribute } from 'three';
import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import type { CityGeometry } from '../render/types';
import { drape, triangulate, type Terrain } from './terrain';

export function lotGeometry(city: CompiledCity, source: CityGeometry, terrain: Terrain) {
  const surface: number[] = [],
    paint: number[] = [];
  const polygon = (target: number[], rings: Vec2[][], height: number) => {
    for (const triangle of triangulate(rings))
      for (const p of triangle.reverse()) target.push(p.x, height, p.y);
  };
  for (const lot of Object.values(source.parking ?? {})) {
    if (lot.kind !== 'lot' || lot.shape?.kind !== 'polygon') continue;
    const outer = areaD(lot.shape.ring) > 0 ? lot.shape.ring : [...lot.shape.ring].reverse();
    polygon(
      surface,
      booleanOpD(ClipType.Difference, [outer], lot.exclusions ?? [], FillRule.EvenOdd, 5),
      -0.01,
    );
  }
  for (const lot of city.lots ?? [])
    for (const stall of lot.stalls) {
      const points = stall.corners;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const dx = (-(b.y - a.y) * 0.06) / length,
          dy = ((b.x - a.x) * 0.06) / length;
        const ring = [
          { x: a.x + dx, y: a.y + dy },
          { x: b.x + dx, y: b.y + dy },
          { x: b.x - dx, y: b.y - dy },
          { x: a.x - dx, y: a.y - dy },
        ];
        polygon(paint, [areaD(ring) > 0 ? ring : ring.reverse()], 0.015);
      }
    }
  const buffer = (positions: number[], height: number) => {
    let geometry = new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3),
    );
    if (terrain.grid) geometry = drape(geometry, terrain, height);
    geometry.computeVertexNormals();
    return geometry;
  };
  return { surface: buffer(surface, -0.01), paint: buffer(paint, 0.015) };
}
