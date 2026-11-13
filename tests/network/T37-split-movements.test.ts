import { withoutLotAisles } from '../without-lot-aisles';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { auditRoute } from '../../bench/route-audit';
import { cumulativeLengths, headingAtDistance, segmentsIntersect } from '../../src/geo/polyline';
import { importOsmCached } from '../../bench/city-cache';
import { compile, type CompiledCity } from '../../src/network';
import { defaultSlice, orderBranches } from '../../src/network/continuity';
import type { CMovement, CRoad } from '../../src/network/types';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import type { City, TurnRule } from '../../src/schema';
import { cityTest, tierCities } from '../tier';
import { limit } from '../timeouts';

const extracts = {
  Munich: ['munich-donnersberger', [11.525, 48.135, 11.545, 48.148]],
  Sindelfingen: ['sindelfingen-a81', [8.98, 48.69, 9, 48.702]],
} as const;
const loaded = new Map<string, { city: City; net: CompiledCity }>();
function load(name: keyof typeof extracts) {
  let entry = loaded.get(name);
  if (!entry) {
    const [file, bbox] = extracts[name];
    const imported = importOsmCached(readFileSync(`fixtures/osm/${file}.osm`, 'utf8'), {
      importerVersion: 'test',
      bbox: [...bbox],
    });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const city = withoutLotAisles(imported.city);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    loaded.set(name, (entry = { city, net: result.compiled }));
  }
  return entry;
}

const continuing = (m: CMovement) => ['through', 'merge', 'diverge'].includes(m.turn);

/** Architecture 5.2 step 4: the most specific matching rule decides. */
function banned(rules: TurnRule[], from: number, to: number) {
  const matching = rules.filter(
    (r) =>
      (r.fromLane === undefined || r.fromLane === from) &&
      (r.toLane === undefined || r.toLane === to),
  );
  const score = (r: TurnRule) => Number(r.fromLane !== undefined) + Number(r.toLane !== undefined);
  const best = matching.reduce<TurnRule | undefined>(
    (best, r) => (best && score(best) > score(r) ? best : r),
    undefined,
  );
  return best?.allowed === false;
}

interface LinedUp {
  node: string;
  id: string;
  movement: CMovement | undefined;
  banned: boolean;
}

/** The oracle, written from the contract: nodes TASK-071 classifies (uncontrolled, every movement
 * through, merge or diverge, every road end within 30 degrees of one axis), and at each the
 * trunk and branch lanes that TASK-071's default slice lines up. */
function linedUp(city: City, net: CompiledCity) {
  const headings = net.roads.map((road) => {
    const line = city.roads[road.id]!.centerline;
    const cumulative = cumulativeLengths(line);
    return {
      start: headingAtDistance(line, cumulative, 0),
      end: headingAtDistance(line, cumulative, cumulative.at(-1)!),
    };
  });
  const nodes: string[] = [];
  const pairs: LinedUp[] = [];
  for (const node of net.nodes) {
    const movements = node.movements.map((i) => net.movements[i]!);
    if (node.control !== 'uncontrolled' || !movements.length || !movements.every(continuing))
      continue;
    const ends = net.roads.flatMap((road) => [
      ...(road.to === node.idx ? [{ road, entering: true, heading: headings[road.idx]!.end }] : []),
      ...(road.from === node.idx
        ? [{ road, entering: false, heading: headings[road.idx]!.start }]
        : []),
    ]);
    const groups: { split: boolean; trunk: CRoad; branches: CRoad[]; heading: number }[] = [];
    let axis: number | undefined;
    let kind = true;
    for (const forward of [true, false]) {
      const group = ends.filter((e) => Math.cos(e.heading - ends[0]!.heading) > 0 === forward);
      if (!group.length) continue;
      const into = group.filter((e) => e.entering).map((e) => e.road);
      const out = group.filter((e) => !e.entering).map((e) => e.road);
      if (!into.length || !out.length || (into.length > 1 && out.length > 1)) kind = false;
      if (!kind) break;
      const split =
        into.length === 1 && (out.length > 1 || into[0]!.lanes.length >= out[0]!.lanes.length);
      const trunk = (split ? into : out)[0]!;
      const trunkHeading = headings[trunk.idx]![split ? 'end' : 'start'];
      axis ??= trunkHeading;
      const heading = axis + (Math.cos(trunkHeading - axis) < 0 ? Math.PI : 0);
      groups.push({ split, trunk, branches: split ? out : into, heading });
    }
    if (
      !kind ||
      ends.some((e) => Math.abs(Math.cos(e.heading - axis!)) < Math.cos(Math.PI / 6) - 1e-9)
    )
      continue;
    nodes.push(node.id);
    for (const { split, trunk, branches, heading } of groups) {
      const ordered = orderBranches(branches, headings, heading, split);
      let cursor = 0;
      for (const [position, branch] of ordered.entries()) {
        const slice = defaultSlice(
          trunk.lanes.length,
          ordered.map((r) => r.lanes.length),
          position,
          cursor,
          net.drivingSide,
        );
        if (slice.length) cursor = slice.at(-1)![0] + 1;
        const from = split ? trunk : branch,
          to = split ? branch : trunk;
        const rules = city.nodes[node.id]!.turnRules.filter(
          (r) => r.from === from.id && r.to === to.id,
        );
        for (const [t, b] of slice) {
          const a = net.lanes[from.lanes[split ? t : b]!]!,
            c = net.lanes[to.lanes[split ? b : t]!]!;
          pairs.push({
            node: node.id,
            id: `${a.id}>${c.id}`,
            movement: a.out.map((i) => net.movements[i]!).find((m) => m.toLane === c.idx),
            banned: banned(rules, a.lane, c.lane),
          });
        }
      }
    }
  }
  return { nodes, pairs };
}

cityTest(
  'T37: the lanes that line up at Munich n:312, n:305, n:201 and n:194 continue',
  () => {
    const { city, net } = load('Munich');
    const { pairs } = linedUp(city, net);
    const at = (node: string) =>
      pairs.filter((p) => p.node === node).map((p) => [p.id, p.movement?.turn ?? 'banned']);
    // r:313's lanes 0 and 1 line up with r:692 (lanes 2 and 3 are banned there by turn:lanes).
    expect(at('n:312')).toEqual([
      ['r:313#0>r:692#0', 'diverge'],
      ['r:313#1>r:692#1', 'diverge'],
      ['r:313#2>r:706#0', 'diverge'],
      ['r:313#3>r:706#1', 'diverge'],
    ]);
    const node = net.nodes[net.index.node.get('n:312')!]!;
    // Nothing removed: the fallback movements of r:313#0 and #1 into r:706 stay.
    expect(node.movements.map((i) => net.movements[i]!.id).sort()).toEqual([
      'r:313#0>r:692#0',
      'r:313#0>r:706#0',
      'r:313#1>r:692#1',
      'r:313#1>r:706#0',
      'r:313#2>r:706#0',
      'r:313#3>r:706#1',
    ]);
    // r:307#0 had no movement at all; r:1188 keeps its curb-side pairs (#0>#1, #1>#2, #2>#3).
    expect(at('n:305')).toEqual([
      ['r:1188#0>r:307#0', 'merge'],
      ['r:1188#1>r:307#1', 'merge'],
      ['r:1188#2>r:307#2', 'merge'],
      ['r:676#0>r:307#2', 'merge'],
      ['r:676#1>r:307#3', 'merge'],
    ]);
    // Already complete before TASK-085: r:730's single lane feeds every lane of r:968, and under
    // the unequal-count slice r:1275 lines up with r:968's right lanes; r:968#1 lines up with none.
    // TASK-131 keeps OSM nodes: n:201 now leads into way 4513904 (r:203, three lanes, 29 m to
    // n:202, where r:968 widens to four), so r:730 and r:1275 fill its three lanes one to one.
    expect(at('n:201')).toEqual([
      ['r:730#0>r:203#0', 'merge'],
      ['r:1275#0>r:203#1', 'merge'],
      ['r:1275#1>r:203#2', 'merge'],
    ]);
    // r:687#2 lines up with r:416#2, but OSM turn:lanes sends it only to r:196.
    expect(at('n:194')).toEqual([
      ['r:687#0>r:416#0', 'diverge'],
      ['r:687#1>r:416#1', 'diverge'],
      ['r:687#2>r:416#2', 'banned'],
      ['r:687#2>r:196#0', 'diverge'],
    ]);
  },
  limit(60_000),
);

// Before TASK-085 (571cce5): Munich 152 of the 161 lined-up pairs had a movement, 1 banned, 8
// missing (n:253 r:482#0>r:321#0; n:305 r:1188#0-2>r:307#0-2; n:308 r:1259#1>r:310#1,
// r:1259#2>r:310#2; n:312 r:313#0>r:692#0, r:313#1>r:692#1); Sindelfingen 93 of 94, missing
// n:918 r:1000#0>r:920#0. Movements 1327 to 1335 and 1123 to 1124; nodes of the kind 70 and 48.
// TASK-083: Munich 1335 to 1340. The realignment no longer bends one carriageway of a corridor
// away from the other, so at n:104, n:324, n:446, n:721, n:774 and n:823 the through road is
// classified through again (its curb lanes gain the through pairing; e.g. r:1276#0>r:1277#0)
// and turns between a corridor's two carriageways are u-turns, not lefts.
// TASK-131 keeps every OSM node (no merge): the nodes main merged into one junction are each a
// node of their own, many of them TASK-071 continuations, so Munich 72 nodes, 166 pairs, 1356
// movements -> 125, 273, 1646 and Sindelfingen 59, 116, 1174 -> 118, 251, 1383.
test.each(
  tierCities([
    // e4654d8: r:252#2>r:482#1 and r:966#2>r:703#1 merge on their inner roads (1646 -> 1648).
    // Fix round: r:950#1>r:714#0 and r:968#3>r:966#2 merge into inner lanes, r:699#0 enters
    // r:1312, and the lanes at n:294, n:366 and n:478 change places (1648 -> 1650).
    ['Munich', 125, 273, 1, 1650], // TASK-101: retained access boundaries and final signal geometry.
    // TASK-087: Sindelfingen's n:580 becomes a continuation node (r:585/r:586 runs on into the
    // unnamed pair r:582/r:583, now side by side): its two lined-up pairs are added, r:586>r:582
    // is classified through, and the turn r:583#0>r:582#0 between the pair's carriageways goes.
    // TASK-089: unchanged (the network keeps every movement where it splits converging nodes).
    // TASK-101 retains the junctions beside short access boundaries.
    ['Sindelfingen', 118, 251, 0, 1383],
  ] as const),
)(
  'T37: %s gives every lined-up trunk and branch lane a movement unless banned',
  (name, nodeCount, pairCount, bannedCount, movementCount) => {
    const { city, net } = load(name);
    const { nodes, pairs } = linedUp(city, net);
    expect([
      nodes.length,
      pairs.length,
      pairs.filter((p) => p.banned).length,
      net.movements.length,
    ]).toEqual([nodeCount, pairCount, bannedCount, movementCount]);
    expect(pairs.filter((p) => !p.movement && !p.banned).map((p) => p.id)).toEqual([]);
    expect(pairs.filter((p) => p.movement && !continuing(p.movement))).toEqual([]);
  },
  limit(60_000),
);

/** TASK-131 keeps OSM geometry (realignRoads deleted, the merge gone): a two-way street forking
 * into two two-way streets at an acute OSM angle is a TASK-071 split node, and the merge into
 * one fork crosses the diverge into the other, as on the road. Munich n:235 (Schulstraße, arms
 * r:1113 and r:236 26 degrees apart), Sindelfingen n:27 (service, r:28 and r:697 27 degrees
 * apart) and n:68 (r:69 and r:245 19 degrees apart, the B55 case). */
const acuteForks = [
  'r:1113#0>r:1115#0 x r:1116#0>r:237#0',
  'r:697#0>r:30#0 x r:31#0>r:29#0',
  'r:73#0>r:245#0 x r:69#0>r:72#0',
];

test.each(tierCities(['Munich', 'Sindelfingen'] as const))(
  'T37: %s lined-up movements do not cross each other at a node',
  (name) => {
    const { city, net } = load(name);
    const byNode = new Map<number, CMovement[]>();
    for (const { movement } of linedUp(city, net).pairs)
      if (movement) byNode.set(movement.node, [...(byNode.get(movement.node) ?? []), movement]);
    const crossings: string[] = [];
    for (const movements of byNode.values())
      for (const [i, a] of movements.entries())
        for (const b of movements.slice(i + 1)) {
          // Movements sharing a lane end meet there by construction.
          if (a.fromLane === b.fromLane || a.toLane === b.toLane) continue;
          const cross = a.polyline.some((p, k) =>
            b.polyline.some(
              (q, l) =>
                k > 0 && l > 0 && segmentsIntersect(a.polyline[k - 1]!, p, b.polyline[l - 1]!, q),
            ),
          );
          if (cross) crossings.push(`${a.id} x ${b.id}`);
        }
    expect(crossings.filter((c) => !acuteForks.includes(c))).toEqual([]);
  },
  limit(60_000),
);

cityTest(
  'T37: lane-level routing uses r:313 into r:692 and the route is drivable',
  () => {
    const { city, net } = load('Munich');
    const start = net.lanes[net.index.lane.get('r:313#0')!]!;
    // r:1030 is reached through r:692, r:996, r:928 and r:694; before TASK-085 the routes there
    // from r:313 took the r:706 branch and a longer way round (throughput routes, Munich 9-11).
    const road = net.index.road.get('r:1030')!;
    const destination = net.connectors.find(
      (c) => c.direction !== 'out' && net.lanes[c.lane]!.road === road,
    )!;
    const request = {
      fromLane: start.idx,
      fromPosM: 0,
      toConnector: destination.idx,
      vehicleClass: 'car' as const,
      desiredSpeedFactor: 1,
      noise: 0,
      seed: 1,
    };
    const result = createRouteProvider().route(net, freeFlowLinkCosts(net), request);
    if (!result.ok) throw new Error(result.reason);
    expect(result.route.roads.slice(0, 2).map((i) => net.roads[i]!.id)).toEqual(['r:313', 'r:692']);
    expect(auditRoute(city, net, request, result.route)).toEqual([]);
  },
  limit(60_000),
);
