// TASK-104: appended lot aisles and their junction mouths; T49 proves main hashes with aisles removed.
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { vehicleClasses, type AccessValue, type City } from '../../src/schema';
import { tierCities, unitTest } from '../tier';
import { routingFixture } from './fixtures';
import { throughputCities, throughputFixture, throughputRequests } from './throughput-fixtures';
import { test } from 'vitest';

// Exact full results from 56ffccd's unmodified router on these same unrestricted networks.
// Imported networks retain access boundaries before their rules are cleared for this check.
const hashes = {
  grid: 'f54053d207e6c0d1da2ad1748d84de10b7c6d961fbddde66e183c0b0066bb031',
  town: '3014271261a29ab0fdd413ecf0af3063f569f9420cb028b05a1fbd827973be57',
  Sindelfingen: 'edfee22305eddb2436d68f82ed0ebb88ab120980bd9a8818b90f0bf11d38cd9a',
  Munich: 'bc6db3c17ec82aac370bbdd77c0e3e19880c48d3485e7f06757a44fac6fc29d0',
};

test.each(tierCities(throughputCities))('T47 unrestricted %s routes equal main', (name) => {
  const { city } = throughputFixture(name);
  for (const road of Object.values(city.roads)) {
    delete road.access;
    for (const lane of road.lanes) lane.allowed = [...vehicleClasses];
  }
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const net = result.compiled;
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(net);
  const routes = throughputRequests(net).map(({ request }) => provider.route(net, costs, request));
  expect(createHash('sha256').update(JSON.stringify(routes)).digest('hex')).toBe(hashes[name]);
});

function route(city: City) {
  const { compiled, request } = routingFixture(city);
  const result = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request);
  if (!result.ok) throw new Error(result.reason);
  return { compiled, request, result };
}

unitTest.each(['no', 'destination', 'private'] as const)(
  'T47 a through trip avoids a %s road even on its fastest path',
  (rule) => {
    const city = grid5x5();
    const baseline = route(city);
    const restricted = baseline.compiled.roads[baseline.result.route.roads[2]!]!.id;
    city.roads[restricted]!.access = { car: rule };
    const changed = route(city);
    expect(changed.result.route.roads.map((idx) => changed.compiled.roads[idx]!.id)).not.toContain(
      restricted,
    );
    const truck = createRouteProvider().route(
      changed.compiled,
      freeFlowLinkCosts(changed.compiled),
      {
        ...changed.request,
        vehicleClass: 'truck',
      },
    );
    expect(truck.ok && truck.route.roads).toEqual(baseline.result.route.roads);
  },
);

unitTest.each(['destination', 'private'] as const)(
  'T47 %s zones admit trips starting or ending in the zone',
  (rule) => {
    const city = grid5x5();
    const base = route(city);
    const ids = base.result.route.roads.map((idx) => base.compiled.roads[idx]!.id);
    for (const id of ids.slice(0, 3)) city.roads[id]!.access = { all: rule };
    expect(route(city).result.route.roads).toEqual(base.result.route.roads);
    for (const road of Object.values(city.roads)) delete road.access;
    for (const id of ids.slice(-3)) city.roads[id]!.access = { all: rule };
    expect(route(city).result.route.roads).toEqual(base.result.route.roads);
  },
);

unitTest('T47 delivery rules apply to every search, endpoints and cached request order', () => {
  const city = grid5x5();
  for (const road of Object.values(city.roads)) road.access = { all: 'delivery' };
  const { compiled, request } = routingFixture(city);
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(compiled);
  for (const purpose of [
    'delivery',
    undefined,
    'private',
    'service',
    'taxi',
    'through',
    'delivery',
  ] as const) {
    const result = provider.route(compiled, costs, { ...request, ...(purpose && { purpose }) });
    if (purpose === 'delivery') expect(result.ok).toBe(true);
    else expect(result).toEqual({ ok: false, reason: 'class_forbidden' });
  }
});

unitTest('T47 disconnected access zones stay separate per class and local request', () => {
  const city = grid5x5();
  const base = route(city);
  const ids = base.result.route.roads.map((idx) => base.compiled.roads[idx]!.id);
  city.roads[ids[0]!]!.access = { car: 'destination', bus: 'private' };
  city.roads[ids[3]!]!.access = { car: 'private' };
  const changed = route(city);
  const a = changed.compiled.roads[changed.compiled.index.road.get(ids[0]!)!]!;
  const b = changed.compiled.roads[changed.compiled.index.road.get(ids[3]!)!]!;
  expect(a.zone[0]).not.toBe(b.zone[0]);
  expect(changed.result.route.roads).not.toContain(b.idx);
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(changed.compiled);
  // Leaving the second zone is legal, but a subsequent through request must avoid it again.
  expect(
    provider.route(changed.compiled, costs, {
      ...changed.request,
      fromLane: b.lanes[0]!,
      fromPosM: 0,
    }).ok,
  ).toBe(true);
  expect(provider.route(changed.compiled, costs, changed.request)).toEqual(changed.result);
});

unitTest.each(['no', 'delivery'] satisfies AccessValue[])(
  'T47 an unavoidable %s rule returns class_forbidden',
  (rule) => {
    const city = grid5x5();
    const base = route(city);
    const origin = base.compiled.lanes[base.request.fromLane]!.road;
    const destination =
      base.compiled.lanes[base.compiled.connectors[base.request.toConnector]!.lane]!.road;
    for (const road of base.compiled.roads)
      if (road.idx !== origin && road.idx !== destination)
        city.roads[road.id]!.access = { all: rule };
    const { compiled, request } = routingFixture(city);
    expect(createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request)).toEqual({
      ok: false,
      reason: 'class_forbidden',
    });
  },
);

unitTest('T47 a reserved bus lane is never a car target lane', () => {
  const city = grid5x5();
  for (const road of Object.values(city.roads))
    if (road.lanes.length > 1) road.lanes.at(-1)!.allowed = ['bus'];
  const { compiled, result } = route(city);
  expect(
    result.route.targetLanes.flat().every((idx) => compiled.lanes[idx]!.allowed.includes('car')),
  ).toBe(true);
});

unitTest('T47 lane fallback never bypasses delivery or local access filters', () => {
  const { city, node, road, place } = buildCity('Late restricted turn', 1);
  const junction = node(0, 0),
    rejoin = node(0, -100),
    far = node(100, 0),
    corner = node(100, -100);
  const origin = road(node(-100, 0), junction, { lanes: 2 });
  road(junction, rejoin);
  const detour = road(junction, far, { lanes: 2 });
  road(far, corner);
  road(corner, rejoin);
  const destination = road(rejoin, node(-100, -100));
  place('Origin', 'residential', origin.centerline[0]!, [
    { road: origin, lane: 1, positionM: 80, direction: 'out' },
  ]);
  place('Destination', 'work', destination.centerline[1]!, [
    { road: destination, direction: 'in' },
  ]);
  for (const rule of ['delivery', 'destination', 'private', 'no'] as const) {
    detour.access = { all: rule };
    const { compiled, request } = routingFixture(city);
    const provider = createRouteProvider();
    const costs = freeFlowLinkCosts(compiled);
    expect(provider.route(compiled, costs, request)).toEqual({
      ok: false,
      reason: 'class_forbidden',
    });
    expect(provider.route(compiled, costs, { ...request, purpose: 'delivery' }).ok).toBe(
      rule === 'delivery',
    );
  }
});
