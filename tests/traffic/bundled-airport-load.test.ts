import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { scheduleTrips } from '../../src/demand';
import { compile } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { limit } from '../timeouts';

// TASK-310: reference outputs from 06e2dab with the held-out archives installed.
const pins = [
  {
    id: 'london-city-airport',
    compiled: '300d4ee41d2480bf169ae29a3ba1768fb1e1963d243795b6c8d182505885dafc',
    state: [3067669136, 334463102],
    board: 'ddc47628f289d0be781c7673d06c76c591321888e06a397965bf4dad53317ace',
  },
  {
    id: 'zurich-airport',
    compiled: '0842d13fbc4288095f0198b9eb316ac754d6d469fef5a9e012ef37e47731d8e0',
    state: [62496529, 2841216063],
    board: '9272e4fd978df31378c44a424aa9f623f2142a1880c317909fad4213c2601943',
  },
  {
    id: 'boston-logan',
    compiled: '3f854d1506b00eeb836b61c3b31b2fb99cc14a093367fe30fc0646a5a82ee709',
    state: [2936898296, 837548569],
    board: '82500a0afed2baa5e3c2e1dc97fcab675062904cd15ff82297d98d9c062e2ad8',
  },
  {
    id: 'heathrow',
    compiled: '52a242206bf7b485fdfbe42e26adda7f8a3a5a54c64623a08d0854cfacfa7069',
    state: [2003868899, 4110133764],
    board: '16a8bdd274ab14d4d6aa283a7cfad907ca1fb29dc3c1f1a5e8a73e8c8df56f56',
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
