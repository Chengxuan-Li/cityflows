import { expect, test } from 'vitest';
import { throughAudit } from '../../bench/geometry-audit';
import { openFreiburg } from '../../bench/freiburg';
import { compile } from '../../src/network';
import { limit } from '../timeouts';

// T34 (TASK-213): measure 4 on Freiburg reads a through road's edges, not a fork's road or a cut
// line. TASK-212's figures for J5 came partly from both.
test(
  'T34.11: measure 4 leaves out a fork beside an arm and never samples along a cut line',
  async () => {
    const city = (await openFreiburg()).city;
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
    const net = result.compiled;
    const at = (id: string) =>
      throughAudit(city, net, net.nodes[net.index.node.get(id as `n:${number}`)!]!)!;
    // n:552: r:554 leaves 29 degrees beside r:556 (within 30 degrees of the arm, so no side road);
    // the junction surface between the two read as the through road's far edge, 5.25 m out.
    expect(at('n:552').farM).toBeLessThan(0.5);
    // n:1747: the first station lay on r:1748's cut corner, its ray along the cut line, which
    // neither the road nor the outline counts as inside: 3.35 m, against 0.001 m 1 cm away.
    expect(at('n:1747').farM).toBeLessThan(0.1);
  },
  limit(180_000),
);
