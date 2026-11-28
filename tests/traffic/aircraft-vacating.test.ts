import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compileAirside } from '../../src/network/airside';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { createFlightOperations } from '../../src/sim/flight-operations';
import { overlaps, runwayConflictCheck } from '../sim/aircraft-checks';
import { limit } from '../timeouts';

test(
  'an arrival can clear 27L even when the Heathrow exit queue fills up',
  { timeout: limit(180_000) },
  async () => {
    const { city } = await openBundled('heathrow');
    const graph = compileAirside(city.airport!, city, {
      roads: [],
      lanes: [],
      movements: [],
      index: {
        node: new Map(),
        road: new Map(),
        lane: new Map(),
        movement: new Map(),
        place: new Map(),
        connector: new Map(),
        parking: new Map(),
      },
    });
    const previous = process.env.T377;
    process.env.T377 = '1';
    const fleet = createAircraftFleet(graph, 5);
    if (previous === undefined) delete process.env.T377;
    else process.env.T377 = previous;
    const startS = 6 * 3600;
    const endS = 7 * 3600 + 10 * 60;
    const operations = createFlightOperations(fleet, 5, startS);
    const conflicts = runwayConflictCheck(graph);
    for (let step = startS * 10; step < endS * 10; step++) {
      const timeS = step / 10;
      operations.step(timeS);
      fleet.step(timeS);
      if (step % 10 === 0 && timeS >= 7 * 3600) {
        const poses = fleet.snapshot();
        expect(overlaps(poses), `body overlap at ${timeS} s`).toEqual([]);
        expect(conflicts(poses), `runway conflict at ${timeS} s`).toBe(0);
      }
    }
    expect(fleet.metrics().landed).toBeGreaterThanOrEqual(20);
    expect(fleet.arrivalCauses().tailOnRunway).toEqual({ s: 0, ids: [] });
  },
);
