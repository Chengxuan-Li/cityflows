import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { keepClearZones, MOUTH_AFTER_M, MOUTH_BEFORE_M } from '../../src/network/keep-clear';
import { allocateId, type TripRequest } from '../../src/schema';
import { keepClearMarkings } from '../../src/render/marking-geometry';
import { markingThemes } from '../../src/render/style';
import { createEngine } from '../../src/sim/engine';
import { KEEP_CLEAR_STOP_M, keepClearStand } from '../../src/sim/keep-clear';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { setup } from './fixtures';

const { lengthM } = DEFAULT_SIM_PARAMS.vehicleClasses.car;

/**
 * TASK-169: a two-way street along y = 0 with a stocked lot south of it. Its exit at x = 150 is
 * on the near (eastbound) lane, `far` adds one on the westbound lane at x = 150. A gateway on
 * the near lane at x = 175 admits one car per 20 s, so a platoon queues back across the mouth.
 */
function mouthWorld(far = false) {
  const { city, node, street, place } = buildCity('Keep clear', 169);
  const [east, west] = street(node(0, 0), node(400, 0));
  place('Shop', 'retail', { x: 160, y: 30 }, []);
  place('West start', 'gateway', { x: -10, y: 10 }, [
    { road: east!, positionM: 5, direction: 'out' },
  ]);
  place('Stop', 'gateway', { x: 175, y: 10 }, [{ road: east!, positionM: 175, direction: 'in' }]);
  place('East end', 'gateway', { x: 410, y: 10 }, [
    { road: east!, positionM: 390, direction: 'in' },
  ]);
  const [shop, westStart, stop, eastEnd] = Object.values(city.places);
  for (const p of Object.values(city.places)) p.population = p.jobs = 0;
  stop!.connectors[0]!.throughputPerMin = 3;
  const id = allocateId(city, 'pk');
  const connector = (roadId: string, positionM: number) => ({
    id: allocateId(city, 'c'),
    roadId,
    lane: 0,
    positionM,
    direction: 'both' as const,
    throughputPerMin: 60,
  });
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 10,
      access: 'public',
      placeId: shop!.id,
      connectors: [connector(east!.id, 150), ...(far ? [connector(west!.id, 250)] : [])],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 80, y: 8 },
          { x: 240, y: 8 },
          { x: 240, y: 50 },
          { x: 80, y: 50 },
        ],
      },
      occupancyAtStart: 0.1,
      provenance: { source: 'authored', inferred: ['driveway'] },
    },
  };
  const net = setup(city);
  const lane = (road: string) => net.lanes[net.index.lane.get(`${road}#0`)!]!;
  const trip = (name: string, origin: string, destination: string, departS: number) =>
    ({
      id: name,
      personId: null,
      originPlaceId: origin,
      destinationPlaceId: destination,
      departS,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'private',
      legs: [],
    }) satisfies TripRequest;
  return {
    net,
    near: lane(east!.id),
    farLane: lane(west!.id),
    platoon: Array.from({ length: 10 }, (_, i) =>
      trip(`through:${i}`, westStart!.id, stop!.id, 100 + i),
    ),
    leaving: (departS: number) => trip('leaving', shop!.id, eastEnd!.id, departS),
  };
}

const scenario = {
  ...defaultScenario('grid5x5', 169),
  startS: 100,
  endS: 1500,
  simParams: { streetParkingShare: 0 },
};

test('TASK-169 a lot exit has a mouth zone on its lane and on the lanes it crosses', () => {
  const near = mouthWorld();
  const zones = keepClearZones(near.net);
  const mouths = (lane: number) => zones[lane]!.filter((z) => z.kind === 'mouth');
  expect(mouths(near.near.idx)).toEqual([
    { lane: near.near.idx, fromM: 150 - MOUTH_BEFORE_M, toM: 150 + MOUTH_AFTER_M, kind: 'mouth' },
  ]);
  // The near exit crosses nothing: the westbound lane lies beyond its exit lane.
  expect(mouths(near.farLane.idx)).toEqual([]);
  const far = mouthWorld(true);
  const farZones = keepClearZones(far.net);
  expect(farZones[far.farLane.idx]!.filter((z) => z.kind === 'mouth')).toHaveLength(1);
  // The far exit (x = 150) crosses the near lane there, inside the near exit's own zone.
  const crossed = farZones[far.near.idx]!.filter((z) => z.kind === 'mouth');
  expect(crossed).toHaveLength(1);
  expect(crossed[0]!.fromM).toBeLessThanOrEqual(150 - MOUTH_BEFORE_M);
  // Marked crossings are zones too, one per span.
  for (const link of far.net.walk.links)
    for (const span of link.crossing?.spans ?? [])
      expect(
        farZones[span.lane]!.some(
          (z) =>
            z.kind === 'crosswalk' && Math.abs(z.fromM - Math.max(0, span.atM - span.halfM)) < 1e-9,
        ),
      ).toBe(true);
});

test('TASK-169 where a car stands to keep clear of a zone', () => {
  const zones = [
    { lane: 0, fromM: 20, toM: 22.5, kind: 'crosswalk' as const },
    { lane: 0, fromM: 40, toM: 54.5, kind: 'mouth' as const },
  ];
  // Clear of every zone, or past the last one: it keeps its stand.
  expect(keepClearStand(zones, lengthM, 35)).toBeNull();
  expect(keepClearStand(zones, lengthM, 60)).toBeNull();
  // Over the mouth: short of it.
  expect(keepClearStand(zones, lengthM, 50)).toBe(40 - KEEP_CLEAR_STOP_M);
  // Short of the mouth it would cover the crosswalk, so short of that too.
  expect(keepClearStand(zones, lengthM, 44, Infinity)).toBe(40 - KEEP_CLEAR_STOP_M);
  expect(keepClearStand(zones, lengthM, 24)).toBe(20 - KEEP_CLEAR_STOP_M);
  // At its destination in the mouth it stands where it arrives.
  expect(keepClearStand(zones, lengthM, 50, 50)).toBeNull();
  // Its rear would stand short of the lane: it keeps its stand.
  expect(keepClearStand([{ ...zones[0]!, fromM: 3, toM: 5.5 }], lengthM, 6)).toBeNull();
  // At a stop line 3 m on, it moves up past the crosswalk when its body then clears it...
  expect(keepClearStand(zones, lengthM, 25, Infinity, 28)).toBeCloseTo(22.7 + lengthM, 9);
  // ...and holds short of it when the line is too close.
  expect(keepClearStand(zones, lengthM, 25, Infinity, 26)).toBe(20 - KEEP_CLEAR_STOP_M);
});

test('TASK-169 a queue keeps the mouth clear and the lot car joins it while it stands', () => {
  const w = mouthWorld();
  const zone = keepClearZones(w.net)[w.near.idx]!.find((z) => z.kind === 'mouth')!;
  const trips = [...w.platoon, w.leaving(160)];
  const id = trips.length;
  const engine = createEngine();
  engine.load({ compiled: w.net, trips, scenario });
  let standingInZone = 0,
    joinedStandingQueue = false,
    exitS = NaN,
    grantS = NaN;
  for (let step = 0; step < 12000; step++) {
    engine.step();
    const leaving = engine.inspect(id);
    if (leaving?.parkingPhase === 'exit' && Number.isNaN(exitS)) exitS = engine.timeS;
    const standing = w.platoon.flatMap((_, i) => {
      const car = engine.inspect(i + 1);
      return car?.state === 'driving' && car.lane === w.near.idx && car.speedMps < 0.1
        ? [car.positionM]
        : [];
    });
    standingInZone += standing.filter((f) => f > zone.fromM && f - lengthM < zone.toM).length;
    if (leaving?.parkingPhase === 'merge' && Number.isNaN(grantS)) {
      grantS = engine.timeS;
      // Through cars still stand behind the mouth and beyond it: it joined a standing queue.
      joinedStandingQueue =
        standing.some((f) => f <= zone.fromM) && standing.some((f) => f - lengthM >= zone.toM);
    }
    if (leaving?.state === 'completed') break;
  }
  expect(standingInZone).toBe(0);
  expect(joinedStandingQueue).toBe(true);
  expect(grantS - exitS).toBeLessThan(5);
  expect(engine.inspect(id)!.state).toBe('completed');
  expect(engine.metrics().trips.failed).toBe(0);
});

test('TASK-169 cars waiting at a stop sign keep its zebra clear and all get through', () => {
  const { city, node, road, place } = buildCity('Keep clear stop', 169);
  const junction = node(0, 0);
  const west = road(node(-120, 0), junction, { roadClass: 'primary' });
  const north = road(node(0, -120), junction);
  const east = road(junction, node(120, 0));
  const south = road(junction, node(0, 120));
  junction.control = 'stop';
  junction.minorRoads = [north.id];
  place('North', 'gateway', { x: 10, y: -110 }, [{ road: north, direction: 'out', positionM: 5 }]);
  place('South', 'gateway', { x: 10, y: 110 }, [{ road: south, direction: 'in', positionM: 100 }]);
  place('West', 'gateway', { x: -110, y: 10 }, [{ road: west, direction: 'out', positionM: 5 }]);
  place('East', 'gateway', { x: 110, y: 10 }, [{ road: east, direction: 'in', positionM: 100 }]);
  const net = setup(city);
  const minor = net.lanes[net.index.lane.get(`${north.id}#0`)!]!;
  const zebra = keepClearZones(net)[minor.idx]!.find((z) => z.kind === 'crosswalk')!;
  expect(zebra.toM).toBeGreaterThan(minor.stopM - DEFAULT_SIM_PARAMS.idm.minGapM - lengthM);
  const [n, s, w, e] = Object.values(city.places).map((p) => p.id);
  const trip = (i: number, from: string, to: string, departS: number): TripRequest => ({
    id: `${from}:${i}`,
    personId: null,
    originPlaceId: from,
    destinationPlaceId: to,
    departS,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  });
  const trips = [
    ...Array.from({ length: 8 }, (_, i) => trip(i, n!, s!, 100 + i * 2)),
    ...Array.from({ length: 30 }, (_, i) => trip(i, w!, e!, 100 + i * 3)),
  ];
  const engine = createEngine();
  engine.load({ compiled: net, trips, scenario: { ...scenario, endS: 2000 } });
  let onZebra = 0;
  for (let step = 0; step < 6000; step++) {
    engine.step();
    for (let id = 1; id <= 8; id++) {
      const car = engine.inspect(id);
      if (car?.state === 'driving' && car.lane === minor.idx && car.speedMps < 0.1)
        onZebra += Number(car.positionM > zebra.fromM && car.positionM - lengthM < zebra.toM);
    }
  }
  expect(onZebra).toBe(0);
  expect(engine.metrics().trips.completed).toBe(trips.length);
});

test('TASK-169 keep-clear markings: a hatched box in Germany, KEEP CLEAR text in the US and UK', () => {
  const w = mouthWorld();
  const road = w.net.roads[w.near.road]!;
  const zone = keepClearZones(w.net)[w.near.idx]!.find((z) => z.kind === 'mouth')!;
  for (const theme of ['de', 'us', 'uk'] as const) {
    const shapes = keepClearMarkings(w.net, road, markingThemes[theme]);
    expect(shapes.length, theme).toBeGreaterThan(theme === 'de' ? 8 : 40);
    for (const shape of shapes) {
      expect(shape.kind).toBe('polygon');
      // Every shape lies on the lane, inside the zone (the lane runs straight east).
      for (const p of shape.points) {
        const at = p.x - w.near.polyline[0]!.x;
        expect(at - (zone.fromM - 1e-6)).toBeGreaterThanOrEqual(0);
        expect(zone.toM + 1e-6 - at).toBeGreaterThanOrEqual(0);
        expect(Math.abs(p.y - w.near.polyline[0]!.y)).toBeLessThanOrEqual(w.near.widthM / 2);
      }
    }
  }
  // Crosswalk zones draw nothing of their own: their stripes are the marking.
  const other = w.net.roads[w.farLane.road]!;
  expect(keepClearMarkings(w.net, other, markingThemes.de)).toEqual([]);
});
