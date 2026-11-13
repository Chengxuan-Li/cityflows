import { headingAtDistance, nearestOnPolyline, pointAtDistance } from '../geo/polyline';
import type { CompiledCity } from './types';

/**
 * TASK-169: a stretch of a lane that queued traffic keeps clear (architecture section 8, keep
 * clear): no vehicle stops with its body over it unless the space beyond takes its whole body.
 * `crosswalk`: the span of a marked crossing (zebra or signal) over the lane. `mouth`: where
 * cars leaving a lot or garage join the lane or cross it, drawn as a keep-clear marking.
 */
export interface KeepClearZone {
  lane: number;
  fromM: number;
  toM: number;
  kind: 'crosswalk' | 'mouth';
}

/** A mouth zone on the exit lane reaches this far back from the connector: a van's length
 * (5.5 m) and the 2 m gap behind the body of a car joining at its connector, plus 0.5 m. */
export const MOUTH_BEFORE_M = 8;
/** ...and this far past it: a lot exit's merge joins up to 4.4 m past its connector (Munich
 * pk:2047's far-lane exit), and the car ahead keeps a 2 m gap to it. */
export const MOUTH_AFTER_M = 6.5;
/** A lane the merge crosses to reach the exit lane is kept clear this far either side of the
 * station nearest the connector (TASK-157's crossing spans are about 6.5 m long). */
export const MOUTH_CROSSED_M = 7;

const cache = new WeakMap<CompiledCity, KeepClearZone[][]>();

/**
 * The keep-clear zones of each lane, sorted by `fromM`, overlapping zones of a kind merged.
 * Mouths are the exits of lots and garages that have spaces, on public lanes (not lot aisles or
 * a junction group's inner roads): on the exit lane around the connector, and on every lane of
 * the exit's street that lies between the facility and the exit lane, which its cars cross.
 */
export function keepClearZones(city: CompiledCity): KeepClearZone[][] {
  let zones = cache.get(city);
  if (zones) return zones;
  const byLane = city.lanes.map((): KeepClearZone[] => []);
  for (const link of city.walk.links)
    for (const span of link.crossing?.spans ?? []) {
      const lane = city.lanes[span.lane]!;
      byLane[lane.idx]!.push({
        lane: lane.idx,
        fromM: Math.max(0, span.atM - span.halfM),
        toM: Math.min(lane.lengthM, span.atM + span.halfM),
        kind: 'crosswalk',
      });
    }
  const aisles = new Set(city.lots?.flatMap((lot) => lot.aisles) ?? []);
  const departures = new Set(
    city.parkingSpaces?.flatMap((s) => (s.departure === undefined ? [] : [s.departure])) ?? [],
  );
  const mouth = (lane: number, fromM: number, toM: number) => {
    const length = city.lanes[lane]!.lengthM;
    if (fromM < length && toM > 0)
      byLane[lane]!.push({
        lane,
        fromM: Math.max(0, fromM),
        toM: Math.min(length, toM),
        kind: 'mouth',
      });
  };
  for (const facility of city.parking) {
    if ((facility.kind !== 'lot' && facility.kind !== 'garage') || !facility.capacity) continue;
    for (const index of facility.connectorsOut) {
      const connector = city.connectors[index]!;
      const lane = city.lanes[connector.lane]!;
      const road = city.roads[lane.road]!;
      if (departures.has(index) || aisles.has(road.id) || road.group !== undefined) continue;
      mouth(lane.idx, connector.positionM - MOUTH_BEFORE_M, connector.positionM + MOUTH_AFTER_M);
      const at = pointAtDistance(lane.polyline, lane.cumulative, connector.positionM);
      const heading = headingAtDistance(lane.polyline, lane.cumulative, connector.positionM);
      const side = (p: { x: number; y: number }) =>
        Math.sign(Math.cos(heading) * (p.y - at.y) - Math.sin(heading) * (p.x - at.x));
      const facilitySide = side(facility.centroid);
      for (const other of city.roads) {
        if (
          other !== road &&
          (road.streetGroupId === null || other.streetGroupId !== road.streetGroupId)
        )
          continue;
        for (const i of other.lanes) {
          if (i === lane.idx) continue;
          const crossed = city.lanes[i]!;
          const near = nearestOnPolyline(crossed.polyline, at);
          if (near.along <= 0 || near.along >= crossed.lengthM) continue;
          if (side(near.point) !== facilitySide || near.away > 2 * lane.widthM * road.lanes.length)
            continue;
          mouth(i, near.along - MOUTH_CROSSED_M, near.along + MOUTH_CROSSED_M);
        }
      }
    }
  }
  zones = byLane.map((list) => {
    list.sort((a, b) => a.fromM - b.fromM || a.kind.localeCompare(b.kind));
    const merged: KeepClearZone[] = [];
    for (const zone of list) {
      const last = merged.findLast((z) => z.kind === zone.kind);
      if (last && zone.fromM <= last.toM) last.toM = Math.max(last.toM, zone.toM);
      else merged.push({ ...zone });
    }
    return merged.sort((a, b) => a.fromM - b.fromM);
  });
  cache.set(city, zones);
  return zones;
}
