import { BufferGeometry, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { drape } from './terrain';
import { heightAt, roadStation, type cityHeights } from './heights';
import { walkGeometry } from '../render/walk-geometry';
import type { CompiledCity } from '../network';
import type { CityGeometry } from '../render/types';
import { distance, nearestOnPolyline } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';

export function buildWalk(
  city: CompiledCity,
  source: CityGeometry,
  heights: ReturnType<typeof cityHeights>,
) {
  const sidewalks: number[] = [],
    footways: number[] = [],
    steps: number[] = [];
  const landSidewalks: number[] = [],
    landFootways: number[] = [],
    landSteps: number[] = [];
  for (const shape of walkGeometry(city, source)) {
    const l = shape.link;
    const roadHeight = l.road === undefined ? undefined : heights.roads[l.road];
    const fromGrade = city.walk.nodes[l.from]!.layer,
      toGrade = city.walk.nodes[l.to]!.layer;
    const ground =
      l.layer === 0 &&
      fromGrade === 0 &&
      toGrade === 0 &&
      (!roadHeight || (roadHeight.fromM === 0 && roadHeight.toM === 0 && roadHeight.deckM === 0));
    const target = shape.sidewalk
      ? ground
        ? landSidewalks
        : sidewalks
      : ground
        ? landFootways
        : footways;
    const hatchTarget = ground ? landSteps : steps;
    const z = (p: { x: number; y: number }) => {
      if (l.road !== undefined) {
        const r = city.roads[l.road]!,
          h = heights.roads[l.road]!,
          s = roadStation(r, p);
        return heightAt(h, s) + (h.crossfall?.(s, p) ?? 0) + 0.14;
      }
      return (
        heights.terrain.groundAt(p.x, p.y) +
        (l.node !== undefined
          ? heights.nodes[l.node]! -
            heights.terrain.groundAt(city.nodes[l.node]!.pos.x, city.nodes[l.node]!.pos.y)
          : heightAt(
              { lengthM: l.lengthM, fromM: fromGrade * 5, toM: toGrade * 5, deckM: l.layer * 5 },
              nearestOnPolyline(l.line, p).along,
            )) +
        0.14
      );
    };
    const curvedHeight = roadHeight
      ? roadHeight.fromM !== roadHeight.deckM || roadHeight.toM !== roadHeight.deckM
      : fromGrade !== l.layer || toGrade !== l.layer;
    const emit = (points: Vec2[]) => {
      const lengths = points.map((p, i) => distance(p, points[(i + 1) % 3]!));
      const edge = lengths.indexOf(Math.max(...lengths));
      if (curvedHeight && lengths[edge]! > 2) {
        const a = points[edge]!,
          b = points[(edge + 1) % 3]!,
          c = points[(edge + 2) % 3]!;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        emit([a, mid, c]);
        emit([mid, b, c]);
      } else for (const p of [...points].reverse()) target.push(p.x, z(p), p.y);
    };
    for (const tri of shape.polygons) emit(tri);
    for (const [a, b] of shape.hatches) {
      const dx = b!.x - a!.x,
        dy = b!.y - a!.y,
        length = Math.hypot(dx, dy),
        x = (-dy / length) * 0.06,
        y = (dx / length) * 0.06;
      for (const p of [
        { x: a!.x + x, y: a!.y + y },
        { x: b!.x + x, y: b!.y + y },
        { x: b!.x - x, y: b!.y - y },
        { x: a!.x + x, y: a!.y + y },
        { x: b!.x - x, y: b!.y - y },
        { x: a!.x - x, y: a!.y - y },
      ])
        hatchTarget.push(p.x, z(p) + 0.01, p.y);
    }
  }
  const buffer = (data: number[]) => {
    const g = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(data, 3));
    g.computeVertexNormals();
    return g;
  };
  const surface = (raised: number[], land: number[], offset: number) => {
    const a = buffer(raised),
      flat = buffer(land);
    const b = source.terrain ? drape(flat, heights.terrain, offset, false, true) : flat;
    const result = mergeGeometries([a, b])!;
    a.dispose();
    b.dispose();
    if (b !== flat) flat.dispose();
    return result;
  };
  return {
    sidewalks: surface(sidewalks, landSidewalks, 0.14),
    footways: surface(footways, landFootways, 0.14),
    steps: surface(steps, landSteps, 0.15),
  };
}
