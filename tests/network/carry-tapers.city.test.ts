import { beforeAll, expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import {
  joinAudit,
  laneOverlaps,
  roadWidthAudit,
  unrelatedOverlaps,
} from '../../bench/geometry-audit';
import { loadAuditCity } from '../../bench/junction-audit';
import { compile, type CompiledCity } from '../../src/network';
import type { City } from '../../src/schema';
import { limit } from '../timeouts';

// TASK-221: lane transitions carried across the plain nodes between short roads
// (`carryTransitions`, continuity.ts). Each test fails with its rule switched off.

const cities: Record<string, { city: City; net: CompiledCity }> = {};

beforeAll(async () => {
  for (const [name, city] of [
    ['freiburg', (await openFreiburg()).city],
    ['munich', loadAuditCity('munich')],
    ['sindelfingen', loadAuditCity('sindelfingen')],
  ] as const) {
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
    cities[name] = { city, net: result.compiled };
  }
}, limit(300_000));

/** The largest step between the edges of a movement's two lane ends at a node (audit measure 7). */
function joint(name: string, node: string): number {
  const { net } = cities[name]!;
  return joinAudit(net, net.nodes[net.index.node.get(node as never)!]!)?.maxM ?? 0;
}

function overlap(name: string, roads: string): number {
  const { city, net } = cities[name]!;
  return laneOverlaps(city, net).find((o) => o.roads === roads)?.areaM2 ?? 0;
}

function width(name: string, road: string): number {
  const { city, net } = cities[name]!;
  return roadWidthAudit(city, net, net.roads[net.index.road.get(road as never)!]!).audit.maxM;
}

test('a continuation transition runs on through the plain nodes beyond its roads (S6, J6)', () => {
  // Freiburg n:536: the 11.7 m on-ramp r:1224 jogged 3.5 m in 5.9 m (0.44 m step); it now holds
  // beside r:678 over r:1224 and r:1129 and eases over 20 m.
  expect(joint('freiburg', 'n:536')).toBeLessThan(0.05);
  expect(overlap('freiburg', 'r:1224/r:678')).toBe(0);
  // Munich n:194: the ramp r:196 eased onto its own line, which lies on r:416's lanes for 55 m.
  expect(overlap('munich', 'r:196/r:416')).toBeLessThan(1);
});

test('a carried window holds first and never tapers shorter than without the chains', () => {
  // Variant: Freiburg n:1709, the case for this rule on the tip, is not carried here (its
  // narrowest branch's window stays on r:1711); kept as a guard: a 10.9 m taper took the hold and
  // the branches parted while their blocks overlapped (r:1711/r:2169).
  expect(overlap('freiburg', 'r:1711/r:2169')).toBe(0);
});

test('the branches follow the widest branch chain, not a straight ray', () => {
  // On the straight ray Munich r:259 and r:416 left their corridors by 1.26 and 0.45 m in the
  // 75 m window from n:194, Freiburg r:678 by 0.53 m.
  expect(width('munich', 'r:259')).toBeLessThan(0.1);
  expect(width('munich', 'r:416')).toBeLessThan(0.1);
  // TASK-242: r:538 beside it, placed (`left_of:2`, its block 1.75 m right of its line), moves the
  // window's chain: r:678 runs 0.46 m off its corridor.
  expect(width('freiburg', 'r:678')).toBeLessThan(0.5);
});

test('a carried window eases by the quintic, without a bend at the plain nodes it crosses', () => {
  // Munich n:194, where the ramp's window ends 55 m on (0.044 m by smoothstep).
  expect(joint('munich', 'n:194')).toBeLessThan(0.02);
});

test('carried windows are laid after the side-by-side blocks, which keep their chains', () => {
  // Freiburg n:78: a chain from n:281 took r:1203 first and squeezed the block there to 4.8 m
  // (r:1203/r:80 11.6 m2).
  expect(overlap('freiburg', 'r:1203/r:80')).toBe(0);
});

test('a split of a shared trunk lane keeps its own window', () => {
  // Sindelfingen n:967: a longer taper only lengthened the shared lane's split (10.4 to 21.3 m2).
  expect(overlap('sindelfingen', 'r:1090/r:969')).toBeLessThan(11);
});

test('only a moving side whose window passes its first road is carried', () => {
  // Freiburg n:1546: a lone branch with no offset was pulled onto the ray over 15 m (0.66 m off
  // r:2171); n:544's branches, whose window stays on their roads, eased early (0.23 m2).
  expect(width('freiburg', 'r:2171')).toBeLessThan(0.3);
  // TASK-242: r:1380 placed (`middle_of:2`, its block 1.75 m right) moves the split at n:544,
  // where the branches now overlap by 0.56 m2.
  expect(overlap('freiburg', 'r:1118/r:546')).toBeLessThan(0.6);
});

test('a road that follows a carried transition keeps it at a plain node', () => {
  // Munich n:257: r:416's chain runs into r:259 without an offset; dropped there as at a plain
  // node, r:259 met the ramp's continuation r:261 (0.13 m2).
  const { city, net } = cities.munich!;
  expect(unrelatedOverlaps(city, net).find((o) => o.roads === 'r:259/r:261')?.areaM2 ?? 0).toBe(0);
});
