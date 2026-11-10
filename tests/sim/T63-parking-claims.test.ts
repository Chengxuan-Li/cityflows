import { expect, test } from 'vitest';
import { compile } from '../../src/network';
import { createParking } from '../../src/sim/parking';
import { createAccounting } from '../../src/sim/metrics';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { parkingWorld } from '../parking-world';

function world(kind: 'roadside' | 'garage' | 'lot' = 'roadside') {
  const w = parkingWorld(kind === 'garage' ? 'lot' : kind);
  const source = w.city.parking![w.id]!;
  if (kind === 'roadside') {
    source.capacity = 1;
    source.strip!.toM = source.strip!.fromM + 5.5;
  } else if (kind === 'garage') {
    source.kind = 'garage';
    source.capacity = 2;
  } else source.capacity = 2;
  const result = compile(w.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compiled = result.compiled;
  const target = compiled.parking[compiled.index.parking.get(w.id)!]!;
  if (kind === 'lot') target.occupancyAtStart = (target.capacity - 2) / target.capacity;
  const requests = [w.trip('a'), w.trip('b'), w.trip('c')];
  const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
  const parking = createParking(compiled, requests, w.scenario, DEFAULT_SIM_PARAMS, vehicles);
  const accounting = createAccounting(compiled, vehicles, parking, () => 105);
  const facility = compiled.parking[compiled.index.parking.get(w.id)!]!;
  const choices = new Int32Array(3).fill(-1);
  function choose(id: number, timeS = 100, departure = false) {
    return parking.choose(
      id,
      timeS,
      (c) => {
        choices[id] = c;
        vehicles.destination[id] = c;
        return true;
      },
      departure,
    );
  }
  return { ...w, compiled, vehicles, parking, accounting, facility, choices, choose };
}

test('T63 one strip space is claimed at choice; overflow chooses elsewhere without rejection', () => {
  const w = world();
  expect(w.facility.spaces).toHaveLength(1);
  for (let id = 0; id < 3; id++) expect(w.choose(id)).toBe(true);
  expect(w.compiled.connectors[w.choices[0]!]!.parking).toBe(w.facility.idx);
  for (const id of [1, 2])
    expect(w.compiled.connectors[w.choices[id]!]!.parking).not.toBe(w.facility.idx);
  const slot = w.facility.spaces![0]!;
  expect(w.parking.detail(0, 101).parkingSpace).toBe(slot);
  expect(w.parking.full(w.choices[0]!, 0)).toBe(false);
  expect(w.parking.full(w.choices[0]!, 1)).toBe(true);
  expect(w.parking.metrics(0).claims!.entryRejections).toBe(0);
  w.parking.arrive(0, w.choices[0]!, 110);
  expect(w.parking.metrics(0).claims!.active).toBe(0);
});

test.each(['garage', 'lot'] as const)('T63 %s excludes occupied plus claims', (kind) => {
  const w = world(kind);
  // Restrict the choice callback to this facility so a failed choice cannot mask exclusion.
  const choose = (id: number) =>
    w.parking.choose(id, 100, (c) => w.compiled.connectors[c]!.parking === w.facility.idx);
  expect(w.facility.capacity - w.parking.snapshot()[w.facility.idx]!).toBe(2);
  expect(choose(0)).toBe(true);
  expect(choose(1)).toBe(true);
  expect(choose(2)).toBe(false);
});

test.each(['gridlocked', 'no_parking', 'respawn'] as const)(
  'T63 %s releases strip and facility claims through shared trip accounting',
  (reason) => {
    for (const kind of ['roadside', 'garage', 'lot'] as const) {
      const w = world(kind);
      const choose = (id: number) =>
        w.parking.choose(id, 100, (c) => {
          w.choices[id] = c;
          w.vehicles.destination[id] = c;
          return w.compiled.connectors[c]!.parking === w.facility.idx;
        });
      expect(choose(0)).toBe(true);
      w.accounting.transition(0, DRIVING);
      if (reason === 'respawn') w.accounting.respawn(0);
      else w.accounting.fail(0, reason);
      expect(w.parking.metrics(0).claims!.active).toBe(0);
      if (kind === 'roadside') expect(w.parking.metrics(0, 105).claims!.stripHeld.maxS).toBe(5);
      w.parking.assertClaims();
      expect(choose(1)).toBe(true);
      expect(w.compiled.connectors[w.choices[1]!]!.parking).toBe(w.facility.idx);
    }
  },
);

test('T63 choosing again drops the old claim even when no new route works', () => {
  const w = world();
  w.choose(0);
  expect(w.parking.choose(0, 101, () => false)).toBe(false);
  expect(w.parking.metrics(0).claims!.active).toBe(0);
  expect(w.choose(1)).toBe(true);
  expect(w.compiled.connectors[w.choices[1]!]!.parking).toBe(w.facility.idx);
});

test('T63 a gridlocked lot customer returns its last capacity unit to the choice', () => {
  const w = world('lot');
  const only = (c: number) => w.compiled.connectors[c]!.parking === w.facility.idx;
  expect(w.parking.choose(0, 100, only)).toBe(true);
  expect(w.parking.choose(1, 100, only)).toBe(true);
  w.accounting.transition(0, DRIVING);
  w.accounting.fail(0, 'gridlocked');
  expect(w.parking.choose(2, 101, only)).toBe(true);
});

test('T63 a repeat choice retains only one claim; entry rejection frees it immediately', () => {
  const w = world();
  w.choose(0);
  w.choose(0, 101);
  expect(w.parking.metrics(0).claims!.active).toBe(1);
  w.parking.reject(0, 102);
  expect(w.parking.metrics(0).claims!.active).toBe(0);
  expect(w.parking.metrics(0).claims!.entryRejections).toBe(1);
  expect(w.choose(1)).toBe(true);
  expect(w.compiled.connectors[w.choices[1]!]!.parking).toBe(w.facility.idx);
});

test('T63 soft inferred garages never fill and do not count claims', () => {
  const w = world('garage');
  const soft = w.compiled.parking.find((f) =>
    f.source.provenance.inferred?.includes('implicitGarage'),
  )!;
  soft.capacity = 0;
  for (let id = 0; id < 3; id++)
    expect(w.parking.choose(id, 100, (c) => w.compiled.connectors[c]!.parking === soft.idx)).toBe(
      true,
    );
  expect(w.parking.metrics(0).claims!.active).toBe(0);
});

test('T63 full-facility departure forecast makes no claim', () => {
  const w = world('garage');
  const only = (c: number) => w.compiled.connectors[c]!.parking === w.facility.idx;
  expect(w.parking.choose(0, 100, only)).toBe(true);
  expect(w.parking.choose(1, 100, only)).toBe(true);
  expect(w.parking.choose(2, 100, only, true)).toBe(true);
  expect(w.parking.metrics(0).claims!.active).toBe(2);
});

test('T63 an edit removes a claimed strip; an unrelated edit keeps it', () => {
  const w = world();
  w.choose(0);
  w.parking.patch(w.compiled);
  expect(w.parking.detail(0, 101).parkingSpace).toBe(w.facility.spaces![0]);
  delete w.city.parking![w.id];
  const next = compile(w.city);
  if (!next.ok) throw new Error('compile');
  w.parking.patch(next.compiled);
  expect(w.parking.metrics(0).claims!.active).toBe(0);
  expect(w.parking.detail(0, 102).parkingSpace).toBe(null);
  w.parking.assertClaims();
});

test('T63 claims hash deterministically and round trip through their snapshot', () => {
  const a = world(),
    b = world();
  const initial = a.parking.stateHash();
  a.choose(0);
  b.choose(0);
  expect(a.parking.stateHash()).not.toBe(initial);
  expect(a.parking.stateHash()).toBe(b.parking.stateHash());
  const saved = structuredClone(a.parking.claimSnapshot());
  const loaded = world();
  loaded.parking.restoreClaims(saved);
  expect(loaded.parking.stateHash()).toBe(a.parking.stateHash());
  expect(loaded.parking.detail(0, 101).parkingSpace).toBe(a.parking.detail(0, 101).parkingSpace);
  expect(loaded.parking.full(a.choices[0]!, 1)).toBe(true);
});

test('T63 engine snapshots and inspectors expose a claim before the manoeuvre and release on parking', () => {
  const w = world();
  const engine = createEngine();
  engine.load({
    compiled: w.compiled,
    trips: [w.trip('arrival')],
    scenario: w.scenario,
    debugParkingClaims: true,
  });
  while (engine.timeS < 300 && engine.inspect(1)?.state !== 'driving') engine.step();
  const saved = structuredClone(engine.snapshot().parkingClaims!);
  expect(saved.facility[0]).toBe(w.facility.idx);
  expect(saved.space[0]).toBe(w.facility.spaces![0]);
  expect(engine.inspect(1)?.parkingSpace).toBe(saved.space[0]);
  expect(engine.inspect(1)?.parkingPhase).toBe(null);
  engine.step(3000);
  expect(engine.inspect(1)?.state).toBe('completed');
  expect(engine.metrics().parking.claims!.active).toBe(0);
  expect(saved.facility[0]).toBe(w.facility.idx);
  expect(engine.snapshot().parkingClaims!.facility[0]).toBe(-1);
});

test('T63 strip empty-held times include completed claims and censored active claims', () => {
  const w = world();
  w.choose(0, 100);
  w.parking.release(0, 110);
  w.choose(1, 120);
  expect(w.parking.metrics(0, 130).claims!.stripHeld).toMatchObject({
    count: 2,
    totalS: 20,
    meanS: 10,
    p50S: 10,
    maxS: 10,
  });
});
