import { booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import { nearestOnPolyline } from '../geo/polyline';
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import {
  roadMarkingGeometry,
  transitionMarkings,
  nodeMarkingGeometry,
  movementMarkings,
  markingPolygons,
  type MarkingShape,
  type GoreSurface,
  type PaintedGore,
} from '../render/marking-geometry';
import { markingTheme } from '../render/style';
import type { CityGeometry } from '../render/types';
import { heightAt, roadStation, type cityHeights } from './heights';

export function goreHeight(
  city: CompiledCity,
  heights: ReturnType<typeof cityHeights>,
  surface: GoreSurface,
  p: Vec2,
): number {
  const z = surface.edgeRoads.map((indices) => {
    const road = indices
      .map((i) => city.roads[i]!)
      .reduce((a, b) =>
        nearestOnPolyline(a.reference, p).away < nearestOnPolyline(b.reference, p).away ? a : b,
      );
    return heightAt(heights.roads[road.idx]!, roadStation(road, p));
  });
  const distances = surface.edges.map((edge) => nearestOnPolyline(edge, p).away);
  const total = distances[0]! + distances[1]!;
  return total < 1e-6 ? z[0]! : (z[0]! * distances[1]! + z[1]! * distances[0]!) / total;
}

export interface GoreTriangle {
  points: [Vec2, Vec2, Vec2];
  heights: [number, number, number];
}
const meshes = new WeakMap<ReturnType<typeof cityHeights>, Map<PaintedGore, GoreTriangle[]>>();
export function triangleHeight(triangle: GoreTriangle, p: Vec2): number {
  const [a, b, c] = triangle.points;
  const determinant = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / determinant;
  const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / determinant;
  return u * triangle.heights[0] + v * triangle.heights[1] + (1 - u - v) * triangle.heights[2];
}
/** One tessellated height surface for gore asphalt and its paint, including raised ramps. */
export function goreTriangles(
  city: CompiledCity,
  heights: ReturnType<typeof cityHeights>,
  gore: PaintedGore,
): GoreTriangle[] {
  let cache = meshes.get(heights);
  if (!cache) meshes.set(heights, (cache = new Map()));
  const hit = cache.get(gore);
  if (hit) return hit;
  const result: GoreTriangle[] = [];
  const divide = (points: [Vec2, Vec2, Vec2]) => {
    const lengths = points.map((p, i) =>
      Math.hypot(p.x - points[(i + 1) % 3]!.x, p.y - points[(i + 1) % 3]!.y),
    );
    const edge = lengths.indexOf(Math.max(...lengths));
    if (lengths[edge]! <= 2) {
      result.push({
        points,
        heights: points.map((p) => goreHeight(city, heights, gore.surface, p)) as [
          number,
          number,
          number,
        ],
      });
      return;
    }
    const a = points[edge]!,
      b = points[(edge + 1) % 3]!,
      c = points[(edge + 2) % 3]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    divide([a, mid, c]);
    divide([mid, b, c]);
  };
  const all = [...gore.ring, ...gore.holes.flat()];
  for (const triangle of ShapeUtils.triangulateShape(
    gore.ring.map((p) => new Vector2(p.x, p.y)),
    gore.holes.map((r) => r.map((p) => new Vector2(p.x, p.y))),
  ))
    divide(triangle.map((i) => all[i]!) as [Vec2, Vec2, Vec2]);
  cache.set(gore, result);
  return result;
}

/** All paint uses the same shapes as Pixi; only triangulation and height sampling belong here. */
export function buildMarkings(
  city: CompiledCity,
  source: CityGeometry,
  heights: ReturnType<typeof cityHeights>,
): BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [];
  const emit = (polygon: Vec2[], color: number, height: (p: Vec2) => number) => {
    for (const triangle of ShapeUtils.triangulateShape(
      polygon.map((p) => new Vector2(p.x, p.y)),
      [],
    ))
      for (const index of [triangle[2]!, triangle[1]!, triangle[0]!]) {
        const p = polygon[index]!;
        positions.push(p.x, height(p) + 0.025, p.y);
        colors.push(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
      }
  };
  const counts = { line: 0, polygon: 0 };
  const add = (shapes: MarkingShape[], height: (p: Vec2) => number, flat = false) => {
    for (const shape of shapes) {
      counts[shape.kind]++;
      for (const ring of markingPolygons(shape)) {
        const color = markingTheme.colors[shape.role];
        if (shape.gore) {
          const xs = ring.map((p) => p.x),
            ys = ring.map((p) => p.y);
          const minX = Math.min(...xs),
            maxX = Math.max(...xs),
            minY = Math.min(...ys),
            maxY = Math.max(...ys);
          for (const triangle of goreTriangles(city, heights, shape.gore)) {
            if (
              triangle.points.every((p) => p.x < minX) ||
              triangle.points.every((p) => p.x > maxX) ||
              triangle.points.every((p) => p.y < minY) ||
              triangle.points.every((p) => p.y > maxY)
            )
              continue;
            for (const part of booleanOpD(
              ClipType.Intersection,
              [ring],
              [triangle.points],
              FillRule.NonZero,
              5,
            ))
              emit(part, color, (p) => triangleHeight(triangle, p));
          }
        } else if (shape.kind === 'line' && !flat) {
          const [a, b, c, d] = ring as [Vec2, Vec2, Vec2, Vec2];
          const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
          const at = (u: Vec2, v: Vec2, t: number) => ({
            x: u.x + (v.x - u.x) * t,
            y: u.y + (v.y - u.y) * t,
          });
          for (let i = 0; i < steps; i++)
            emit(
              [
                at(a, b, i / steps),
                at(a, b, (i + 1) / steps),
                at(d, c, (i + 1) / steps),
                at(d, c, i / steps),
              ],
              color,
              height,
            );
        } else emit(ring, color, height);
      }
    }
  };
  for (const road of city.roads) {
    const geometry = roadMarkingGeometry(city, road, source);
    const profile = heights.roads[road.idx]!;
    add(
      [...geometry.below, ...geometry.above, ...transitionMarkings(city, road)],
      (p) => heightAt(profile, roadStation(road, p)),
      profile.fromM === profile.toM && profile.fromM === profile.deckM,
    );
  }
  for (const node of city.nodes) {
    add(nodeMarkingGeometry(city, node), () => heights.nodes[node.idx]!, true);
    if (node.outline.length)
      for (const index of node.movements) {
        const movement = city.movements[index]!;
        // Pixi draws movement paths before the junction fill; retain that occlusion in 3D.
        if (!movement.neverGreen)
          add(movementMarkings(movement), () => heights.nodes[node.idx]! - 0.05, true);
      }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.userData.markingCounts = counts;
  geometry.computeVertexNormals();
  return geometry;
}
