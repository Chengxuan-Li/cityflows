import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { allocateId } from '../../src/schema';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { town } from '../../src/fixtures/town';
import { addImplicitGarages } from '../../src/network/parking';
import { safeStripRuns } from '../../src/network/strips';
import { createHash } from 'node:crypto';
import type { CompiledCity } from '../../src/network';

/** Lead (TASK-111 merge): a signal phase's walk list indexes walk links, which strips move. */
const vehicleNodes = (net: CompiledCity) =>
  net.nodes.map((n) =>
    n.signal
      ? {
          ...n,
          signal: {
            ...n.signal,
            phases: n.signal.phases.map((p) => ({
              durationS: p.durationS,
              movements: p.movements,
            })),
          },
        }
      : n,
  );

test.each([
  ['grid', grid5x5],
  ['town', town],
] as const)(
  'T52 %s strip additions and removals preserve original vehicle bytes',
  (name, fixture) => {
    const city = fixture();
    addImplicitGarages(city);
    const original = compile(city);
    if (!original.ok) throw new Error('compile');
    const ids = new Set(original.compiled.connectors.map((c) => c.id));
    const hash = (net: CompiledCity) =>
      createHash('sha256')
        .update(
          JSON.stringify({
            nodes: vehicleNodes(net),
            roads: net.roads,
            movements: net.movements,
            places: net.places,
            lanes: net.lanes.map((l) => ({
              ...l,
              connectors: l.connectors.filter((i) => ids.has(net.connectors[i]!.id)),
            })),
            connectors: net.connectors.filter((c) => ids.has(c.id)),
          }),
        )
        .digest('hex');
    const target = Object.values(city.roads)
      .map((road) => ({
        road,
        runs: safeStripRuns(city, original.compiled, road.id, 'right', 'parallel'),
      }))
      .find((r) => r.runs.length)!;
    const id = allocateId(city, 'pk'),
      run = target.runs[0]!;
    city.parking![id] = {
      id,
      kind: 'roadside',
      name: null,
      access: 'public',
      placeId: null,
      capacity: run.capacity,
      connectors: [],
      shape: null,
      strip: {
        roadId: target.road.id,
        side: 'right',
        fromM: run.fromM,
        toM: run.toM,
        layout: 'parallel',
      },
      provenance: { source: 'authored' },
    };
    const added = compile(city);
    if (!added.ok) throw new Error('compile');
    expect(added.compiled.parkingSpaces!.length).toBeGreaterThan(0);
    expect(hash(added.compiled)).toBe(hash(original.compiled));
    delete city.parking![id];
    const removed = compile(city);
    if (!removed.ok) throw new Error('compile');
    expect(hash(removed.compiled)).toBe(hash(original.compiled));
    console.info('T52', name, 'unchanged vehicle hash', hash(original.compiled));
  },
);

test('T52 strips have physical slots and exact curb-lane connectors without changing lane geometry', () => {
  const { city, node, road } = buildCity('Strip', 103);
  const r = road(node(0, 0), node(120, 0));
  const baseline = compile(city);
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'roadside',
      name: null,
      capacity: 18,
      access: 'public',
      placeId: null,
      shape: null,
      connectors: [],
      provenance: { source: 'generated' },
      strip: { roadId: r.id, side: 'right', fromM: 10, toM: 110, layout: 'parallel' },
    },
  };
  const result = compile(city);
  if (!result.ok || !baseline.ok) throw new Error('compile');
  const net = result.compiled;
  expect(net.parking).toHaveLength(1);
  expect(net.parking[0]!.capacity).toBe(18);
  expect(net.parkingSpaces).toHaveLength(18);
  expect(net.strips).toHaveLength(1);
  for (const space of net.parkingSpaces!) {
    expect(space.position.y).toBeCloseTo(2.5);
    expect(space.positionM).toBeGreaterThan(10);
    expect(space.positionM).toBeLessThan(110);
    expect(net.connectors[space.connector]).toMatchObject({
      lane: space.lane,
      positionM: space.positionM,
      direction: 'both',
    });
    expect(space.manoeuvre).toBe(true);
  }
  expect(net.lanes.map((lane) => ({ ...lane, connectors: [] }))).toEqual(
    baseline.compiled.lanes.map((lane) => ({ ...lane, connectors: [] })),
  );
  expect(compile(city)).toEqual(result);
  // Local access still admits a trip parking here; changing it must not erase occupied bays.
  r.access = { all: 'destination' };
  const local = compile(city);
  if (!local.ok) throw new Error('compile');
  expect(local.compiled.parkingSpaces).toEqual(net.parkingSpaces);
  expect(local.compiled.strips).toEqual(net.strips);
});

test('T52 a lot without mapped aisles generates contained stalls and uses its driveway', () => {
  const { city, node, road } = buildCity('Driveway lot', 103);
  const r = road(node(0, 0), node(120, 0));
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 0,
      access: 'public',
      placeId: null,
      shape: {
        kind: 'polygon',
        ring: [
          { x: 20, y: 8 },
          { x: 100, y: 8 },
          { x: 100, y: 30 },
          { x: 20, y: 30 },
        ],
      },
      connectors: [
        {
          id: allocateId(city, 'c'),
          roadId: r.id,
          lane: 0,
          positionM: 60,
          direction: 'both',
          throughputPerMin: 30,
        },
      ],
      provenance: { source: 'generated', inferred: ['driveway'] },
    },
  };
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  expect(result.compiled.parking[0]!.capacity).toBeGreaterThan(10);
  expect(result.compiled.parkingSpaces!.every((s) => s.manoeuvre)).toBe(true);
  expect(new Set(result.compiled.parkingSpaces!.map((s) => s.connector)).size).toBe(1);
});
