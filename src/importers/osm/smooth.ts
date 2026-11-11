import { circularFillet, distance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { City, Road, RoadClass } from '../../schema';
import type { OsmRoad } from './roads';

const radii: Record<RoadClass, number> = {
  motorway: 400,
  trunk: 250,
  primary: 120,
  secondary: 80,
  tertiary: 50,
  ramp: 60,
  residential: 25,
  service: 12,
};

/** Lanes reach this far from the centerline; a tighter arc folds the inner ones. */
const extent = (road: Road) =>
  Math.abs(road.lateralOffsetM) + road.lanes.reduce((w, lane) => w + lane.widthM, 0) / 2 + 0.5;

interface End {
  source: OsmRoad;
  start: boolean;
  neighbor: Vec2;
}

export function smoothRoads(
  city: City,
  roads: OsmRoad[],
  protectedNodes: ReadonlySet<string>,
  roundaboutWays: ReadonlySet<number>,
): void {
  const ring = new Set(
    roads.filter(({ road }) => road.provenance.osmIds?.some((id) => roundaboutWays.has(id))),
  );
  const incidents = new Map<string, Map<string, End[]>>();
  for (const source of roads) {
    const { road } = source;
    for (const start of [true, false]) {
      const id = start ? road.from : road.to;
      const other = start ? road.to : road.from;
      const key = road.streetGroupId === null ? road.id : `${road.streetGroupId}:${other}`;
      const arms = incidents.get(id) ?? new Map<string, End[]>();
      const ends = arms.get(key) ?? [];
      ends.push({ source, start, neighbor: road.centerline.at(start ? 1 : -2)! });
      arms.set(key, ends);
      incidents.set(id, arms);
    }
  }

  // Build both halves from the same arc and from the original endpoints. An interior
  // fillet may consume the other half of the segment shared with a seam.
  const starts = new Map<OsmRoad, Vec2[]>();
  const ends = new Map<OsmRoad, Vec2[]>();
  for (const [id, arms] of incidents) {
    const node = city.nodes[id]!;
    if (arms.size !== 2 || node.control !== 'uncontrolled' || protectedNodes.has(id)) continue;
    const [a, b] = [...arms.values()] as [End[], End[]];
    const left = a[0]!.source.road;
    const right = b[0]!.source.road;
    const sameWay = left.provenance.osmIds!.some((way) => right.provenance.osmIds!.includes(way));
    if (!sameWay && (!left.name || left.name !== right.name)) continue;
    if (
      !a.some((end) => b.some((other) => other.start !== end.start)) ||
      [a, b].some((arm) =>
        arm.some(
          ({ source, start, neighbor }) =>
            ring.has(source) ||
            source.layer !== node.layer ||
            (start ? source.cutStart : source.cutEnd) ||
            distance(neighbor, arm[0]!.neighbor) !== 0,
        ),
      )
    )
      continue;
    // At a class change, use the more demanding target for the shared arc.
    const radius = Math.max(radii[left.roadClass], radii[right.roadClass]);
    const arc = circularFillet(
      a[0]!.neighbor,
      node.pos,
      b[0]!.neighbor,
      radius,
      Math.max(...[...a, ...b].map(({ source }) => extent(source.road))),
    );
    if (!arc) continue;
    const middle = (arc.points.length - 1) / 2;
    node.pos = arc.points[middle]!;
    for (const [arm, towardNode] of [
      [a, arc.points.slice(0, middle + 1)],
      [b, arc.points.slice(middle).reverse()],
    ] as const) {
      for (const { source, start } of arm) {
        if (start) starts.set(source, [...towardNode].reverse());
        else ends.set(source, towardNode);
      }
    }
  }

  for (const source of roads) {
    if (ring.has(source)) continue;
    const { road } = source;
    const original = road.centerline;
    const start = starts.get(source);
    const end = ends.get(source);
    let count = Number(!!start) + Number(!!end);
    const points = start ?? [original[0]!];
    for (let i = 1; i < original.length - 1; i++) {
      const [a, b, c] = [original[i - 1]!, original[i]!, original[i + 1]!];
      // Sample a mirrored two-way centerline identically in both directions.
      const reverse = a.x > c.x || (a.x === c.x && a.y > c.y);
      const arc = circularFillet(
        reverse ? c : a,
        b,
        reverse ? a : c,
        radii[road.roadClass],
        extent(road),
      );
      if (arc) {
        count++;
        points.push(...(reverse ? arc.points.reverse() : arc.points));
      } else {
        points.push(b);
      }
    }
    points.push(...(end ?? [original.at(-1)!]));
    if (count === 0) continue;
    // Two adjacent fillets can use exactly half the same segment.
    road.centerline = points.filter(
      (point, i) => i === 0 || distance(point, points[i - 1]!) > 1e-9,
    );
    road.provenance = {
      ...road.provenance,
      inferred: [...road.provenance.inferred!, `smoothed:${count}`],
    };
  }
}
