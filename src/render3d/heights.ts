import { nearestOnPolyline } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CRoad } from '../network';
import { cityGrades } from '../render/grades';
import type { CityGeometry } from '../render/types';

export interface RoadHeight {
  lengthM: number;
  deckM: number;
  fromM: number;
  toM: number;
  fromSlope?: number;
  toSlope?: number;
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
export function heightAt(road: RoadHeight, s: number): number {
  const { fromM, toM, fromSlope, toSlope, lengthM, t } = profileAt(road, s);
  return (
    fromM +
    (toM - fromM) * t * t * (3 - 2 * t) +
    lengthM * (fromSlope * t * (1 - t) * (1 - t) - toSlope * t * t * (1 - t))
  );
}

export function heightSlopeAt(road: RoadHeight, s: number): number {
  if (s < 0 || s > road.lengthM) return 0;
  const { fromM, toM, fromSlope, toSlope, lengthM, t } = profileAt(road, s);
  return (
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
  return { nodes, roads };
}

/** Station zero is the compiled surface cut, where the flat junction meets the ramp. */
export function roadStation(road: CRoad, point: Vec2): number {
  return nearestOnPolyline(road.reference, point).along - road.stations[0]!;
}
