import { circularFillet, distance } from '../../geo/polyline';
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

/** TASK-131 (owner, checkpoint 0): smoothing never moves a node or a road within this distance
 * of its end nodes; road lines there stay at their OSM positions. */
export const SMOOTH_CLEAR_M = 30;

/** Rounds the interior vertices of each road (not a roundabout ring) with a circular fillet of
 * its class radius, where the whole arc lies `SMOOTH_CLEAR_M` or more from both end nodes. */
export function smoothRoads(
  city: City,
  roads: OsmRoad[],
  roundaboutWays: ReadonlySet<number>,
): void {
  const ring = new Set(
    roads.filter(({ road }) => road.provenance.osmIds?.some((id) => roundaboutWays.has(id))),
  );
  for (const source of roads) {
    if (ring.has(source)) continue;
    const { road } = source;
    const original = road.centerline;
    const ends = [city.nodes[road.from]!.pos, city.nodes[road.to]!.pos];
    let count = 0;
    const points = [original[0]!];
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
      if (arc && arc.points.every((p) => ends.every((e) => distance(p, e) >= SMOOTH_CLEAR_M))) {
        count++;
        points.push(...(reverse ? arc.points.reverse() : arc.points));
      } else {
        points.push(b);
      }
    }
    points.push(original.at(-1)!);
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
