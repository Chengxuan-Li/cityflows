import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { junctions } from '../../src/fixtures/junctions';
import { junctionOutline, containMovements } from '../../src/network/junctions';
import { compile } from '../../src/network';
import { insideOutline, outlineCrossings, surfaceAudit } from './junction-audit';

test('T20: every fixture outline is simple, including the capped acute Y', () => {
  const result = compile(junctions());
  if (!result.ok) throw new Error('fixture');
  expect(outlineCrossings(result.compiled)).toEqual([]);
  const acute = result.compiled.nodes.find((n) => n.id === 'n:1')!;
  // Facing outer edges of the 155/205 degree arms meet west of their capped cuts. TASK-074:
  // the capped mouths move out to the uncapped cuts, so the outline covers the tip.
  const tip = { x: -6 / Math.sin((25 * Math.PI) / 180), y: 0 };
  expect(insideOutline(tip, acute.outline)).toBe(true);
  expect(acute.outline.some((p) => Math.hypot(p.x - tip.x, p.y - tip.y) < 0.01)).toBe(false);
});

test('T20: fixture fillets are tangent, bounded and contain movement widths', () => {
  const result = compile(junctions());
  if (!result.ok) throw new Error('fixture');
  const audit = surfaceAudit(result.compiled);
  expect(audit.widthsOutside).toEqual([]);
  expect(audit.oversized).toEqual([]);
  expect(audit.tangents).toEqual([]);
  expect(audit.classes.fillet).toBeGreaterThan(0);
  // TASK-074: capped corners take a fillet beyond their moved mouths instead of a gore.
  expect(audit.classes.gore).toBe(0);
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
  // TASK-074: the 16 m arm is shorter than its setbacks and its stub lies across the 313 degree
  // arm's mouth: three movements into r:9 leave the outline (main: two from r:10), and the
  // outline touches itself at one point where its two loops meet (no proper crossing).
  expect(surfaceAudit(net).widthsOutside).toEqual(['r:4#1>r:9#3', 'r:4#0>r:9#2', 'r:7#2>r:9#3']);
  expect(outlineCrossings(net)).toEqual(['n:1:2/5', 'n:1:2/6', 'n:1:3/5', 'n:1:3/6']);
});
