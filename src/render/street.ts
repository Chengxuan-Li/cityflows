import Flatbush from 'flatbush';
import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  nearestOnPolyline,
  parallelOffset,
  pointAtDistance,
  pointInPolygon,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CRoad } from '../network';
import { crossingEnabled, crossingPlacement } from '../network/crossings';
import type { AccessValue } from '../schema';
import { cityGrades } from './grades';
import { busLabels } from './marking-geometry';
import type { CityGeometry } from './types';
import type { Tree } from './vegetation';

export interface StreetLamp {
  road?: number;
  pos: Vec2;
  heightM: number;
  heading: number;
  source: 'osm' | 'generated';
  mount?: string;
}
export type SignRule = Exclude<AccessValue, 'yes'>;
export interface AccessSign {
  road: number;
  pos: Vec2;
  heading: number;
  rules: SignRule[];
}
export interface Curb {
  road: number;
  points: Vec2[];
}
export const signLabels: Record<SignRule, string> = {
  no: 'Verbot der Einfahrt',
  destination: 'Anlieger frei',
  delivery: 'Lieferverkehr frei',
  private: 'Privatweg',
};

/** TASK-106 predates lamp points; keep its input restricted to the features it owns. */
export function treeContext(source: CityGeometry): CityGeometry {
  if (!source.context?.features.some((f) => f.class === 'street_lamp')) return source;
  return {
    ...source,
    context: { features: source.context.features.filter((f) => f.class !== 'street_lamp') },
  };
}

type Obstacle = { rings: Vec2[][]; road?: number; grade?: number };
const closed = (ring: Vec2[]) => [...ring, ring[0]!];
const inside = (p: Vec2, rings: Vec2[][]) =>
  pointInPolygon(p, rings[0]!) && !rings.slice(1).some((r) => pointInPolygon(p, r));

/** Immutable render data only: neither canonical entities nor compiled arrays are written. */
export function placeStreet(city: CompiledCity, source: CityGeometry, trees: readonly Tree[]) {
  const features = source.context?.features ?? [];
  const { roadGrades, nodeGrades } = cityGrades(city, source);
  const lamps: StreetLamp[] = features.flatMap((f) =>
    f.kind === 'point' && f.class === 'street_lamp'
      ? [
          {
            pos: f.pos,
            heightM: f.heightM ?? 7,
            heading: 0,
            source: 'osm' as const,
            ...(f.sub && { mount: f.sub }),
          },
        ]
      : [],
  );
  // OSM lamps have no road ID. Associate nearby carriageway edges for display grade/height.
  for (const lamp of lamps) {
    let best = 2.5;
    for (const road of city.roads) {
      if (roadGrades[road.idx]! < 0) continue;
      const away = nearestOnPolyline(closed(road.surface), lamp.pos).away;
      if (away < best) {
        best = away;
        lamp.road = road.idx;
      }
    }
  }
  const osmLamps = [...lamps];
  const signs: AccessSign[] = [],
    curbs: Curb[] = [];
  const obstacles: Obstacle[] = [];
  for (const road of city.roads)
    if (road.surface.length)
      obstacles.push({
        rings: [closed(road.surface)],
        road: road.idx,
        grade: roadGrades[road.idx]!,
      });
  for (const node of city.nodes)
    if (node.outline.length)
      obstacles.push({ rings: [closed(node.outline)], grade: nodeGrades[node.idx]! });
  for (const f of features)
    if (f.kind === 'area' && ['building', 'water'].includes(f.class))
      obstacles.push({ rings: f.rings });
  const index = new Flatbush(Math.max(1, obstacles.length));
  for (const obstacle of obstacles) {
    const ring = obstacle.rings[0]!;
    index.add(
      Math.min(...ring.map((p) => p.x)),
      Math.min(...ring.map((p) => p.y)),
      Math.max(...ring.map((p) => p.x)),
      Math.max(...ring.map((p) => p.y)),
    );
  }
  if (!obstacles.length) index.add(0, 0, 0, 0);
  index.finish();
  const clear = (p: Vec2, margin: number, ownRoad = -1) =>
    !index.search(p.x - margin, p.y - margin, p.x + margin, p.y + margin).some((i) => {
      const o = obstacles[i];
      if (!o || ('road' in o && o.road === ownRoad)) return false;
      if (ownRoad !== -1 && o.grade !== undefined && o.grade !== roadGrades[ownRoad]) return false;
      return inside(p, o.rings) || o.rings.some((ring) => nearestOnPolyline(ring, p).away < margin);
    });
  const treeIndex = new Flatbush(Math.max(1, trees.length));
  for (const tree of trees) treeIndex.add(tree.pos.x, tree.pos.y, tree.pos.x, tree.pos.y);
  if (!trees.length) treeIndex.add(0, 0, 0, 0);
  treeIndex.finish();
  const lampIndex = new Flatbush(Math.max(1, osmLamps.length));
  for (const lamp of osmLamps) lampIndex.add(lamp.pos.x, lamp.pos.y, lamp.pos.x, lamp.pos.y);
  if (!osmLamps.length) lampIndex.add(0, 0, 0, 0);
  lampIndex.finish();
  const incoming = city.nodes.map(() => [] as CRoad[]);
  for (const road of city.roads) incoming[road.to]!.push(road);

  const signCounts = { no: 0, destination: 0, delivery: 0, private: 0 };
  let labels = 0;
  for (const road of city.roads) {
    labels += busLabels(city, road, source).length;
    const rules: SignRule[] = [];
    for (const [kind, value] of road.access.entries()) {
      if (value === 'yes') continue;
      // Ignore an opposing carriageway: driving back out of a zone is not an entry.
      const previous = incoming[road.from]!.filter((r) => r.from !== road.to);
      if (
        (!incoming[road.from]!.length ||
          previous.some(
            (r) =>
              r.access[kind] === 'yes' ||
              (r.access[kind] !== value &&
                (road.zone[kind] === -1 || r.zone[kind] !== road.zone[kind])),
          )) &&
        !rules.includes(value)
      )
        rules.push(value);
    }
    const half = road.surface.length / 2;
    const edges = [road.surface.slice(0, half), road.surface.slice(half).reverse()];
    const curbSide = city.drivingSide === 'right' ? 1 : 0;
    if (rules.length) {
      const edge = edges[curbSide]!,
        lengths = cumulativeLengths(edge);
      const station = Math.min(4, lengths.at(-1)! / 2);
      const h = headingAtDistance(edge, lengths, station),
        p = pointAtDistance(edge, lengths, station);
      const side = curbSide === 1 ? 1 : -1;
      signs.push({
        road: road.idx,
        rules,
        heading: h,
        pos: { x: p.x - Math.sin(h) * side * 0.9, y: p.y + Math.cos(h) * side * 0.9 },
      });
      for (const rule of rules) signCounts[rule]++;
    }
    const ground = !roadGrades[road.idx] && !nodeGrades[road.from] && !nodeGrades[road.to];
    const crossings = [false, true].flatMap((end) =>
      crossingEnabled(city, road, end, source) ? crossingPlacement(city, road, end).stripes : [],
    );
    const connectors = city.connectors
      .filter((c) => {
        const other = city.roads[city.lanes[c.lane]!.road]!;
        return (
          other.idx === road.idx ||
          (road.streetGroupId !== null && other.streetGroupId === road.streetGroupId)
        );
      })
      .map((c) => {
        const lane = city.lanes[c.lane]!;
        return pointAtDistance(lane.polyline, lane.cumulative, c.positionM);
      });
    const width = road.lanes.reduce((n, i) => n + city.lanes[i]!.widthM, 0);
    for (const [side, original] of edges.entries()) {
      if (original.length < 2 || (road.streetGroupId && side !== curbSide)) continue;
      const sign = side === 0 ? -1 : 1;
      // On divided roads the inward edge belongs to a median, not a verge.
      const centre = city.lanes[road.lanes[0]!]!.polyline;
      const midpoint = original[Math.floor(original.length / 2)]!;
      const near = nearestOnPolyline(centre, midpoint);
      const outward = { x: -near.direction.y * sign, y: near.direction.x * sign };
      if (
        road.corridorId &&
        city.roads.some((other) => {
          if (other === road || other.corridorId !== road.corridorId) return false;
          const q = nearestOnPolyline(city.lanes[other.lanes[0]!]!.polyline, near.point).point;
          return (q.x - near.point.x) * outward.x + (q.y - near.point.y) * outward.y > 0.1;
        })
      )
        continue;
      const edge = parallelOffset(original, sign * 0.1),
        lengths = cumulativeLengths(edge),
        length = lengths.at(-1)!;
      const gaps = [
        ...crossings.map((stripe) => {
          const stations = stripe.map((p) => nearestOnPolyline(edge, p).along);
          return [Math.min(...stations) - 0.5, Math.max(...stations) + 0.5];
        }),
        ...connectors.map((p) => {
          const at = nearestOnPolyline(edge, p).along;
          return [at - 3, at + 3];
        }),
      ];
      const inGap = (s: number, margin = 0) =>
        gaps.some(([a, b]) => s >= a! - margin && s <= b! + margin);
      let run: Vec2[] = [];
      const flush = () => {
        if (run.length > 1) curbs.push({ road: road.idx, points: run });
        run = [];
      };
      // Sampling at <=1m keeps curb bases on terrain and cuts every access/crossing gap.
      const stations = [
        ...new Set([
          0,
          length,
          ...Array.from({ length: Math.max(0, Math.floor(length)) }, (_, i) => i + 0.5),
          ...Array.from(lengths).slice(1, -1),
        ]),
      ]
        .filter((s) => s >= 0 && s <= length)
        .sort((a, b) => a - b);
      if (ground)
        for (const s of stations) {
          const p = pointAtDistance(edge, lengths, s);
          if (inGap(s) || !clear(p, 0.05, road.idx)) flush();
          else run.push(p);
        }
      flush();
      if (roadGrades[road.idx]! < 0 || nodeGrades[road.from]! < 0 || nodeGrades[road.to]! < 0)
        continue;
      if (!['residential', 'service', 'tertiary', 'secondary', 'primary'].includes(road.roadClass))
        continue;
      if (side !== curbSide && width < 10) continue;
      const spacing = ['residential', 'service'].includes(road.roadClass) ? 30 : 40;
      const verge = parallelOffset(original, sign * 0.5),
        vergeLengths = cumulativeLengths(verge);
      const paired =
        road.streetGroupId === null
          ? undefined
          : city.roads.find(
              (other) => other.idx !== road.idx && other.streetGroupId === road.streetGroupId,
            );
      const physicalWidth =
        width + (paired?.lanes.reduce((sum, i) => sum + city.lanes[i]!.widthM, 0) ?? 0);
      const lampStations: number[] = [];
      if (physicalWidth >= 10) {
        const anchor = paired && paired.idx < road.idx ? paired : road;
        const lengths = cumulativeLengths(anchor.reference);
        const opposite = paired ? anchor !== road : side !== curbSide;
        for (let s = 15 + (opposite ? spacing / 2 : 0); s < lengths.at(-1)! - 12; s += spacing) {
          const at = nearestOnPolyline(verge, pointAtDistance(anchor.reference, lengths, s)).along;
          if (at > 0 && at < vergeLengths.at(-1)!) lampStations.push(at);
        }
      } else for (let s = 15; s < vergeLengths.at(-1)! - 12; s += spacing) lampStations.push(s);
      for (const s of lampStations) {
        const p = pointAtDistance(verge, vergeLengths, s);
        if (
          !clear(p, 0.15) ||
          city.nodes.some((n) => distance(n.pos, p) < 12) ||
          inGap(nearestOnPolyline(edge, p).along, 3) ||
          connectors.some((q) => distance(p, q) < width + 4)
        )
          continue;
        if (
          treeIndex
            .search(p.x - 8, p.y - 8, p.x + 8, p.y + 8)
            .some((i) => trees[i] && distance(p, trees[i]!.pos) < 8)
        )
          continue;
        if (
          lampIndex
            .search(p.x - 25, p.y - 25, p.x + 25, p.y + 25)
            .some((i) => osmLamps[i] && distance(p, osmLamps[i]!.pos) < 25)
        )
          continue;
        const h = headingAtDistance(verge, vergeLengths, s);
        lamps.push({
          pos: p,
          heightM: width >= 10 ? 9 : 7,
          heading: h + (side === 0 ? Math.PI / 2 : -Math.PI / 2),
          source: 'generated',
          road: road.idx,
        });
      }
    }
  }
  return {
    lamps,
    signs,
    curbs,
    counts: {
      lamps: { osm: osmLamps.length, generated: lamps.length - osmLamps.length },
      signs: signCounts,
      busLabels: labels,
      signEntries: signs.length,
      curbs: curbs.length,
    },
  };
}
