import { signalApproach } from '../../src/fixtures/signal-approach';
import { allocateId, type City, type TripRequest } from '../../src/schema';
import { createIntersections } from '../../src/sim/intersection';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { setup } from './fixtures';

export function opposing(params = DEFAULT_SIM_PARAMS) {
  const city = signalApproach();
  // Four-lane arms leave room after crossing the opposing median lane for rear clearance.
  for (const road of Object.values(city.roads)) {
    road.lanes.push({ ...road.lanes[0]! }, { ...road.lanes[0]! });
    road.lateralOffsetM = 6;
  }
  const compiled = setup(city);
  const left = compiled.movements.find((m) => m.turn === 'left')!;
  const through = compiled.movements.find(
    (m) => m.turn === 'through' && left.conflicts.includes(m.idx) && m.toLane !== left.toLane,
  )!;
  compiled.nodes[left.node]!.control = 'uncontrolled';
  compiled.nodes[left.node]!.signal = null;
  const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
  const intersections = createIntersections(compiled, vehicles, params);
  for (const [id, path] of [left, through, left].entries()) {
    vehicles.state[id] = DRIVING;
    vehicles.movement[id] = path.idx;
    vehicles.insert(
      id,
      path.fromLane,
      compiled.lanes[path.fromLane]!.lengthM - (id === 2 ? 20 : 2),
    );
  }
  const request = (id: number) => {
    intersections.request(id, compiled.movements[vehicles.movement[id]!]!);
    intersections.resolve();
  };
  return { city, compiled, left, through, vehicles, intersections, request };
}

// Demand on every legal movement, including junctions in disconnected fixture components.
export function movementTrips(city: City): TripRequest[] {
  const compiled = setup(city);
  const places = compiled.lanes.map((lane) => {
    const id = allocateId(city, 'p');
    city.places[id] = {
      id,
      name: lane.id,
      kind: 'gateway',
      shape: { kind: 'point', pos: lane.polyline[0]! },
      population: 0,
      jobs: 0,
      attraction: 1,
      capacity: null,
      profile: null,
      events: [],
      provenance: { source: 'generated' },
      connectors: ['out', 'in'].map((direction) => ({
        id: allocateId(city, 'c'),
        roadId: compiled.roads[lane.road]!.id,
        lane: lane.lane,
        positionM:
          direction === 'out' ? Math.max(5, lane.lengthM - 40) : Math.min(30, lane.lengthM - 5),
        direction: direction as 'in' | 'out',
        throughputPerMin: 120,
      })),
    };
    return id;
  });
  return compiled.movements
    .filter((m) => !m.neverGreen)
    .flatMap((path) =>
      Array.from({ length: 4 }, (_, i) => ({
        id: `${path.id}:${i}`,
        personId: null,
        originPlaceId: places[path.fromLane]!,
        destinationPlaceId: places[path.toLane]!,
        departS: 100 + i * 3,
        mode: 'car' as const,
        legs: [],
      })),
    );
}
