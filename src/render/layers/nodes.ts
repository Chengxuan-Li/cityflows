import {
  areaD,
  booleanOpD,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
} from 'clipper2-ts';
import type { Graphics } from 'pixi.js';
import {
  cumulativeLengths,
  distance as distanceOf,
  pointAtDistance,
  headingAtDistance,
  nearestOnPolyline,
  pointInPolygon,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { crossingArms, endEdges, nodeRoads } from '../../network/crossings';
import { CURB_RADIUS_M } from '../../network/junctions';
import type { CMovement, CNode, CompiledCity, CRoad } from '../../network';
import { paintedCity } from '../road-paint';
import { roadStyle, style } from '../style';

// TASK-347 (drawing only; the compiled outline, cuts and lanes stay as the simulation reads them).
// A node of two arms toward two neighbours (a signalised crossing between junctions, a one-way
// street becoming two-way, a corner, a change in lane count) is drawn as the road running on: a
// strip between its arms' cuts whose sides continue the outermost road edges, with no junction
// fan and no curb bands. A junction group is drawn as one surface: its members' surfaces and its
// inner roads, closed over slivers narrower than `GROUP_CLOSE_M * 2`, with curbs on its outside.

/** Turns sharper than this get a curb on their inner side. */
const STRIP_CURB_ANGLE = (20 * Math.PI) / 180;
const STRIP_STEPS = 16;
/** Arms within this angle of each other (a hairpin) draw as a junction. */
const STRIP_MIN_ANGLE = (30 * Math.PI) / 180;
/** How far a movement may come out of the strip and the strip still be drawn. */
const STRIP_TOLERANCE_M = 0.25;
/** Half the widest sliver a group surface fills between its parts. */
export const GROUP_CLOSE_M = 1;
/** How far a round join's chords may fall inside its arc. */
const ARC_TOLERANCE_M = 0.02;

const strips = new WeakMap<CompiledCity, (Vec2[] | null)[]>();

/** The strip a node of two arms (`crossingArms`) toward two neighbouring nodes is drawn as, or
 * null where it draws its outline: a node with no outline, of other arms, a hairpin, or one whose
 * strip would fold or leave a movement uncovered. */
export function roadStrip(city: CompiledCity, node: CNode): Vec2[] | null {
  city = paintedCity(city);
  let byNode = strips.get(city);
  if (!byNode) strips.set(city, (byNode = []));
  if (byNode[node.idx] === undefined) byNode[node.idx] = buildStrip(city, node);
  return byNode[node.idx]!;
}

function buildStrip(city: CompiledCity, node: CNode): Vec2[] | null {
  if (!node.outline.length) return null;
  const roads = nodeRoads(city, node);
  if (roads.some((r) => r.from === r.to)) return null;
  const neighbours = new Set(roads.map((r) => (r.from === node.idx ? r.to : r.from)));
  const arms = crossingArms(city, node);
  if (neighbours.size !== 2 || arms.length !== 2) return null;
  const sides = arms.map((arm) => {
    const sum = arm.reduce((s, e) => ({ x: s.x + e.direction.x, y: s.y + e.direction.y }), {
      x: 0,
      y: 0,
    });
    const length = Math.hypot(sum.x, sum.y);
    const d = { x: sum.x / length, y: sum.y / length };
    // Each end's corners with the edge's direction toward the node, ordered across the arm from
    // the left to the right of someone at the node looking out along it.
    const corners = arm
      .flatMap((e) =>
        endEdges(e.road, e.atEnd).map((edge) => ({ p: edge[0]!, edge, road: e.road })),
      )
      .map((c) => ({ ...c, across: -(c.p.x - node.pos.x) * d.y + (c.p.y - node.pos.y) * d.x }))
      .sort((a, b) => a.across - b.across);
    return { d, corners };
  });
  const [a, b] = sides as [(typeof sides)[0], (typeof sides)[0]];
  if (a.d.x * b.d.x + a.d.y * b.d.y > Math.cos(STRIP_MIN_ANGLE)) return null;
  type Corner = (typeof a.corners)[0];
  /** A point `s` out along a corner's edge, with the edge's direction there toward the node. */
  const along = (c: Corner, s: number) => {
    const lengths = cumulativeLengths(c.edge);
    const at = Math.min(s, lengths.at(-1)! / 2);
    const p = pointAtDistance(c.edge, lengths, at);
    // Toward the node: out at the corner along its first metre, beyond it along the chord back to
    // the corner (an edge bending just beyond the cut turns its own direction away from the node).
    const q = at > 0 ? c.p : pointAtDistance(c.edge, lengths, Math.min(lengths.at(-1)!, 1));
    const l = distanceOf(p, q) || 1;
    const sign = at > 0 ? 1 : -1;
    const kept = c.edge.filter((_, i) => lengths[i]! > 0 && lengths[i]! < at);
    return { p, t: { x: (sign * (q.x - p.x)) / l, y: (sign * (q.y - p.y)) / l }, kept };
  };
  /** How far ahead of each corner (toward the node) the lines of their edges meet. */
  const meet = (from: Corner, to: Corner) => {
    const [f, g] = [along(from, 0), along(to, 0)];
    const det = f.t.x * -g.t.y - f.t.y * -g.t.x;
    if (Math.abs(det) < 1e-9) return null;
    const dx = to.p.x - from.p.x,
      dy = to.p.y - from.p.y;
    return { u: (dx * -g.t.y - dy * -g.t.x) / det, v: (f.t.x * dy - f.t.y * dx) / det };
  };
  /** The side from `from` to `to`: on the inner side of a turn a curb of the lower road's class
   * radius from its tangent points on the two edges (out beyond the cuts where it needs), else a
   * cubic from corner to corner along the edges, as round as a circular arc. */
  const side = (from: Corner, to: Corner, inner: boolean) => {
    let [f, g] = [along(from, 0), along(to, 0)];
    const deflection = Math.acos(Math.max(-1, Math.min(1, -(f.t.x * g.t.x + f.t.y * g.t.y))));
    const hit = meet(from, to);
    if (inner && hit && deflection > STRIP_CURB_ANGLE) {
      const lower = from.road.classRank <= to.road.classRank ? from.road : to.road;
      const tangent = CURB_RADIUS_M[lower.roadClass] * Math.tan(deflection / 2);
      if (tangent > hit.u) f = along(from, tangent - hit.u);
      if (tangent > hit.v) g = along(to, tangent - hit.v);
    }
    const theta = Math.acos(Math.max(-1, Math.min(1, -(f.t.x * g.t.x + f.t.y * g.t.y))));
    const share =
      theta < 1e-3 ? 1 / 3 : ((4 / 3) * Math.tan(theta / 4)) / (2 * Math.sin(theta / 2));
    const h = share * distanceOf(f.p, g.p);
    const c = [
      f.p,
      { x: f.p.x + h * f.t.x, y: f.p.y + h * f.t.y },
      { x: g.p.x + h * g.t.x, y: g.p.y + h * g.t.y },
      g.p,
    ];
    const cubic = Array.from({ length: STRIP_STEPS + 1 }, (_, i) => {
      const t = i / STRIP_STEPS,
        u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return {
        x: w.reduce((sum, k, j) => sum + k * c[j]!.x, 0),
        y: w.reduce((sum, k, j) => sum + k * c[j]!.y, 0),
      };
    });
    return [...f.kept, ...cubic, ...[...g.kept].reverse()];
  };
  // The inner side of a turn is the one whose edges meet nearer.
  const near = (from: Corner, to: Corner) => {
    const hit = meet(from, to);
    return hit ? Math.max(hit.u, hit.v) : Infinity;
  };
  const right = near(a.corners.at(-1)!, b.corners[0]!),
    left = near(b.corners.at(-1)!, a.corners[0]!);
  const ring = (curbs: boolean) => [
    ...a.corners.map((c) => c.p),
    ...side(a.corners.at(-1)!, b.corners[0]!, curbs && right < left),
    ...b.corners.map((c) => c.p),
    ...side(b.corners.at(-1)!, a.corners[0]!, curbs && left < right),
  ];
  // Where the curb would fold the strip (a short road, a curb past the other arm), corner to
  // corner.
  let cleaned = booleanOpD(ClipType.Union, [ring(true)], null, FillRule.NonZero, 3);
  if (cleaned.length !== 1)
    cleaned = booleanOpD(ClipType.Union, [ring(false)], null, FillRule.NonZero, 3);
  if (cleaned.length !== 1) return null;
  const movements = node.movements.map((i) => city.movements[i]!);
  const covers = (strip: Vec2[]) => {
    const closed = [...strip, strip[0]!];
    return movements.every((m) =>
      m.polyline.every((p) => pointInPolygon(p, closed, STRIP_TOLERANCE_M)),
    );
  };
  const strip = cleaned[0]!.map(({ x, y }) => ({ x, y }));
  if (covers(strip)) return strip;
  // Paths fanning out wider than the strip (lanes added across it, a tight turn) take their own
  // surfaces in, as the outline does.
  const paths = movements.flatMap((m) =>
    inflatePathsD(
      [m.polyline],
      Math.min(city.lanes[m.fromLane]!.widthM, city.lanes[m.toLane]!.widthM) / 2,
      JoinType.Round,
      EndType.Butt,
      2,
      3,
      ARC_TOLERANCE_M,
    ),
  );
  // Arms running on within 30 degrees (lanes added across a straight node) take the convex hull,
  // which keeps the strip's edges straight where the paths' own surfaces would leave lumps.
  const straight = -(a.d.x * b.d.x + a.d.y * b.d.y) > Math.cos(STRIP_MIN_ANGLE);
  const joined = straight
    ? [convexHull([strip, ...paths].flat())]
    : booleanOpD(ClipType.Union, [strip, ...paths], null, FillRule.NonZero, 3);
  if (joined.length !== 1) return null;
  const wider = joined[0]!.map(({ x, y }) => ({ x, y }));
  return covers(wider) ? wider : null;
}

function convexHull(points: Vec2[]): Vec2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Vec2[]) => {
    const out: Vec2[] = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out.at(-2)!, out.at(-1)!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

const groupRings = new WeakMap<CompiledCity, Vec2[][][]>();

/** A junction group's one surface: outer rings and holes (clipper orientation). */
export function groupSurface(city: CompiledCity, group: number): Vec2[][] {
  city = paintedCity(city);
  let byGroup = groupRings.get(city);
  if (!byGroup) groupRings.set(city, (byGroup = []));
  return (byGroup[group] ??= buildGroupSurface(city, group));
}

function buildGroupSurface(city: CompiledCity, index: number): Vec2[][] {
  const group = city.groups![index]!;
  const parts = [
    ...group.nodes.map((n) => nodeSurface(city, city.nodes[n]!)),
    ...group.innerRoads.map((r) => city.roads[r]!.surface),
  ].filter((ring) => ring.length > 2);
  const union = booleanOpD(ClipType.Union, parts, null, FillRule.NonZero, 3);
  const grown = inflatePathsD(
    union,
    GROUP_CLOSE_M,
    JoinType.Round,
    EndType.Polygon,
    2,
    3,
    ARC_TOLERANCE_M,
  );
  return inflatePathsD(
    grown,
    -GROUP_CLOSE_M,
    JoinType.Round,
    EndType.Polygon,
    2,
    3,
    ARC_TOLERANCE_M,
  ).map((ring) => ring.map(({ x, y }) => ({ x, y })));
}

/** What a node draws on its own: its strip, or its outline. */
export function nodeSurface(city: CompiledCity, node: CNode): Vec2[] {
  return roadStrip(city, node) ?? node.outline;
}

/** The rings a node is drawn with, holes after their outer ring (`pointInPolygon` even-odd): a
 * group's surface at its first member and nothing at the others, else its own surface. */
export function drawnRings(city: CompiledCity, node: CNode): Vec2[][] {
  if (node.group === undefined) {
    const ring = nodeSurface(city, node);
    return ring.length ? [ring] : [];
  }
  const group = city.groups![node.group]!;
  return group.nodes[0] === node.idx ? groupSurface(city, node.group) : [];
}

/** TASK-347: a node's drawn surface, in the junction colour. Under the road markings, with the
 * widest verge of its roads as a road is drawn: a strip, and at a group's first member the group's
 * one surface (its medians cut out), which fills between its members and inner roads. Over them,
 * as before: the outline of a node not drawn as road, a group member's too. */
export function drawJunction(
  surfaces: Graphics,
  nodes: Graphics,
  city: CompiledCity,
  node: CNode,
  roadClasses = false,
): void {
  const color = nodeColor(city, node, roadClasses);
  const verge = (roads: CRoad[]) =>
    Math.max(...roads.map((r) => roadStyle(r, roadClasses).vergeM)) * 2;
  const strip = roadStrip(city, node);
  if (strip)
    surfaces
      .poly(strip)
      .fill(color)
      .stroke({ color, width: verge(nodeRoads(city, node)), join: 'round' });
  else if (node.outline.length) nodes.poly(node.outline).fill(color);
  if (node.group === undefined || city.groups![node.group]!.nodes[0] !== node.idx) return;
  const group = city.groups![node.group]!;
  const rings = groupSurface(city, node.group);
  const width = verge(group.nodes.flatMap((n) => nodeRoads(city, city.nodes[n]!)));
  // Clipper's outer rings have a positive area and its holes a negative one.
  const holes = rings.filter((r) => areaD(r) < 0);
  for (const outer of rings.filter((r) => areaD(r) > 0)) {
    const closed = [...outer, outer[0]!];
    const inner = holes.filter((hole) => pointInPolygon(hole[0]!, closed));
    // A cut takes the hole out of the fill just drawn; the verges are stroked after.
    surfaces.poly(outer).fill(color);
    for (const hole of inner) surfaces.poly(hole).cut();
    for (const ring of [outer, ...inner])
      surfaces.poly(ring).stroke({ color, width, join: 'round' });
  }
}

export function roadEndEdges(_city: CompiledCity, road: CRoad, atEnd: boolean) {
  // The surface's cut corners, left then right in travel direction: the junction polygon's
  // corners there (TASK-089: a lane curving with a converging shift is not square to its cut).
  const ring = road.surface;
  const half = ring.length / 2;
  return atEnd ? [ring[half - 1]!, ring[half]!] : [ring[0]!, ring.at(-1)!];
}

export function nodeColor(city: CompiledCity, node: CNode, roadClasses = false): number {
  if (!roadClasses) return style.asphalt;
  const highest = highestRoad(city, node.group === undefined ? [node.idx] : groupNodes(city, node));
  return highest ? roadStyle(highest, true).color : style.asphalt;
}

function groupNodes(city: CompiledCity, node: CNode): number[] {
  return city.groups?.[node.group!]?.nodes ?? [node.idx];
}

function highestRoad(city: CompiledCity, nodes: readonly number[]): CRoad | undefined {
  const at = new Set(nodes);
  return city.roads
    .filter((r) => at.has(r.from) || at.has(r.to))
    .reduce<CRoad | undefined>(
      (best, road) => (!best || road.classRank > best.classRank ? road : best),
      undefined,
    );
}

/** TASK-131: a junction group is one surface. Its inner roads take the tone its members take,
 * that of the highest-ranked road at any member, so no seam shows between them with road classes
 * on; elsewhere a road keeps its own. */
export function roadFill(city: CompiledCity, road: CRoad, roadClasses = false): number {
  if (!roadClasses || road.group === undefined) return roadStyle(road, roadClasses).color;
  const highest = highestRoad(city, city.groups?.[road.group]?.nodes ?? [road.from, road.to]);
  return roadStyle(highest ?? road, true).color;
}

/** The junction polygon, curbs included (TASK-083). */
export function drawNode(graphics: Graphics, node: CNode, color: number = style.asphalt): void {
  if (!node.outline.length) return;
  graphics.poly(node.outline).fill(color);
}

export function drawRoadJoins(
  graphics: Graphics,
  city: CompiledCity,
  road: CRoad,
  roadClasses = false,
): void {
  const { vergeM } = roadStyle(road, roadClasses);
  const color = roadFill(city, road, roadClasses);
  for (const atEnd of [false, true]) {
    const node = city.nodes[atEnd ? road.to : road.from]!;
    if (!node.outline.length) continue;
    const edges = roadEndEdges(city, road, atEnd);
    graphics.poly(edges, false).stroke({ color, width: vergeM * 2, cap: 'round' });
    // TASK-347: a node drawn as road has no curbs; a group's curbs inside its surface face none.
    if (roadStrip(city, node)) continue;
    const taper = curbTaper(city, node);
    if (taper && taper.trunk === road) graphics.poly(taper.ring).fill(color);
    // The road's verge runs on along the curb to its middle, so the curb has no step where the
    // junction surface takes over from the road (TASK-074). TASK-083: its width eases into the
    // next road's verge, so the two halves meet at the middle with one width and no cap.
    for (const band of curbBands(city, node, road, edges, roadClasses))
      if (!innerCurb(city, node, band)) graphics.poly(band).fill(color);
  }
}

/** TASK-347: a curb band whose middle lies inside its node's group surface, clear of its edge. */
export function innerCurb(city: CompiledCity, node: CNode, band: Vec2[]): boolean {
  if (node.group === undefined) return false;
  const half = band.length / 2;
  const mid = Math.floor(half / 2);
  const a = band[mid]!,
    b = band[band.length - 1 - mid]!;
  return insideRings(groupSurface(city, node.group), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
}

/** Inside rings with holes (even-odd), at least `marginM` from every edge. */
export function insideRings(rings: Vec2[][], p: Vec2, marginM = 0.3): boolean {
  let inside = false;
  for (const ring of rings) {
    const closed = [...ring, ring[0]!];
    if (nearestOnPolyline(closed, p).away < marginM) return false;
    if (pointInPolygon(p, closed)) inside = !inside;
  }
  return inside;
}

/** TASK-080 (B36): at a split or merge whose branches run side by side wider than the trunk (an
 * absorbing merge, a lane added at an exit), the curb-side edge eases from the outermost branch
 * to the trunk as one smooth taper over the trunk's `taperM`, drawn under the junction surface.
 * The ring spans from the taper curve to 2 m inside the trunk's edge line. */
export function curbTaper(city: CompiledCity, node: CNode) {
  if (node.control !== 'uncontrolled') return null;
  const roads = nodeRoads(city, node);
  const incoming = roads.filter((r) => r.to === node.idx && r.from !== node.idx);
  const outgoing = roads.filter((r) => r.from === node.idx && r.to !== node.idx);
  const merge = outgoing.length === 1 && incoming.length > 1;
  if (!merge && !(incoming.length === 1 && outgoing.length > 1)) return null;
  const trunk = (merge ? outgoing : incoming)[0]!;
  const side = city.drivingSide === 'right' ? 1 : 0;
  const sign = side ? 1 : -1;
  const lane = city.lanes[trunk.lanes[side ? trunk.lanes.length - 1 : 0]!]!;
  const h = headingAtDistance(lane.polyline, lane.cumulative, merge ? 0 : lane.lengthM);
  const corner = roadEndEdges(city, trunk, !merge)[side]!;
  const frame = (p: Vec2) => ({
    u: (p.x - corner.x) * Math.cos(h) + (p.y - corner.y) * Math.sin(h),
    v: sign * (-(p.x - corner.x) * Math.sin(h) + (p.y - corner.y) * Math.cos(h)),
  });
  const world = (u: number, v: number) => ({
    x: corner.x + u * Math.cos(h) - sign * v * Math.sin(h),
    y: corner.y + u * Math.sin(h) + sign * v * Math.cos(h),
  });
  const branches = merge ? incoming : outgoing;
  const along = branches.every((b) => {
    const l = city.lanes[b.lanes[0]!]!;
    const heading = headingAtDistance(l.polyline, l.cumulative, merge ? l.lengthM : 0);
    return Math.cos(heading - h) > Math.cos(Math.PI / 6);
  });
  if (!along) return null;
  const outer = branches
    .map((b) => frame(roadEndEdges(city, b, merge)[side]!))
    .reduce((a, b) => (b.v > a.v ? b : a));
  if (outer.v < 0.3 || (merge ? outer.u > 0 : outer.u < 0)) return null;
  const taperM = Math.max(15, Math.min(40, 0.4 * trunk.speedLimitMps * 3.6));
  const direction = merge ? 1 : -1;
  const curve: Vec2[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    curve.push(world(outer.u + direction * taperM * t, outer.v * (1 - t * t * (3 - 2 * t))));
  }
  return {
    trunk,
    ring: [...curve, world(outer.u + direction * taperM, -2), world(outer.u, -2)],
  };
}

/** From each of a road end's corners on the outline, the first half of the curb toward the next
 * road end's corner, as a band around the curb whose half width eases (smoothstep along the whole
 * curb) from this road's verge at its corner to the other road's at that one: the other road's
 * band meets it at the middle with the same width and cross-section. */
export function curbBands(
  city: CompiledCity,
  node: CNode,
  road: CRoad,
  corners: Vec2[],
  roadClasses = false,
): Vec2[][] {
  const ring = node.outline.slice(0, -1);
  const n = ring.length;
  const others = nodeRoads(city, node).flatMap((r) => [
    ...(r.from === node.idx ? roadEndEdges(city, r, false).map((p) => ({ p, r })) : []),
    ...(r.to === node.idx ? roadEndEdges(city, r, true).map((p) => ({ p, r })) : []),
  ]);
  const near = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y) <= 0.15;
  const own = roadStyle(road, roadClasses).vergeM;
  return corners.flatMap((corner, side) => {
    // The outline vertex nearest the corner, and the way along the outline away from the road's
    // other corner, judged a little way off (the outline can repeat a corner within millimetres).
    let k = -1;
    ring.forEach((p, i) => {
      if (near(p, corner) && (k < 0 || distanceOf(p, corner) < distanceOf(ring[k]!, corner))) k = i;
    });
    if (k < 0) return [];
    const other = corners[1 - side]!;
    const along = (step: number) => {
      let i = 1;
      while (i < n - 1 && distanceOf(ring[(k + step * i + n * n) % n]!, corner) < 0.3) i++;
      const p = ring[(k + step * i + n * n) % n]!;
      return (p.x - corner.x) * (other.x - corner.x) + (p.y - corner.y) * (other.y - corner.y);
    };
    const step = along(1) < along(-1) ? 1 : -1;
    const curb = [corner];
    let end: CRoad | undefined;
    for (let i = 1; i < n; i++) {
      const p = ring[(k + step * i + n * n) % n]!;
      curb.push(p);
      // The next road end's corner; the ring can repeat a corner within millimetres.
      end = others.find((q) => near(p, q.p) && !near(q.p, corner))?.r;
      if (end) break;
    }
    if (!end) return [];
    // A curb runs out along each road edge to its tangent point and turns back there along the
    // arc: the band covers the arc only, the roads' own verges drawing their edges. TASK-092: the
    // outline also dips under the road where a movement surface's end pokes past the cut.
    const alongEdge = (r: CRoad, p: Vec2) => {
      const h = r.surface.length / 2;
      return (
        [r.surface.slice(0, h), r.surface.slice(h)].some(
          (edge) => nearestOnPolyline(edge, p).away < 0.05,
        ) || pointInPolygon(p, [...r.surface, r.surface[0]!])
      );
    };
    const trim = (path: Vec2[], r: CRoad) => {
      let i = 0;
      while (i + 1 < path.length && alongEdge(r, path[i + 1]!)) i++;
      path.splice(0, i);
    };
    trim(curb, road);
    curb.reverse();
    trim(curb, end);
    curb.reverse();
    if (curb.length < 2) return [];
    const lengths = [0];
    for (let i = 1; i < curb.length; i++)
      lengths.push(lengths[i - 1]! + distanceOf(curb[i - 1]!, curb[i]!));
    const total = lengths.at(-1)!;
    if (total < 1e-6) return [];
    const theirs = roadStyle(end, roadClasses).vergeM;
    const width = (s: number) => {
      const t = Math.max(0, Math.min(1, s / total));
      return own + (theirs - own) * t * t * (3 - 2 * t);
    };
    // The curb's first half, cut at its middle point, and both sides of it at the width there.
    const half: { p: Vec2; s: number }[] = [{ p: curb[0]!, s: 0 }];
    for (let i = 1; i < curb.length; i++) {
      if (lengths[i]! >= total / 2) {
        const t = (total / 2 - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]!);
        const a = curb[i - 1]!,
          b = curb[i]!;
        half.push({ p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, s: total / 2 });
        break;
      }
      half.push({ p: curb[i]!, s: lengths[i]! });
    }
    // Cross-sections at the half's vertices, across the curb's direction there; at the middle,
    // across the segment holding it, which the other half shares.
    const direction = (i: number) => {
      const a = i === 0 ? half[0]!.p : half[i - 1]!.p;
      const b = i === half.length - 1 ? half[i]!.p : half[i + 1]!.p;
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    };
    const left: Vec2[] = [],
      right: Vec2[] = [];
    half.forEach(({ p, s }, i) => {
      const d = direction(i);
      const w = width(s);
      left.push({ x: p.x - d.y * w, y: p.y + d.x * w });
      right.push({ x: p.x + d.y * w, y: p.y - d.x * w });
    });
    return [[...left, ...right.reverse()]];
  });
}

export function drawMovementSurface(
  graphics: Graphics,
  city: CompiledCity,
  movement: CMovement,
  roadClasses = false,
): void {
  if (!city.nodes[movement.node]!.outline.length) return;
  const width = Math.min(
    city.lanes[movement.fromLane]!.widthM,
    city.lanes[movement.toLane]!.widthM,
  );
  graphics.poly(movement.polyline, false).stroke({
    width,
    color: nodeColor(city, city.nodes[movement.node]!, roadClasses),
    cap: 'butt',
  });
}
