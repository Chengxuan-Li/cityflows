import { expect, test } from 'vitest';
import { continuity } from '../../src/fixtures/continuity';
import { compile } from '../../src/network';
import { transitionMarkings } from '../../src/render/marking-geometry';
import { transitionGeometry } from '../../src/render/layers/transitions';
import { distance } from '../../src/geo/polyline';
import { buildCity } from '../../src/fixtures/build-city';

test('T25: drops shrink to zero with a standard merge arrow and hatched verge, additions grow, and boundaries meet', () => {
  const result = compile(continuity());
  if (!result.ok) throw new Error('continuity fixture');
  const net = result.compiled;
  for (const added of [false, true]) {
    const lane = net.lanes.find((l) => (added ? l.taperStartM > 0 : l.taperEndM > 0))!;
    const geometry = transitionGeometry(net, net.roads[lane.road]!);
    const taper = geometry.lanes.find((l) => l.lane === lane.idx)!;
    const widths = taper.left.map((p, i) => distance(p, taper.right[i]!));
    expect(added ? widths[0] : widths.at(-1)).toBeLessThan(0.001);
    expect(added ? widths.at(-1) : widths[0]).toBeCloseTo(3, 3);
    for (let i = 1; i < widths.length; i++)
      expect((widths[i]! - widths[i - 1]!) * (added ? 1 : -1)).toBeGreaterThanOrEqual(-0.001);
    const marks = transitionMarkings(net, net.roads[lane.road]!);
    expect(marks.some((s) => s.role === 'arrow')).toBe(!added);
    expect(
      marks.every((s) => s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))),
    ).toBe(true);
    expect(marks.some((s) => s.role === 'hatch')).toBe(true);
    expect(geometry.dividers.length).toBe(2);
  }
});

test.each([
  [3, 5],
  [5, 3],
])('T25: adjacent tapered lanes share one painted boundary (%i to %i)', (before, after) => {
  const { city, node, road } = buildCity('Westbound lane transition', 1);
  const seam = node(0, 0);
  const incoming = road(node(100, 20), seam, { lanes: before });
  const outgoing = road(seam, node(-100, -20), { lanes: after });
  const result = compile(city);
  if (!result.ok) throw new Error('lane transition fixture');
  const net = result.compiled;
  const tapered = net.roads.find((r) => r.id === (after > before ? outgoing.id : incoming.id))!;
  const geometry = transitionGeometry(net, tapered);
  const a = geometry.lanes[3]!;
  const b = geometry.lanes[4]!;
  expect(a.right).toHaveLength(b.left.length);
  expect(Math.max(...a.right.map((p, i) => distance(p, b.left[i]!)))).toBeLessThan(0.001);
});
