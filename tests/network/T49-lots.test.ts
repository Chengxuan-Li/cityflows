import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { allocateId } from '../../src/schema';
import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import { lotGeometry } from '../../src/render3d/stalls';
import { createTerrain } from '../../src/render3d/terrain';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { scenarioSchema } from '../../src/schema';
import { saveProject, saveProjectJson } from '../../src/project/save';
import { openProject } from '../../src/project/open';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { segmentDistance } from '../../src/geo/polyline';

export function lotFixture() {
  const builder = buildCity('Surface lot', 104);
  const { city, node, road } = builder;
  const a = node(0, 0),
    b = node(100, 0);
  const aisle = road(a, b, { roadClass: 'service', speedKmh: 10 });
  aisle.lanes[0]!.widthM = 6;
  aisle.access = { all: 'destination' };
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: 'Test lot',
      capacity: 123,
      access: 'public',
      placeId: null,
      connectors: [],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 0, y: -10 },
          { x: 100, y: -10 },
          { x: 100, y: 10 },
          { x: 0, y: 10 },
        ],
      },
      aisles: [aisle.id],
      provenance: { source: 'generated' },
    },
  };
  return { ...builder, aisle, id };
}

test('T49 compiles deterministic perpendicular stalls on both sides without changing saved capacity', () => {
  const { city } = lotFixture();
  const result = compile(city);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('compile failed');
  // 6 m clearance at either end, 2.5 m pitch: 35 stalls per side.
  const lots = (result.compiled as typeof result.compiled & { lots?: { stallCount: number }[] })
    .lots;
  expect(lots?.[0]?.stallCount).toBeGreaterThanOrEqual(70 * 0.95);
  expect(lots?.[0]?.stallCount).toBeLessThanOrEqual(70 * 1.05);
  expect(compile(city)).toEqual(result);
  expect(Object.values(city.parking!)[0]!.capacity).toBe(123);
});

test('T49 clips full bays to a concave boundary, excludes buildings and crossing aisles, and drapes 3D paint', () => {
  const { city, id, node, road } = lotFixture();
  const lot = city.parking![id]!;
  lot.entries = [Object.keys(city.nodes)[0]!];
  lot.exclusions = [
    [
      { x: 20, y: -9 },
      { x: 30, y: -9 },
      { x: 30, y: -3 },
      { x: 20, y: -3 },
    ],
  ];
  lot.shape = {
    kind: 'polygon',
    ring: [
      { x: 0, y: -10 },
      { x: 100, y: -10 },
      { x: 100, y: 10 },
      { x: 60, y: 10 },
      { x: 60, y: 5 },
      { x: 40, y: 5 },
      { x: 40, y: 10 },
      { x: 0, y: 10 },
    ],
  };
  const crossing = road(node(50, -20), node(50, 20), { roadClass: 'service' });
  lot.aisles!.push(crossing.id);
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const stalls = result.compiled.lots![0]!.stalls;
  expect(stalls.length).toBeGreaterThan(20);
  const area = (rings: { x: number; y: number }[][]) =>
    rings.reduce((sum, ring) => sum + Math.abs(areaD(ring)), 0);
  for (const [i, stall] of stalls.entries()) {
    expect(
      area(booleanOpD(ClipType.Difference, [stall.corners], [lot.shape.ring], FillRule.EvenOdd, 4)),
    ).toBeLessThan(0.001);
    for (const obstacle of [
      ...lot.exclusions,
      ...result.compiled.roads.map((r) => r.surface),
      ...stalls.slice(0, i).map((s) => s.corners),
    ])
      expect(
        area(booleanOpD(ClipType.Intersection, [stall.corners], [obstacle], FillRule.EvenOdd, 4)),
      ).toBeLessThan(0.001);
    expect(stall.corners.every((p) => Math.hypot(p.x, p.y) >= 6)).toBe(true);
  }
  const grid = {
    source: 'test',
    originM: { x: -20, y: -20 },
    cellM: 100,
    cols: 2,
    rows: 2,
    baseM: 500,
    heights: 'AAAAAAAAAAA=',
  };
  const geometry = lotGeometry(result.compiled, city, createTerrain(grid));
  const paint = geometry.paint.getAttribute('position');
  expect(paint.count).toBeGreaterThan(0);
  for (let i = 0; i < paint.count; i++) expect(paint.getY(i)).toBeCloseTo(500.015, 3);
  geometry.surface.dispose();
  geometry.paint.dispose();
});

test('T49 narrow one-way aisles get angled stalls', () => {
  const { city, aisle } = lotFixture();
  aisle.lanes[0]!.widthM = 3;
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  expect(result.compiled.lots![0]!.stalls.length).toBeGreaterThan(30);
  for (const stall of result.compiled.lots![0]!.stalls)
    expect(Math.abs(stall.heading)).toBeCloseTo(Math.PI / 3);
});

test.each([saveProject, saveProjectJson])(
  'T49 lots survive save/open and older files without lots still open',
  async (save) => {
    const { city } = lotFixture();
    const project = { city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
    expect(await openProject(await save(project))).toEqual({ ok: true, project });
    delete city.parking;
    expect(await openProject(await save(project))).toEqual({ ok: true, project });
  },
);

test('T49 a neighbouring private-road origin cannot use a lot as a through shortcut', () => {
  const { city, node, road, place } = buildCity('Private road beside lot', 104);
  const a = node(0, 0),
    b = node(100, 0),
    c = node(200, 0),
    d = node(300, 0);
  const origin = road(a, b);
  origin.access = { all: 'private' };
  const aisle = road(b, c, { roadClass: 'service', speedKmh: 10 });
  aisle.access = { all: 'destination' };
  const destination = road(c, d);
  place('Destination', 'work', d.pos, [{ road: destination, direction: 'in' }]);
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 20,
      access: 'public',
      placeId: null,
      connectors: [],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 100, y: -20 },
          { x: 200, y: -20 },
          { x: 200, y: 20 },
          { x: 100, y: 20 },
        ],
      },
      aisles: [aisle.id],
      entries: [b.id, c.id],
      provenance: { source: 'generated' },
    },
  };
  const compiled = compile(city);
  if (!compiled.ok) throw new Error('compile');
  const net = compiled.compiled,
    provider = createRouteProvider(),
    costs = freeFlowLinkCosts(net);
  const request = {
    fromLane: net.index.lane.get(origin.id + '#0')!,
    fromPosM: 0,
    toConnector: 0,
    vehicleClass: 'car' as const,
    desiredSpeedFactor: 1,
    noise: 0,
    seed: 104,
  };
  expect(provider.route(net, costs, request)).toEqual({ ok: false, reason: 'class_forbidden' });
  expect(
    provider.route(net, costs, { ...request, fromLane: net.index.lane.get(aisle.id + '#0')! }).ok,
  ).toBe(true);
});

test('T49 every bay edge stays six metres from an entry even when both corners are clear', () => {
  const { city, id, node, road } = lotFixture();
  const entry = node(7.25, -14.1);
  const other = road(entry, node(7.25, -30), { roadClass: 'service' });
  city.parking![id]!.aisles!.push(other.id);
  city.parking![id]!.entries = [entry.id];
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  expect(result.compiled.lots![0]!.stalls.length).toBeGreaterThan(30);
  for (const stall of result.compiled.lots![0]!.stalls)
    for (let i = 0; i < 4; i++)
      expect(
        segmentDistance(entry.pos, stall.corners[i]!, stall.corners[(i + 1) % 4]!),
      ).toBeGreaterThanOrEqual(6);
});

test('T49 overlapping facilities share physical space without duplicating bays', () => {
  const { city, id } = lotFixture();
  const second = allocateId(city, 'pk');
  city.parking![second] = { ...structuredClone(city.parking![id]!), id: second };
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  const stalls = result.compiled.lots!.flatMap((lot) => lot.stalls);
  expect(stalls.length).toBeGreaterThanOrEqual(70 * 0.95);
  expect(stalls.length).toBeLessThanOrEqual(70 * 1.05);
  expect(new Set(stalls.map((stall) => JSON.stringify(stall.corners))).size).toBe(stalls.length);
});

test('T49 a building footprint exactly matching a bay excludes that bay', () => {
  const { city, id } = lotFixture();
  const before = compile(city);
  if (!before.ok) throw new Error('compile');
  const blocked = before.compiled.lots![0]!.stalls[0]!.corners;
  city.parking![id]!.exclusions = [blocked];
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  expect(result.compiled.lots![0]!.stallCount).toBe(before.compiled.lots![0]!.stallCount - 1);
});
