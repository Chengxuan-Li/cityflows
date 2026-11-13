import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { auditCity, auditRoute } from '../../bench/route-audit';
import { readFileSync } from 'node:fs';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { town } from '../../src/fixtures/town';
import { compile } from '../../src/network';
import { buildCity } from '../../src/fixtures/build-city';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { routingFixture } from './fixtures';
import { createGeoReference, localToLonLat } from '../../src/geo/projection';
import { limit } from '../timeouts';

test.each(['grid', 'town', 'Sindelfingen'])(
  '%s returns no statically undrivable connector routes',
  (name) => {
    const imported =
      name === 'Sindelfingen'
        ? importOsmCached(readFileSync('fixtures/osm/sindelfingen-a81.osm', 'utf8'), {
            importerVersion: 'test',
            bbox: [8.98, 48.69, 9, 48.702],
          })
        : null;
    if (imported && !imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const city = imported?.ok ? imported.city : name === 'grid' ? grid5x5() : town();
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const report = auditCity(city, result.compiled);
    expect(report.rejected, JSON.stringify(report.examples)).toBe(0);
    if (name === 'Sindelfingen') expect(report.routable).toBeGreaterThan(5000);
    else expect(report.routable).toBe(report.pairs);
  },
  limit(60_000),
);

test('audit catches a clamped lane drop even though its compiled movement exists', () => {
  const { city, node, road, place } = buildCity('Lane drop audit', 1);
  const junction = node(100, 0);
  const approach = road(node(0, 0), junction, { lanes: 2 });
  const exit = road(junction, node(200, 0));
  place('Home', 'residential', { x: 0, y: 0 }, [{ road: approach, lane: 1, direction: 'out' }]);
  place('Work', 'work', { x: 200, y: 0 }, [{ road: exit, direction: 'in' }]);
  const { compiled, request } = routingFixture(city);
  const result = createRouteProvider().route(compiled, freeFlowLinkCosts(compiled), request);
  if (!result.ok) throw new Error(result.reason);
  // Construct the physically undrivable chain independently of the router's chosen route.
  const dropped = compiled.movements.find((m) => m.fromLane === request.fromLane)!;
  const route = {
    ...result.route,
    movements: [dropped.idx],
    targetLanes: [[request.fromLane], [dropped.toLane]],
  };
  expect(auditRoute(city, compiled, request, route).map((issue) => issue.cause)).toContain(
    'dropped_lane',
  );
  const illegal = { ...route, movements: [-1] };
  expect(auditRoute(city, compiled, request, illegal).map((issue) => issue.cause)).toContain(
    'illegal_movement',
  );
  const surviving = compiled.movements.find((m) => m.fromLane !== request.fromLane)!;
  const late = {
    ...route,
    movements: [surviving.idx],
    targetLanes: [[surviving.fromLane], [surviving.toLane]],
  };
  expect(
    auditRoute(city, compiled, { ...request, fromPosM: 80 }, late).map((issue) => issue.cause),
  ).toContain('lane_distance');
});

test('audit identifies a clipped dead end before an absent movement and permits arrival there', () => {
  const { city, node, road, place } = buildCity('Boundary audit', 1);
  const from = road(node(0, 0), node(100, 0));
  const to = road(node(100, 100), node(200, 100));
  place('Home', 'residential', { x: 0, y: 0 }, [{ road: from, direction: 'out' }]);
  place('Gateway', 'gateway', { x: 100, y: 0 }, [{ road: from, positionM: 80, direction: 'in' }]);
  place('Work', 'work', { x: 200, y: 100 }, [{ road: to, direction: 'in' }]);
  const reference = createGeoReference({ lon: 0, lat: 0 });
  city.geo = {
    ...reference,
    bbox: [0, -0.001, localToLonLat(reference, { x: 100, y: 0 }).lon, 0.001],
    source: {
      kind: 'osm',
      snapshotDate: null,
      attribution: 'Test',
      importerVersion: 'test',
      inferredCount: 0,
    },
  };
  const { compiled, request } = routingFixture(city);
  const first = compiled.index.road.get(from.id)!;
  const last = compiled.index.road.get(to.id)!;
  const bad = {
    roads: [first, last],
    movements: [-1],
    targetLanes: [[request.fromLane], [compiled.connectors[request.toConnector]!.lane]],
    costS: 0,
  };
  expect(auditRoute(city, compiled, request, bad).map((issue) => issue.cause)).toContain(
    'boundary_dead_end',
  );
  const arrival = compiled.connectors.find(
    (c) => c.direction === 'in' && c.lane === request.fromLane,
  )!;
  const good = { roads: [first], movements: [], targetLanes: [[request.fromLane]], costS: 0 };
  expect(auditRoute(city, compiled, { ...request, toConnector: arrival.idx }, good)).toEqual([]);
});
