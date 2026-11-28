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
// TASK-381 re-pins the first minute at all four airports after releasing queue reserves on
// set-back unmarked exits. The compiled graphs, loaded states and boards are unchanged.
// TASK-386 re-pins the four compiled graphs and startup states (M3 trunk ends without default
// crossings, M5 straight bands); the flight boards are unchanged.
const pins = [
  {
    id: 'london-city-airport',
    compiled: '0fb645d586d0ff58287c78e2cd5875d66b0ff42202ea7e163246008e6de618bf',
    state: [193940800, 721176118],
    board: 'b1c98cc15570f53d5c02f8cf2828b09879337d4d04325b68fcb4eebfe15f180c',
  },
  {
    id: 'zurich-airport',
    compiled: '9d1c4c5feffe2034c7be1d63a66577abd25e46dfff808ca9954d5d630c2cdd10',
    state: [3333416462, 3010772661],
    board: 'f0b7bc5b71b5e04b1cad6b1849863054b40c4b809fc960a0d72f7b80f1204ffe',
  },
  {
    id: 'boston-logan',
    compiled: '2d37c2c366d96480a3c3538c90a38bde2fe924faf7a52d30c5fd6fccf98ad4fc',
    state: [3509028583, 4266511212],
    board: 'fd7da6fa26993fa5da7501a6aab4159f8acf350f63799f2d24aeeb1644d461fb',
  },
  {
    id: 'heathrow',
    compiled: 'a72a3d66e0f5f89f4625fa06b8467d3f8890d4881d3b0d30dfa4fff94f336632',
    state: [573402987, 2167168041],
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
