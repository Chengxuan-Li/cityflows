import { withoutLotAisles } from '../without-lot-aisles';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  junctionShapeAudit,
  polylineSelfCrossings,
  throughAudit,
  unrelatedOverlaps,
} from '../../bench/geometry-audit';
import { auditCities, loadAuditCity, type AuditCity } from '../../bench/junction-audit';
import { cityTest, tierCities, unitTest } from '../tier';
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
    const city = withoutLotAisles(loadAuditCity(name));
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

cityTest(
  'T38.1: G2, Landsberger Straße keeps its alignment across n:774 and n:719',
  () => {
    const { city, net } = load('munich');
    // TASK-131 keeps OSM nodes: main merged each carriageway's crossing node into one junction
    // with two through pairs. Kept, each carriageway crosses its own group member (n:774 with
    // n:1365 across the 12.8 m median link, n:719 with n:1357 across 11.9 m): one pair at each.
    for (const id of ['n:774', 'n:1365', 'n:719', 'n:1357']) {
      const n = node(net, id);
      const through = throughAudit(city, net, n)!;
      expect(n.group, id).toBeDefined();
      expect(through.pairs, id).toBe(1);
      expect(through.farM, id).toBeLessThanOrEqual(0.1);
      expect(through.nearM, id).toBeLessThanOrEqual(0.1);
      expect(through.laneM, id).toBeLessThan(0.1);
      expect(junctionShapeAudit(city, net, n)!.bulgeM2, id).toBe(0);
    }
    expect(node(net, 'n:1365').group).toBe(node(net, 'n:774').group);
    expect(node(net, 'n:1357').group).toBe(node(net, 'n:719').group);
  },
  120_000,
);

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

test.each(tierCities(auditCities))(
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
  // TASK-101: 7d92383 on the same retained-access topology, rather than the old collapsed map.
  sindelfingen: { bulgeM2: 1591.05, overlapM2: 92.26 },
  munich: { bulgeM2: 905.25, overlapM2: 118.13 },
};

/** TASK-131: unrelated overlap on the kept OSM geometry, m², re-pinned (relax off, the merge and
 * the median pull gone; the coordinator's ruling: different roads overlapping are not moved).
 * The ten largest pairs, m², and their causes:
 * - Sindelfingen 240.88 (was 92.26 + 0.06):
 *   - r:927/r:997 96.56: unnamed opposite one-way service roads with no ref, so no pair; their
 *     OSM ways run 2.95 m apart for 1 + 2 lanes (4.5 m).
 *   - r:1228/r:140 42.94: a driveway 4.6 m beside a street, 3 m of lanes each; both unnamed, so
 *     not a B55 side-by-side pair.
 *   - r:1061/r:966 19.69, r:1055/r:80 7.19, r:965/r:975 4.75: the plant road's carriageways
 *     (lanes=4 beside 1 lane, OSM 6.9 to 7.0 m apart for 7.5 m), unnamed with no ref: not paired.
 *   - A 81 r:464/r:543 17.13: pushOverlapping eases its push to zero at n:542's lane gain and at
 *     the bbox cut ends.
 *   - A 81 r:1254/r:464 13.44: r:1254 is 48 m long, the push eased to zero at both ends.
 *   - A 81 r:1255/r:545 16.81, r:1255/r:464 9.81, r:1252/r:545 6.25: the network's continuation
 *     offset moves the two-lane r:1255 and r:545 1.75 m toward the median at the lane changes
 *     (n:1251, n:1253); the importer's push cannot act at nodes.
 *   The retained r:1060/r:966 pair still has 0.75 m² (stage 2: 0.69 m²).
 * - Munich 106.58 (was 118.13):
 *   - r:259/r:694 70.25, r:416/r:694 0.94: r:694's -1.75 m continuation offset at n:320, beside
 *     n:257.
 *   - r:1030/r:416 15.63, r:1030/r:687 4.75: the Trappentreutunnel pair ends at n:320, n:257
 *     and n:194, where its push eases to zero.
 *   - r:735/r:925 7.13, r:196/r:259 4.75, r:259/r:261 2.5, r:685/r:997 0.63: a ramp beside a
 *     trunk within 20 m of their merge or diverge node (n:924, n:195, n:675). */
const keptOverlapM2: Partial<Record<AuditCity, number>> = { sindelfingen: 240.88, munich: 106.58 };

test.each(tierCities(auditCities))(
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
    expect(overlap).toBeLessThanOrEqual((keptOverlapM2[name] ?? stage2[name].overlapM2) + 0.01);
  },
  120_000,
);

test.each(tierCities(auditCities))(
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

test.each(tierCities(auditCities))(
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

test.each(tierCities(auditCities))(
  'T38.3: %s curbs leave and meet their road edges within 20 degrees (B42)',
  (name) => {
    const { net } = load(name);
    const failures: string[] = [];
    // TASK-089 (B42, n:138's nubs): a curb's curve starts on the first road's right edge and ends
    // on the second's left edge, running along each edge there (its tangent, estimated from its
    // first three samples, within 20 degrees of the edge's direction): no jog or tooth where the
    // curb meets the road.
    for (const n of net.nodes) {
      for (const c of junctionCorners(n)) {
        if (c.kind !== 'curb' || !c.curve || c.curve.length < 3) continue;
        const where = `${n.id} ${c.roads.map((r) => net.roads[r]!.id).join('>')}`;
        const [ra, rb] = c.roads.map((r) => net.roads[r]!);
        const outward = (road: NonNullable<typeof ra>, right: boolean, k: number) => {
          const ring = road.surface;
          const h = ring.length / 2;
          const tl = ring.slice(0, h),
            tr = ring.slice(h).reverse();
          const atEnd = road.to === n.idx && (road.from !== n.idx || k === 0);
          return right ? (atEnd ? [...tl].reverse() : tr) : atEnd ? [...tr].reverse() : tl;
        };
        const curve = c.curve;
        for (const [k, edge, [p0, p1, p2]] of [
          [0, outward(ra!, true, 0), [curve[0]!, curve[1]!, curve[2]!]],
          [1, outward(rb!, false, 1), [curve.at(-1)!, curve.at(-2)!, curve.at(-3)!]],
        ] as const) {
          const hit = nearestOnPolyline(edge, p0);
          if (hit.away > 0.01) failures.push(`${where}: end ${k} ${hit.away.toFixed(3)} m off`);
          // The curve's direction into the corner at p0 (quadratic through the first three
          // samples); outward along the edge is the opposite.
          const t = { x: 4 * (p1.x - p0.x) - (p2.x - p0.x), y: 4 * (p1.y - p0.y) - (p2.y - p0.y) };
          const l = Math.hypot(t.x, t.y);
          if (l < 1e-9) continue;
          const cos = -(t.x * hit.direction.x + t.y * hit.direction.y) / l;
          const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
          if (angle > 20) failures.push(`${where}: end ${k} at ${angle.toFixed(1)} degrees`);
        }
      }
    }
    expect(failures).toEqual([]);
  },
  120_000,
);

unitTest(
  'T38.3: class radii at a residential crossing, a side street and a primary crossing',
  () => {
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
  },
);

unitTest('T38.2: fixture polygons are simple and cover the capped acute Y', () => {
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

unitTest(
  'T38.2: a short unequal junction holds the movements that escaped the TASK-074 outline',
  () => {
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
  },
);

// T38.4: main after stage 2 (7d92383), lengths of the lanes at nodes with an outline.
// TASK-101: real-city maps recompiled by unmodified 7d92383 on the same retained-access
// canonical cities. Both copies retain signal control with identical empty green groups
// for geometry-only comparison; green schedules do not change lane lengths. Budgets stay fixed.
const stage2Lanes = JSON.parse(
  readFileSync('tests/network/T38-stage2-lane-lengths.json', 'utf8'),
) as Record<AuditCity, Record<string, number>>;

// Lanes that lose more on main 5568eed, each with its reason. TASK-090: a budget, not this exact
// list (every junction geometry task renamed lanes in it): at most `storageBudget` lanes lose more than
// 2 m, none more than 10 m.
// TASK-131: stage 2 re-recorded on the cities that keep OSM geometry (797678e); Sindelfingen's
// budget 4 -> 19, each lane named below. Munich loses 4 (r:410#0, r:552#0, r:600#0, r:601#0).
const storageBudget: Record<AuditCity, number> = { grid: 0, town: 0, sindelfingen: 19, munich: 30 };
const storageExceptions: Record<AuditCity, Record<string, string>> = {
  grid: {},
  town: {},
  sindelfingen: {
    'r:521#0':
      'Leaves n:139 between approaches 58 degrees apart; its edge meets r:476 5.9 m out (stage 2 joined the two as one direction and cut it at 4.2 m).',
    // TASK-089.
    'r:1109#0':
      'n:594: r:1061/r:966 converge there and are set side by side, so the side street meets a wider approach (2.1 m).',
    // TASK-131: Benzstraße's split nodes n:867 and n:902 (merged on main) are junctions since
    // 797678e (a two-way direction never shifts at a continuation), each with a 10 m radius.
    'r:1065#0': 'Leaves n:867, cut 8.9 m out (8.8 m).',
    'r:868#0': 'Leaves n:867 beside r:871, cut 4 m out (4.7 m).',
    'r:868#1': 'As r:868#0 (4.7 m).',
    'r:869#0': 'Enters n:867, cut 2.5 m out (2.5 m).',
    'r:871#0': 'Enters n:867, cut at its 10 m radius (10.42 m, `beyondTen`).',
    'r:871#1': 'As r:871#0 (9.7 m).',
    'r:1225#0': 'Enters n:902, cut at its 10 m radius (10.0002 m, `beyondTen`).',
    'r:1225#1': 'As r:1225#0 (10.0 m).',
    'r:1246#0': 'Leaves n:902, cut at its 10 m radius (9.9 m).',
    'r:903#0': 'Enters n:902 (3.2 m).',
    'r:904#0': 'Leaves n:902 (3.6 m).',
    // TASK-131: TASK-089's converging pair at n:580 and n:581, on OSM nodes.
    'r:582#0': 'The unnamed pair from n:580 to n:581, cut 2.5 m out at both (5.0 m).',
    'r:583#0': 'As r:582#0, its other carriageway (5.0 m).',
    'r:585#0': 'Into n:580 beside the pair (2.0 m).',
    'r:586#0': 'As r:585#0, its other direction (2.1 m).',
    'r:592#0': 'Way 332200797 into n:581 beside the pair (2.6 m).',
    'r:593#0': 'As r:592#0, its other direction (2.4 m).',
    // TASK-131: smoothing no longer fillets within 30 m of a node.
    'r:626#0':
      'Its 86-degree OSM vertex 5.3 m from n:345 is eased to radius 3.25 m and the lane is cut beyond it (2.7 m).',
    'r:627#0': 'As r:626#0, its other direction (2.1 m).',
  },
  munich: {
    'r:1024#0':
      'n:894: the service way lies on r:899 (shadowed) and is cut to the cap where it crosses Richelstraße r:1001/r:1002, 60 degrees away.',
    'r:1027#0': 'As r:1024, its other direction.',
    'r:715#1':
      'Arnulfstraße at n:138: both ends at the cap as in stage 2; the lane follows the through alignment to r:958 and is 2.3 m shorter.',
    // TASK-087: Landsberger Straße's carriageways meet n:322 and n:328 side by side, a 14.5 m
    // divided street instead of 7 m converging ones, so the side streets are cut farther out.
    'r:281#0': 'Max-Friedlaender-Bogen at n:322 meets the 14.5 m Landsberger pair (3.9 m).',
    'r:282#0': 'As r:281#0, its other direction (3.3 m).',
    'r:487#0': 'Max-Friedlaender-Bogen at the signal n:328, beside the pushed pairs (3.4 m).',
    'r:488#0': 'As r:487#0, its other direction (2.6 m).',
    'r:762#0': 'Schrenkstraße at the signal n:328, beside the pushed pairs (2.7 m).',
    'r:763#0': 'As r:762#0, its other direction (2.5 m).',
    // TASK-089: side streets at junctions where a street's carriageways converge and are set side
    // by side (each its own end, half the corridor separation off the node), or where B43 keeps a
    // divided pair's median: they meet a wider approach and are cut farther out.
    'r:1050#0': 'n:719: Landsberger Straße keeps its 0.5 m median at the node (B43) (3.8 m).',
    'r:1182#0': 'n:1181, the side street between the converging pairs (3.8 m).',
    'r:1183#0': 'As r:1182#0, its other direction (4.4 m).',
    'r:1260#0': 'n:382, the stub beside the converging r:383/r:399 (3.8 m).',
    'r:1261#0': 'As r:1260#0, its other direction (3.7 m).',
    'r:1262#0': 'n:382, the other stub (3.5 m).',
    'r:1263#0': 'As r:1262#0, its other direction (4.3 m).',
    'r:36#0': 'n:33, beside the converging r:845/r:944 and r:946/r:948 (3.3 m).',
    'r:368#0':
      'Marsstraße between n:949 and n:823, both converging nodes: cut farther out at n:949 (2.7 m).',
    'r:368#1': 'As r:368#0 (2.7 m).',
    'r:480#0': 'As r:368#0, its other direction (3.7 m).',
    'r:480#1': 'As r:480#0 (3.7 m).',
    'r:422#0': 'n:949, the side street beside the converging pairs (2.7 m).',
    'r:423#0': 'As r:422#0, its other direction (3.5 m).',
    'r:542#0':
      'n:446: Arnulfstraße r:1354/r:447 is separated by the importer now, a wider approach (3.7 m).',
    'r:543#0': 'As r:542#0, its other direction (3.1 m).',
    'r:806#0': 'n:407, beside the converging r:386/r:716 (3.6 m).',
    'r:824#0': 'n:823, beside the converging r:1372/r:845 (3.2 m).',
    'r:946#1': 'n:33, the inner lane of the split r:946 beside r:948, cut 2.2 m farther out.',
  },
};

/** TASK-131: lanes that lose more than 10 m, each with its bound. Sindelfingen r:871#0 and
 * r:1225#0 enter Benzstraße's splits n:867 and n:902, junctions with a 10 m radius since 797678e
 * (merged on main): 10.42 m and 10.0002 m. */
const beyondTen: Record<string, number> = {
  'sindelfingen r:871#0': 10.5,
  'sindelfingen r:1225#0': 10.01,
};

test.each(tierCities(auditCities))(
  'T38.4: %s loses more than 2 m on few lanes and no more than 10 m on any against stage 2',
  (name) => {
    const { net } = load(name);
    const losses = net.lanes
      .filter((lane) => stage2Lanes[name][lane.id] !== undefined)
      .map((lane) => ({ id: lane.id, lossM: stage2Lanes[name][lane.id]! - lane.lengthM }))
      .filter((lane) => lane.lossM > 2);
    const unrecorded = losses.filter((lane) => !storageExceptions[name][lane.id]);
    console.info('T38.4', name, losses.length, 'lanes lose over 2 m; not recorded:', unrecorded);
    expect(losses.length).toBeLessThanOrEqual(storageBudget[name]);
    expect(losses.filter((lane) => lane.lossM > (beyondTen[`${name} ${lane.id}`] ?? 10))).toEqual(
      [],
    );
  },
  120_000,
);

// T38.5, Munich's morning, became the traffic gate in tests/traffic/munich-morning.test.ts.

// TASK-090: the fingerprint test (a hash of everything compiled, moved from T31) is gone: it moved
// with every geometry change and reimport determinism (tests/importers/determinism.test.ts, T23,
// T24) covers determinism.
