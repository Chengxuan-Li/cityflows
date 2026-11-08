import { cumulativeLengths, nearestOnPolyline, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CRoad } from '../network';
import { cityGrades } from '../render/grades';
import type { CityGeometry } from '../render/types';
import { createTerrain } from './terrain';

export interface RoadHeight {
  lengthM: number;
  deckM: number;
  fromM: number;
  toM: number;
  fromSlope?: number;
  toSlope?: number;
  ground?: (s: number) => number;
  crossfall?: (s: number, p: Vec2) => number;
}

function hasDeckExtremum(road: RoadHeight) {
  return road.deckM > Math.max(road.fromM, road.toM) || road.deckM < Math.min(road.fromM, road.toM);
}

function profileAt(road: RoadHeight, s: number) {
  let { fromM, toM, lengthM } = road;
  let fromSlope = road.fromSlope ?? 0,
    toSlope = road.toSlope ?? 0;
  if (hasDeckExtremum(road)) {
    lengthM = Math.min(60, lengthM / 2);
    if (s <= lengthM) {
      toM = road.deckM;
      toSlope = 0;
    } else if (s >= road.lengthM - lengthM) {
      fromM = road.deckM;
      fromSlope = 0;
      s -= road.lengthM - lengthM;
    } else {
      fromM = toM = road.deckM;
      fromSlope = toSlope = 0;
    }
  }
  return { fromM, toM, fromSlope, toSlope, lengthM, t: Math.max(0, Math.min(1, s / lengthM)) };
}

/** Full-span cubic Hermite profile. Connected grades determine the tangents;
 * a grade outside the end heights is retained as a level bridge/tunnel extremum. */
function gradeHeightAt(road: RoadHeight, s: number): number {
  const { fromM, toM, fromSlope, toSlope, lengthM, t } = profileAt(road, s);
  return (
    fromM +
    (toM - fromM) * t * t * (3 - 2 * t) +
    lengthM * (fromSlope * t * (1 - t) * (1 - t) - toSlope * t * t * (1 - t))
  );
}

export function heightAt(road: RoadHeight, s: number): number {
  const grade = gradeHeightAt(road, s);
  return road.ground ? road.ground(s) + grade : grade;
}

export function heightSlopeAt(road: RoadHeight, s: number): number {
  if (s < 0 || s > road.lengthM) return 0;
  const { fromM, toM, fromSlope, toSlope, lengthM, t } = profileAt(road, s);
  return (
    (road.ground
      ? (road.ground(Math.min(road.lengthM, s + 0.1)) - road.ground(Math.max(0, s - 0.1))) /
        (Math.min(road.lengthM, s + 0.1) - Math.max(0, s - 0.1))
      : 0) +
    ((toM - fromM) * 6 * t * (1 - t)) / lengthM +
    fromSlope * (1 - t) * (1 - 3 * t) +
    toSlope * t * (3 * t - 2)
  );
}

function endInterval(road: RoadHeight, atEnd: boolean) {
  const lengthM = hasDeckExtremum(road) ? Math.min(60, road.lengthM / 2) : road.lengthM;
  const rise = hasDeckExtremum(road)
    ? atEnd
      ? road.toM - road.deckM
      : road.deckM - road.fromM
    : road.toM - road.fromM;
  return { lengthM, slope: rise / lengthM };
}

export function cityHeights(city: CompiledCity, source: CityGeometry) {
  const { nodeGrades, roadGrades } = cityGrades(city, source);
  const nodes = nodeGrades.map((g) => 5 * g);
  const roads = city.roads.map((road): RoadHeight => ({
    lengthM: road.stations.at(-1)! - road.stations[0]!,
    deckM: 5 * roadGrades[road.idx]!,
    fromM: nodes[road.from]!,
    toM: nodes[road.to]!,
    fromSlope: 0,
    toSlope: 0,
  }));
  const incoming = city.roads.map(() => new Set<number>());
  const outgoing = city.roads.map(() => new Set<number>());
  for (const movement of city.movements) {
    const node = city.nodes[movement.node]!;
    if (node.outline.length || node.control !== 'uncontrolled' || movement.neverGreen) continue;
    const before = city.lanes[movement.fromLane]!.road,
      after = city.lanes[movement.toLane]!.road;
    if (before === after) continue;
    outgoing[before]!.add(after);
    incoming[after]!.add(before);
  }
  for (const before of city.roads) {
    if (outgoing[before.idx]!.size !== 1) continue;
    const next = [...outgoing[before.idx]!][0]!;
    if (incoming[next]!.size !== 1) continue;
    const a = endInterval(roads[before.idx]!, true),
      b = endInterval(roads[next]!, false);
    // PCHIP's weighted harmonic tangent preserves monotonicity: flats and
    // changes of grade direction have zero slope, so the profile cannot overshoot.
    if (!a.slope || !b.slope || Math.sign(a.slope) !== Math.sign(b.slope)) continue;
    const w1 = 2 * b.lengthM + a.lengthM,
      w2 = b.lengthM + 2 * a.lengthM;
    const slope = (w1 + w2) / (w1 / a.slope + w2 / b.slope);
    roads[before.idx]!.toSlope = roads[next]!.fromSlope = slope;
  }
  const terrain = createTerrain(source.terrain, source.context?.features);
  if (source.terrain) {
    for (const road of city.roads) {
      const height = roads[road.idx]!;
      const cumulative = cumulativeLengths(road.reference);
      const at = (s: number) => {
        const p = pointAtDistance(road.reference, cumulative, s + road.stations[0]!);
        return terrain.groundAt(p.x, p.y);
      };
      const fromNode = city.nodes[road.from]!,
        toNode = city.nodes[road.to]!;
      const from = nodeGrades[road.from] ? terrain.groundAt(fromNode.pos.x, fromNode.pos.y) : at(0);
      const to = nodeGrades[road.to]
        ? terrain.groundAt(toNode.pos.x, toNode.pos.y)
        : at(height.lengthM);
      const linear = (s: number) =>
        from + (to - from) * Math.max(0, Math.min(1, s / height.lengthM));
      const amplitude = Math.max(
        Math.abs(height.deckM),
        Math.abs(height.fromM),
        Math.abs(height.toM),
      );
      const blend = (s: number) =>
        amplitude ? Math.min(1, Math.abs(gradeHeightAt(height, s)) / amplitude) : 0;
      height.ground = amplitude ? (s) => at(s) * (1 - blend(s)) + linear(s) * blend(s) : at;
      if (roadGrades[road.idx] === 0)
        height.crossfall = (s, p) => (terrain.surfaceAt(p.x, p.y) - at(s)) * (1 - blend(s));
    }
    for (const node of city.nodes) nodes[node.idx]! += terrain.groundAt(node.pos.x, node.pos.y);
  }
  return { nodes, roads, terrain, nodeGrades };
}

/** Apply the road's transverse terrain slope, or the ground junction's local surface. */
export function terrainVehicleOffset(
  city: CompiledCity,
  heights: ReturnType<typeof cityHeights>,
  segment: number,
  point: Vec2,
) {
  if (!heights.terrain.grid) return 0;
  if (segment >= 0) {
    const road = city.roads[city.lanes[segment]!.road]!;
    return heights.roads[road.idx]!.crossfall?.(roadStation(road, point), point) ?? 0;
  }
  const node = city.nodes[city.movements[-segment - 1]!.node]!;
  return heights.nodeGrades[node.idx] === 0
    ? heights.terrain.surfaceAt(point.x, point.y) - heights.terrain.groundAt(node.pos.x, node.pos.y)
    : 0;
}

/** Station zero is the compiled surface cut, where the flat junction meets the ramp. */
export function roadStation(road: CRoad, point: Vec2): number {
  return nearestOnPolyline(road.reference, point).along - road.stations[0]!;
}
