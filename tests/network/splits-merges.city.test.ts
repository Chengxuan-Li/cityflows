import { beforeAll, expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import {
  directionPairs,
  joinAudit,
  laneFoldAudit,
  laneOverlaps,
  pairGapAudit,
} from '../../bench/geometry-audit';
import { loadAuditCity } from '../../bench/junction-audit';
import { compile, type CompiledCity } from '../../src/network';
import { referenceLine } from '../../src/network/corridor';
import type { City } from '../../src/schema';
import { limit } from '../timeouts';

// TASK-214: lane splits and merges, the cases of TASK-212's audit
// (docs/findings/2026-11-19-geometry-audit/README.md, S1 to S6) and its Munich regressions. Each
// case is a lane polyline that folded or a lane joint that stepped, under the rule that fixed it.

const cities: Record<string, { city: City; net: CompiledCity }> = {};

beforeAll(async () => {
  for (const [name, city] of [
    ['freiburg', (await openFreiburg()).city],
    ['munich', loadAuditCity('munich')],
  ] as const) {
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
    cities[name] = { city, net: result.compiled };
  }
  // Importing both cities with a cold cache (CI) takes longer than the 10 s default hook limit.
}, limit(300_000));

/** The largest step between the edges of a movement's two lane ends at a node (audit measure 7). */
function joint(name: string, node: string): number {
  const { net } = cities[name]!;
  return joinAudit(net, net.nodes[net.index.node.get(node as never)!]!)?.maxM ?? 0;
}

/** Back-step, self-crossing and cusp of a lane polyline (audit measure 3). */
function fold(name: string, lane: string) {
  const { city, net } = cities[name]!;
  const audit = laneFoldAudit(city, net, net.lanes[net.index.lane.get(lane as never)!]!);
  return { backStepM: audit.backStepM, crossings: audit.crossings, cusps: audit.cusps };
}

const straight = { backStepM: 0, crossings: 0, cusps: 0 };

test('a road whose two transitions meet keeps its shift between them (S1, S3)', () => {
  // Bus bays at the Hauptbahnhof: each two-lane road between one-lane pinches is shifted at both
  // ends; it used to swing back to its own line in the middle (0.2 to 0.4 m steps at the joints).
  for (const node of ['n:1278', 'n:1188', 'n:610', 'n:617'])
    expect(joint('freiburg', node)).toBeLessThan(0.05);
  // The shift is measured across the road's own line, not taken from the side-by-side line's
  // offset (r:282 between a side-by-side block and a lane gain: 1.97 m).
  expect(joint('freiburg', 'n:280')).toBeLessThan(0.1);
});

test('the wider road jogs at a lane gain or drop with one branch (S2, S3)', () => {
  // Bismarckallee 2 to 5 lanes: the 6 m two-lane road jogged 5.25 m (1.41 m step).
  expect(joint('freiburg', 'n:1169')).toBeLessThan(0.15);
  // Munich Arnulfstraße 2 to 3 lanes on the 11 m inner road r:700 (0.26 m).
  expect(joint('munich', 'n:695')).toBeLessThan(0.05);
  // But not a 4 m wide road beside a 27 m narrow one (n:1209), which takes the shorter taper.
  expect(joint('freiburg', 'n:1209')).toBeLessThan(0.05);
});

test('a side-by-side block on a short road is measured from its trimmed cut (S3, S4)', () => {
  // r:718 (8 m, cut 6.25 m scaled to 3.2 m) ran 3 m past n:717 and folded.
  for (const lane of ['r:718#0', 'r:718#1', 'r:718#2'])
    expect(fold('freiburg', lane)).toEqual(straight);
});

test('lanes off a bending side-by-side line follow its interpolated normals (S4)', () => {
  // Munich Landsberger Straße r:728, 3.5 m off the line: a 0.9 m back-step at each vertex.
  expect(fold('munich', 'r:728#0')).toEqual(straight);
  for (const lane of ['r:1096#0', 'r:1262#0', 'r:394#0'])
    expect(fold('freiburg', lane)).toEqual(straight);
});

test('the roads of a side-by-side chain share one line and one window (S3)', () => {
  // Munich n:675, a plain node inside a block's chain: the trimmed lines' end normals (0.11 m).
  expect(joint('munich', 'n:675')).toBeLessThan(0.05);
  // Freiburg n:393: a later block halved only the chain's second road (1.0 m step).
  expect(joint('freiburg', 'n:393')).toBeLessThan(0.1);
});

test('a branch beside lanes its neighbour adds moves off by their width (J6)', () => {
  // Munich n:27: Arnulfstraße's two added lanes on r:958 grew over the ramp r:29 (87.7 m2).
  const { city, net } = cities.munich!;
  const overlap = laneOverlaps(city, net).find((o) => o.roads === 'r:29/r:958')!;
  expect(overlap.areaM2).toBeLessThan(40);
});

test('a road too short for its cuts is not joined across a junction (S4)', () => {
  // r:653 (4.7 m, four lanes 7 m off its line) was eased round the next road at n:652 and folded.
  for (const lane of ['r:653#1', 'r:653#2', 'r:653#3'])
    expect(fold('freiburg', lane)).toEqual(straight);
});

test('two tight corners a straight apart are both eased to their radius (S4)', () => {
  // Munich r:589/r:588, a one-lane two-way hairpin: the second corner kept a 0.19 m radius, the
  // inside lane folded 2.5 m back and the two directions parted 0.69 m.
  expect(fold('munich', 'r:589#0')).toEqual(straight);
  const { net } = cities.munich!;
  const pair = directionPairs(cities.munich!.city, net).find(
    ({ a, b }) => `${a.id}/${b.id}` === 'r:588/r:589' || `${a.id}/${b.id}` === 'r:589/r:588',
  )!;
  expect(pairGapAudit(net, pair.a, pair.b, pair.kind, [0, 0]).maxM).toBeLessThan(0.05);
  const hairpin = [
    [-595.99, -525.27],
    [-574.21, -519.7],
    [-573.66, -519.38],
    [-573.33, -518.91],
    [-573.37, -518.29],
    [-576.13, -507.07],
    [-576.27, -506.82],
    [-576.53, -506.66],
    [-576.82, -506.63],
    [-602.92, -509.58],
  ].map(([x, y]) => ({ x: x!, y: y! }));
  const { eased } = referenceLine(hairpin, 3, 3);
  expect(eased.map((e) => [e.limited, e.radiusM])).toEqual([
    [false, 3.25],
    [false, 3.25],
  ]);
});
