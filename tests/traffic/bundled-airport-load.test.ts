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
// TASK-351 re-pins the compiled graphs of the three airports it rebuilds (their car entrances and
// parking exits) and the startup states that follow. TASK-348 + TASK-351 (merge): Zurich's and
// Heathrow's graphs (crossings outside junction groups laid out as plain nodes) and Heathrow's state.
const pins = [
  {
    id: 'london-city-airport',
    compiled: 'e76955d8a627e065dec27fbe4b91f7b3a9082821f9e34156b8236e2dfe9d8d8c',
    state: [193940800, 1229324366],
    board: 'b1c98cc15570f53d5c02f8cf2828b09879337d4d04325b68fcb4eebfe15f180c',
  },
  {
    id: 'zurich-airport',
    compiled: 'fb9a6f683dbc57b56f7381df6780aa64b8abb1b5a72781d751d66258057feb2e',
    state: [1233058347, 420095907],
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
    compiled: '29c4a6bff6e9ca9edf7b26a97156860d803d9e6262df1ad0ab51b734013d1991',
    state: [3394981357, 646132797],
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
