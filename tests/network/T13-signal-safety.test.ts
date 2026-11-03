import { expect, it } from 'vitest';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { compile, signalStateAt } from '../../src/network';

function signalFixture() {
  const city = signalApproach();
  const node = Object.values(city.nodes).find((n) => n.control === 'signal')!;
  const incoming = Object.values(city.roads).filter((r) => r.to === node.id);
  const through = (x: number, y: number) => {
    const from = incoming.find(
      (r) => Math.sign(r.centerline[0]!.x) === x && Math.sign(r.centerline[0]!.y) === y,
    )!;
    const to = Object.values(city.roads).find(
      (r) =>
        r.from === node.id &&
        Math.sign(r.centerline.at(-1)!.x) === -x &&
        Math.sign(r.centerline.at(-1)!.y) === -y,
    )!;
    return { from: from.id, to: to.id };
  };
  const east = through(-1, 0);
  const west = through(1, 0);
  const north = through(0, 1);
  const south = through(0, -1);
  node.signal = {
    offsetS: 2,
    amberS: 3,
    allRedS: 1,
    phases: [
      { durationS: 10, groups: [east, west] },
      { durationS: 12, groups: [north, south] },
    ],
  };
  return { city, node, east, north };
}

it('rejects a phase that serves intersecting paths', () => {
  const { city, node, north } = signalFixture();
  node.signal!.phases[0]!.groups.push(north);
  const result = compile(city);
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'signal_conflict',
      severity: 'error',
      refs: expect.arrayContaining([node.id]),
    }),
  );
});

it('looks up phase and color including clearance times and marks unserved turns', () => {
  const { city, node, east } = signalFixture();
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const signal = result.compiled.nodes[result.compiled.index.node.get(node.id)!]!.signal!;
  expect(signal.cycleS).toBe(30);
  expect(signal.phases[0]!.movements).toHaveLength(4);
  for (const [time, phase, state] of [
    [0, 0, 'green'],
    [8, 0, 'amber'],
    [11, 0, 'all-red'],
    [12, 1, 'green'],
    [28, 0, 'green'],
    [-3, 1, 'all-red'],
  ] as const) {
    expect(signalStateAt(signal, time)).toEqual({ phase, state });
  }
  const unserved = result.compiled.movements.find((m) => m.turn === 'left')!;
  expect(unserved.neverGreen).toBe(true);
  expect(
    result.compiled.movements[
      result.compiled.index.movement.get(east.from + '#0>' + east.to + '#0')!
    ]!.neverGreen,
  ).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'signal_unserved_movement',
      severity: 'warning',
      refs: expect.arrayContaining([unserved.id]),
    }),
  );
});
