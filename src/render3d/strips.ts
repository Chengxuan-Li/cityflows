import { BufferGeometry, Float32BufferAttribute } from 'three';
import { areaD } from 'clipper2-ts';
import type { CompiledCity } from '../network';
import type { Vec2 } from '../geo/vec2';
import type { CityGeometry } from '../render/types';
import { stripTicks } from '../render/strip-geometry';
import { heightAt, roadStation, type cityHeights } from './heights';
import { triangulate } from './terrain';

export function stripGeometry(
  city: CompiledCity,
  source: CityGeometry,
  heights: ReturnType<typeof cityHeights>,
) {
  const surface: number[] = [],
    paint: number[] = [];
  const polygon = (target: number[], ring: Vec2[], roadIndex: number, offset: number) => {
    const road = city.roads[roadIndex]!,
      height = heights.roads[roadIndex]!;
    for (const triangle of triangulate([areaD(ring) > 0 ? ring : [...ring].reverse()]))
      for (const p of triangle.reverse()) {
        const s = roadStation(road, p);
        const z = heightAt(height, s) + (height.crossfall?.(s, p) ?? 0);
        target.push(p.x, z + offset, p.y);
      }
  };
  for (const strip of city.strips ?? []) {
    // Preserve the compiler's station samples so a long, straight band follows terrain folds.
    const half = strip.polygon.length / 2;
    for (let i = 1; i < half; i++)
      polygon(
        surface,
        [
          strip.polygon[i - 1]!,
          strip.polygon[i]!,
          strip.polygon[strip.polygon.length - i - 1]!,
          strip.polygon[strip.polygon.length - i]!,
        ],
        strip.road,
        0.005,
      );
  }
  for (const tick of stripTicks(city, source)) {
    const [a, b] = tick.points as [Vec2, Vec2];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dx = (-(b.y - a.y) * 0.06) / length,
      dy = ((b.x - a.x) * 0.06) / length;
    polygon(
      paint,
      [
        { x: a.x + dx, y: a.y + dy },
        { x: b.x + dx, y: b.y + dy },
        { x: b.x - dx, y: b.y - dy },
        { x: a.x - dx, y: a.y - dy },
      ],
      tick.road,
      0.025,
    );
  }
  const buffer = (positions: number[]) => {
    const geometry = new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3),
    );
    geometry.computeVertexNormals();
    return geometry;
  };
  return { surface: buffer(surface), paint: buffer(paint) };
}
