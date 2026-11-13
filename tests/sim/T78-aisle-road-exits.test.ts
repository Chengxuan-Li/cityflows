import { expect, test } from 'vitest';
import { buildCity, generated } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { angleDelta } from '../../src/sim/manoeuvre';
import { headingAtDistance } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { allocateId, type City, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';

type Pose = { x: number; y: number; heading: number };

/** SAT on two 4.5 x 1.8 m car bodies, each given by its front bumper. */
function overlap(a: Pose, b: Pose) {
  const corners = (p: Pose) =>
    [
      [-4.5, -0.9],
      [0, -0.9],
      [0, 0.9],
      [-4.5, 0.9],
    ].map(([x, y]) => ({
      x: p.x + x! * Math.cos(p.heading) - y! * Math.sin(p.heading),
      y: p.y + x! * Math.sin(p.heading) + y! * Math.cos(p.heading),
    }));
  return ![a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2].some((h) => {
    const project = (p: { x: number; y: number }) => p.x * Math.cos(h) + p.y * Math.sin(h),
      aa = corners(a).map(project),
      bb = corners(b).map(project);
    return Math.max(...aa) <= Math.min(...bb) + 1e-4 || Math.max(...bb) <= Math.min(...aa) + 1e-4;
  });
}

/**
 * A one-way loop with a parking aisle road across it, joined at real junctions m (top) and n
 * (bottom), and one stocked lot along the aisle. Through traffic drives the aisle: it is the
 * short way from the loop's west side to its east side. In `dead-end` the two-way aisle's
 * southbound lane has no legal movement at n, and the lot holds only its west row, beside it.
 */
function aisleWorld(aisle: 'two-way' | 'one-way' | 'dead-end') {
  const { city, node, road, street, place } = buildCity('Aisle road exits', 152);
  const a = node(0, 0),
    m = node(200, 0),
    b = node(400, 0),
    c = node(400, 120),
    n = node(200, 120),
    d = node(0, 120);
  const west = road(a, m),
    east = road(m, b);
  road(b, c);
  const south = road(c, n),
    southWest = road(n, d);
  const left = road(d, a);
  const aisles = aisle === 'one-way' ? [road(n, m)] : street(m, n);
  for (const r of aisles) r.roadClass = 'service';
  if (aisle === 'dead-end')
    n.turnRules = [southWest, aisles[1]!].map((to) => ({
      from: aisles[0]!.id,
      to: to.id,
      allowed: false,
      provenance: generated,
    }));
  place('Shop', 'retail', { x: 240, y: 60 }, []);
  place('West out', 'gateway', { x: 0, y: -10 }, [{ road: west, positionM: 20, direction: 'out' }]);
  place('South out', 'gateway', { x: 400, y: 130 }, [
    { road: south, positionM: 20, direction: 'out' },
  ]);
  place('Bottom in', 'gateway', { x: 100, y: 130 }, [
    { road: southWest, positionM: 5, direction: 'in' },
  ]);
  place('East in', 'gateway', { x: 380, y: -10 }, [{ road: east, positionM: 5, direction: 'in' }]);
  place('Home in', 'gateway', { x: -10, y: 60 }, [{ road: left, positionM: 60, direction: 'in' }]);
  const [shop, westOut, southOut, bottomIn, eastIn, homeIn] = Object.values(city.places);
  for (const p of Object.values(city.places)) p.population = p.jobs = 0;
  // The aisle traffic's destinations admit one car per 20 s just past the aisle, so queues
  // stand back along both aisle lanes, across the bays, while the lot car wants to leave.
  bottomIn!.connectors[0]!.throughputPerMin = eastIn!.connectors[0]!.throughputPerMin = 3;
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 0,
      access: 'public',
      placeId: shop!.id,
      connectors: [],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 185, y: 10 },
          { x: aisle === 'dead-end' ? 199 : 215, y: 10 },
          { x: aisle === 'dead-end' ? 199 : 215, y: 110 },
          { x: 185, y: 110 },
        ],
      },
      aisles: aisles.map((r) => r.id),
      entries: [m.id, n.id],
      occupancyAtStart: 0,
      provenance: { source: 'authored' },
    },
  };
  const trip = (
    name: string,
    origin: string,
    destination: string,
    departS: number,
  ): TripRequest => ({
    id: name,
    personId: null,
    originPlaceId: origin,
    destinationPlaceId: destination,
    departS,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  });
  // Platoons along each aisle lane, queueing there when the lot car's departure comes at 160 s.
  const platoon = [
    ...Array.from({ length: 12 }, (_, i) =>
      trip(`south:${i}`, westOut!.id, bottomIn!.id, 100 + i * 3),
    ),
    ...Array.from({ length: 12 }, (_, i) =>
      trip(`north:${i}`, southOut!.id, eastIn!.id, 100 + i * 3),
    ),
  ];
  const leaving = trip('leaving', shop!.id, homeIn!.id, 160);
  return { city, id, platoon, leaving };
}

function compiledWithOneCar(city: City, id: string) {
  const first = compile(city);
  if (!first.ok) throw new Error(JSON.stringify(first.diagnostics));
  const capacity = first.compiled.parking[first.compiled.index.parking.get(id)!]!.capacity;
  city.parking![id]!.occupancyAtStart = 1 / capacity;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

test.each(['two-way', 'one-way', 'dead-end'] as const)(
  'T78 a bay beside a %s aisle road takes its gap, leaves into the aisle lane in its legal direction and finishes',
  (aisle) => {
    const w = aisleWorld(aisle);
    const net = compiledWithOneCar(w.city, w.id);
    const lot = net.parking[net.index.parking.get(w.id)!]!;
    // Every bay of this lot lines the aisle road, so each leaves into it.
    expect(lot.spaces!.length).toBeGreaterThan(20);
    expect(lot.spaces!.every((i) => net.parkingSpaces![i]!.departure !== undefined)).toBe(true);
    const aisleLanes = new Set(
      w.city.parking![w.id]!.aisles!.map((r) => net.lanes[net.index.lane.get(`${r}#0`)!]!.idx),
    );
    const scenario = {
      ...defaultScenario('grid5x5', 152),
      startS: 100,
      endS: 1200,
      simParams: { streetParkingShare: 0 },
    };
    const trips = [...w.platoon, w.leaving];
    const engine = createEngine();
    engine.load({ compiled: net, trips, scenario });
    const id = trips.length; // engine ids are 1-based
    const { lengthM } = DEFAULT_SIM_PARAMS.vehicleClasses.car;
    const spacing =
      lengthM + Math.max(DEFAULT_SIM_PARAMS.spawnMinGapM, DEFAULT_SIM_PARAMS.idm.minGapM);
    // The lot's one stocked car is the leaving trip's car.
    const stock = engine.snapshot().parkedCars!;
    const space = lot.spaces!.find((i) => (stock.occupied[i >> 3]! >> (i & 7)) & 1)!;
    const c = net.connectors[net.parkingSpaces![space]!.departure!]!;
    let waited = 0,
      leaveSteps = 0,
      lastStation = -Infinity,
      onDeparture = false;
    const phases = new Set<string>();
    for (let step = 0; step < 11000; step++) {
      engine.step();
      const detail = engine.inspect(id);
      if (!detail) continue;
      if (detail.parkingPhase) phases.add(detail.parkingPhase);
      if (detail.parkingSpace != null) expect(detail.parkingSpace).toBe(space);
      const others = Array.from({ length: w.platoon.length }, (_, i) => engine.inspect(i + 1));
      const near = (lane: number, station: number) =>
        others.some(
          (o) =>
            o?.state === 'driving' && o.lane === lane && Math.abs(o.positionM - station) < spacing,
        );
      // Still in its bay after its departure time while an aisle car stands in its gap: waiting.
      if (detail.state === 'queued_origin' && engine.timeS > 160 && near(c.lane, c.positionM))
        waited++;
      if (detail.parkingPhase === 'leave') {
        // The gap was taken before the body left the bay: from the first leave step it is a
        // lane occupant at its own station, and no other car is within the spawn spacing there.
        if (!leaveSteps) expect(near(c.lane, c.positionM), `gap at ${engine.timeS}`).toBe(false);
        leaveSteps++;
        expect([detail.state, detail.lane, detail.positionM]).toEqual([
          'driving',
          c.lane,
          c.positionM,
        ]);
      }
      const s = engine.snapshot();
      const at = [...s.id].indexOf(id);
      if (at !== -1) {
        const pose = { x: s.x[at]!, y: s.y[at]!, heading: s.heading[at]! };
        for (let i = 0; i < s.count; i++)
          if (s.id[i] !== id)
            expect(
              overlap(pose, { x: s.x[i]!, y: s.y[i]!, heading: s.heading[i]! }),
              `overlaps ${s.id[i]} at ${engine.timeS}`,
            ).toBe(false);
      }
      // On the aisle lane it only ever moves forward, in the lane's own direction.
      if (detail.state === 'driving' && detail.lane === c.lane && !detail.parkingPhase) {
        expect(detail.positionM).toBeGreaterThanOrEqual(lastStation - 1e-9);
        if (!onDeparture && at !== -1) {
          const lane = net.lanes[c.lane]!;
          expect(
            Math.abs(
              angleDelta(
                s.heading[at]!,
                headingAtDistance(lane.polyline, lane.cumulative, detail.positionM),
              ),
            ),
          ).toBeLessThan(1e-6);
        }
        onDeparture = true;
        lastStation = detail.positionM;
      }
      if (detail.state === 'completed' || detail.state === 'failed') break;
    }
    expect(aisleLanes.has(c.lane)).toBe(true);
    // The bay's own lane, unless it leads nowhere: then the other lane of the same aisle.
    expect(c.lane === net.parkingSpaces![space]!.lane).toBe(aisle !== 'dead-end');
    expect(c.direction).toBe('out');
    if (aisle === 'one-way') expect(aisleLanes.size).toBe(1);
    expect(waited).toBeGreaterThan(0);
    expect(leaveSteps).toBeGreaterThan(30);
    expect(onDeparture).toBe(true);
    // It never drove out through the lot as an off-lane motion.
    expect([...phases]).toEqual(['leave']);
    expect(engine.inspect(id)!.state).toBe('completed');
    expect(engine.metrics().trips.failed).toBe(0);
  },
);
