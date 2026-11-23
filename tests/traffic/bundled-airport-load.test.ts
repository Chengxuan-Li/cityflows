import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { scheduleTrips } from '../../src/demand';
import { compile } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { limit } from '../timeouts';

// TASK-310: reference outputs from 06e2dab with the held-out archives installed. TASK-312 re-pins
// the startup states and boards (stand rule, order, Boston and Heathrow schedules and runway tables).
// TASK-320 re-pins the compiled graphs (stands' road bands and room ahead; the rest unchanged) and
// the startup states and boards where parked poses change (London City, Zurich, Heathrow).
const pins = [
  {
    id: 'london-city-airport',
    compiled: '5147d31fd2188e92690e4500dedeb34675e249f70a0c3313949ab799373218c2',
    state: [3987169813, 886009363],
    board: 'b1c98cc15570f53d5c02f8cf2828b09879337d4d04325b68fcb4eebfe15f180c',
  },
  {
    id: 'zurich-airport',
    compiled: '5b079ccbc54a73687cc3999cb2e38a9dd1e13c5fb2ab547bcfe6a70d126a890b',
    state: [2699325225, 3382430523],
    board: 'f0b7bc5b71b5e04b1cad6b1849863054b40c4b809fc960a0d72f7b80f1204ffe',
  },
  {
    id: 'boston-logan',
    compiled: '7fc43beb08028dfce7bd50c989b8c7051dd3031c2af238390ac28f0a04d3bece',
    state: [3509028583, 2047946547],
    board: 'fd7da6fa26993fa5da7501a6aab4159f8acf350f63799f2d24aeeb1644d461fb',
  },
  {
    id: 'heathrow',
    compiled: '34ed206e2ac48dc75881b5563343e59abe223bafa4814a7b8eaa0a0ee674a9b5',
    state: [3284891146, 37696474],
    board: '03695df6916ac1950720e1a2469fa7e69dbc0c6561f3acc516b76313114cd26f',
  },
];

const hash = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_, member: unknown) =>
        member instanceof Map
          ? [...member]
          : ArrayBuffer.isView(member)
            ? Array.from(member as Float64Array)
            : member,
      ),
    )
    .digest('hex');

test.for(pins)(
  '$id keeps the compiled graph and startup state',
  { timeout: limit(120_000) },
  async (pin) => {
    const {
      city,
      population,
      scenarios: [scenario],
    } = await openBundled(pin.id);
    let finishWalk = () => {};
    const result = compile(city, (finish) => (finishWalk = finish));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    finishWalk();
    const { compiled } = result;
    expect(hash(compiled)).toBe(pin.compiled);
    const trips = scheduleTrips(city, population!, scenario!, compiled);
    const engine = createEngine();
    engine.load({ compiled, trips, scenario: scenario!, population });
    const loaded = engine.stateHash();
    engine.step(600);
    expect([loaded, engine.stateHash()]).toEqual(pin.state);
    expect(hash(engine.flightBoard())).toBe(pin.board);
  },
);
