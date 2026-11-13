import { nearestOnPolyline } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CLane, CompiledCity, CRoad } from './types';

/** TASK-175: road surface heights from compiled grades, the terrain-free part of TASK-132's 3D
 * height model (architecture section 5). A grade is 5 m; a road's ends sit at its nodes' grades
 * and its deck at its own, joined by cubic ramps. */
export const gradeHeightM = 5;
/** Two surfaces this far apart or more are at different levels: a 3.5 m truck under a 0.8 m
 * deck, with margin, and less than one grade. */
export const levelClearanceM = 4.5;

export interface RoadProfile {
  lengthM: number;
  deckM: number;
  fromM: number;
  toM: number;
  fromSlope?: number;
  toSlope?: number;
}

function hasDeckExtremum(road: RoadProfile) {
  return road.deckM > Math.max(road.fromM, road.toM) || road.deckM < Math.min(road.fromM, road.toM);
}

export function profileAt(road: RoadProfile, s: number) {
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
export function profileHeightAt(road: RoadProfile, s: number): number {
  const { fromM, toM, fromSlope, toSlope, lengthM, t } = profileAt(road, s);
  return (
    fromM +
    (toM - fromM) * t * t * (3 - 2 * t) +
    lengthM * (fromSlope * t * (1 - t) * (1 - t) - toSlope * t * t * (1 - t))
  );
}

function endInterval(road: RoadProfile, atEnd: boolean) {
  const lengthM = hasDeckExtremum(road) ? Math.min(60, road.lengthM / 2) : road.lengthM;
  const rise = hasDeckExtremum(road)
    ? atEnd
      ? road.toM - road.deckM
      : road.deckM - road.fromM
    : road.toM - road.fromM;
  return { lengthM, slope: rise / lengthM };
}

function buildProfiles(city: CompiledCity) {
  const nodes = city.nodes.map((n) => gradeHeightM * n.grade);
  const roads = city.roads.map((road): RoadProfile => ({
    lengthM: road.stations.at(-1)! - road.stations[0]!,
    deckM: gradeHeightM * road.grade,
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

const cache = new WeakMap<CompiledCity, ReturnType<typeof buildProfiles>>();
/** Node and road surface heights above ground, by compiled index. Shared: copy before changing. */
export function gradeProfiles(city: CompiledCity) {
  let profiles = cache.get(city);
  if (!profiles) cache.set(city, (profiles = buildProfiles(city)));
  return profiles;
}

/** Station zero is the compiled surface cut, where the flat junction meets the ramp. */
export function roadStation(road: CRoad, point: Vec2): number {
  return nearestOnPolyline(road.reference, point).along - road.stations[0]!;
}

/** The height above ground of `lane`'s surface abreast of `point`. */
export function laneHeightAt(city: CompiledCity, lane: Pick<CLane, 'road'>, point: Vec2) {
  const road = city.roads[lane.road]!;
  return profileHeightAt(gradeProfiles(city).roads[road.idx]!, roadStation(road, point));
}
