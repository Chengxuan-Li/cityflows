import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createEngine } from '../../src/sim/engine';
import { createIntersections } from '../../src/sim/intersection';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { createVehicles, DRIVING } from '../../src/sim/vehicle';
import { signalProgramSchema } from '../../src/schema';
import { addSignal } from '../../src/importers/osm/controls';
import { scenario, setup, trips } from './fixtures';

function signal(side: 'right' | 'left', enabled = true) {
  const { city, node, road, place } = buildCity('Turn on red', 1);
  city.drivingSide = side;
  const junction = node(0, 0);
  const incoming = road(node(-150, 0), junction);
  const outgoing = road(junction, node(0, side === 'right' ? 150 : -150));
  const major = road(node(0, side === 'right' ? -150 : 150), junction, { roadClass: 'primary' });
  junction.control = 'signal';
  junction.signal = {
    turnOnRed: enabled,
    offsetS: 0,
    amberS: 3,
    allRedS: 1,
    phases: [
      { durationS: 1000, groups: [{ from: major.id, to: outgoing.id }] },
      { durationS: 20, groups: [{ from: incoming.id, to: outgoing.id }] },
    ],
  };
  place('Home', 'residential', { x: -120, y: 0 }, [
    { road: incoming, direction: 'out', positionM: 10 },
  ]);
  place('Work', 'work', { x: 0, y: 120 }, [{ road: outgoing, direction: 'in', positionM: 100 }]);
  const compiled = setup(city);
  const turn = compiled.movements.find((m) => m.turn === side)!;
  const through = compiled.movements.find((m) => m.turn === 'through')!;
  return { city, compiled, turn, through, junction };
}

test.each(['right', 'left'] as const)(
  'T05 %s turn on red stops for a second then proceeds',
  (side) => {
    for (const enabled of [false, true]) {
      const { city, compiled, turn } = signal(side, enabled);
      expect(turn.turnOnRed).toBe(enabled);
      const engine = createEngine();
      engine.load({ compiled, scenario: scenario(), trips: trips(city, 1) });
      let stopped = 0;
      let entered = false;
      for (let i = 0; i < 700; i++) {
        const previous = engine.inspect(1);
        engine.step();
        const car = engine.inspect(1)!;
        if (car.lane === turn.fromLane && car.speedMps === 0 && previous?.speedMps === 0)
          stopped += 0.1;
        if (car.lane < 0) {
          expect(stopped).toBeGreaterThanOrEqual(1 - 1e-9);
          entered = true;
          break;
        }
      }
      expect(entered).toBe(enabled);
    }
  },
);

test('T05 red turns yield to green gaps, occupied paths and blocked exits', () => {
  const { compiled, turn, through } = signal('right');
  const vehicles = createVehicles(3, compiled.lanes.length, compiled.movements.length);
  for (const [id, path] of [turn, through].entries()) {
    vehicles.state[id] = DRIVING;
    vehicles.movement[id] = path.idx;
    vehicles.speed[id] = id ? 10 : 0;
    vehicles.insert(id, path.fromLane, compiled.lanes[path.fromLane]!.lengthM - (id ? 30 : 2));
  }
  vehicles.stopped[0] = 1;
  const intersections = createIntersections(compiled, vehicles, DEFAULT_SIM_PARAMS);
  intersections.signals(100);
  intersections.request(0, turn);
  intersections.resolve();
  expect(intersections.grants[0]).toBe(-1);
  vehicles.position[1] = compiled.lanes[through.fromLane]!.lengthM - 50;
  vehicles.insert(2, turn.toLane, 2);
  intersections.request(0, turn);
  intersections.resolve();
  expect(intersections.grants[0]).toBe(-1);
  vehicles.remove(2);
  intersections.request(1, through);
  intersections.request(0, turn);
  intersections.resolve();
  expect(intersections.grants[1]).toBe(through.idx);
  expect(intersections.grants[0]).toBe(-1);
  intersections.release(1);
  intersections.request(0, turn);
  intersections.resolve();
  expect(intersections.grants[0]).toBe(turn.idx);
  vehicles.stopped[0] = 0;
  intersections.signals(100.1);
  expect(intersections.grants[0]).toBe(turn.idx);
});

test('T05 unphased permitted turns remain routable and the flag survives validation', () => {
  const { city, junction } = signal('right');
  junction.signal!.phases.pop();
  const parsed = signalProgramSchema.parse(junction.signal);
  expect(parsed.turnOnRed).toBe(true);
  const compiled = setup(city);
  const turn = compiled.movements.find((m) => m.turn === 'right')!;
  expect(turn.neverGreen).toBe(false);
});

test.each([
  ['US', true],
  ['United States', true],
  ['DE', false],
  [undefined, undefined],
] as const)('T05 country %s sets only explicit import defaults', (country, expected) => {
  const { city, junction, compiled } = signal('right');
  junction.provenance.inferred = [];
  addSignal(city, junction, 2, compiled, [], {
    node: [],
    relation: [],
    way: [{ id: 1, nd: [], tag: { 'addr:country': country } }],
  });
  expect(junction.signal!.turnOnRed).toBe(expected);
});
