import {
  areaD,
  booleanOpD,
  booleanOpDWithPolyTree,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
  PolyTreeD,
  type PolyPathD,
} from 'clipper2-ts';
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { straightSkeleton, type StraightSkeleton } from '../geo/straight-skeleton';
import type { Vec2 } from '../geo/vec2';
import type { ContextFeature, RoofShape } from '../schema';

type Area = Extract<ContextFeature, { kind: 'area' }>;
type Vertex = Vec2 & { h: number };
type Patch = { ring: Vec2[]; height: (p: Vec2) => number };
type Fallback = 'courtyard' | 'irregular-footprint' | 'skeleton';

export interface RoofGeometry {
  roof: BufferGeometry;
  infill: BufferGeometry;
  wallHeightM: number;
  roofHeightM: number;
  shape: RoofShape;
  fallbackReason?: Fallback;
}

const epsilon = 1e-8;
const cross = (a: Vec2, b: Vec2, p: Vec2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const area = (ring: readonly Vec2[]) =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;

function openRing(ring: Vec2[]) {
  const first = ring[0]!,
    last = ring[ring.length - 1]!;
  return first.x === last.x && first.y === last.y ? ring.slice(0, -1) : ring;
}

function hull(ring: Vec2[]) {
  const sorted = [...ring].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (points: Vec2[]) => {
    const result: Vec2[] = [];
    for (const p of points) {
      while (result.length >= 2 && cross(result.at(-2)!, result.at(-1)!, p) <= 0) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function bounds(ring: Vec2[], u: Vec2, v: Vec2) {
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const p of ring) {
    const x = p.x * u.x + p.y * u.y,
      y = p.x * v.x + p.y * v.y;
    minU = Math.min(minU, x);
    maxU = Math.max(maxU, x);
    minV = Math.min(minV, y);
    maxV = Math.max(maxV, y);
  }
  return { minU, maxU, minV, maxV, area: (maxU - minU) * (maxV - minV) };
}

function rectangle(ring: Vec2[]) {
  const convex = hull(ring);
  let best = {
    u: { x: 1, y: 0 },
    v: { x: 0, y: 1 },
    ...bounds(ring, { x: 1, y: 0 }, { x: 0, y: 1 }),
  };
  for (let i = 0; i < convex.length; i++) {
    const p = convex[i]!,
      q = convex[(i + 1) % convex.length]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const u = { x: (q.x - p.x) / length, y: (q.y - p.y) / length };
    const v = { x: -u.y, y: u.x };
    const box = bounds(ring, u, v);
    if (box.area < best.area - epsilon) best = { u, v, ...box };
  }
  if (best.maxV - best.minV > best.maxU - best.minU) {
    const u = best.v,
      v = { x: -u.y, y: u.x };
    return { u, v, ...bounds(ring, u, v) };
  }
  return best;
}

function geometry(positions: number[]) {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const uv: number[] = [];
  for (let i = 0; i < positions.length; i += 3) uv.push(positions[i]!, positions[i + 2]!);
  result.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  result.computeVertexNormals();
  return result;
}

function patch(vertices: Vertex[]): Patch {
  const a = vertices[0]!;
  const b = vertices[1]!;
  let c = vertices[2]!;
  for (let i = 2; Math.abs(cross(a, b, c)) < epsilon && i < vertices.length; i++) c = vertices[i]!;
  // Each patch is planar; clipping changes only its boundary, never its pitch.
  const determinant = cross(a, b, c);
  const dx = ((b.h - a.h) * (c.y - a.y) - (c.h - a.h) * (b.y - a.y)) / determinant;
  const dy = ((b.x - a.x) * (c.h - a.h) - (c.x - a.x) * (b.h - a.h)) / determinant;
  const ring = vertices.map(({ x, y }) => ({ x, y }));
  if (area(ring) < 0) ring.reverse();
  return { ring, height: (p) => a.h + dx * (p.x - a.x) + dy * (p.y - a.y) };
}

function roofPatches(shape: RoofShape, a: number, b: number): Patch[] {
  const point = (x: number, y: number, h: number): Vertex => ({ x, y, h });
  const patches: Patch[] = [];
  const add = (...vertices: Vertex[]) => {
    if (Math.abs(area(vertices)) > epsilon) patches.push(patch(vertices));
  };
  const strip = (v0: number, h0: number, v1: number, h1: number) =>
    add(point(-a, v0, h0), point(a, v0, h0), point(a, v1, h1), point(-a, v1, h1));
  const hip = (x: number, y: number, eave: number, peak: number, pyramid = false) => {
    const r = pyramid ? 0 : x - Math.min(y, x * 0.8);
    const A = point(-x, -y, eave),
      B = point(x, -y, eave);
    const C = point(x, y, eave),
      D = point(-x, y, eave);
    const R = point(-r, 0, peak),
      S = point(r, 0, peak);
    add(A, B, S, R);
    add(B, C, S);
    add(C, D, R, S);
    add(D, A, R);
  };
  switch (shape) {
    case 'skillion':
      strip(-b, 1, b, 0);
      break;
    case 'gambrel':
      strip(-b, 0, -b * 0.65, 0.72);
      strip(-b * 0.65, 0.72, 0, 1);
      strip(0, 1, b * 0.65, 0.72);
      strip(b * 0.65, 0.72, b, 0);
      break;
    case 'hipped':
      hip(a, b, 0, 1);
      break;
    case 'pyramidal':
      hip(a, b, 0, 1, true);
      break;
    case 'round':
      // TASK-210: a barrel vault, half an ellipse across the short side, in planar strips.
      for (let i = 0; i < 12; i++) {
        const t0 = (Math.PI * i) / 12,
          t1 = (Math.PI * (i + 1)) / 12;
        strip(-b * Math.cos(t0), Math.sin(t0), -b * Math.cos(t1), Math.sin(t1));
      }
      break;
    case 'mansard': {
      const inset = Math.min(a, b) * 0.25;
      const innerA = a - inset,
        innerB = b - inset;
      const outer = [point(-a, -b, 0), point(a, -b, 0), point(a, b, 0), point(-a, b, 0)];
      const inner = [
        point(-innerA, -innerB, 0.75),
        point(innerA, -innerB, 0.75),
        point(innerA, innerB, 0.75),
        point(-innerA, innerB, 0.75),
      ];
      for (let i = 0; i < 4; i++)
        add(outer[i]!, outer[(i + 1) % 4]!, inner[(i + 1) % 4]!, inner[i]!);
      hip(innerA, innerB, 0.75, 1);
      break;
    }
    case 'half-hipped': {
      const r = a - Math.min(b * 0.5, a * 0.5);
      const A = point(-a, -b, 0),
        B = point(a, -b, 0),
        C = point(a, b, 0),
        D = point(-a, b, 0);
      const L0 = point(-a, -b * 0.5, 0.5),
        L1 = point(-a, b * 0.5, 0.5);
      const R0 = point(a, -b * 0.5, 0.5),
        R1 = point(a, b * 0.5, 0.5);
      const L = point(-r, 0, 1),
        R = point(r, 0, 1);
      add(A, B, R0, R, L, L0);
      add(C, D, L1, L, R, R1);
      add(L0, L, L1);
      add(R0, R1, R);
      break;
    }
    default:
      strip(-b, 0, 0, 1);
      strip(0, 1, b, 0);
  }
  return patches;
}

/** TASK-201: a convex footprint other than a near-rectangle (the Münster spire's octagon) is
 * not one of the box shapes: its pyramid rises from every edge to the centroid. */
function convex(ring: Vec2[]) {
  const sign = Math.sign(area(ring));
  return ring.every(
    (p, i) =>
      cross(p, ring[(i + 1) % ring.length]!, ring[(i + 2) % ring.length]!) * sign >= -epsilon,
  );
}

function centroid(ring: Vec2[]): Vec2 {
  let cx = 0,
    cy = 0,
    twice = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    const c = p.x * q.y - q.x * p.y;
    twice += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  });
  return { x: cx / (3 * twice), y: cy / (3 * twice) };
}

function apexPatches(ring: Vector2[]): Patch[] {
  const apex = { ...centroid(ring), h: 1 };
  return ring.flatMap((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return Math.abs(cross(p, q, apex)) > epsilon
      ? [patch([{ x: p.x, y: p.y, h: 0 }, { x: q.x, y: q.y, h: 0 }, apex])]
      : [];
  });
}

/** TASK-210: every edge faces the centroid, so copies of the outline scaled about it nest. */
function starShaped(ring: Vec2[]) {
  const c = centroid(ring),
    sign = Math.sign(area(ring));
  return ring.every((p, i) => cross(p, ring[(i + 1) % ring.length]!, c) * sign > epsilon);
}

type Profile = readonly (readonly [scale: number, height: number])[];

/** A hemisphere (stretched when the roof is taller than the radius) or, lower, a spherical cap:
 * angles from the springing to the crown, as outline scale and height fraction. */
function domeProfile(radius: number, height: number): Profile {
  const alpha = 2 * Math.atan(Math.min(1, height / radius));
  return Array.from({ length: 9 }, (_, i) => {
    const theta = alpha * (1 - i / 8);
    return [
      Math.sin(theta) / Math.sin(alpha),
      (Math.cos(theta) - Math.cos(alpha)) / (1 - Math.cos(alpha)),
    ];
  });
}

/** A neck on a ledge, a bulb as wide as the outline, and a concave taper to a point. */
const onionProfile: Profile = [
  [1, 0],
  [0.8, 0],
  [0.9, 0.06],
  [0.98, 0.16],
  [1, 0.26],
  [0.95, 0.38],
  [0.8, 0.5],
  [0.56, 0.6],
  [0.34, 0.69],
  [0.18, 0.79],
  [0.08, 0.89],
  [0, 1],
];

/** TASK-210: dome and onion. Each section is the outline scaled about its centroid, so each band
 * between two sections is a ring of planar trapezoids: a sphere on a circular outline, a cloister
 * vault on a square one. Triangles face outward (the onion's lower bulb faces down). */
function revolve(ring: Vec2[], profile: Profile): Vertex[] {
  const c = centroid(ring);
  const loop = area(ring) > 0 ? [...ring].reverse() : ring;
  const at = (p: Vec2, [scale, h]: Profile[number]): Vertex => ({
    x: c.x + (p.x - c.x) * scale,
    y: c.y + (p.y - c.y) * scale,
    h,
  });
  const triangles: Vertex[] = [];
  for (let k = 0; k + 1 < profile.length; k++)
    loop.forEach((p, i) => {
      const q = loop[(i + 1) % loop.length]!;
      const a = at(p, profile[k]!),
        b = at(q, profile[k]!),
        upperB = at(q, profile[k + 1]!),
        upperA = at(p, profile[k + 1]!);
      triangles.push(a, b, upperB);
      if (profile[k + 1]![0] > 0) triangles.push(a, upperB, upperA);
    });
  return triangles;
}

/** Convex clipping of each footprint triangle retains concave edges and courtyard holes. */
function clip(subject: Vec2[], ring: Vec2[]) {
  let result = subject;
  for (let i = 0; i < ring.length && result.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    const input = result;
    result = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!,
        q = input[(j + 1) % input.length]!;
      const cp = cross(a, b, p),
        cq = cross(a, b, q);
      if (cp >= -epsilon) result.push(p);
      if (cp < -epsilon !== cq < -epsilon) {
        const t = cp / (cp - cq);
        result.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return result;
}

function clipEdge(a: Vec2, b: Vec2, ring: Vec2[]) {
  let start = 0,
    end = 1;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!,
      q = ring[(i + 1) % ring.length]!;
    const ca = cross(p, q, a),
      cb = cross(p, q, b);
    if (ca < -epsilon && cb < -epsilon) return undefined;
    if (ca < -epsilon) start = Math.max(start, ca / (ca - cb));
    if (cb < -epsilon) end = Math.min(end, ca / (ca - cb));
  }
  return end - start > epsilon ? [start, end] : undefined;
}

type Ends = 'hipped' | 'gabled' | 'half-hipped';
/** Height (fraction of the roof's) against time (fraction of the skeleton's peak). */
type Section = readonly (readonly [time: number, height: number])[];
const pitch: Section = [
  [0, 0],
  [1, 1],
];
/** TASK-236: how each pitched shape takes the skeleton: which wing ends stand, and its section.
 * Gambrel and mansard break where the box roofs do (at 35% and 25% of the half width, 72% and
 * 75% up); round is the box barrel's semicircle in the same 12 steps, from the widest wing. */
const skeletonStyles: Partial<Record<RoofShape, { ends: Ends; section: Section }>> = {
  gabled: { ends: 'gabled', section: pitch },
  hipped: { ends: 'hipped', section: pitch },
  pyramidal: { ends: 'hipped', section: pitch },
  'half-hipped': { ends: 'half-hipped', section: pitch },
  gambrel: {
    ends: 'gabled',
    section: [
      [0, 0],
      [0.35, 0.72],
      [1, 1],
    ],
  },
  mansard: {
    ends: 'hipped',
    section: [
      [0, 0],
      [0.25, 0.75],
      [1, 1],
    ],
  },
  round: {
    ends: 'gabled',
    section: Array.from(
      { length: 7 },
      (_, i) => [1 - Math.cos((Math.PI * i) / 12), Math.sin((Math.PI * i) / 12)] as const,
    ),
  },
};

/** The point where the edge pq reaches time `level`, found from its lower end so the faces on
 * either side of the edge share it exactly. */
function cut(p: Vertex, q: Vertex, level: number): Vertex {
  const [low, high] = p.h < q.h ? [p, q] : [q, p];
  const t = (level - low.h) / (high.h - low.h);
  return { x: low.x + (high.x - low.x) * t, y: low.y + (high.y - low.y) * t, h: level };
}

/** The convex pieces of a convex polygon between consecutive levels of its time. A vertex
 * within a micrometre of a level lies on it, so no piece has a sliver beside it. */
function bands(polygon: Vertex[], levels: readonly number[]) {
  const pieces: Vertex[][] = [];
  let rest = polygon;
  for (const level of levels) {
    const below: Vertex[] = [],
      above: Vertex[] = [];
    rest.forEach((p, i) => {
      const q = rest[(i + 1) % rest.length]!;
      const dp = p.h - level,
        dq = q.h - level;
      if (dp <= 1e-6) below.push(p);
      if (dp >= -1e-6) above.push(p);
      if ((dp < -1e-6 && dq > 1e-6) || (dp > 1e-6 && dq < -1e-6)) {
        const point = cut(p, q, level);
        below.push(point);
        above.push(point);
      }
    });
    if (below.length >= 3) pieces.push(below);
    rest = above;
    if (rest.length < 3) return pieces;
  }
  pieces.push(rest);
  return pieces;
}

/** TASK-227: the roof over a straight skeleton, as triangles of (x, y, time) in the outline's
 * frame: every face slopes from its edge, all at one pitch. Gabled, a face that is a triangle
 * under the end of a level ridge (the ridge leaves its apex within 60 degrees of square to the
 * edge, its apex over the middle 80% of the edge: a wing's short end) stands vertical instead:
 * its apex moves out over the edge, keeping its height, and the triangle goes to the walls.
 * TASK-236: half-hipped, such an end stands to half the ridge's time under a hip at the face's
 * own pitch: the apex moves halfway out, the wall's top corners lie on the edge at half time
 * (the box roof's half hip), and the neighbouring faces run out to them. `walls` are the
 * standing ends, each wound edge start, top, edge end, so it faces out. */
function skeletonRoof({ nodes, faces, arcs }: StraightSkeleton, ends: Ends) {
  const points: Vertex[] = nodes.map(({ x, y, t }) => ({ x, y, h: t }));
  const rings = faces.map((face) => [...face.nodes]);
  const walls: Vertex[][] = [];
  const moved = new Set<number>();
  /** Puts `node` between `a` and `b` in the face that runs from `a` to `b`. */
  const insert = (a: number, b: number, node: number) => {
    for (const ring of rings) {
      const i = ring.findIndex((n, k) => n === a && ring[(k + 1) % ring.length] === b);
      if (i >= 0) return void ring.splice(i + 1, 0, node);
    }
    throw new Error('A skeleton arc has no face on its other side');
  };
  if (ends !== 'hipped')
    faces.forEach((face, index) => {
      const apex = face.nodes.slice(face.base);
      if (apex.length !== 1 || moved.has(apex[0]!)) return;
      const top = nodes[apex[0]!]!,
        from = nodes[face.nodes[0]!]!,
        to = nodes[face.nodes[face.base - 1]!]!;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const dx = (to.x - from.x) / length,
        dy = (to.y - from.y) / length;
      const along = (top.x - from.x) * dx + (top.y - from.y) * dy;
      if (along < 0.1 * length || along > 0.9 * length) return;
      const incident = arcs.filter((arc) => arc.includes(apex[0]!));
      const ridges = incident.filter((arc) => {
        const other = nodes[arc[0] === apex[0] ? arc[1] : arc[0]]!;
        const run = Math.hypot(other.x - top.x, other.y - top.y);
        return (
          run > 0.01 &&
          Math.abs(other.t - top.t) < 0.1 * run &&
          Math.abs((other.x - top.x) * dx + (other.y - top.y) * dy) < 0.5 * run
        );
      });
      if (incident.length !== 3 || ridges.length !== 1) return;
      moved.add(apex[0]!);
      const on = (s: number, h: number) => ({ x: from.x + dx * s, y: from.y + dy * s, h });
      const start = { x: from.x, y: from.y, h: 0 },
        end = { x: to.x, y: to.y, h: 0 };
      if (ends === 'gabled') {
        points[apex[0]!] = on(along, top.t);
        rings[index] = [];
        walls.push([start, points[apex[0]!]!, end]);
        return;
      }
      const half = top.t / 2;
      // The inward normal is the edge's direction turned left.
      points[apex[0]!] = {
        x: from.x + dx * along - dy * half,
        y: from.y + dy * along + dx * half,
        h: top.t,
      };
      const left = points.push(on(along / 2, half)) - 1,
        right = points.push(on((length + along) / 2, half)) - 1;
      insert(face.nodes[0]!, apex[0]!, left);
      insert(apex[0]!, face.nodes[face.base - 1]!, right);
      rings[index] = [left, right, apex[0]!];
      walls.push([start, points[left]!, points[right]!, end]);
    });
  const triangles: Vertex[] = [];
  for (const nodeRing of rings) {
    if (!nodeRing.length) continue;
    const ring = nodeRing.map((i) => points[i]!);
    for (const triangle of ShapeUtils.triangulateShape(
      ring.map((p) => new Vector2(p.x, p.y)),
      [],
    )) {
      const [p, q, r] = triangle.map((i) => ring[i]!) as [Vertex, Vertex, Vertex];
      triangles.push(p, q, r);
    }
  }
  return { triangles, walls };
}

const top = (piece: { heightM?: number; levels?: number }) =>
  piece.heightM ?? (piece.levels === undefined ? undefined : piece.levels * 3);
const positive = (ring: Vec2[]) => {
  const open = openRing(ring).map(({ x, y }) => ({ x, y }));
  return area(open) < 0 ? open.reverse() : open;
};
const closed = (ring: { x: number; y: number }[]) => [
  ...ring.map(({ x, y }) => ({ x, y })),
  { x: ring[0]!.x, y: ring[0]!.y },
];

/** TASK-272: the outline's area that no part covers, as outer rings with their holes. Pieces
 * narrower than 1 m (the seams left where outline and parts were simplified apart) and under
 * 4 m² (the importer's smallest area) are dropped. */
function uncovered(feature: Area): Vec2[][][] {
  // Its courtyards and its parts' outer rings, all one way round, so overlaps never cancel.
  const covered = [...feature.rings.slice(1), ...feature.parts!.map((part) => part.rings[0]!)];
  const rest = booleanOpD(
    ClipType.Difference,
    [positive(feature.rings[0]!)],
    covered.map(positive),
    FillRule.NonZero,
    2,
  );
  const opened = inflatePathsD(
    inflatePathsD(rest, -0.5, JoinType.Miter, EndType.Polygon, 2, 2),
    0.5,
    JoinType.Miter,
    EndType.Polygon,
    2,
    2,
  );
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(ClipType.Intersection, opened, rest, tree, FillRule.NonZero, 2);
  const pieces: Vec2[][][] = [];
  // Outer rings hold holes; a hole can hold islands, which are outer rings again.
  const walk = (node: PolyPathD) => {
    for (let i = 0; i < node.count; i++) {
      const outer = node.child(i);
      const holes = Array.from({ length: outer.count }, (_, j) => outer.child(j));
      const net =
        Math.abs(areaD(outer.poly!)) - holes.reduce((sum, h) => sum + Math.abs(areaD(h.poly!)), 0);
      if (net >= 4) pieces.push([closed(outer.poly!), ...holes.map((h) => closed(h.poly!))]);
      holes.forEach(walk);
    }
  };
  walk(tree);
  return pieces;
}

/** TASK-201: what 3D draws of a building: its `building:part` areas when it has them (each
 * from its own minimum height, in the outline's colour and material unless it has its own),
 * otherwise the outline itself.
 *
 * TASK-272: where the outline's height is not the height of its tallest part (Simple 3D
 * Buildings' convention for the outline, which then only envelopes its parts), the outline
 * gives the main body: the area no part covers stands with the outline's own tags, and a part
 * with neither height nor levels takes the outline's (Philadelphia City Hall: a 30 m body
 * around a 167 m tower, 26 of its 30 parts untagged). */
export function buildingPieces(feature: Area): Area[] {
  if (!feature.parts?.length) return [feature];
  const { colour, material } = feature;
  const outlineTop = top(feature);
  const tallest = Math.max(...feature.parts.map((part) => top(part) ?? 0));
  const body = outlineTop === undefined || Math.abs(tallest - outlineTop) > 0.5;
  const inherited =
    body && outlineTop !== undefined
      ? {
          ...(feature.heightM !== undefined && { heightM: feature.heightM }),
          ...(feature.levels !== undefined && { levels: feature.levels }),
        }
      : {};
  const pieces: Area[] = feature.parts.map((part) => ({
    kind: 'area',
    class: 'building',
    ...(colour && { colour }),
    ...(material && { material }),
    ...(top(part) === undefined && inherited),
    ...part,
  }));
  if (body)
    for (const rings of uncovered(feature)) {
      const rest: Area = { ...feature, rings };
      delete rest.parts;
      pieces.push(rest);
    }
  return pieces;
}

/** Display-only building roof; x/east, z/south, y/up, with the building base at zero. */
export function buildRoof(feature: Area): RoofGeometry {
  const total = feature.heightM ?? (feature.levels === undefined ? 10 : feature.levels * 3);
  const requested = feature.roof?.shape ?? 'flat';
  const rings = feature.rings.map(openRing);
  const box = rectangle(rings[0]!);
  const fill = Math.abs(area(rings[0]!)) / box.area;
  const revolved = requested === 'dome' || requested === 'onion';
  let fallbackReason: Fallback | undefined;
  // TASK-236: a skillion is one plane over the oriented box, so it fits any outline (courtyards
  // too); the walls close every edge under it.
  if (requested !== 'flat' && requested !== 'skillion') {
    if (rings.length > 1) fallbackReason = 'courtyard';
    // TASK-210: a box shape clipped to a convex outline (a trapezoid, a circle) stays continuous
    // and its walls close it; only a pyramid takes a triangle.
    else if (
      revolved
        ? !starShaped(rings[0]!)
        : fill < 0.85 && !(convex(rings[0]!) && (fill >= 0.7 || requested === 'pyramidal'))
    )
      fallbackReason = 'irregular-footprint';
  }
  // TASK-227: pitched roofs that no box shape fits (concave outlines, courtyards, triangles)
  // come from the straight skeleton; convex ones keep their box shape.
  const style = fallbackReason ? skeletonStyles[requested] : undefined;
  let skeleton: StraightSkeleton | undefined;
  let built: ReturnType<typeof skeletonRoof> | undefined;
  if (style) {
    skeleton = straightSkeleton(rings);
    fallbackReason = skeleton ? undefined : 'skeleton';
    if (skeleton) built = skeletonRoof(skeleton, style.ends);
  }
  // TASK-236: a vault runs along a ridge between standing ends; with no wing end to stand (a
  // triangle, a ring of wings round a courtyard) the round roof is hipped.
  const shape = fallbackReason
    ? 'flat'
    : requested === 'round' && built && !built.walls.length
      ? 'hipped'
      : requested;
  const section = shape === 'hipped' ? pitch : style?.section;
  let u = box.u,
    v = box.v;
  if (feature.roof?.directionDeg !== undefined) {
    // OSM roof:direction is the downhill compass bearing, perpendicular to the ridge.
    const radians = (feature.roof.directionDeg * Math.PI) / 180;
    v = { x: Math.sin(radians), y: -Math.cos(radians) };
    u = { x: v.y, y: -v.x };
  } else if (feature.roof?.orientation === 'across') {
    u = box.v;
    v = { x: -u.y, y: u.x };
  }
  const oriented = bounds(rings[0]!, u, v);
  const centerU = (oriented.minU + oriented.maxU) / 2,
    centerV = (oriented.minV + oriented.maxV) / 2;
  const a = (oriented.maxU - oriented.minU) / 2,
    b = (oriented.maxV - oriented.minV) / 2;
  const middle = centroid(rings[0]!);
  const radius =
    rings[0]!.reduce((sum, p) => sum + Math.hypot(p.x - middle.x, p.y - middle.y), 0) /
    rings[0]!.length;
  // The skeleton's peak: the half width of its widest wing.
  const peak = skeleton ? Math.max(...skeleton.nodes.map((node) => node.t)) : 0;
  // A semicircular barrel, a hemisphere, an onion three radii tall, a 35 degree pitch (on the
  // skeleton, from its widest wing).
  const natural = skeleton
    ? Math.min(8, peak * (shape === 'round' ? 1 : Math.tan((35 * Math.PI) / 180)))
    : shape === 'dome'
      ? radius
      : shape === 'onion'
        ? 3 * radius
        : Math.min(8, Math.min(a, b) * (shape === 'round' ? 1 : Math.tan((35 * Math.PI) / 180)));
  // TASK-210: roof:levels=0 says the roof holds no storey, not that it has no height.
  const roofHeightM =
    shape === 'flat'
      ? 0
      : Math.min(
          Math.max(0, total - (feature.minHeightM ?? 0)),
          feature.roof?.heightM ??
            (feature.roof?.levels ? feature.roof.levels * 3 : Math.min(total / 2, natural)),
        );
  const wallHeightM = total - roofHeightM;
  const local = rings.map((ring) =>
    ring.map((p) => new Vector2(p.x * u.x + p.y * u.y - centerU, p.x * v.x + p.y * v.y - centerV)),
  );
  const roofs: number[] = [],
    infill: number[] = [];
  const world = (p: Vec2, height: number) => [
    (p.x + centerU) * u.x + (p.y + centerV) * v.x,
    height,
    (p.x + centerU) * u.y + (p.y + centerV) * v.y,
  ];
  if (built && section && roofHeightM > 0) {
    // One section for every face, so the widest wing's ridge is at the roof height and no wing
    // rises above it; faces split where the section breaks, so each piece is planar.
    const levels = section.slice(1, -1).map(([time]) => time * peak);
    const rise = (h: number) => {
      const s = h / peak;
      let k = 1;
      while (k < section.length - 1 && s > section[k]![0]) k++;
      const [s0, h0] = section[k - 1]!,
        [s1, h1] = section[k]!;
      return h0 + ((s - s0) / (s1 - s0)) * (h1 - h0);
    };
    const point = (p: Vertex) => [p.x, wallHeightM + rise(p.h) * roofHeightM, p.y];
    const { triangles, walls } = built;
    for (let i = 0; i < triangles.length; i += 3)
      for (const piece of levels.length
        ? bands(triangles.slice(i, i + 3), levels)
        : [triangles.slice(i, i + 3)])
        for (let k = 1; k + 1 < piece.length; k++) {
          const p = piece[0]!;
          let q = piece[k]!,
            r = piece[k + 1]!;
          const signed = cross(p, q, r);
          if (Math.abs(signed) < epsilon) continue;
          if (signed > 0) [q, r] = [r, q];
          roofs.push(...point(p), ...point(q), ...point(r));
        }
    // A standing end is convex under its section: a fan from the edge's start keeps its winding.
    for (const wall of walls) {
      const top = wall.flatMap((p, i) => {
        const q = wall[(i + 1) % wall.length]!;
        const between = levels.filter(
          (level) => Math.min(p.h, q.h) + 1e-6 < level && level < Math.max(p.h, q.h) - 1e-6,
        );
        return [p, ...(p.h > q.h ? between.reverse() : between).map((level) => cut(p, q, level))];
      });
      for (let k = 1; k + 1 < top.length; k++)
        infill.push(...point(top[0]!), ...point(top[k]!), ...point(top[k + 1]!));
    }
    return { roof: geometry(roofs), infill: geometry(infill), wallHeightM, roofHeightM, shape };
  }
  if ((shape === 'dome' || shape === 'onion') && roofHeightM > 0) {
    const profile = shape === 'dome' ? domeProfile(radius, roofHeightM) : onionProfile;
    for (const p of revolve(local[0]!, profile))
      roofs.push(...world(p, wallHeightM + p.h * roofHeightM));
    return {
      roof: geometry(roofs),
      infill: geometry(infill),
      wallHeightM,
      roofHeightM,
      shape,
    };
  }
  const triangles = ShapeUtils.triangulateShape(local[0]!, local.slice(1));
  const points = local.flat();
  const patches =
    shape === 'flat'
      ? [
          patch([
            { x: -a, y: -b, h: 0 },
            { x: a, y: -b, h: 0 },
            { x: a, y: b, h: 0 },
            { x: -a, y: b, h: 0 },
          ]),
        ]
      : shape === 'pyramidal' && fill < 0.85
        ? apexPatches(local[0]!)
        : roofPatches(shape, a, b);
  for (const surface of patches) {
    const height = (p: Vec2) =>
      wallHeightM + Math.max(0, Math.min(1, surface.height(p))) * roofHeightM;
    for (const triangle of triangles) {
      const clipped = clip(
        triangle.map((index) => points[index]!),
        surface.ring,
      );
      for (let i = 1; i + 1 < clipped.length; i++) {
        const p = clipped[0]!;
        let q = clipped[i]!,
          r = clipped[i + 1]!;
        const signed = cross(p, q, r);
        if (Math.abs(signed) < epsilon) continue;
        if (signed > 0) [q, r] = [r, q];
        roofs.push(...world(p, height(p)), ...world(q, height(q)), ...world(r, height(r)));
      }
    }
    if (!roofHeightM) continue;
    local.forEach((ring, ringIndex) => {
      const reverse = area(ring) > 0 !== (ringIndex === 0);
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!,
          q = ring[(i + 1) % ring.length]!;
        const interval = clipEdge(p, q, surface.ring);
        if (!interval) continue;
        const interpolate = (t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        let start = interpolate(interval[0]!),
          end = interpolate(interval[1]!);
        if (reverse) [start, end] = [end, start];
        const bottomA = world(start, wallHeightM),
          bottomB = world(end, wallHeightM);
        const topA = world(start, height(start)),
          topB = world(end, height(end));
        if (height(start) > wallHeightM + epsilon) infill.push(...bottomA, ...topA, ...topB);
        if (height(end) > wallHeightM + epsilon) infill.push(...bottomA, ...topB, ...bottomB);
      }
    });
  }
  return {
    roof: geometry(roofs),
    infill: geometry(infill),
    wallHeightM,
    roofHeightM,
    shape,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}
