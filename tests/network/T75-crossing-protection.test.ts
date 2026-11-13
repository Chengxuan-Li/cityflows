import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { operatingCrossing } from '../../src/fixtures/operating-crossings';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { compile } from '../../src/network';

function crossing() {
  const b = buildCity('Crossing entries', 136);
  const west = b.node(-80, 0),
    centre = b.node(4, 0),
    east = b.node(80, 0);
  const roads = [...b.street(west, centre), ...b.street(centre, east)];
  for (const road of roads) road.provenance = { source: 'generated', osmIds: [10] };
  b.city.rail = operatingCrossing('tram').rail;
  return { ...b, west, centre, east };
}
function compiled(source: ReturnType<typeof crossing>['city']) {
  const result = compile(source);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

test('T75 a legal crossing turn is metered before grant while the turn away remains outside the conflict', () => {
  const b = crossing(),
    north = b.node(20, -60),
    incoming = b.road(north, b.centre);
  const c = compiled(b.city),
    f = c.rail!.facilities![0]!,
    lane = c.index.road.get(incoming.id)!;
  const incomingLane = c.roads[lane]!.lanes[0]!;
  const movements = c.lanes[incomingLane]!.out.map((i) => c.movements[i]!);
  const towardWest = movements.find(
    (m) => c.nodes[c.roads[c.lanes[m.toLane]!.road]!.to]!.id === b.west.id,
  )!;
  const towardEast = movements.find(
    (m) => c.nodes[c.roads[c.lanes[m.toLane]!.road]!.to]!.id === b.east.id,
  )!;
  expect(f.stops).toContainEqual({ lane: incomingLane, stopM: c.lanes[incomingLane]!.stopM });
  expect(f.spans!.some((s) => s.segment === -towardWest.idx - 1)).toBe(true);
  expect(f.spans!.some((s) => s.segment === -towardEast.idx - 1)).toBe(false);
  expect(f.spans!.some((s) => s.segment === towardEast.toLane)).toBe(false);
});

test('T75 an adjacent parallel road and a grade-separated crossing are not road conflicts', () => {
  const b = crossing(),
    parallel = b.road(b.node(2.8, -60), b.node(2.8, 60));
  const bridge = b.road(b.node(-50, 8, 1), b.node(50, 8, 1));
  bridge.layer = 1;
  const c = compiled(b.city),
    f = c.rail!.facilities![0]!;
  for (const road of [parallel, bridge]) {
    const lanes = c.roads[c.index.road.get(road.id)!]!.lanes;
    expect(
      f.spans!.some((s) => lanes.includes(s.segment)),
      road.id,
    ).toBe(false);
    expect(
      f.stops!.some((s) => lanes.includes(s.lane)),
      road.id,
    ).toBe(false);
  }
});

test('T75 the protected road span includes the body width of both mapped tracks', () => {
  const b = buildCity('Two track crossing', 136),
    west = b.node(-80, 0),
    east = b.node(80, 0),
    road = b.road(west, east);
  road.provenance = { source: 'generated', osmIds: [10] };
  b.city.rail = operatingCrossing('tram').rail!;
  const second = structuredClone(b.city.rail);
  for (const n of Object.values(second.nodes)) {
    n.id = n.id.replace('rn:', 'rn:1');
    n.pos.x += 4.2;
  }
  for (const t of Object.values(second.tracks)) {
    t.id = t.id.replace('rt:', 'rt:1');
    t.from = t.from.replace('rn:', 'rn:1');
    t.to = t.to.replace('rn:', 'rn:1');
    for (const p of t.line) p.x += 4.2;
  }
  Object.assign(
    b.city.rail.nodes,
    Object.fromEntries(Object.values(second.nodes).map((n) => [n.id, n])),
  );
  Object.assign(
    b.city.rail.tracks,
    Object.fromEntries(Object.values(second.tracks).map((t) => [t.id, t])),
  );
  const c = compiled(b.city),
    f = c.rail!.facilities![0]!,
    lane = c.lanes[c.roads[c.index.road.get(road.id)!]!.lanes[0]!]!,
    span = f.spans!.find((s) => s.segment === lane.idx)!;
  expect(f.nodes).toHaveLength(2);
  expect(f.railSpans).toHaveLength(4);
  expect(span.fromM).toBeLessThan(nearestOnPolyline(lane.polyline, { x: -1.2, y: 0 }).along);
  expect(span.toM).toBeGreaterThan(nearestOnPolyline(lane.polyline, { x: 5.4, y: 0 }).along);
});
