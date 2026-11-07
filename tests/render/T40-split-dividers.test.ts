import { expect, test } from 'vitest';
import { auditCities, compileAuditCity, type AuditCity } from '../../bench/junction-audit';
import {
  clipOutside,
  distance,
  parallelOffset,
  pointInPolygon,
  segmentsIntersect,
  trimPolyline,
} from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import type { CMovement, CNode, CompiledCity, CRoad } from '../../src/network';
import { junctionGuides, splitLinedUp } from '../../src/render/layers/junction-markings';
import { crossingStripes, markingClips } from '../../src/render/layers/roads';
import { cityTest, tierCities } from '../tier';

const nets = new Map<string, CompiledCity>();
const net = (name: AuditCity) => {
  if (!nets.has(name)) nets.set(name, compileAuditCity(name));
  return nets.get(name)!;
};
const nodeOf = (city: CompiledCity, id: string) => city.nodes[city.index.node.get(id as never)!]!;
const roadOf = (city: CompiledCity, id: string) => city.roads[city.index.road.get(id as never)!]!;

/** The node end of a lane's centre. */
function laneEnd(city: CompiledCity, lane: number, node: CNode) {
  const l = city.lanes[lane]!;
  return city.roads[l.road]!.to === node.idx ? l.polyline.at(-1)! : l.polyline[0]!;
}

/** Where the drawn divider on the right of `lane` (as `drawRoad` lays it, clipped as it clips
 * it) ends at `node`; undefined when the lane has no divider there. */
function dividerEnd(city: CompiledCity, lane: number, node: CNode): Vec2 | undefined {
  const l = city.lanes[lane]!;
  const road = city.roads[l.road]!;
  if (l.right < 0) return undefined;
  const line = parallelOffset(trimPolyline(l.polyline, 0, l.lengthM - l.stopM), l.widthM / 2);
  // TASK-079: an approach's stretch under its own outline is drawn, above the junction.
  const clips = road.to === node.idx ? [] : markingClips(city, road);
  const pieces = clipOutside(line, clips, 0.05);
  const at = laneEnd(city, lane, node);
  return pieces
    .flatMap((piece) => [piece[0]!, piece.at(-1)!])
    .reduce((a, b) => (distance(a, at) <= distance(b, at) ? a : b));
}

/** The gap at one cut between a divider end `p` and the lanes' own line: their divider where
 * they are lanes of one road, else the point where their edges meet. */
function cutGap(city: CompiledCity, node: CNode, lanes: [number, number], p: Vec2) {
  const [a, b] = lanes.map((i) => city.lanes[i]!);
  const left = a!.right === b!.idx ? a! : b!.right === a!.idx ? b! : undefined;
  const target = left
    ? dividerEnd(city, left.idx, node)!
    : (() => {
        const [p0, p1] = lanes.map((i) => laneEnd(city, i, node));
        return { x: (p0!.x + p1!.x) / 2, y: (p0!.y + p1!.y) / 2 };
      })();
  return distance(p, target);
}

function crosses(a: Vec2[], b: Vec2[]) {
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++)
      if (segmentsIntersect(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) return true;
  return false;
}

// The neighbouring lined-up pairs (TASK-085, T37) at the B39 junctions, left to right.
const expected: Record<string, [string, string][]> = {
  // r:968#1 lines up with no lane of r:730 or r:1275: between r:730#0>r:968#0 and
  // r:1275#0>r:968#2 a lane opens (a gore), so only r:1275's divider continues.
  'n:201': [['r:1275#0>r:968#2', 'r:1275#1>r:968#3']],
  'n:312': [
    ['r:313#0>r:692#0', 'r:313#1>r:692#1'],
    ['r:313#1>r:692#1', 'r:313#2>r:706#0'],
    ['r:313#2>r:706#0', 'r:313#3>r:706#1'],
  ],
  // An absorbing merge: r:1188#2 and r:676#0 converge into r:307#2 and get none.
  'n:305': [
    ['r:1188#0>r:307#0', 'r:1188#1>r:307#1'],
    ['r:1188#1>r:307#1', 'r:1188#2>r:307#2'],
    ['r:676#0>r:307#2', 'r:676#1>r:307#3'],
  ],
};

cityTest(
  'T40.1: every neighbouring through pair at n:201, n:312, n:305 has a divider from cut to cut',
  () => {
    const city = net('munich');
    for (const [id, pairs] of Object.entries(expected)) {
      const node = nodeOf(city, id);
      const guides = junctionGuides(city, node);
      const dividers = guides.filter((g) => g.between);
      expect(
        dividers.map((g) => g.between!.map((m) => m.id)),
        id,
      ).toEqual(pairs);
      const ring = [...node.outline, node.outline[0]!];
      for (const guide of dividers) {
        const [a, b] = guide.between!;
        // Continuous with the lanes' own dividers (or the meeting of two roads' edges) at both cuts.
        const start = cutGap(city, node, [a.fromLane, b.fromLane], guide.line[0]!);
        const end = cutGap(city, node, [a.toLane, b.toLane], guide.line.at(-1)!);
        expect(start, `${id} ${a.id} start`).toBeLessThan(0.5);
        expect(end, `${id} ${a.id} end`).toBeLessThan(0.5);
        // Inside the junction polygon (0.1 m), dashed along the whole line.
        expect(guide.line.every((p) => pointInPolygon(p, ring, 0.1))).toBe(true);
        expect(guide.dashes.flat().every((p) => pointInPolygon(p, ring, 0.1))).toBe(true);
        expect(guide.dashes.length).toBeGreaterThanOrEqual(5);
      }
    }
  },
  60_000,
);

cityTest(
  'T40.1: at n:194 (a continuation node, no junction surface) the roads’ dividers meet',
  () => {
    const city = net('munich');
    const node = nodeOf(city, 'n:194');
    expect(node.outline).toEqual([]);
    expect(junctionGuides(city, node)).toEqual([]);
    const movement = (id: string) => city.movements[city.index.movement.get(id as never)!]!;
    const pairs: [CMovement, CMovement][] = [
      [movement('r:687#0>r:416#0'), movement('r:687#1>r:416#1')],
      [movement('r:687#1>r:416#1'), movement('r:687#2>r:196#0')],
    ];
    // r:196#0 starts where r:416#2 does (r:687#2>r:416#2 is banned by turn:lanes), so the boundary
    // between r:416#1 and r:196#0 is r:416's divider #1|#2.
    const branchEnds = ['r:416', 'r:196']
      .flatMap((id) => roadOf(city, id).lanes.map((lane) => dividerEnd(city, lane, node)))
      .filter((p): p is Vec2 => p !== undefined);
    for (const [a, b] of pairs) {
      const [p, q] = [a.fromLane, b.fromLane].map((i) => laneEnd(city, i, node));
      const boundary = { x: (p!.x + q!.x) / 2, y: (p!.y + q!.y) / 2 };
      // r:687's divider ends at the boundary and a branch's divider starts there.
      expect(distance(dividerEnd(city, a.fromLane, node)!, boundary), a.id).toBeLessThan(0.5);
      expect(Math.min(...branchEnds.map((e) => distance(e, boundary))), a.id).toBeLessThan(0.5);
    }
  },
);

test.each(tierCities(auditCities))(
  'T40.2: %s split dividers cross no movement of another lane pair; none at signals',
  (name) => {
    const city = net(name);
    let nodes = 0;
    let dividers = 0;
    for (const node of city.nodes) {
      const guides = junctionGuides(city, node);
      if (node.signal) expect(guides, node.id).toEqual([]);
      const split = guides.filter((g) => g.between);
      if (!split.length) continue;
      nodes++;
      expect(splitLinedUp(city, node), node.id).not.toBeNull();
      const movements = node.movements.map((i) => city.movements[i]!);
      for (const guide of split) {
        dividers++;
        const [a, b] = guide.between!;
        const own = new Set([a.fromLane, a.toLane, b.fromLane, b.toLane]);
        // A movement into or out of one of the pair's lanes may cross it (a lane change over a
        // dashed line); any other may not.
        const foreign = movements.filter(
          (m) => !own.has(m.fromLane) && !own.has(m.toLane) && crosses(m.polyline, guide.line),
        );
        expect(
          foreign.map((m) => m.id),
          `${node.id} ${a.id}`,
        ).toEqual([]);
        for (const other of guides)
          if (other !== guide) expect(crosses(other.line, guide.line), node.id).toBe(false);
        // And, as at the B39 junctions, it meets the lanes' lines at both cuts.
        expect(cutGap(city, node, [a.fromLane, b.fromLane], guide.line[0]!)).toBeLessThan(0.5);
        expect(cutGap(city, node, [a.toLane, b.toLane], guide.line.at(-1)!)).toBeLessThan(0.5);
      }
    }
    // Munich: n:201, n:253, n:266, n:28, n:305, n:308, n:312, n:670 (one divider each where not
    // named in T40.1; n:308 three). Sindelfingen's splits are single-lane; grid and town have none.
    expect({ nodes, dividers }).toEqual(
      name === 'munich' ? { nodes: 8, dividers: 14 } : { nodes: 0, dividers: 0 },
    );
  },
  60_000,
);

/** Roads at `node` that draw a crossing at their end there. */
function crossingRoads(city: CompiledCity, node: CNode) {
  return city.roads
    .filter(
      (road: CRoad) =>
        (road.to === node.idx && crossingStripes(city, road, true).length) ||
        (road.from === node.idx && crossingStripes(city, road, false).length),
    )
    .map((road) => road.id)
    .sort();
}

cityTest('T40.3: n:1181 draws the crossings of TASK-072’s rule, off the junction polygon', () => {
  const city = net('munich');
  const node = nodeOf(city, 'n:1181');
  // Every served approach and exit of the signal: Landsberger Straße west (r:981 in, r:1358 out),
  // east (r:984 in, r:476 out) and Barthstraße (r:1182 in, r:1183 out). Before TASK-083 the old
  // outline reached over the ends of r:981, r:1358 and r:476 and hid their stripes. r:729, laid
  // beside r:984, ends inside the junction; since TASK-094 its signal-arm crossing moves out
  // along the road like any other, clear of the junction.
  expect(crossingRoads(city, node)).toEqual([
    'r:1182',
    'r:1183',
    'r:1358',
    'r:476',
    'r:729',
    'r:981',
    'r:984',
  ]);
  for (const road of city.roads.filter((r) => r.from === node.idx || r.to === node.idx))
    for (const stripe of crossingStripes(city, road, road.to === node.idx))
      for (const p of stripe) {
        expect(pointInPolygon(p, node.outline)).toBe(false);
        expect(pointInPolygon(p, [...road.surface, road.surface[0]!])).toBe(true);
      }
});
