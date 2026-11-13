import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import { lotPath } from '../../src/network/lot-paths';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { allocateId, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { saveProject, saveProjectJson } from '../../src/project/save';
import { openProject } from '../../src/project/open';
import { createEditor } from '../../src/editor';

function fixture() {
  const nodes = [
    [1, 0, 0],
    [2, 120, 0],
    [3, 220, 0],
    [4, 400, 0],
    [5, 400, 200],
    [6, 0, 200],
    [12, 120, 50],
    [13, 220, 50],
    [20, 100, 8],
    [21, 260, 8],
    [22, 260, 90],
    [23, 100, 90],
  ];
  const xml = `<osm><bounds minlat="-0.003" minlon="-0.001" maxlat="0.001" maxlon="0.005"/>
    ${nodes.map(([id, x, y]) => `<node id="${id}" lat="${-y! / 111319.49}" lon="${x! / 111319.49}"/>`).join('')}
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/><nd ref="1"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
    <way id="11"><nd ref="2"/><nd ref="12"/><nd ref="13"/><nd ref="3"/><tag k="highway" v="service"/><tag k="service" v="parking_aisle"/><tag k="oneway" v="yes"/><tag k="maxheight" v="2.1"/></way>
    <way id="30"><nd ref="20"/><nd ref="21"/><nd ref="22"/><nd ref="23"/><nd ref="20"/><tag k="amenity" v="parking"/><tag k="parking" v="surface"/><tag k="capacity" v="50"/></way></osm>`;
  const imported = importOsm(xml, { importerVersion: 'test', context: false, terrain: false });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const city = imported.city,
    lot = Object.values(city.parking!).find((f) => f.kind === 'lot')!;
  const mouth = Object.values(city.nodes).find((n) => n.provenance.osmIds?.includes(2))!;
  // This near-entry destination used to make the car reverse up the one-way throat.
  city.places[lot.placeId!]!.shape = {
    kind: 'point',
    pos: { x: mouth.pos.x, y: mouth.pos.y + 14 },
  };
  city.parking = { [lot.id]: lot };
  const road = Object.values(city.roads).find((r) => r.provenance.osmIds?.includes(10))!;
  const initial = compile(city);
  if (!initial.ok) throw new Error('Fixture compile failed');
  const lane = initial.compiled.lanes[initial.compiled.index.lane.get(`${road.id}#0`)!]!;
  const gateway = allocateId(city, 'p');
  city.places[gateway] = {
    ...city.places[lot.placeId!]!,
    id: gateway,
    name: 'Gateway',
    kind: 'gateway',
    population: 0,
    jobs: 0,
    events: [],
    connectors: [
      {
        id: allocateId(city, 'c'),
        roadId: road.id,
        lane: 0,
        positionM: 10,
        direction: 'out',
        throughputPerMin: 60,
      },
      {
        id: allocateId(city, 'c'),
        roadId: road.id,
        lane: 0,
        positionM: lane.lengthM - 10,
        direction: 'in',
        throughputPerMin: 60,
      },
    ],
  };
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return { city, lot, net: result.compiled, gateway };
}

test('mapped one-way paths never reverse on a source aisle, including near-entry bays', () => {
  const { lot, net } = fixture(),
    graph = net.lots![0]!.circulation!;
  let checked = 0;
  for (const portal of lot.mappedPortals!)
    for (let stall = 0; stall < graph.stallNodes.length; stall++) {
      const connector = net.index.connector.get(portal.connectorId)!;
      let path = lotPath(graph, connector, stall, portal.direction);
      if (!path) continue;
      checked++;
      if (portal.direction === 'out') path = path.toReversed();
      for (let i = 1; i < path.length; i++) {
        const a = graph.nodes[path[i - 1]!]!,
          b = graph.nodes[path[i]!]!;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        for (const id of lot.aisles!) {
          const lane = net.lanes[net.index.lane.get(`${id}#0`)!]!;
          const hit = nearestOnPolyline(lane.polyline, mid);
          if (hit.away < 0.1)
            expect(
              (b.x - a.x) * hit.direction.x + (b.y - a.y) * hit.direction.y,
            ).toBeGreaterThanOrEqual(-0.05);
        }
      }
    }
  expect(checked).toBeGreaterThan(50);
});

test.each(['car', 'van'] as const)(
  'mapped mouth preserves %s permissions through actual parking and return',
  (vehicleClass) => {
    const { lot, net, gateway } = fixture();
    const trips: TripRequest[] = [
      {
        id: 'arrival',
        personId: 'driver',
        originPlaceId: gateway,
        destinationPlaceId: lot.placeId!,
        departS: 100,
        mode: 'car',
        vehicleClass,
        purpose: 'private',
        legs: [],
      },
      {
        id: 'return',
        personId: 'driver',
        originPlaceId: lot.placeId!,
        destinationPlaceId: gateway,
        departS: 350,
        mode: 'car',
        vehicleClass,
        purpose: 'private',
        legs: [],
      },
    ];
    const scenario = defaultScenario('grid5x5', 149);
    scenario.startS = 100;
    scenario.endS = 1200;
    scenario.simParams.streetParkingShare = 1;
    const engine = createEngine();
    engine.load({ compiled: net, trips, scenario });
    let parked = false,
      entered = false,
      left = false;
    for (let second = 0; second < 1000; second++) {
      engine.step(10);
      entered ||= engine.inspect(1)?.parkingPhase === 'drive_in';
      left ||= engine.inspect(2)?.parkingPhase === 'drive_out';
      parked ||= [...(engine.snapshot().parkedCars?.id ?? [])].includes(1);
      if (engine.inspect(2)?.state === 'completed' || engine.inspect(2)?.state === 'failed') break;
    }
    if (vehicleClass === 'car') {
      expect(engine.metrics().trips.completed).toBe(2);
      expect([entered, parked, left]).toEqual([true, true, true]);
      expect(engine.inspect(1)?.parkingFacility).toBe(lot.id);
    } else {
      expect(engine.inspect(1)?.state).toBe('failed');
      expect([entered, parked, left]).toEqual([false, false, false]);
    }
  },
);

test.each([saveProject, saveProjectJson])(
  'typed mouths survive project round trips; legacy projects remain valid',
  async (save) => {
    const { city, lot } = fixture();
    const opened = await openProject(await save({ city, scenarios: [defaultScenario('grid5x5')] }));
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.project.city.parking![lot.id]!.mappedPortals).toEqual(lot.mappedPortals);
    expect(compile(opened.project.city).ok).toBe(true);
    const legacy = structuredClone(city);
    delete legacy.parking![lot.id]!.mappedPortals;
    expect(compile(legacy).ok).toBe(true);
  },
);

test.each(['road', 'node', 'connector', 'duplicate', 'garage', 'anchor'] as const)(
  'stale or misplaced mapped %s records fail as parking diagnostics',
  (kind) => {
    const { city, lot } = fixture(),
      portal = lot.mappedPortals![0]!;
    if (kind === 'road') portal.aisleRoadId = 'r:999999';
    if (kind === 'node') portal.nodeId = 'n:999999';
    if (kind === 'connector') portal.connectorId = 'c:999999';
    if (kind === 'duplicate') lot.mappedPortals!.push({ ...portal });
    if (kind === 'garage') lot.kind = 'garage';
    if (kind === 'anchor') lot.connectors.find((c) => c.id === portal.connectorId)!.positionM += 20;
    const result = compile(city);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'parking_invalid')).toBe(true);
  },
);

test('deleting a portal street removes its typed connector references without a compile exception', () => {
  const { city, lot } = fixture();
  const road = lot.connectors[0]!.roadId,
    editor = createEditor(city);
  const result = editor.apply({ kind: 'deleteRoad', roadId: road });
  expect(result.ok).toBe(true);
  expect(compile(editor.city).ok).toBe(true);
});

test('deleting a mapped aisle removes dependent street portals without retaining a driveway shortcut', () => {
  const { city, lot } = fixture();
  const portal = lot.mappedPortals![0]!,
    editor = createEditor(city);
  const result = editor.apply({ kind: 'deleteRoad', roadId: portal.aisleRoadId });
  expect(result.ok).toBe(true);
  expect(editor.city.parking![lot.id]!.mappedPortals).toEqual([]);
  expect(editor.city.parking![lot.id]!.connectors).toEqual([]);
  expect(compile(editor.city).ok).toBe(true);
});
