import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { keepClearZones } from '../../src/network/keep-clear';
import { allocateId, type City, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { setup } from './fixtures';

// TASK-289: York pk:4462 (TASK-288's v1). A lot's entry stands just past a zebra, so a car
// waiting there covers it, and its exit joins the other carriageway just short of the same zebra.
// A car waiting at the entry because a departure's merge would cross its way held the walkers;
// waiting walkers held the zebra's span on the other carriageway; the departure's grant waited for
// that span: a cycle, with the queue behind the entry gridlocked.

const carLengthM = DEFAULT_SIM_PARAMS.vehicleClasses.car.lengthM;

function walkPlace(city: City, name: string, pos: { x: number; y: number }) {
  const id = `p:${city.nextId++}`;
  city.places[id] = {
    id,
    name,
    kind: 'other',
    shape: { kind: 'point', pos },
    population: 0,
    jobs: 0,
    attraction: 1,
    capacity: null,
    connectors: [],
    profile: null,
    events: [],
    provenance: { source: 'generated' },
  };
  return id;
}

/** A T junction with a zebra on each arm. A stocked lot north of the east arm is entered from the
 * eastbound lane 11 m in, over the zebra (6 to 8.5 m), and left onto the westbound lane 14 m short
 * of the junction, a merge that lands across that lane's span of the zebra. */
function lotByZebra() {
  const { city, node, street, place } = buildCity('Lot by a zebra', 289);
  const centre = node(0, 0);
  const [westIn, westOut] = street(node(-200, 0), centre);
  const [eastOut, eastIn] = street(centre, node(200, 0));
  street(centre, node(0, 150));
  place('Shop', 'retail', { x: 40, y: -30 }, []);
  place('West', 'gateway', { x: -210, y: 0 }, [
    { road: westIn, direction: 'out', positionM: 5 },
    { road: westOut, direction: 'in', positionM: 170 },
  ]);
  const [shop, west] = Object.values(city.places);
  for (const p of [shop!, west!]) p.population = p.jobs = 0;
  const north = walkPlace(city, 'North bank', { x: 24, y: -14 });
  const south = walkPlace(city, 'South bank', { x: 24, y: 14 });
  const id = allocateId(city, 'pk');
  const connector = (roadId: string, positionM: number, direction: 'in' | 'out') => ({
    id: allocateId(city, 'c'),
    roadId,
    lane: 0,
    positionM,
    direction,
    throughputPerMin: 60,
  });
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 8,
      access: 'public',
      placeId: shop!.id,
      connectors: [connector(eastOut.id, 11, 'in'), connector(eastIn.id, 186, 'out')],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 8, y: -8 },
          { x: 60, y: -8 },
          { x: 60, y: -40 },
          { x: 8, y: -40 },
        ],
      },
      occupancyAtStart: 0.75,
      provenance: { source: 'authored', inferred: ['driveway'] },
    },
  };
  const compiled = setup(city);
  const entryLane = compiled.index.lane.get(`${eastOut.id}#0`)!;
  const zebra = keepClearZones(compiled)[entryLane]!.find((z) => z.kind === 'crosswalk')!;
  return { compiled, shop: shop!.id, west: west!.id, north, south, entryLane, zebra };
}

const trip = (id: string, from: string, to: string, departS: number): TripRequest => ({
  id,
  personId: null,
  originPlaceId: from,
  destinationPlaceId: to,
  departS,
  mode: 'car',
  vehicleClass: 'car',
  purpose: 'private',
  legs: [],
});

/** The lot by the zebra through a morning of walkers: `leaving` cars leave it west at 110 s and
 * every 15 s, six come from the west to park from 100 s, and one more leaves at `extraS`. How
 * many steps a car waited at the entry over the zebra, the trip counts, and when the first car to
 * park entered the lot. */
function morning(leaving: number, extraS?: number) {
  const { compiled, shop, west, north, south, entryLane, zebra } = lotByZebra();
  // The stand at the entry covers the zebra.
  expect(zebra.fromM).toBeLessThan(11);
  expect(zebra.toM).toBeGreaterThan(11 - carLengthM);
  const trips = [
    trip('visit:0', west, shop, 100),
    ...Array.from({ length: 5 }, (_, i) => trip(`visit:${i + 1}`, west, shop, 115 + i * 15)),
    ...Array.from({ length: leaving }, (_, i) => trip(`leave:${i}`, shop, west, 110 + i * 15)),
    ...(extraS === undefined ? [] : [trip('leave:extra', shop, west, extraS)]),
  ];
  const engine = createEngine();
  engine.load({
    compiled,
    trips,
    scenario: {
      ...defaultScenario('grid5x5', 289),
      startS: 100,
      endS: 1900,
      simParams: { streetParkingShare: 0 },
      walkers: [
        { fromPlaceId: north, toPlaceId: south, perHour: 1200 },
        { fromPlaceId: south, toPlaceId: north, perHour: 1200 },
      ],
    },
  });
  let waitingOnZebra = 0,
    enteredS = NaN;
  for (let step = 0; step < 12000 && engine.metrics().trips.completed < trips.length; step++) {
    engine.step();
    if (Number.isNaN(enteredS) && engine.inspect(1)?.state === 'in_lot') enteredS = engine.timeS;
    for (let v = 1; v <= trips.length; v++) {
      const car = engine.inspect(v);
      if (
        car?.state === 'queued_destination' &&
        car.lane === entryLane &&
        car.positionM > zebra.fromM &&
        car.positionM - carLengthM < zebra.toM
      )
        waitingOnZebra++;
    }
  }
  return { waitingOnZebra, trips: engine.metrics().trips, count: trips.length, enteredS };
}

test('TASK-289 a car waiting at a lot entry keeps the zebra clear, and the lot drains', () => {
  const { waitingOnZebra, trips, count } = morning(6);
  expect(waitingOnZebra).toBe(0);
  expect(trips).toMatchObject({ completed: count, failed: 0 });
});

test('TASK-289 a car moving up to a lot entry over a zebra goes before a departure', () => {
  // The first car to park stands short of the zebra while five departures leave, and moves up
  // when the lot would admit it. One more departure starting as it moves up would hold it on the
  // zebra: it waits until the car has entered.
  const { enteredS } = morning(5, 5000);
  expect(enteredS).toBeGreaterThan(200);
  const { waitingOnZebra, trips, count } = morning(5, enteredS - 2);
  expect(waitingOnZebra).toBe(0);
  expect(trips).toMatchObject({ completed: count, failed: 0 });
});
