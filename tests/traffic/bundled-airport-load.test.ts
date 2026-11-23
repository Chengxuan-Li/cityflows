import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { scheduleTrips } from '../../src/demand';
import { compile } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { limit } from '../timeouts';

// TASK-310: reference outputs from 06e2dab with the held-out archives installed. TASK-312 re-pins
// the startup states and boards (stand rule, order, Boston and Heathrow schedules and runway tables).
const pins = [
  {
    id: 'london-city-airport',
    compiled: '300d4ee41d2480bf169ae29a3ba1768fb1e1963d243795b6c8d182505885dafc',
    state: [1254997485, 450676063],
    board: '693753b0737b8dd00e32bf1700dcb6b4ac6eebd28819db2cb4e7dc2685d7257a',
  },
  {
    id: 'zurich-airport',
    compiled: '0842d13fbc4288095f0198b9eb316ac754d6d469fef5a9e012ef37e47731d8e0',
    state: [2808817488, 771631734],
    board: 'f0b7bc5b71b5e04b1cad6b1849863054b40c4b809fc960a0d72f7b80f1204ffe',
  },
  {
    id: 'boston-logan',
    compiled: '92b6ea0f2297d18b13816ffa831132257f3429a1d61844d0fd86ec2bb0ec649c',
    state: [3509028583, 2047946547],
    board: 'fd7da6fa26993fa5da7501a6aab4159f8acf350f63799f2d24aeeb1644d461fb',
  },
  {
    id: 'heathrow',
    compiled: 'ff64f8c0c36b2c1bbea9e3841369c1ce3c420f74f6c9d04494338a73d379229e',
    state: [2614120500, 2245673856],
    board: '4e2f2d608d3d8f9d9efddd023b1e5cbc5e8af73d6f3bb5150acbfbd3485da170',
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
