import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { junctions } from '../../src/fixtures/junctions';
import { cumulativeLengths } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile } from '../../src/network';
import { populateConflicts } from '../../src/network/conflicts';
import type { City } from '../../src/schema';

function compiled(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

function crossing(a: Vec2[], b: Vec2[], widths = [3, 3], sameExit = false) {
  const { city, node, road } = buildCity('Measured contact', 1);
  const center = node(0, 0);
  road(node(-100, 0), center);
  road(node(0, -100), center);
  road(center, node(100, 0));
  road(center, node(0, 100));
  const net = compiled(city);
  const paths = net.movements.filter((m) => m.turn === 'through');
  paths.forEach((path, i) => {
    path.polyline = [a, b][i]!;
    path.cumulative = cumulativeLengths(path.polyline);
    path.lengthM = path.cumulative.at(-1)!;
    path.conflicts = [];
    path.conflictZones = [];
    net.lanes[path.fromLane]!.widthM = widths[i]!;
  });
  if (sameExit) paths[1]!.toLane = paths[0]!.toLane;
  const junction = net.nodes[paths[0]!.node]!;
  junction.movements = paths.map((p) => p.idx);
  populateConflicts(junction, net.movements, net.lanes);
  return paths;
}

test('T21: straight paths are sampled to one meter and use both incoming lane widths', () => {
  const [a, b] = crossing(
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ],
    [
      { x: 10.25, y: -20 },
      { x: 10.25, y: 20 },
    ],
    [2, 5],
  );
  // Contact on a: (6.75, 13.75); on b: (16.5, 23.5), rounded outward.
  expect(a!.conflictZones).toEqual([[6, 14]]);
  expect(b!.conflictZones).toEqual([[16, 24]]);
});

test('T21: a narrow contact between sample points is never missed', () => {
  const [a] = crossing(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    [
      { x: 4.5, y: -10 },
      { x: 4.5, y: 10 },
    ],
    [0.1, 0.1],
  );
  expect(a!.conflictZones).toEqual([[4, 5]]);
});

test('T21: same-exit contacts extend to the movement end', () => {
  const paths = crossing(
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ],
    [
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ],
    [3, 3],
    true,
  );
  for (const path of paths) expect(path.conflictZones[0]![1]).toBe(path.lengthM);
  expect(paths[0]!.conflictZones[0]![0]).toBe(5);
});

test.each([
  ['grid', grid5x5],
  ['junctions', junctions],
] as const)(
  'T21: %s zones align with reciprocal conflicts and stay within the movement',
  (_, fixture) => {
    const net = compiled(fixture());
    for (const path of net.movements) {
      expect(path.conflictZones).toHaveLength(path.conflicts.length);
      path.conflicts.forEach((idx, i) => {
        const other = net.movements[idx]!;
        const [start, end] = path.conflictZones[i]!;
        expect(other.conflicts).toContain(path.idx);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThanOrEqual(start);
        expect(end).toBeLessThanOrEqual(path.lengthM);
        if (path.toLane === other.toLane) expect(end).toBe(path.lengthM);
      });
    }
  },
);

test.each([
  {
    fixture: grid5x5,
    a: 'r:48#0>r:66#0',
    b: 'r:60#0>r:64#0',
    zones: [
      [5.5, 11.5],
      [2.5, 8.5],
    ],
  },
  {
    fixture: junctions,
    a: 'r:14#0>r:19#0',
    b: 'r:17#0>r:22#0',
    zones: [
      [3.1422220101, 9.527288645],
      [7.4266660303, 13.8117326652],
    ],
  },
])(
  'T21: $a / $b cover hand-computed contact intervals within one sample',
  ({ fixture, a, b, zones }) => {
    const net = compiled(fixture());
    const paths = [a, b].map((id) => net.movements.find((m) => m.id === id)!);
    // Grid: perpendicular lines at x=118.5 and y=241.5, radius 3 m.
    // Junction: lines cross at 70 degrees, at s=6.3347553275 / 10.6191993478 m;
    // each contact extends 3/sin(70 degrees) = 3.1925333174 m from the crossing.
    paths.forEach((path, i) => {
      const zone = path.conflictZones[path.conflicts.indexOf(paths[1 - i]!.idx)]!;
      const exact = zones[i]!;
      expect(zone[0]).toBeLessThanOrEqual(exact[0]! + 1e-9);
      expect(zone[0]).toBeGreaterThanOrEqual(exact[0]! - 1);
      expect(zone[1]).toBeGreaterThanOrEqual(exact[1]! - 1e-9);
      expect(zone[1]).toBeLessThanOrEqual(exact[1]! + 1);
    });
  },
);
