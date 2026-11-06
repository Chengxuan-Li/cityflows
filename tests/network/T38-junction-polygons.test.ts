import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  junctionShapeAudit,
  polylineSelfCrossings,
  throughAudit,
  unrelatedOverlaps,
} from '../../bench/geometry-audit';
import { probeMorning } from '../../bench/import-probe';
import { auditCities, loadAuditCity, type AuditCity } from '../../bench/junction-audit';
import { buildCity } from '../../src/fixtures/build-city';
import { junctions } from '../../src/fixtures/junctions';
import {
  distance,
  headingAtDistance,
  nearestOnPolyline,
  preparePolygon,
  segmentDistance,
} from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CompiledCity, type CNode } from '../../src/network';
import { CURB_RADIUS_M, junctionCorners } from '../../src/network/junctions';
import type { City } from '../../src/schema';

// T38 (TASK-083, docs/plan.md "Geometry rework" stage 3): junction polygons, osm2streets-style
// on TASK-082's corridors. Moved here: T20's simple outlines and contained movements (fixtures
// and imports), T27's outline measures, storage and Munich morning, T31's curb radii and
// fingerprints.

const compiled = new Map<AuditCity, { city: City; net: CompiledCity }>();
function load(name: AuditCity) {
  let entry = compiled.get(name);
  if (!entry) {
    const city = loadAuditCity(name);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
    compiled.set(name, (entry = { city, net: result.compiled }));
  }
  return entry;
}

const node = (net: CompiledCity, id: string) =>
  net.nodes[net.index.node.get(id as `n:${number}`)!]!;
const incident = (net: CompiledCity, n: CNode) =>
  net.roads.filter((r) => r.from === n.idx || r.to === n.idx);

function boundaryDistance(p: Vec2, ring: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++)
    best = Math.min(best, segmentDistance(p, ring[i - 1]!, ring[i]!));
  return best;
}

/** A road end's trimmed corners at the node, left and right in travel direction. */
function cut(net: CompiledCity, roadIdx: number, atEnd: boolean): [Vec2, Vec2] {
  const ring = net.roads[roadIdx]!.surface;
  const half = ring.length / 2;
  return atEnd ? [ring[half - 1]!, ring[half]!] : [ring[0]!, ring.at(-1)!];
}

test('T38.1: G2, Landsberger Straße keeps its alignment across n:774 and n:719', () => {
  const { city, net } = load('munich');
  for (const id of ['n:774', 'n:719']) {
    const n = node(net, id);
    const through = throughAudit(city, net, n)!;
    expect(through.pairs, id).toBe(2);
    expect(through.farM, id).toBeLessThanOrEqual(0.1);
    expect(through.nearM, id).toBeLessThanOrEqual(0.1);
    expect(through.laneM, id).toBeLessThan(0.1);
    expect(junctionShapeAudit(city, net, n)!.bulgeM2, id).toBe(0);
  }
}, 120_000);

/** The movement surface samples of a node that lie neither in its outline (0.1 m) nor on the
 * movement's own roads (a hairpin sweeping back over its lanes behind the stop line is road). */
function escaping(net: CompiledCity, n: CNode): string[] {
  const inside = preparePolygon(n.outline, 0.1);
  const out: string[] = [];
  for (const i of n.movements) {
    const m = net.movements[i]!;
    const from = net.lanes[m.fromLane]!,
      to = net.lanes[m.toLane]!;
    const own = [from.road, to.road].map((r) =>
      preparePolygon([...net.roads[r]!.surface, net.roads[r]!.surface[0]!], 0.1),
    );
    const half = Math.min(from.widthM, to.widthM) / 2;
    const last = m.polyline.length - 1;
    const samples = m.polyline.flatMap((p, k) => {
      const h =
        k === 0
          ? headingAtDistance(from.polyline, from.cumulative, from.lengthM)
          : k === last
            ? headingAtDistance(to.polyline, to.cumulative, 0)
            : Math.atan2(
                m.polyline[k + 1]!.y - m.polyline[k - 1]!.y,
                m.polyline[k + 1]!.x - m.polyline[k - 1]!.x,
              );
      return [-1, 0, 1].map((s) => ({
        x: p.x - Math.sin(h) * half * s,
        y: p.y + Math.cos(h) * half * s,
      }));
    });
    if (samples.some((p) => !inside(p) && !own.some((on) => on(p)))) out.push(m.id);
  }
  return out;
}

/** Road ends whose cut leaves the outline: a sample of the cut farther than 0.1 m from the
 * outline's boundary and outside it. A cut under the outline (a capped end the gore covers) is on
 * it in this sense. */
function cutsOff(net: CompiledCity, n: CNode): string[] {
  const inside = preparePolygon(n.outline, 0.1);
  return incident(net, n).flatMap((road) =>
    [false, true]
      .filter((atEnd) => (atEnd ? road.to : road.from) === n.idx)
      .flatMap((atEnd) => {
        const [a, b] = cut(net, road.idx, atEnd);
        const off = [0, 0.25, 0.5, 0.75, 1].some((t) => {
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          return !inside(p) && boundaryDistance(p, n.outline) > 0.1;
        });
        return off ? [`${n.id}:${road.id}`] : [];
      }),
  );
}

test.each(auditCities)(
  'T38.2: %s junction polygons are simple, hold every movement surface and meet every cut',
  (name) => {
    const { net } = load(name);
    const junctions = net.nodes.filter((n) => n.outline.length);
    expect(junctions.length).toBeGreaterThan(0);
    expect(
      junctions.filter((n) => polylineSelfCrossings(n.outline, true)).map((n) => n.id),
    ).toEqual([]);
    expect(junctions.flatMap((n) => escaping(net, n))).toEqual([]);
    expect(junctions.flatMap((n) => cutsOff(net, n))).toEqual([]);
  },
  120_000,
);

// Main after stage 2 (7d92383), npm run geometry-audit: junction bulge (outline and curbs) and
// unrelated same-grade overlap, m².
const stage2 = {
  grid: { bulgeM2: 0, overlapM2: 0 },
  town: { bulgeM2: 1832.7, overlapM2: 0 },
  sindelfingen: { bulgeM2: 1591.05, overlapM2: 50.13 },
  munich: { bulgeM2: 905.25, overlapM2: 118.13 },
};

test.each(auditCities)(
  'T38.2: %s bulge is at most a quarter of stage 2’s and no unrelated overlap is added',
  (name) => {
    const { city, net } = load(name);
    const bulge = net.nodes.reduce(
      (sum, n) => sum + (junctionShapeAudit(city, net, n)?.bulgeM2 ?? 0),
      0,
    );
    const overlap = unrelatedOverlaps(city, net).reduce((sum, o) => sum + o.areaM2, 0);
    console.info('T38.2', name, 'bulge', bulge.toFixed(2), 'overlap', overlap.toFixed(2));
    expect(bulge).toBeLessThanOrEqual(stage2[name].bulgeM2 / 4);
    expect(overlap).toBeLessThanOrEqual(stage2[name].overlapM2 + 0.01);
  },
  120_000,
);

test.each(auditCities)(
  'T38.3: %s concave corners are tangent arcs of their class radius or the largest that fits',
  (name) => {
    const { net } = load(name);
    const failures: string[] = [];
    const limits: Record<string, number> = {};
    for (const n of net.nodes) {
      if (!n.outline.length) continue;
      for (const corner of junctionCorners(n)) {
        if (corner.kind !== 'curb') continue;
        const where = `${n.id} ${corner.roads.map((r) => net.roads[r]!.id).join('>')}`;
        limits[corner.limit!] = (limits[corner.limit!] ?? 0) + 1;
        const lower = corner.roads
          .map((r) => net.roads[r]!)
          .reduce((a, b) => (b.classRank < a.classRank ? b : a));
        expect(corner.classRadius).toBeLessThanOrEqual(CURB_RADIUS_M[lower.roadClass]);
        // Tangent to both road edges where they leave the cut, at the radius from the centre.
        corner.roads.forEach((r, k) => {
          const road = net.roads[r]!;
          const atEnd = road.to === n.idx && (road.from !== n.idx || k === 0);
          const [left, right] = cut(net, r, atEnd);
          const edge = (() => {
            const ring = road.surface;
            const half = ring.length / 2;
            const travelLeft = ring.slice(0, half),
              travelRight = ring.slice(half).reverse();
            // The first road's right edge outward, the second's left edge outward.
            const outwardRight = atEnd ? [...travelLeft].reverse() : travelRight;
            const outwardLeft = atEnd ? [...travelRight].reverse() : travelLeft;
            return k === 0 ? outwardRight : outwardLeft;
          })();
          const t = corner.tangents![k]!;
          if (distance(edge[0]!, atEnd ? (k === 0 ? left : right) : k === 0 ? right : left) > 1e-6)
            failures.push(`${where}: edge does not start at the cut`);
          // A tangent point may lie a hair behind its cut, on the edge's straight extension.
          const d = { x: edge[1]!.x - edge[0]!.x, y: edge[1]!.y - edge[0]!.y };
          const l = Math.hypot(d.x, d.y);
          edge.unshift({ x: edge[0]!.x - (d.x / l) * 0.5, y: edge[0]!.y - (d.y / l) * 0.5 });
          if (nearestOnPolyline(edge, t).away > 0.25)
            failures.push(
              `${where}: tangent ${k} off its edge ${nearestOnPolyline(edge, t).away.toFixed(3)} ${corner.limit} ${corner.radius!.toFixed(2)}`,
            );
          if (Math.abs(distance(t, corner.centre!) - corner.radius!) > 0.02)
            failures.push(`${where}: tangent ${k} off the arc`);
        });
        if (corner.limit === 'class' && Math.abs(corner.radius! - corner.classRadius!) > 1e-6)
          failures.push(`${where}: radius ${corner.radius} under no limit`);
        if (corner.limit !== 'cut' && corner.radius! > corner.classRadius! + 1e-6)
          failures.push(`${where}: radius ${corner.radius} above the class radius`);
      }
    }
    console.info('T38.3', name, 'curbs by limit', limits);
    expect(failures).toEqual([]);
  },
  120_000,
);

const turnDegrees = (a: Vec2, p: Vec2, b: Vec2) => {
  const h1 = Math.atan2(p.y - a.y, p.x - a.x),
    h2 = Math.atan2(b.y - p.y, b.x - p.x);
  return (Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) * 180) / Math.PI;
};

test.each(auditCities)(
  'T38.3: %s draws continuation joints, outer corners and steps without a turn over 20 degrees',
  (name) => {
    const { net } = load(name);
    const failures: string[] = [];
    // Through, merge and diverge joins at nodes without an outline (TASK-071/080/082): the outer
    // surface edges of the two roads meet within 20 degrees.
    for (const n of net.nodes) {
      if (n.outline.length) continue;
      for (const i of n.movements) {
        const m = net.movements[i]!;
        if (!['through', 'merge', 'diverge'].includes(m.turn)) continue;
        const from = net.lanes[m.fromLane]!,
          to = net.lanes[m.toLane]!;
        const a = net.roads[from.road]!,
          b = net.roads[to.road]!;
        for (const side of [0, 1]) {
          const outer = (road: typeof a, lane: number) =>
            side ? road.lanes.at(-1) === lane : road.lanes[0] === lane;
          if (!outer(a, from.idx) || !outer(b, to.idx)) continue;
          const edge = (road: typeof a) => {
            const h = road.surface.length / 2;
            return side ? road.surface.slice(h).reverse() : road.surface.slice(0, h);
          };
          const ea = edge(a),
            eb = edge(b);
          if (distance(ea.at(-1)!, eb[0]!) > 0.5) continue;
          const turn = turnDegrees(ea.at(-2)!, ea.at(-1)!, eb[1]!);
          if (turn > 20) failures.push(`${n.id} ${m.id} side ${side}: ${turn.toFixed(1)}`);
        }
      }
    }
    // At junctions: an outer corner or a step runs from one road edge into the next with no
    // vertex turning more than 20 degrees, the road edges' first metre included.
    for (const n of net.nodes) {
      for (const c of junctionCorners(n)) {
        if (c.kind !== 'outer' && c.kind !== 'step') continue;
        const [ra, rb] = c.roads.map((r) => net.roads[r]!);
        const outward = (road: NonNullable<typeof ra>, right: boolean) => {
          const ring = road.surface;
          const h = ring.length / 2;
          const tl = ring.slice(0, h),
            tr = ring.slice(h).reverse();
          const atEnd = road.to === n.idx;
          return right ? (atEnd ? [...tl].reverse() : tr) : atEnd ? [...tr].reverse() : tl;
        };
        const ea = outward(ra!, true),
          eb = outward(rb!, false);
        const path = [ea[1]!, ...c.ring, eb[1]!];
        for (let i = 1; i + 1 < path.length; i++) {
          if (distance(path[i - 1]!, path[i]!) < 1e-6 || distance(path[i]!, path[i + 1]!) < 1e-6)
            continue;
          const turn = turnDegrees(path[i - 1]!, path[i]!, path[i + 1]!);
          if (turn > 20) {
            failures.push(`${n.id} ${c.kind} ${ra!.id}>${rb!.id} at ${i}: ${turn.toFixed(1)}`);
            break;
          }
        }
      }
    }
    expect(failures).toEqual([]);
  },
  120_000,
);

test('T38.3: class radii at a residential crossing, a side street and a primary crossing', () => {
  const { city, node: at, road, street } = buildCity('Curb classes', 1);
  const two = (
    a: ReturnType<typeof at>,
    b: ReturnType<typeof at>,
    roadClass: 'secondary' | 'primary',
  ) => {
    const streetGroupId = `street:${a.id}:${b.id}`;
    road(a, b, { roadClass, streetGroupId });
    road(b, a, { roadClass, streetGroupId });
  };
  const residential = at(0, 0);
  for (const [x, y] of [
    [200, 0],
    [-200, 0],
    [0, 200],
    [0, -200],
  ] as const)
    street(residential, at(x, y));
  const side = at(1000, 0);
  two(at(800, 0), side, 'secondary');
  two(side, at(1200, 0), 'secondary');
  street(side, at(1000, 200));
  const primary = at(2000, 0);
  for (const [x, y] of [
    [2200, 0],
    [1800, 0],
    [2000, 200],
    [2000, -200],
  ] as const)
    two(primary, at(x, y), 'primary');
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const net = result.compiled;
  const radii = (id: string) =>
    junctionCorners(node(net, id))
      .filter((c) => c.kind === 'curb')
      .map((c) => [c.classRadius, Math.round(c.radius! * 1000) / 1000]);
  expect(radii(residential.id)).toEqual(Array(4).fill([6, 6]));
  expect(radii(side.id)).toEqual(Array(2).fill([6, 6]));
  expect(radii(primary.id)).toEqual(Array(4).fill([12, 12]));
  // The side street's two corners and nothing on the far side of the through road.
  expect(junctionCorners(node(net, side.id)).map((c) => c.kind)).toEqual(['curb', 'curb']);
});

test('T38.2: fixture polygons are simple and cover the capped acute Y', () => {
  const result = compile(junctions());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  for (const n of net.nodes.filter((n) => n.outline.length)) {
    expect(polylineSelfCrossings(n.outline, true), n.id).toBe(0);
    expect(escaping(net, n), n.id).toEqual([]);
    expect(cutsOff(net, n), n.id).toEqual([]);
  }
  // The facing outer edges of the 155/205 degree arms meet west of their capped cuts: the gore
  // covers the tip.
  const acute = node(net, 'n:1');
  const tip = { x: -6 / Math.sin((25 * Math.PI) / 180), y: 0 };
  expect(preparePolygon(acute.outline, 0.1)(tip)).toBe(true);
});

test('T38.2: a short unequal junction holds the movements that escaped the TASK-074 outline', () => {
  // Moved from T20: three movements into r:9 left the old outline, which touched itself where
  // the 16 m arm's stub lay across the 313 degree arm's mouth.
  const { city, node: at, street } = buildCity('Short unequal junction', 1);
  const center = at(0, 0);
  for (const [degrees, length, lanes] of [
    [93, 93, 2],
    [23, 16, 3],
    [313, 39, 4],
  ] as const) {
    const angle = (degrees * Math.PI) / 180;
    street(center, at(Math.cos(angle) * length, Math.sin(angle) * length), lanes);
  }
  const result = compile(city);
  if (!result.ok) throw new Error('fixture');
  const n = node(result.compiled, center.id);
  expect(polylineSelfCrossings(n.outline, true)).toBe(0);
  expect(escaping(result.compiled, n)).toEqual([]);
  expect(cutsOff(result.compiled, n)).toEqual([]);
});

// T38.4: main after stage 2 (7d92383), lengths of the lanes at nodes with an outline.
const stage2Lanes = JSON.parse(
  readFileSync('tests/network/T38-stage2-lane-lengths.json', 'utf8'),
) as Record<AuditCity, Record<string, number>>;

// Lanes that lose more, each with its reason.
const storageExceptions: Record<AuditCity, Record<string, string>> = {
  grid: {},
  town: {},
  sindelfingen: {
    'r:521#0':
      'Leaves n:139 between approaches 58 degrees apart; its edge meets r:476 5.9 m out (stage 2 joined the two as one direction and cut it at 4.2 m).',
  },
  munich: {
    'r:1024#0':
      'n:894: the service way lies on r:899 (shadowed) and is cut to the cap where it crosses Richelstraße r:1001/r:1002, 60 degrees away.',
    'r:1027#0': 'As r:1024, its other direction.',
    'r:1354#1':
      'Arnulfstraße at n:446 is no longer bent away from its other carriageway by the realignment: the road is 4 m shorter.',
    'r:715#1':
      'Arnulfstraße at n:138: both ends at the cap as in stage 2; the lane follows the through alignment to r:958 and is 2.3 m shorter.',
    'r:716#0':
      'Arnulfstraße at n:138, 41 degrees from its other carriageway r:386, now a separate approach: its far edge crosses r:386 at the cap (stage 2 7.1 m).',
    'r:716#1': 'As r:716#0.',
  },
};

test.each(auditCities)(
  'T38.4: %s loses no more than 2 m of any lane against stage 2',
  (name) => {
    const { net } = load(name);
    const losses = net.lanes
      .filter((lane) => stage2Lanes[name][lane.id] !== undefined)
      .filter((lane) => stage2Lanes[name][lane.id]! - lane.lengthM > 2)
      .map((lane) => lane.id)
      .sort();
    expect(losses).toEqual(Object.keys(storageExceptions[name]).sort());
  },
  120_000,
);

// T38.5: the traffic gate against main after stage 2 (7d92383): Munich at 0.15, 7:00 to 10:00,
// 3 686 completed and 58 failed, all gridlocked.
test('T38.5: Munich at 0.15 completes 90 percent of stage 2, gridlock at most 1.5 times', () => {
  const { city, net } = load('munich');
  const morning = probeMorning(city, net, 0.15);
  console.info(
    'T38.5 Munich morning at 0.15',
    morning.completed,
    morning.failedByReason,
    morning.stalledHeads,
  );
  expect(morning.failed).toBe(morning.failedByReason.gridlocked ?? 0);
  expect(morning.completed).toBeGreaterThanOrEqual(Math.ceil(0.9 * 3686));
  expect(morning.failed).toBeLessThanOrEqual(1.5 * 58);
  expect(morning.stalledHeads).toBe(0);
}, 600_000);

/** Everything compiled except TASK-082's corridor geometry (reference lines, stations, corridor
 * surfaces, all derived from the lanes it hashes), hashed (moved from T31). */
function fingerprint(net: CompiledCity) {
  const hash = createHash('sha256');
  const plain = (value: unknown) =>
    JSON.stringify(value, (key, v: unknown) =>
      ['corridorId', 'reference', 'stations', 'corridorSurface'].includes(key)
        ? undefined
        : v instanceof Float64Array
          ? Array.from(v)
          : v,
    );
  for (const list of [net.nodes, net.roads, net.lanes, net.movements, net.places, net.connectors])
    for (const item of list) hash.update(plain(item));
  return hash.digest('hex').slice(0, 16);
}

// Re-measured after TASK-083 (cuts, through alignments, polygons, through movements). Before:
// grid 56deba638330bc89, town fc657fc34fe56206, Sindelfingen 9406c542b3054ff5, Munich
// 330eb51540ef21b3 (T31, with the aprons left out).
const fingerprints: Record<AuditCity, string> = {
  grid: '550abeb39a410ed8',
  town: '21bcc4f206cea7a5',
  sindelfingen: 'e0d07f9df3ecf65f',
  munich: '946d523f0505c680',
};

test.each(auditCities)(
  'T38: %s compiles to its fingerprint',
  (name) => {
    expect(fingerprint(load(name).net)).toBe(fingerprints[name]);
  },
  120_000,
);
