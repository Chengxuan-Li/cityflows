import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { junctions } from '../../src/fixtures/junctions';
import { junctionOutline, containMovements } from '../../src/network/junctions';
import { compile } from '../../src/network';
import { outlineCrossings, surfaceAudit } from './junction-audit';

test('T20: every fixture outline is simple, including the capped acute Y', () => {
  const result = compile(junctions());
  if (!result.ok) throw new Error('fixture');
  expect(outlineCrossings(result.compiled)).toEqual([]);
  const acute = result.compiled.nodes.find((n) => n.id === 'n:1')!;
  // Facing outer edges of the 155/205 degree arms meet west of their capped cuts.
  const tip = { x: -6 / Math.sin((25 * Math.PI) / 180), y: 0 };
  expect(acute.outline.some((p) => Math.hypot(p.x - tip.x, p.y - tip.y) < 0.01)).toBe(true);
});

test('T20: fixture fillets are tangent, bounded and contain movement widths', () => {
  const result = compile(junctions());
  if (!result.ok) throw new Error('fixture');
  const audit = surfaceAudit(result.compiled);
  expect(audit.widthsOutside).toEqual([]);
  expect(audit.oversized).toEqual([]);
  expect(audit.tangents).toEqual([]);
  expect(audit.classes.fillet).toBeGreaterThan(0);
  expect(audit.classes.gore).toBeGreaterThan(0);
});

test('T20: reports fixed movement widths that escape an outer road edge', () => {
  const { city, node, street } = buildCity('Short unequal junction', 1);
  const center = node(0, 0);
  for (const [degrees, length, lanes] of [
    [93, 93, 2],
    [23, 16, 3],
    [313, 39, 4],
  ] as const) {
    const angle = (degrees * Math.PI) / 180;
    street(center, node(Math.cos(angle) * length, Math.sin(angle) * length), lanes);
  }
  const result = compile(city);
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  const atCenter = net.nodes[net.index.node.get(center.id)!]!;
  const copy = { ...atCenter };
  copy.outline = junctionOutline(
    copy,
    net.roads.filter((r) => r.from === copy.idx || r.to === copy.idx),
    net.lanes,
  );
  expect(containMovements(copy, net.movements, net.lanes).contained).toBe(false);
  expect(surfaceAudit(net).widthsOutside).toEqual(['r:10#3>r:3#1', 'r:10#3>r:6#2']);
  expect(outlineCrossings(net)).toEqual([]);
});
