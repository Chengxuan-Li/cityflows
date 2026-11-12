import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import type { TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import { sampleConflictZones } from './conflict-zone-safety';
import { scenario, setup } from './fixtures';

function ring(count = 50) {
  const { city, node, road, place } = buildCity('Box ring', 1);
  const corners = [node(0, 0), node(80, 0), node(80, 80), node(0, 80)];
  corners.forEach((corner, i) => road(corner, corners[(i + 1) % 4]!));
  const origins: string[] = [],
    destinations: string[] = [];
  for (const [i, corner] of corners.entries()) {
    const dx = (corner.pos.x - 40) * 3,
      dy = (corner.pos.y - 40) * 3;
    const feeder = road(node(corner.pos.x + dx, corner.pos.y + dy), corner);
    const exit = road(corner, node(corner.pos.x - dy, corner.pos.y + dx));
    place(`Origin ${i}`, 'gateway', corner.pos, [{ road: feeder, direction: 'out', positionM: 5 }]);
    origins.push(Object.values(city.places).at(-1)!.id);
    place(`Exit ${i}`, 'gateway', corner.pos, [{ road: exit, direction: 'in', positionM: 80 }]);
    destinations.push(Object.values(city.places).at(-1)!.id);
  }
  const requests: TripRequest[] = origins.flatMap((originPlaceId, i) =>
    Array.from({ length: count }, (_, j) => ({
      id: `${i}:${j}`,
      personId: null,
      originPlaceId,
      destinationPlaceId: destinations[(i + 2) % 4]!,
      departS: 100 + j * 0.5,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'private',
      legs: [],
    })),
  );
  const compiled = setup(city),
    engine = createEngine();
  engine.load({
    compiled,
    trips: requests,
    scenario: scenario(),
    params: {
      gridlock: { respawnS: 1e6, fadeS: 5, maxRespawns: 3 },
      maxReplans: 0,
    },
  });
  return { engine, compiled, requests };
}

test('T66: a loaded four-junction ring drains within ten minutes without recovery', () => {
  const { engine, compiled, requests } = ring();
  for (let i = 0; i < 6000; i++) {
    engine.step();
    sampleConflictZones(engine, compiled);
  }
  expect(engine.metrics().trips.completed).toBe(requests.length);
  expect(engine.metrics().respawns).toBe(0);
});

test('T66: uncongested arrivals retain main times and order', () => {
  const { engine, requests } = ring(1);
  const arrived: number[] = [],
    times: number[] = [];
  for (let i = 0; i < 2000; i++) {
    engine.step();
    for (let id = 1; id <= requests.length; id++) {
      const detail = engine.inspect(id);
      if (detail?.state === 'completed' && !arrived.includes(id)) {
        arrived.push(id);
        times.push(detail.arrivedS!);
      }
    }
  }
  expect(arrived).toEqual([2, 3, 4, 1]);
  expect(times).toEqual([144.1, 144.2, 144.7, 144.9]);
});

test('T66: the ring is deterministic for the same seed', () => {
  const a = ring(10),
    b = ring(10);
  for (let i = 0; i < 2000; i++) {
    a.engine.step();
    b.engine.step();
    if (i % 100 === 0) expect(a.engine.stateHash()).toBe(b.engine.stateHash());
  }
});
