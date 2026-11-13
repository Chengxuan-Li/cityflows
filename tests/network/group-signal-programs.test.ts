import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import { GROUP_CYCLE_MAX_S } from '../../src/network/signal-program';
import type { City } from '../../src/schema';
import { dualSingle } from '../importers/junction-group-osm';
import { throughputFixture } from '../routing/throughput-fixtures';
import { tierCities } from '../tier';

// TASK-161: a junction group's generated program. Movements from inner roads are green in every
// phase, so a green group's chains run on through the group whatever else is green: two green
// groups whose chains cross must not share a phase, or one is starved by a stream that never stops
// (Munich jg:10783: r:961's turns crossed the r:966 > r:703 stream released with them).

/** Every generated group program's census: its green groups (entry>exit road ids), the share of
 * the cycle each is green, and the pairs green together whose chains cross. A chain that passes a
 * member twice circles the group and counts only for a pair with no direct chain. */
function census(city: City, net: CompiledCity) {
  return (net.groups ?? [])
    .filter((g) => g.signalised)
    .map((group) => {
      const program = city.junctionGroups![group.id]!.signal!;
      const cycleS = program.phases.reduce((s, p) => s + p.durationS + 4, 0);
      const chains = new Map<string, number[][]>();
      for (const c of group.chains) {
        const key = `${net.roads[c.from]!.id}>${net.roads[c.to]!.id}`;
        chains.set(key, [...(chains.get(key) ?? []), c.movements]);
      }
      const paths = new Map(
        [...chains].map(([key, list]) => {
          const direct = list.filter(
            (c) => new Set(c.map((m) => net.movements[m]!.node)).size === c.length,
          );
          return [key, new Set((direct.length ? direct : list).flat())];
        }),
      );
      const crosses = (a: string, b: string) =>
        [...paths.get(a)!].some((m) =>
          net.movements[m]!.conflicts.some(
            (o) =>
              paths.get(b)!.has(o) &&
              // Two chains merging into one lane of an inner road merge inside the junction.
              !(
                net.movements[o]!.toLane === net.movements[m]!.toLane &&
                net.roads[net.lanes[net.movements[m]!.toLane]!.road]!.group !== undefined
              ),
          ),
        );
      const share = new Map(
        [...chains.keys()].map((key) => [
          key,
          program.phases
            .filter((p) => p.groups.some((g) => `${g.from}>${g.to}` === key))
            .reduce((s, p) => s + p.durationS, 0) / cycleS,
        ]),
      );
      const crossing = program.phases.flatMap((p, i) =>
        p.groups.flatMap((a, j) =>
          p.groups
            .slice(j + 1)
            .filter((b) => crosses(`${a.from}>${a.to}`, `${b.from}>${b.to}`))
            .map((b) => `phase ${i + 1}: ${a.from}>${a.to} x ${b.from}>${b.to}`),
        ),
      );
      const greenS = program.phases.reduce((s, p) => s + p.durationS, 0);
      return {
        id: group.id,
        program,
        cycleS,
        share,
        crossing,
        minShare: greenS / program.phases.length / cycleS,
      };
    });
}

function expectServed(rows: ReturnType<typeof census>) {
  for (const row of rows) {
    expect(row.crossing, row.id).toEqual([]);
    expect(row.cycleS, row.id).toBeLessThanOrEqual(GROUP_CYCLE_MAX_S);
    // Every entry-to-exit pair is green for at least an even split of the green time.
    for (const [key, share] of row.share)
      expect(share, `${row.id} ${key}`).toBeGreaterThanOrEqual(row.minShare - 1e-9);
  }
}

test('TASK-161: a group program stops the inner stream that crosses a green group', () => {
  const result = importOsm(dualSingle(20, true), { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const net = compile(result.city);
  if (!net.ok) throw new Error(JSON.stringify(net.diagnostics.slice(0, 3)));
  const rows = census(result.city, net.compiled);
  expect(rows).toHaveLength(1);
  expectServed(rows);
});

test.each(tierCities(['Munich', 'Sindelfingen'] as const))(
  'TASK-161: every %s group program serves each entry-to-exit pair with no crossing stream',
  (name) => {
    const { city, net } = throughputFixture(name);
    const rows = census(city, net);
    console.info(
      name,
      rows.map(
        (r) => `${r.id} ${r.program.phases.map((p) => p.durationS).join('/')} cycle ${r.cycleS}`,
      ),
    );
    expect(rows).toHaveLength({ Munich: 9, Sindelfingen: 0 }[name]);
    expectServed(rows);
  },
);
