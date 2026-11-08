import {
  cumulativeLengths,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  polylineLength,
  polylineCrossings,
  prepareRing,
} from '../geo/polyline';
import type { City, ParkingLayout, Road } from '../schema';
import type { Vec2 } from '../geo/vec2';
import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import { crossingSpan } from './crossings';
import type { CLane, CompiledCity, CParking, CParkingSpace, CStrip } from './types';

export const stripPitch = (layout: ParkingLayout) =>
  layout === 'parallel' ? 5.5 : layout === 'angled' ? 2.8 : 2.5;
export const stripWidth = (layout: ParkingLayout) =>
  layout === 'parallel' ? 2 : layout === 'angled' ? 4.5 : 5;

function bandPolygon(
  road: Road,
  lane: CLane,
  side: 'left' | 'right',
  fromM: number,
  toM: number,
  width: number,
) {
  const cumulative = cumulativeLengths(road.centerline),
    sign = side === 'left' ? -1 : 1;
  const stations = [fromM];
  for (let s = fromM + 2; s < toM; s += 2) stations.push(s);
  stations.push(toM);
  const edge = (offset: number) =>
    stations.map((station) => {
      const s = nearestOnPolyline(
        lane.polyline,
        pointAtDistance(road.centerline, cumulative, station),
      ).along;
      const p = pointAtDistance(lane.polyline, lane.cumulative, s),
        h = headingAtDistance(lane.polyline, lane.cumulative, s);
      return { x: p.x - Math.sin(h) * offset, y: p.y + Math.cos(h) * offset };
    });
  return [...edge((sign * lane.widthM) / 2), ...edge(sign * (lane.widthM / 2 + width)).reverse()];
}

/** One directed carriageway owns each outside curb of a paired street. */
export function curbLane(
  city: City,
  compiled: CompiledCity,
  roadId: string,
  side: 'left' | 'right',
) {
  const road = city.roads[roadId];
  const r = compiled.roads[compiled.index.road.get(roadId)!];
  if (!road || !r) return undefined;
  if (
    road.streetGroupId &&
    side !== (city.drivingSide === 'right' ? 'right' : 'left') &&
    Object.values(city.roads).some(
      (other) =>
        other.id !== roadId &&
        other.streetGroupId === road.streetGroupId &&
        other.from === road.to &&
        other.to === road.from,
    )
  )
    return undefined;
  const lane = compiled.lanes[r.lanes[side === 'left' ? 0 : r.lanes.length - 1]!]!;
  const access = road.access?.car ?? road.access?.all ?? 'yes';
  return lane.allowed.includes('car') && (access === 'yes' || access === 'destination')
    ? lane
    : undefined;
}

/** Canonical centreline stations; no parking is inferred by compile or opening a project. */
export function safeStripRuns(
  city: City,
  compiled: CompiledCity,
  roadId: string,
  side: 'left' | 'right',
  layout: ParkingLayout,
  exclusions: readonly Vec2[][] = city.context?.features.flatMap((f) =>
    f.kind === 'area' && f.class === 'building' ? [f.rings[0]!] : [],
  ) ?? [],
): { fromM: number; toM: number; capacity: number }[] {
  const lane = curbLane(city, compiled, roadId, side);
  if (!lane) return [];
  const source = city.roads[roadId]!;
  const road = compiled.roads[lane.road]!;
  const length = polylineLength(source.centerline);
  const station = (positionM: number) =>
    nearestOnPolyline(source.centerline, pointAtDistance(lane.polyline, lane.cumulative, positionM))
      .along;
  let start = Math.max(5, station(0) + 5),
    end = Math.min(length - 5, station(lane.lengthM) - 5);
  const first = crossingSpan(compiled, lane, false, city);
  const last = crossingSpan(compiled, lane, true, city);
  if (first) start = Math.max(start, station(Math.max(first.nearM, first.farM)));
  if (last) end = Math.min(end, station(Math.min(last.nearM, last.farM)) - 5);
  const blocked: [number, number][] = [];
  for (const laneIdx of road.lanes)
    for (const idx of compiled.lanes[laneIdx]!.connectors) {
      const c = compiled.connectors[idx]!;
      if (c.parking !== undefined && compiled.parking[c.parking]!.kind === 'roadside') continue;
      const l = compiled.lanes[c.lane]!;
      const s = nearestOnPolyline(
        source.centerline,
        pointAtDistance(l.polyline, l.cumulative, c.positionM),
      ).along;
      blocked.push([s - 3, s + 3]);
    }
  // Mapped midblock crossings are display-only walk links, but still keep the curb clear.
  for (const link of Object.values(city.walk?.links ?? {})) {
    if (link.kind !== 'crossing') continue;
    for (const hit of polylineCrossings(source.centerline, link.line))
      blocked.push([
        hit.alongA - 5 - (link.widthM ?? 2.5) / 2,
        hit.alongA + (link.widthM ?? 2.5) / 2,
      ]);
    for (const p of link.line) {
      const hit = nearestOnPolyline(source.centerline, p);
      if (hit.away <= source.lanes.reduce((sum, l) => sum + l.widthM, 0) + 4)
        blocked.push([
          hit.along - 5 - (link.widthM ?? 2.5) / 2,
          hit.along + (link.widthM ?? 2.5) / 2,
        ]);
    }
  }
  blocked.sort((a, b) => a[0] - b[0]);
  const runs: { fromM: number; toM: number; capacity: number }[] = [];
  const add = (fromM: number, toM: number) => {
    const capacity = Math.floor((toM - fromM + 1e-8) / stripPitch(layout));
    if (capacity > 0) runs.push({ fromM, toM, capacity });
  };
  for (const [from, to] of blocked) {
    if (to <= start || from >= end) continue;
    add(start, Math.min(from, end));
    start = Math.max(start, to);
  }
  add(start, end);
  if (!exclusions.length) return runs;
  const buildings = exclusions.map((ring) => prepareRing(ring));
  const clear: typeof runs = [];
  for (const run of runs) {
    const polygon = bandPolygon(source, lane, side, run.fromM, run.toM, stripWidth(layout));
    const box = prepareRing(polygon).box,
      cuts: [number, number][] = [];
    for (const building of buildings) {
      if (
        building.box.minX >= box.maxX ||
        building.box.maxX <= box.minX ||
        building.box.minY >= box.maxY ||
        building.box.maxY <= box.minY
      )
        continue;
      for (const intersection of booleanOpD(
        ClipType.Intersection,
        [polygon],
        [building.ring],
        FillRule.EvenOdd,
        4,
      )) {
        if (Math.abs(areaD(intersection)) < 0.001) continue;
        const stations = intersection.map((p) => nearestOnPolyline(source.centerline, p).along);
        cuts.push([Math.min(...stations) - 1, Math.max(...stations) + 1]);
      }
    }
    let cursor = run.fromM;
    const append = (fromM: number, toM: number) => {
      const capacity = Math.floor((toM - fromM + 1e-8) / stripPitch(layout));
      if (capacity > 0) clear.push({ fromM, toM, capacity });
    };
    for (const [from, to] of cuts.sort((a, b) => a[0] - b[0])) {
      append(cursor, Math.min(from, run.toM));
      cursor = Math.max(cursor, to);
    }
    append(cursor, run.toM);
  }
  return clear;
}

export function compileStrip(city: City, compiled: CompiledCity, facility: CParking): void {
  const source = facility.source.strip!;
  const lane = curbLane(city, compiled, source.roadId, source.side);
  if (!lane) {
    facility.capacity = 0;
    return;
  }
  const road = city.roads[source.roadId]!;
  const cumulative = cumulativeLengths(road.centerline);
  const width = stripWidth(source.layout),
    sign = source.side === 'left' ? -1 : 1;
  const onLane = (station: number) =>
    nearestOnPolyline(lane.polyline, pointAtDistance(road.centerline, cumulative, station)).along;
  const pose = (station: number, offset: number) => {
    const s = onLane(station);
    const p = pointAtDistance(lane.polyline, lane.cumulative, s);
    const heading = headingAtDistance(lane.polyline, lane.cumulative, s);
    return { x: p.x - Math.sin(heading) * offset, y: p.y + Math.cos(heading) * offset };
  };
  const strip: CStrip = {
    id: facility.id,
    road: lane.road,
    side: source.side,
    fromM: source.fromM,
    toM: source.toM,
    widthM: width,
    layout: source.layout,
    slots: [],
    polygon: bandPolygon(road, lane, source.side, source.fromM, source.toM, width),
  };
  const pitch = stripPitch(source.layout);
  const count = Math.min(facility.capacity, Math.floor((source.toM - source.fromM + 1e-8) / pitch));
  const inset = (source.toM - source.fromM - count * pitch) / 2;
  for (let i = 0; i < count; i++) {
    const station = source.fromM + inset + (i + 0.5) * pitch;
    const positionM = onLane(station);
    const tangent = headingAtDistance(lane.polyline, lane.cumulative, positionM);
    const idx = (compiled.parkingSpaces ??= []).length;
    const space: CParkingSpace = {
      idx,
      parking: facility.idx,
      lane: lane.idx,
      positionM,
      position: pose(station, sign * (lane.widthM / 2 + width / 2)),
      heading:
        tangent +
        (source.layout === 'parallel'
          ? 0
          : sign * (source.layout === 'angled' ? Math.PI / 3 : Math.PI / 2)),
      widthM: source.layout === 'parallel' ? 2 : 2.5,
      lengthM: 5,
      layout: source.layout,
      connector: -1,
      manoeuvre: true,
    };
    compiled.parkingSpaces.push(space);
    (facility.spaces ??= []).push(idx);
    strip.slots.push(idx);
  }
  facility.capacity = count;
  (compiled.strips ??= []).push(strip);
}
