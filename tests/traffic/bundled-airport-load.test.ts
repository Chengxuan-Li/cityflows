import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { scheduleTrips } from '../../src/demand';
import { compile } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { limit } from '../timeouts';

// TASK-310: reference outputs from 47ffd63 with the parked archives installed.
const pins = [
  {
    id: 'london-city-airport',
    compiled: 'c17bf0f58d9409507b3ac008951a943ea7ad5379a31626f037c371fd85641a28',
    state: [1127452598, 4293246752],
    board: '2e455d0ad82e3d72576da3bca4e93a4da85aeff400b407f0f86a29147f2e12b7',
  },
  {
    id: 'boston-logan',
    compiled: '3f854d1506b00eeb836b61c3b31b2fb99cc14a093367fe30fc0646a5a82ee709',
    state: [2936898296, 837548569],
    board: '82500a0afed2baa5e3c2e1dc97fcab675062904cd15ff82297d98d9c062e2ad8',
  },
  {
    id: 'heathrow',
    compiled: 'da17ee7eed980621b184ea6ed777137bfb7ffa72fc1819015cb5d5e72f851fef',
    state: [3237156883, 3275580588],
    board: 'c3a3cf59214f9f24bd91e8a3510bc0d2f798b9dee41787aca955899562eaf742',
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
