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
import {
  distance,
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  pointInPolygon,
  segmentIntersection,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CWalkLink } from '../network';
import { cityGrades } from './grades';
import type { CityGeometry } from './types';

export interface WalkShape {
  link: CWalkLink;
  layer: number;
  sidewalk: boolean;
  polygons: Vec2[][];
  hatches: Vec2[][];
}
const positive = (ring: Vec2[]) => (areaD(ring) < 0 ? [...ring].reverse() : ring);
/** One paving footprint for both renderers, with building holes and same-grade asphalt removed. */
export function walkGeometry(city: CompiledCity, source?: CityGeometry): WalkShape[] {
  const { roadGrades, nodeGrades } = cityGrades(city);
  const obstacles = [
    ...city.roads.map((r) => ({
      rings: [positive(r.surface)],
      layer: roadGrades[r.idx]!,
      building: false,
    })),
    ...city.nodes
      .filter((n) => n.outline.length)
      .map((n) => ({ rings: [positive(n.outline)], layer: nodeGrades[n.idx]!, building: false })),
    ...(source?.context?.features ?? []).flatMap((f) =>
      f.kind === 'area' && f.class === 'building'
        ? [
            {
              rings: [
                positive(f.rings[0]!),
                ...f.rings.slice(1).map((r) => [...positive(r)].reverse()),
              ],
              layer: 0,
              building: true,
            },
          ]
        : [],
    ),
  ];
  const tree = new Flatbush(Math.max(1, obstacles.length));
  const box = (points: Vec2[]) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return [x0, y0, x1, y1] as const;
  };
  for (const o of obstacles) tree.add(...box(o.rings[0]!));
  if (!obstacles.length) tree.add(0, 0, 0, 0);
  tree.finish();
  const shapes: WalkShape[] = [];
  for (const link of city.walk.links) {
    if (link.kind === 'access' || link.kind === 'crossing' || link.kind === 'living_street')
      continue;
    const sidewalk = link.kind === 'sidewalk' || link.kind === 'corner';
    const width = sidewalk ? 2 : Math.min(link.widthM, 3);
    let rings = inflatePathsD([link.line], width / 2, JoinType.Round, EndType.Butt, 2, 3);
    if (!rings.length) continue;
    const clips = tree.search(...box(rings.flat())).flatMap((i) => {
      const o = obstacles[i];
      return o && (o.layer === link.layer || (o.building && link.layer === 0)) ? o.rings : [];
    });
    if (clips.length) rings = booleanOpD(ClipType.Difference, rings, clips, FillRule.NonZero, 3);
    // Millimetre clipping can leave collinear slivers too small to triangulate or display.
    rings = rings.filter((ring) => Math.abs(areaD(ring)) > 0.005);
    if (!rings.length) continue;
    const polygons = rings
      .filter((r) => areaD(r) > 0)
      .flatMap((outer) => {
        const holes = rings.filter(
          (r) => areaD(r) < 0 && pointInPolygon(r[0]!, [...outer, outer[0]!]),
        );
        const points = [...outer, ...holes.flat()],
          starts: number[] = [];
        let offset = outer.length;
        for (const hole of holes) {
          starts.push(offset);
          offset += hole.length;
        }
        const indices = earcut(
          points.flatMap((p) => [p.x, p.y]),
          starts,
          2,
        );
        if (!indices.length) throw new Error(`Cannot triangulate walk link ${link.id}`);
        return Array.from({ length: indices.length / 3 }, (_, i) => [
          points[indices[i * 3]!]!,
          points[indices[i * 3 + 1]!]!,
          points[indices[i * 3 + 2]!]!,
        ]);
      });
    const hatches: Vec2[][] = [];
    if (link.kind === 'steps') {
      const lengths = cumulativeLengths(link.line);
      for (let s = 0.5; s < link.lengthM; s += 0.6) {
        const p = pointAtDistance(link.line, lengths, s),
          a = headingAtDistance(link.line, lengths, s);
        const line = [-width * 0.4, width * 0.4].map((d) => ({
          x: p.x - Math.sin(a) * d,
          y: p.y + Math.cos(a) * d,
        }));
        const a0 = line[0]!,
          b0 = line[1]!,
          cuts = [0, 1];
        for (const ring of rings)
          for (let i = 0; i < ring.length; i++) {
            const hit = segmentIntersection(a0, b0, ring[i]!, ring[(i + 1) % ring.length]!);
            if (hit) cuts.push(distance(a0, hit) / distance(a0, b0));
          }
        cuts.sort((a, b) => a - b);
        const at = (t: number) => ({ x: a0.x + (b0.x - a0.x) * t, y: a0.y + (b0.y - a0.y) * t });
        for (let i = 1; i < cuts.length; i++) {
          const lo = cuts[i - 1]!,
            hi = cuts[i]!;
          if (hi - lo < 1e-6) continue;
          const mid = at((lo + hi) / 2);
          if (rings.filter((r) => pointInPolygon(mid, [...r, r[0]!], 0)).length % 2)
            hatches.push([at(lo), at(hi)]);
        }
      }
    }
    shapes.push({ link, layer: link.layer, sidewalk, polygons, hatches });
  }
  return shapes;
}
