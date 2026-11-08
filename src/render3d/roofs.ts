import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import type { Vec2 } from '../geo/vec2';
import type { ContextFeature, RoofShape } from '../schema';

type Area = Extract<ContextFeature, { kind: 'area' }>;
type Vertex = Vec2 & { h: number };
type Patch = { ring: Vec2[]; height: (p: Vec2) => number };
type Fallback = 'courtyard' | 'irregular-footprint' | 'unsupported-shape';

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

/** Display-only building roof; x/east, z/south, y/up, with the building base at zero. */
export function buildRoof(feature: Area): RoofGeometry {
  const total = feature.heightM ?? (feature.levels === undefined ? 10 : feature.levels * 3);
  const requested = feature.roof?.shape ?? 'flat';
  const rings = feature.rings.map(openRing);
  const box = rectangle(rings[0]!);
  let fallbackReason: Fallback | undefined;
  if (requested !== 'flat') {
    if (rings.length > 1) fallbackReason = 'courtyard';
    else if (['round', 'dome', 'onion'].includes(requested)) fallbackReason = 'unsupported-shape';
    else if (Math.abs(area(rings[0]!)) / box.area < 0.85) fallbackReason = 'irregular-footprint';
  }
  const shape = fallbackReason ? 'flat' : requested;
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
  const roofHeightM =
    shape === 'flat'
      ? 0
      : Math.min(
          Math.max(0, total - (feature.minHeightM ?? 0)),
          feature.roof?.heightM ??
            (feature.roof?.levels === undefined
              ? Math.min(8, total / 2, Math.min(a, b) * Math.tan((35 * Math.PI) / 180))
              : feature.roof.levels * 3),
        );
  const wallHeightM = total - roofHeightM;
  const local = rings.map((ring) =>
    ring.map((p) => new Vector2(p.x * u.x + p.y * u.y - centerU, p.x * v.x + p.y * v.y - centerV)),
  );
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
      : roofPatches(shape, a, b);
  const roofs: number[] = [],
    infill: number[] = [];
  const world = (p: Vec2, height: number) => [
    (p.x + centerU) * u.x + (p.y + centerV) * v.x,
    height,
    (p.x + centerU) * u.y + (p.y + centerV) * v.y,
  ];
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
