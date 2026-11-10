import Flatbush from 'flatbush';
import { earcut } from 'pixi.js';
import {
  areaD,
  booleanOpD,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
} from 'clipper2-ts';
import { distance, nearestOnPolyline, offsetPolyline, pointInPolygon } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { cityGrades } from './grades';
import type { CityGeometry, Pick } from './types';

export interface RailShape {
  layer: number;
  color: number;
  alpha: number;
  polygons: Vec2[][];
  pick?: Pick;
}
const circle = (p: Vec2, r: number) =>
  Array.from({ length: 16 }, (_, i) => ({
    x: p.x + Math.cos((i * Math.PI) / 8) * r,
    y: p.y + Math.sin((i * Math.PI) / 8) * r,
  }));
const positive = (ring: Vec2[]) => (areaD(ring) < 0 ? [...ring].reverse() : ring);
const box = (points: Vec2[]) =>
  [
    Math.min(...points.map((p) => p.x)),
    Math.min(...points.map((p) => p.y)),
    Math.max(...points.map((p) => p.x)),
    Math.max(...points.map((p) => p.y)),
  ] as const;

/** Both views consume the same triangles, clipped clear of same-grade roads except trams. */
export function railGeometry(city: CompiledCity, source?: CityGeometry): RailShape[] {
  if (!city.rail) return [];
  const { roadGrades, nodeGrades } = cityGrades(city, source);
  const obstacles = [
    ...city.roads.map((r) => ({ ring: positive(r.surface), layer: roadGrades[r.idx]! })),
    ...city.nodes
      .filter((n) => n.outline.length)
      .map((n) => ({ ring: positive(n.outline), layer: nodeGrades[n.idx]! })),
  ];
  const spatial = new Flatbush(Math.max(1, obstacles.length));
  for (const o of obstacles) spatial.add(...box(o.ring));
  if (!obstacles.length) spatial.add(0, 0, 0, 0);
  spatial.finish();
  const shapes: RailShape[] = [];
  const add = (
    paths: Vec2[][],
    layer: number,
    color: number,
    alpha: number,
    tram = false,
    pick?: Pick,
  ) => {
    let rings = paths.map(positive);
    const clips =
      tram || !obstacles.length
        ? []
        : spatial
            .search(...box(rings.flat()))
            .flatMap((i) => (obstacles[i]!.layer === layer ? [obstacles[i]!.ring] : []));
    if (clips.length) rings = booleanOpD(ClipType.Difference, rings, clips, FillRule.NonZero, 3);
    const polygons = rings
      .filter((r) => areaD(r) > 0.0001)
      .flatMap((outer) => {
        const holes = rings.filter(
          (r) => areaD(r) < -0.0001 && pointInPolygon(r[0]!, [...outer, outer[0]!]),
        );
        const points = [...outer, ...holes.flat()];
        let end = outer.length;
        const indices = earcut(
          points.flatMap((p) => [p.x, p.y]),
          holes.map((h) => {
            const at = end;
            end += h.length;
            return at;
          }),
          2,
        );
        return Array.from({ length: indices.length / 3 }, (_, i) => [
          points[indices[i * 3]!]!,
          points[indices[i * 3 + 1]!]!,
          points[indices[i * 3 + 2]!]!,
        ]);
      });
    if (polygons.length) shapes.push({ layer, color, alpha, polygons, pick });
  };
  const stroke = (
    line: Vec2[],
    width: number,
    layer: number,
    color: number,
    alpha: number,
    tram: boolean,
    pick?: Pick,
  ) =>
    add(
      inflatePathsD([line], width / 2, JoinType.Round, EndType.Butt, 2, 3),
      layer,
      color,
      alpha,
      tram,
      pick,
    );
  const stationWays = new Set(
    city.rail.platforms
      .filter((p) => p.station !== null && p.mode === 'rail')
      .flatMap((p) => p.tracks)
      .map((id) => city.rail!.tracks.find((t) => t.id === id)!)
      .filter(Boolean)
      .map((t) => t.osmId ?? t.id),
  );
  for (const t of city.rail.tracks) {
    const tram = t.kind === 'tram',
      alpha = t.tunnel ? 0.4 : 1;
    const color = t.service
      ? 0xb6aa98
      : t.kind === 'subway' ||
          t.kind === 'light_rail' ||
          t.usage === 'suburban' ||
          stationWays.has(t.osmId ?? t.id)
        ? 0x8aa6a6
        : 0xb5ae9e;
    const pick: Pick = { kind: 'track', track: t.idx };
    if (!tram) stroke(t.line, t.service ? 2.1 : 2.7, t.layer, color, alpha, false, pick);
    for (const side of [-0.72, 0.72])
      stroke(
        offsetPolyline(t.line, side),
        0.18,
        t.layer,
        tram ? 0x798c91 : 0x777b78,
        alpha,
        tram,
        pick,
      );
  }
  for (const n of city.rail.nodes.filter((n) => n.kind === 'switch'))
    add([circle(n.pos, 1.3)], n.layer, 0x77857d, 1);
  for (const [platform, p] of city.rail.platforms.entries()) {
    const paths =
      p.shape.kind === 'polygon'
        ? [p.shape.ring]
        : p.shape.kind === 'line'
          ? inflatePathsD([p.shape.line], 1, JoinType.Round, EndType.Butt, 2, 3)
          : [circle(p.shape.pos, 1.8)];
    add(paths, p.layer, p.mode === 'rail' ? 0xc1d4ce : 0xd4d7cd, 1, p.mode === 'tram', {
      kind: 'platform',
      platform,
    });
  }
  for (const p of city.places.filter((p) => source?.places[p.id]?.station)) {
    add([circle(p.centroid, 5)], 0, 0x587f77, 1, false, { kind: 'place', place: p.idx });
    add([circle(p.centroid, 2.4)], 0, 0xf8f6ef, 1, false, { kind: 'place', place: p.idx });
  }
  return shapes;
}

export function pickRail(
  city: CompiledCity,
  point: Vec2,
  zoom: number,
  roadGrade = -Infinity,
): Pick | null {
  if (!city.rail) return null;
  for (const p of roadGrade === -Infinity ? city.places : [])
    if (
      city.rail.platforms.some((s) => s.station === p.id) &&
      distance(p.centroid, point) <= Math.max(5, 7 / zoom)
    )
      return { kind: 'place', place: p.idx };
  for (const [platform, p] of city.rail.platforms.entries()) {
    if (roadGrade !== -Infinity) continue;
    if (
      p.shape.kind === 'polygon'
        ? pointInPolygon(point, p.shape.ring)
        : p.shape.kind === 'line'
          ? nearestOnPolyline(p.shape.line, point).away <= Math.max(1, 3 / zoom)
          : distance(point, p.shape.pos) <= Math.max(1.8, 3 / zoom)
    )
      return { kind: 'platform', platform };
  }
  let best = Math.max(1.5, 4 / zoom),
    hit: Pick | null = null;
  for (const t of city.rail.tracks) {
    if (roadGrade !== -Infinity && (t.kind !== 'tram' || t.layer < roadGrade)) continue;
    const d = nearestOnPolyline(t.line, point).away;
    if (d < best) {
      best = d;
      hit = { kind: 'track', track: t.idx };
    }
  }
  return hit;
}
