import { headingAtDistance, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CLane, CMovement, CompiledCity } from '../network';
import type { Route } from '../routing';

export function patchChanges(before: CompiledCity, after: CompiledCity) {
  const map = (items: { id: string }[], index: Map<string, number>) =>
    items.map(({ id }) => index.get(id) ?? -1);
  const lanes = map(before.lanes, after.index.lane);
  const movements = map(before.movements, after.index.movement);
  const roads = map(before.roads, after.index.road);
  const connectors = map(before.connectors, after.index.connector);
  const sameMovements = (old: number[], next: number[]) =>
    old.length === next.length && old.every((idx, i) => movements[idx] === next[i]);
  const changedNodes = new Set<number>();
  for (const node of after.nodes) {
    const old = before.index.node.get(node.id);
    const previous = old === undefined ? undefined : before.nodes[old]!;
    if (
      !previous ||
      previous.control !== node.control ||
      !sameMovements(previous.movements, node.movements) ||
      previous.movements.some((idx) => {
        const a = before.movements[idx]!;
        const b = after.movements[movements[idx]!]!;
        return (
          a.priority !== b.priority ||
          a.neverGreen !== b.neverGreen ||
          a.turnOnRed !== b.turnOnRed ||
          !sameMovements(a.conflicts, b.conflicts)
        );
      })
    )
      changedNodes.add(node.idx);
  }
  const changedRoads = new Set<number>();
  for (const road of before.roads) {
    const next = roads[road.idx]!;
    const replacement = after.roads[next];
    if (
      !replacement ||
      changedNodes.has(replacement.from) ||
      changedNodes.has(replacement.to) ||
      road.speedLimitMps !== replacement.speedLimitMps ||
      road.lanes.length !== replacement.lanes.length ||
      road.lanes.some((idx, i) => {
        const a = before.lanes[idx]!;
        const b = after.lanes[replacement.lanes[i]!]!;
        return (
          lanes[idx] !== b.idx ||
          a.widthM !== b.widthM ||
          a.allowed.join() !== b.allowed.join() ||
          a.polyline.length !== b.polyline.length ||
          a.polyline.some(
            (point, j) => point.x !== b.polyline[j]!.x || point.y !== b.polyline[j]!.y,
          )
        );
      })
    )
      changedRoads.add(road.idx);
  }
  return { lanes, movements, roads, connectors, changedNodes, changedRoads };
}

export type PatchChanges = ReturnType<typeof patchChanges>;

export function remapRoute(route: Route, changes: PatchChanges): Route {
  return {
    ...route,
    roads: route.roads.map((i) => changes.roads[i] ?? -1),
    movements: route.movements.map((i) => changes.movements[i] ?? -1),
    targetLanes: route.targetLanes.map((lanes) =>
      lanes.map((i) => changes.lanes[i] ?? -1).filter((i) => i !== -1),
    ),
  };
}

// The index stores polyline segment ordinals, not lane indices.
export function createProjector(city: CompiledCity) {
  const segmentLanes = city.lanes.flatMap((lane) => lane.polyline.slice(1).map(() => lane.idx));
  return (source: CLane | CMovement, positionM: number) => {
    const point = pointAtDistance(source.polyline, source.cumulative, positionM);
    const heading = headingAtDistance(source.polyline, source.cumulative, positionM);
    let best: { field: number; positionM: number; distance: number } | null = null;
    function consider(segment: CLane | CMovement, field: number) {
      for (let i = 1; i < segment.polyline.length; i++) {
        const a = segment.polyline[i - 1]!;
        const b = segment.polyline[i]!;
        const angle = Math.atan2(b.y - a.y, b.x - a.x) - heading;
        if (Math.cos(angle) < Math.cos(Math.PI / 6) - 1e-9) continue;
        const projection = project(point, a, b);
        if (projection.distance > 4 || (best && projection.distance >= best.distance - 1e-9))
          continue;
        best = {
          field,
          distance: projection.distance,
          positionM:
            segment.cumulative[i - 1]! +
            projection.fraction * (segment.cumulative[i]! - segment.cumulative[i - 1]!),
        };
      }
    }
    const lanes = [
      ...new Set(
        city.laneSpatial
          .search(point.x - 4, point.y - 4, point.x + 4, point.y + 4)
          .map((i) => segmentLanes[i])
          .filter((i): i is number => i !== undefined),
      ),
    ].sort((a, b) => a - b);
    for (const idx of lanes)
      if (city.lanes[idx]!.allowed.includes('car')) consider(city.lanes[idx]!, idx);
    for (const movement of city.movements) {
      if (city.lanes[movement.toLane]!.allowed.includes('car'))
        consider(movement, -movement.idx - 1);
    }
    return best as { field: number; positionM: number; distance: number } | null;
  };
}

function project(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // A zero-length segment (a through node's movement after TASK-061) has no direction.
  if (dx === 0 && dy === 0) return { fraction: 0, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  const fraction = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return { fraction, distance: Math.hypot(p.x - a.x - fraction * dx, p.y - a.y - fraction * dy) };
}
