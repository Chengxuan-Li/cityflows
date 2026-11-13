import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile } from '../../src/network';
import type { TripRequest } from '../../src/schema';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createParking } from '../../src/sim/parking';
import { createVehicles } from '../../src/sim/vehicle';

/** One car parked in every bay of `lot`, each leaving on a trip of its own. */
function stocked(name: string, lot: string) {
  const xml = readFileSync(`fixtures/osm/${name}.osm`, 'utf8');
  const imported = importOsmCached(xml, { importerVersion: '1', context: false, terrain: false });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const { city } = imported;
  city.parking![lot]!.occupancyAtStart = 1;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const net = result.compiled;
  const f = net.parking[net.index.parking.get(lot)!]!;
  const origin = city.parking![lot]!.placeId!;
  const destination = Object.keys(city.places).find((id) => id !== origin)!;
  const trips = f.spaces!.map((_, i): TripRequest => ({
    id: `leave:${i}`,
    personId: null,
    originPlaceId: origin,
    destinationPlaceId: destination,
    departS: 8 * 3600 + i,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  }));
  const vehicles = createVehicles(trips.length, net.lanes.length, net.movements.length);
  const parking = createParking(
    net,
    trips,
    { ...defaultScenario('grid5x5', 1), startS: 8 * 3600 },
    { ...DEFAULT_SIM_PARAMS, streetParkingShare: 0 },
    vehicles,
  );
  const id = (connector: number) => net.connectors[connector]!.id;
  return trips.map((_, car) => {
    const space = net.parkingSpaces![parking.location(car, true).space]!;
    const exits = parking.exits(car, []);
    return {
      bay: space.lotStall!,
      departure: space.departure,
      exits: exits.map((c) => (c === space.departure ? 'departure' : id(c))),
      shares: exits.map((c) => parking.exitShare(car, c)),
    };
  });
}

test('TASK-164 Munich pk:2056: a bay whose departure reaches the west exits keeps mapped exit c:10872, each exit with its share', () => {
  const bays = stocked('munich-donnersberger', 'pk:2056');
  expect(bays.length).toBe(6);
  for (const bay of bays) {
    // The departure drives past c:9409 and c:10871 (one share each); c:10872 onto r:669 lies
    // beyond a dead-end aisle lane, so it stays a lot exit.
    expect(bay.departure, `bay ${bay.bay}`).toBeDefined();
    expect(bay.exits).toEqual(['departure', 'c:10872']);
    expect(bay.shares).toEqual([60, 30]);
  }
});

test('TASK-164 Sindelfingen pk:1487: an exit whose hold stands in an aisle lane is offered only when no other exit is', () => {
  const bays = stocked('sindelfingen-a81', 'pk:1487');
  expect(bays.length).toBeGreaterThan(60);
  // c:2640's hold lands in an interior junction of the aisles (r:1515, r:1516, r:1518, r:1520);
  // every bay has a street exit whose hold is clear.
  for (const bay of bays) {
    expect(bay.exits.length, `bay ${bay.bay}`).toBeGreaterThan(0);
    expect(bay.exits, `bay ${bay.bay}`).not.toContain('c:2640');
  }
});
