import { expect, test } from 'vitest';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { airportFixture } from './airside-fixture';
import { overlaps } from './aircraft-checks';
import { setup } from './fixtures';

// TASK-338: a taxiway drawn along a runway's pavement between two nodes that are not runway
// nodes (Heathrow's N1/N2E at the 27L end) is on that runway: an aircraft taxiing there holds it
// by a gate, as on a crossing.

test('a taxiway running along runway pavement between non-runway nodes gets a gate', () => {
  const { city, stands } = airportFixture();
  const airport = city.airport!;
  const nodeAt = (x: number, y: number) =>
    Object.values(airport.nodes).find((n) => n.pos.x === x && n.pos.y === y)!.id;
  // The only way to the 09 end: from the x = -900 hold, 10 m off the centreline for 500 m, to
  // the x = -1500 hold (the parallel taxiway west of x = -1000 is gone).
  const west = Object.values(airport.edges).find(
    (e) => e.line[0]!.x === -1500 && e.line[0]!.y === 200 && e.line.at(-1)!.x === -1000,
  )!;
  delete airport.edges[west.id];
  const line = [
    { x: -900, y: 100 },
    { x: -950, y: 10 },
    { x: -1450, y: 10 },
    { x: -1500, y: 100 },
  ];
  airport.edges['ae:pavement'] = {
    ...west,
    id: 'ae:pavement',
    from: nodeAt(-900, 100),
    to: nodeAt(-1500, 100),
    line,
    maxCode: 'E',
  };
  const graph = setup(city).airside!;
  const fleet = createAircraftFleet(graph, 1);
  const departure = fleet.spawnParked({ typeId: 'BCS3', stand: stands.E2 });
  if (!departure.ok) throw new Error(departure.reason);
  expect(fleet.requestDeparture(departure.id, '09').ok).toBe(true);

  let along = 0;
  let departed = false;
  for (let step = 0; step * 0.1 <= 1800 && !departed; step++) {
    fleet.step(step * 0.1);
    departed = fleet.drainEvents().some((e) => e.kind === 'departed');
    if (step % 10) continue;
    const snapshot = fleet.snapshot();
    expect(overlaps(snapshot)).toEqual([]);
    const pose = snapshot.find((p) => p.id === departure.id);
    // On the stretch along the pavement, well away from either runway node at its ends.
    if (
      pose &&
      pose.state !== 'takeoff-roll' &&
      Math.abs(pose.y - 10) < 2 &&
      pose.x < -1050 &&
      pose.x > -1350
    ) {
      along++;
      expect(pose.onRunway).toBe(true);
      expect(fleet.runwayOccupant(0)).toBe(departure.id);
    }
  }
  expect(along).toBeGreaterThan(10);
  expect(departed).toBe(true);
});
