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
// TASK-265 re-pins the four compiled graphs (zebra bands on their mapped crossing nodes; startup states
// unchanged). TASK-360 re-pins Heathrow's startup state and board (intersection take-offs and line-ups).
// TASK-364 re-pins Zurich's graph (two one-way to two-way seams laid out as continuations; state unchanged).
// TASK-279 re-pins the walk controls. Zurich, Boston and Heathrow's first minute moves;
// the archives, loaded state and flight boards are unchanged.
// TASK-373 re-pins Boston's graph and first minute for US junction priority. The GB graphs,
// Zurich, and the flight boards stay as on main.
const pins = [
  {
    id: 'london-city-airport',
    compiled: 'b1e9997f9ca2904f7659e4eb9e2889b8eded2520697cedd0c580b32970bce898',
    state: [193940800, 1229324366],
    board: 'b1c98cc15570f53d5c02f8cf2828b09879337d4d04325b68fcb4eebfe15f180c',
  },
  {
    id: 'zurich-airport',
    compiled: '51e86d3f4058fa509762e0b914aa699f0b0a6b83d8e0ebf87d74323d73bdbcfe',
    state: [1233058347, 2094351646],
    board: 'f0b7bc5b71b5e04b1cad6b1849863054b40c4b809fc960a0d72f7b80f1204ffe',
  },
  {
    id: 'boston-logan',
    compiled: 'f791087703cd23503dff7e8507dccdf81bd4aa7579098bf0d0bff58e4d0259c3',
    state: [3509028583, 2047946547],
    board: 'fd7da6fa26993fa5da7501a6aab4159f8acf350f63799f2d24aeeb1644d461fb',
  },
  {
    id: 'heathrow',
    compiled: '01d51ca2d060e66af89ab129ead04f8f8d2562df13b42d463c581ad45ba58329',
    state: [3553834081, 4040218530],
    board: '435dc959537475c17c6bf90a6934b8882ab64c0773940341c03a49d4c60e3e98',
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
