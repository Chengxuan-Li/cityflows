import { expect, test } from 'vitest';
import { compile } from '../../src/network';
import { transitNetwork, SAME_STOP_TRANSFER_S } from '../../src/routing/transit';
import { transitTown, townPlace } from './transit-town';

// TASK-174: walk to a stop, wait, ride, transfer if needed, walk on, on the time-expanded graph.
function network() {
  const city = transitTown();
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return { city, network: transitNetwork(result.compiled)! };
}

const weights = { ride: 1, wait: 1, transferS: 300 };

test('T80 stops are the timetable’s tram stops, reached from the walk network', () => {
  const { network: net } = network();
  expect(net.stops.map((s) => s.id)).toEqual([
    'ts:A0',
    'ts:A1',
    'ts:A2',
    'ts:A3',
    'ts:B0',
    'ts:B1',
    'ts:B2',
  ]);
  for (const stop of net.stops) {
    expect(stop.kind).toBe('tram');
    expect(stop.access).toHaveLength(1);
    expect(stop.access[0]!.platformM).toBeLessThan(20);
  }
  // Both directions of both lines, each calling at its line's stops in order.
  expect(net.lines.map((l) => l.visits.map((v) => net.stops[v.stop]!.id))).toEqual([
    ['ts:A0', 'ts:A1', 'ts:A2', 'ts:A3'],
    ['ts:A3', 'ts:A2', 'ts:A1', 'ts:A0'],
    ['ts:B0', 'ts:B1', 'ts:B2'],
    ['ts:B2', 'ts:B1', 'ts:B0'],
  ]);
});

test('T80 a rider walks to the stop, waits for the next run and rides to the stop nearest the destination', () => {
  const { city, network: net } = network();
  const from = net.placeAccess(townPlace(city, 'West Park').id),
    to = net.placeAccess(townPlace(city, 'Orchard').id);
  const departS = 8 * 3600;
  const plan = net.route({ departS, accessS: from.walkS, egressS: to.walkS }, weights)!;
  expect(plan.rides).toHaveLength(1);
  const [ride] = plan.rides;
  expect(net.stops[ride!.fromStop]!.id).toBe('ts:A0');
  expect(net.stops[ride!.toStop]!.id).toBe('ts:A2');
  expect(plan.accessS).toBe(from.walkS[0]);
  expect(plan.egressS).toBe(to.walkS[2]);
  // The first eastbound departure from West Park after walking there.
  expect(ride!.boardS).toBeGreaterThanOrEqual(departS + plan.accessS);
  const table = net.table,
    route = table.routes[ride!.route]!;
  const boards = table.departures
    .filter((d) => d.route === ride!.route)
    .flatMap((d) =>
      [-1, 0, 1, 2, 20, 21].map(
        (k) =>
          d.timeS +
          k * table.periodS +
          route.stops.find((s) => s.platform === 'ts:A0')!.arrivalS +
          25,
      ),
    )
    .filter((t) => t >= departS + plan.accessS);
  expect(ride!.boardS).toBeCloseTo(Math.min(...boards), 6);
  expect(plan.waitS).toBeCloseTo(ride!.boardS - departS - plan.accessS, 6);
  expect(plan.arriveS).toBeCloseTo(ride!.alightS + plan.egressS, 6);
  expect(plan.costS).toBeCloseTo(plan.accessS + plan.waitS + plan.rideS + plan.egressS, 6);
  // Leaving later catches a later run.
  const later = net.route(
    { departS: ride!.boardS - plan.accessS + 1, accessS: from.walkS, egressS: to.walkS },
    weights,
  )!;
  expect(later.rides[0]!.boardS).toBeGreaterThan(ride!.boardS);
  expect(later.rides[0]!.boardS - ride!.boardS).toBeLessThanOrEqual(table.periodS);
});

test('T80 transfers: a cheap transfer changes to line B, a dear one walks the rest instead', () => {
  const { city, network: net } = network();
  const from = net.placeAccess(townPlace(city, 'West Park').id),
    to = net.placeAccess(townPlace(city, 'Foundry').id);
  const query = { departS: 8 * 3600, accessS: from.walkS, egressS: to.walkS };
  const transfer = net.route(query, { ...weights, transferS: 0 })!;
  expect(transfer.rides.map((r) => [net.stops[r.fromStop]!.id, net.stops[r.toStop]!.id])).toEqual([
    ['ts:A0', 'ts:A3'],
    ['ts:B0', 'ts:B2'],
  ]);
  const walkToB = net.transfers[transfer.rides[0]!.toStop]!.find(
    (t) => t.stop === transfer.rides[1]!.fromStop,
  )!.walkS;
  expect(transfer.transferWalksS).toEqual([walkToB]);
  expect(transfer.rides[1]!.boardS).toBeGreaterThanOrEqual(transfer.rides[0]!.alightS + walkToB);
  expect(transfer.waitS).toBeGreaterThanOrEqual(0);
  const direct = net.route(query, { ...weights, transferS: 3600 })!;
  expect(direct.rides).toHaveLength(1);
  expect(direct.costS).toBeLessThan(transfer.costS + 3600);
  // A transfer at the same stop needs time to alight first.
  expect(SAME_STOP_TRANSFER_S).toBeGreaterThan(0);
});

test('T80 no stop within reach, no transit; the same city gives the same plans', () => {
  const { city, network: net } = network();
  const none = new Float64Array(net.stops.length).fill(Infinity);
  const to = net.placeAccess(townPlace(city, 'Orchard').id);
  expect(net.route({ departS: 8 * 3600, accessS: none, egressS: to.walkS }, weights)).toBeNull();
  const again = network();
  for (const name of ['Orchard', 'Market Offices', 'Foundry']) {
    const query = (n: typeof net, c: typeof city) => ({
      departS: 7.5 * 3600,
      accessS: n.placeAccess(townPlace(c, 'West Park').id).walkS,
      egressS: n.placeAccess(townPlace(c, name).id).walkS,
    });
    expect(again.network.route(query(again.network, again.city), weights)).toEqual(
      net.route(query(net, city), weights),
    );
  }
});
