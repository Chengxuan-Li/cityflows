import { expect, test } from 'vitest';
import { railStation } from '../../tests/demand/rail-station';
import { syntheticAirport } from '../fixtures/synthetic-airport';
import { signalApproach } from '../fixtures/signal-approach';
import { compile } from '../network';
import type { City } from '../schema';
import {
  dynamicDebugGeometry,
  heightDebugColor,
  heightDebugGeometry,
  pickDebugGeometry,
  staticDebugGeometry,
} from './debug-geometry';

const compiled = (source: City) => {
  const result = compile(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
};

test('the combined network overlays contain each compiled node, road, lane, track and runway once', () => {
  const source = railStation().city;
  source.airport = syntheticAirport().airport;
  const city = compiled(source);
  const road = staticDebugGeometry('roadGraph', city, source);
  const lanes = staticDebugGeometry('lanes', city, source);
  const rail = staticDebugGeometry('railGraph', city, source);
  const air = staticDebugGeometry('airsideGraph', city, source, 5.5);
  const ids = (values: typeof road) => values.map((x) => x.id);
  expect(ids(road.filter((p) => p.kind === 'point'))).toEqual(city.nodes.map((n) => n.id));
  expect(ids(road.filter((p) => p.kind === 'line' && p.id))).toEqual(city.roads.map((r) => r.id));
  expect(ids(lanes.filter((p) => p.pick?.kind === 'lane'))).toEqual(city.lanes.map((l) => l.id));
  expect(ids(rail.filter((p) => p.kind === 'line' && p.pick?.kind === 'track'))).toEqual(
    city.rail!.tracks.map((t) => t.id),
  );
  const runwayIds = city.airside!.runways.map((r) => r.id);
  expect(runwayIds.length).toBeGreaterThan(0);
  expect(ids(air.filter((p) => p.id && runwayIds.includes(p.id)))).toEqual(runwayIds);
  const glides = air.filter((p) => p.only3d);
  expect(glides.length).toBe(2 * runwayIds.length);
  for (const g of glides) {
    const a = g.points[0]!,
      b = g.points.at(-1)!;
    expect((b.z! - a.z!) / Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(
      Math.tan((5.5 * Math.PI) / 180),
    );
  }
  const stand = city.airside!.stands[0]!;
  expect(pickDebugGeometry(air, stand.pos, 1)).toMatchObject({
    id: stand.id,
    pick: { kind: 'stand', stand: stand.idx },
  });
  const node = city.nodes[0]!;
  expect(pickDebugGeometry(road, node.pos, 1)?.pick).toEqual({ kind: 'node', node: node.idx });
});

test('signals show the selected node conflict matrix in compiled movement order', () => {
  const city = compiled(signalApproach());
  const n = city.nodes.find((n) => n.signal)!;
  const matrix = dynamicDebugGeometry('signals', city, null, { kind: 'node', node: n.idx }).find(
    (p) => p.text?.startsWith('Conflicts'),
  );
  const rows = matrix!.text!.split('\n').slice(1);
  expect(rows.length).toBe(n.movements.length);
  for (const [i, idx] of n.movements.entries()) {
    const m = city.movements[idx]!;
    expect(rows[i]).toContain(m.id);
    expect(rows[i]!.split('×').length - 1).toBe(m.conflicts.length);
  }
  expect(
    dynamicDebugGeometry('signals', city, null, null).some((p) => p.text?.startsWith('Conflicts')),
  ).toBe(false);
});

test('a road that rises to a bridge deck and returns to ground shows both height and grade', () => {
  const source = syntheticAirport();
  const bridge = Object.values(source.roads)[0]!;
  bridge.layer = 1;
  const city = compiled(source);
  const heights = heightDebugGeometry(city, source);
  expect(heights.some((p) => p.fill && p.points.some((v) => (v.z ?? 0) >= 4.9))).toBe(true);
  expect(heights.some((p) => p.text?.endsWith('%') && Number.parseFloat(p.text) !== 0)).toBe(true);
  expect(new Set([-1, 0, 1].map((grade) => heightDebugColor(0, grade))).size).toBe(3);
});

