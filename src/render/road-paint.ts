import { cumulativeLengths } from '../geo/polyline';
import type { CLane, CompiledCity, CRoad } from '../network';
import { corridorSurfaces } from '../network/corridor';
import { laneEdges } from '../network/lanes';

/** A road beside a mapped transition (TASK-264): the transition road, and the distance from their
 * node to where it has opened 90% of the width the gain adds (or the drop takes away). */
export interface Transition {
  road: CRoad;
  atM: number;
}

const transitions = new WeakMap<
  CompiledCity,
  Map<number, { start?: Transition; end?: Transition }>
>();

/**
 * TASK-264 (TASK-216 D7): the road at `road`'s start (or end) node that is the taper of its lane
 * gain (or drop): a mapped transition, whose surface widens into `road`'s lane block at their
 * plain node (`widenM`, `continuity.ts`); null elsewhere. The gain's lanes are drawn at full width
 * from the node (`transitionLanes`) and its arrows stand on the widening (`approachMarkings`).
 */
export function transitionAt(city: CompiledCity, road: CRoad, atEnd: boolean): Transition | null {
  let byRoad = transitions.get(city);
  if (!byRoad) {
    byRoad = new Map();
    transitions.set(city, byRoad);
    const widths = (r: CRoad) => r.lanes.reduce((sum, i) => sum + city.lanes[i]!.widthM, 0);
    for (const narrow of city.roads) {
      const half = narrow.surface.length / 2;
      if (half !== narrow.stations.length) continue;
      const own = widths(narrow);
      // The surface is the left edge at the stations, then the right edge back.
      const opened = (i: number) =>
        Math.hypot(
          narrow.surface[i]!.x - narrow.surface[2 * half - 1 - i]!.x,
          narrow.surface[i]!.y - narrow.surface[2 * half - 1 - i]!.y,
        ) - own;
      for (const atStart of [false, true]) {
        const node = atStart ? narrow.from : narrow.to;
        if (city.nodes[node]!.setbacks.some((s) => s > 0)) continue;
        const wide = city.roads.filter((r) =>
          atStart ? r.to === node && r.from !== narrow.to : r.from === node && r.to !== narrow.from,
        );
        if (wide.length !== 1) continue;
        const added = widths(wide[0]!) - own;
        const at = atStart ? 0 : half - 1;
        if (added < 1 || opened(at) < 0.9 * added) continue;
        let i = at;
        const step = atStart ? 1 : -1;
        while (i + step >= 0 && i + step < half && opened(i + step) >= 0.9 * added) i += step;
        const entry = byRoad.get(wide[0]!.idx) ?? {};
        entry[atStart ? 'end' : 'start'] = {
          road: narrow,
          atM: Math.abs(narrow.stations[at]! - narrow.stations[i]!),
        };
        byRoad.set(wide[0]!.idx, entry);
      }
    }
  }
  return byRoad.get(road.idx)?.[atEnd ? 'end' : 'start'] ?? null;
}

const fullViews = new WeakMap<CompiledCity, CompiledCity>();

/**
 * TASK-264: a view for the road markings in which the lanes a gain adds (or a drop takes away)
 * beside a mapped transition run at their full width and place up to the node: the transition
 * road's surface has taken the taper. The compiled lanes keep parting from the lane that feeds
 * them, so cars do not jump across the node; only the paint changes.
 */
export function transitionLanes(city: CompiledCity): CompiledCity {
  const cached = fullViews.get(city);
  if (cached) return cached;
  let lanes: CLane[] | null = null;
  for (const road of city.roads) {
    const start = transitionAt(city, road, false) !== null,
      end = transitionAt(city, road, true) !== null;
    if (!start && !end) continue;
    const roadLanes = road.lanes.map((i) => city.lanes[i]!);
    const tapered = (l: CLane) => (start && l.taperStartM > 0) || (end && l.taperEndM > 0);
    const kept = roadLanes.filter((l) => !tapered(l));
    if (!kept.length || kept.length === roadLanes.length) continue;
    lanes ??= [...city.lanes];
    for (const lane of roadLanes.filter(tapered)) {
      const base = kept.reduce((a, b) =>
        Math.abs(a.lane - lane.lane) <= Math.abs(b.lane - lane.lane) ? a : b,
      );
      const inner = kept.find((l) => Math.abs(l.lane - base.lane) === 1);
      const side = Math.sign(lane.lane - base.lane);
      const lateral =
        side *
        (roadLanes
          .filter((l) => (l.lane - base.lane) * side > 0 && (lane.lane - l.lane) * side > 0)
          .reduce((sum, l) => sum + l.widthM, 0) +
          (base.widthM + lane.widthM) / 2);
      // Across the block: from the next kept lane to the base where there is one (the side-by-side
      // block near the node lies across the node's heading), else the road's normals.
      const polyline = base.polyline.map((p, i) => {
        let n = lane.normals[i]!;
        if (inner) {
          const q = inner.polyline[i]!;
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          n = {
            x: ((p.x - q.x) / d) * Math.sign(base.lane - inner.lane),
            y: ((p.y - q.y) / d) * Math.sign(base.lane - inner.lane),
          };
        }
        return { x: p.x + n.x * lateral, y: p.y + n.y * lateral };
      });
      const cumulative = cumulativeLengths(polyline);
      const lengthM = cumulative.at(-1)!;
      lanes[lane.idx] = {
        ...lane,
        polyline,
        cumulative,
        lengthM,
        stopM: lengthM - (lane.lengthM - lane.stopM),
        taperStartM: start ? 0 : lane.taperStartM,
        taperEndM: end ? 0 : lane.taperEndM,
      };
    }
  }
  const view = lanes ? { ...city, lanes } : city;
  fullViews.set(city, view);
  fullViews.set(view, view);
  return view;
}

export const paintedLaneEdges = (lane: CLane, roadLanes: CLane[]) =>
  laneEdges(lane, roadLanes, true);

const cities = new WeakMap<CompiledCity, CompiledCity>();

/** A cached drawing view: simulation/walk geometry and the input remain untouched. */
export function paintedCity(city: CompiledCity): CompiledCity {
  const cached = cities.get(city);
  if (cached) return cached;
  const additions = city.roads.filter(
    (road) =>
      road.lanes.some(
        (i, j) =>
          city.lanes[i]!.taperStartM && j > 0 && city.lanes[road.lanes[j - 1]!]!.taperStartM,
      ) ||
      transitionAt(city, road, false) !== null ||
      transitionAt(city, road, true) !== null,
  );
  if (!additions.length) {
    cities.set(city, city);
    return city;
  }
  const changed = new Set(additions.map((road) => road.idx));
  const full = transitionLanes(city);
  const corridor = (road: CompiledCity['roads'][number]) => road.corridorId ?? `#${road.idx}`;
  const corridors = new Set(additions.map(corridor));
  const roads = city.roads.map((road) => {
    if (!corridors.has(corridor(road))) return road;
    if (!changed.has(road.idx)) return { ...road };
    const lanes = road.lanes.map((i) => full.lanes[i]!);
    const first = paintedLaneEdges(lanes[0]!, lanes);
    const last = paintedLaneEdges(lanes.at(-1)!, lanes);
    return { ...road, surface: [...first.left, ...last.right.reverse()] };
  });
  corridorSurfaces(roads.filter((road) => corridors.has(corridor(road))));
  const painted = { ...city, roads };
  cities.set(city, painted);
  cities.set(painted, painted);
  return painted;
}
