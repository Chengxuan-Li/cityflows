import { expect, it } from 'vitest';
import { compile } from '../../src/network';
import { citySchema, migrateCity, type City } from '../../src/schema';

function minimal(): City {
  const provenance = { source: 'authored' } as const;
  const start = { x: 0, y: 0 };
  const end = { x: 30, y: 0 };
  return {
    schemaVersion: 3,
    version: 0,
    name: 'Minimal',
    geo: null,
    drivingSide: 'right',
    nextId: 4,
    nodes: {
      'n:1': {
        id: 'n:1',
        pos: start,
        layer: 0,
        control: 'uncontrolled',
        minorRoads: [],
        turnRules: [],
        signal: null,
        provenance,
      },
      'n:2': {
        id: 'n:2',
        pos: end,
        layer: 0,
        control: 'uncontrolled',
        minorRoads: [],
        turnRules: [],
        signal: null,
        provenance,
      },
    },
    roads: {
      'r:3': {
        id: 'r:3',
        from: 'n:1',
        to: 'n:2',
        centerline: [start, end],
        lateralOffsetM: 0,
        lanes: [{ widthM: 3, allowed: ['car'] }],
        roadClass: 'residential',
        speedLimitMps: 10,
        name: null,
        streetGroupId: null,
        provenance,
      },
    },
    places: {},
  };
}

it('validates, migrates and compiles a hand-built minimal city', () => {
  const city = minimal();
  expect(citySchema.safeParse(city).success).toBe(true);
  expect(migrateCity(JSON.parse(JSON.stringify(city)))).toEqual(city);
  expect(compile(city).ok).toBe(true);
  expect(() => migrateCity({ ...city, schemaVersion: 4 })).toThrow(/version/i);
});

it('reports each invalid entity and its reference', () => {
  const city = minimal();
  const node = city.nodes['n:1']!;
  node.control = 'signal';
  const road = city.roads['r:3']!;
  road.to = 'n:99';
  road.lanes[0]!.widthM = -3;
  city.places['p:4'] = {
    id: 'p:4',
    name: 'Home',
    kind: 'residential',
    shape: { kind: 'point', pos: node.pos },
    population: 1,
    jobs: 0,
    attraction: 0,
    capacity: null,
    profile: null,
    events: [],
    provenance: node.provenance,
    connectors: [
      { id: 'c:5', roadId: road.id, lane: 1, positionM: 5, direction: 'out', throughputPerMin: 5 },
    ],
  };
  city.nextId = 6;
  expect(citySchema.safeParse(city).success).toBe(false);
  const result = compile(city);
  expect(result.ok).toBe(false);
  for (const [code, refs] of [
    ['dangling_ref', ['r:3', 'n:99']],
    ['lane_invalid', ['r:3']],
    ['connector_invalid', ['c:5', 'r:3']],
    ['signal_missing', ['n:1']],
  ] as const) {
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code, severity: 'error', refs: expect.arrayContaining([...refs]) }),
    );
  }
});

it('allows querying an empty city without returning a phantom lane segment', () => {
  const result = compile({ ...minimal(), nodes: {}, roads: {} });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.compiled.laneSpatial.search(-1, -1, 1, 1)).toEqual([]);
  expect(result.compiled.laneSpatial.neighbors(0, 0, 1)).toEqual([]);
});
