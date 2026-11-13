import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { allocateId, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';

function entryWorld(mapped: boolean, nearClosed: boolean) {
  const { city, node, road, street, place } = buildCity('Two parking entrances', 149);
  const a = node(0, 0),
    b = node(400, 0),
    c = node(400, 100),
    d = node(0, 100);
  const direct = road(a, b);
  road(b, c);
  const detour = road(c, d);
  road(d, a);
  place('Gateway', 'gateway', { x: 100, y: 0 }, [
    { road: direct, positionM: 100, direction: 'out' },
  ]);
  place('Shop', 'retail', { x: 200, y: 50 }, []);
  const [origin, destination] = Object.values(city.places);
  const nearMouth = node(150, 0),
    farMouth = node(350, 100);
  const near = street(nearMouth, node(150, 60));
  const far = street(farMouth, node(350, 40));
  for (const r of [...near, ...far]) r.roadClass = 'service';
  if (nearClosed) near[0].access = { car: 'no' };
  const approaches = compile({ ...city, places: {} });
  if (!approaches.ok) throw new Error(JSON.stringify(approaches.diagnostics));
  const approachLanes = approaches.compiled.lanes;
  const station = (roadId: string, point: { x: number; y: number }) =>
    nearestOnPolyline(
      approachLanes[approaches.compiled.index.lane.get(`${roadId}#0`)!]!.polyline,
      point,
    ).along;
  const id = allocateId(city, 'pk');
  const farEntry = {
    id: allocateId(city, 'c'),
    roadId: detour.id,
    lane: 0,
    positionM: station(detour.id, farMouth.pos),
    direction: 'both' as const,
    throughputPerMin: 60,
  };
  const nearEntry = {
    id: allocateId(city, 'c'),
    roadId: direct.id,
    lane: 0,
    positionM: station(direct.id, nearMouth.pos),
    direction: 'both' as const,
    throughputPerMin: 60,
  };
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 20,
      access: 'customers',
      placeId: destination!.id,
      connectors: [farEntry, nearEntry],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 80, y: 8 },
          { x: 365, y: 8 },
          { x: 365, y: 92 },
          { x: 80, y: 92 },
        ],
      },
      aisles: [...near, ...far].map((r) => r.id),
      entries: [],
      occupancyAtStart: 0,
      provenance: { source: 'authored' },
      ...(mapped
        ? {
            mappedPortals: [
              {
                connectorId: farEntry.id,
                nodeId: farMouth.id,
                aisleRoadId: far[0].id,
                direction: 'in' as const,
              },
              {
                connectorId: farEntry.id,
                nodeId: farMouth.id,
                aisleRoadId: far[1].id,
                direction: 'out' as const,
              },
              {
                connectorId: nearEntry.id,
                nodeId: nearMouth.id,
                aisleRoadId: near[0].id,
                direction: 'in' as const,
              },
              {
                connectorId: nearEntry.id,
                nodeId: nearMouth.id,
                aisleRoadId: near[1].id,
                direction: 'out' as const,
              },
            ],
          }
        : {}),
    },
  };
  const publicId = allocateId(city, 'pk');
  city.parking[publicId] = {
    id: publicId,
    kind: 'garage',
    name: null,
    capacity: 100,
    access: 'public',
    placeId: null,
    shape: { kind: 'point', pos: { x: 110, y: 0 } },
    connectors: [
      {
        id: allocateId(city, 'c'),
        roadId: direct.id,
        lane: 0,
        positionM: 110,
        direction: 'both',
        throughputPerMin: 60,
      },
    ],
    provenance: { source: 'authored' },
  };
  const trip: TripRequest = {
    id: 'entry-choice',
    personId: null,
    originPlaceId: origin!.id,
    destinationPlaceId: destination!.id,
    departS: 100,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  };
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const scenario = { ...defaultScenario('grid5x5', 149), startS: 100, endS: 500 };
  return {
    city,
    compiled: result.compiled,
    scenario,
    trip,
    id,
    direct: direct.id,
    detour: detour.id,
  };
}

test.each([
  { mapped: true, nearClosed: false, direct: true },
  { mapped: false, nearClosed: false, direct: false },
  { mapped: true, nearClosed: true, direct: false },
])(
  'T63 lot entry choice preserves rank and permissions (mapped: $mapped, near closed: $nearClosed)',
  ({ mapped, nearClosed, direct }) => {
    const w = entryWorld(mapped, nearClosed),
      engine = createEngine();
    engine.load({ compiled: w.compiled, trips: [w.trip], scenario: w.scenario });
    engine.step();
    const detail = engine.inspect(1)!;
    expect(detail.parkingFacility).toBe(w.id);
    expect(detail.state).toBe('driving');
    const roads = detail.route!.roads.map((i) => w.compiled.roads[i]!.id);
    if (direct) expect(roads).toEqual([w.direct]);
    else expect(roads).toContain(w.detour);
  },
);

test('T63 a live edit releases a stable bay claim when its selected throat is cut', () => {
  const w = entryWorld(true, false),
    engine = createEngine();
  engine.load({ compiled: w.compiled, trips: [w.trip], scenario: w.scenario });
  engine.step();
  const claimed = engine.snapshot().parkingClaims!.space[0]!;
  expect(claimed).toBeGreaterThanOrEqual(0);
  const edited = structuredClone(w.city);
  edited.version++;
  edited.parking![w.id]!.exclusions = [
    [
      { x: 80, y: 8.5 },
      { x: 365, y: 8.5 },
      { x: 365, y: 9 },
      { x: 80, y: 9 },
    ],
  ];
  const next = compile(edited);
  if (!next.ok) throw new Error(JSON.stringify(next.diagnostics));
  expect(next.compiled.parkingSpaces![claimed]!.lotStall).toBe(
    w.compiled.parkingSpaces![claimed]!.lotStall,
  );
  engine.patch(next.compiled);
  expect(engine.snapshot().parkingClaims!.space[0]).toBe(-1);
  expect(engine.snapshot().parkingClaims!.facility[0]).toBe(-1);
  expect(() => engine.step(4000)).not.toThrow();
  expect(engine.inspect(1)!.state).toBe('completed');
  expect(engine.inspect(1)!.parkingFacility).toBe(w.id);
});
