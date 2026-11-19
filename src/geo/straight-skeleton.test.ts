import { describe, expect, it } from 'vitest';
import { createRandom } from './random';
import { straightSkeleton, type StraightSkeleton } from './straight-skeleton';
import type { Vec2 } from './vec2';

const ring = (...xy: number[]): Vec2[] =>
  Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i]!, y: xy[2 * i + 1]! }));
const area = (points: readonly Vec2[]) =>
  points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;
const orient = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
const crosses = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) =>
  orient(c, d, a) * orient(c, d, b) < -1e-12 && orient(a, b, c) * orient(a, b, d) < -1e-12;

/** Every face a simple polygon on its edge, its skeleton nodes at their time from the edge's line
 * (the roof's pitch is the same on every face), and the faces covering the outline's area. */
function expectRoof(skeleton: StraightSkeleton | undefined, rings: Vec2[][]) {
  expect(skeleton).toBeDefined();
  const { nodes, faces } = skeleton!;
  let covered = 0;
  for (const face of faces) {
    const points = face.nodes.map((i) => nodes[i]!);
    expect(area(points)).toBeGreaterThan(0);
    covered += area(points);
    const from = points[0]!,
      to = points[face.base - 1]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    for (const p of points.slice(face.base)) {
      const distance =
        ((to.x - from.x) * (p.y - from.y) - (to.y - from.y) * (p.x - from.x)) / length;
      expect(distance).toBeCloseTo(p.t, 3);
      expect(p.t).toBeGreaterThan(0);
    }
    for (let i = 0; i < points.length; i++)
      for (let j = i + 2; j < points.length; j++)
        if (i || j < points.length - 1)
          expect(
            crosses(points[i]!, points[i + 1]!, points[j]!, points[(j + 1) % points.length]!),
          ).toBe(false);
  }
  const outline = rings.reduce((sum, r, i) => sum + (i ? -1 : 1) * Math.abs(area(r)), 0);
  expect(Math.abs(covered - outline)).toBeLessThan(0.01 * outline);
  return skeleton!;
}

const peak = (skeleton: StraightSkeleton) => Math.max(...skeleton.nodes.map((node) => node.t));
const has = (skeleton: StraightSkeleton, x: number, y: number, t: number) =>
  skeleton.nodes.some(
    (node) => Math.hypot(node.x - x, node.y - y) < 1e-6 && Math.abs(node.t - t) < 1e-6,
  );

describe('TASK-227 straight skeleton', () => {
  it('an L rises to one ridge along each wing, meeting over the corner', () => {
    const rings = [ring(0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20)];
    const skeleton = expectRoof(straightSkeleton(rings), rings);
    expect(skeleton.faces).toHaveLength(6);
    expect(peak(skeleton)).toBeCloseTo(4, 9);
    for (const [x, y] of [
      [4, 4],
      [16, 4],
      [4, 16],
    ])
      expect(has(skeleton, x!, y!, 4)).toBe(true);
    // The wing ends are triangles: their edge and one apex.
    const ends = skeleton.faces.filter((face) => face.nodes.length === 3);
    expect(ends).toHaveLength(2);
  });

  it('a T and a U: three and two wings at one pitch', () => {
    const t = [ring(0, 0, 30, 0, 30, 8, 19, 8, 19, 25, 11, 25, 11, 8, 0, 8)];
    const tee = expectRoof(straightSkeleton(t), t);
    expect(peak(tee)).toBeCloseTo(4, 9);
    expect(has(tee, 15, 4, 4)).toBe(true);
    expect(has(tee, 15, 21, 4)).toBe(true);
    expect(tee.faces.filter((face) => face.nodes.length === 3)).toHaveLength(3);
    const u = [ring(0, 0, 30, 0, 30, 20, 22, 20, 22, 8, 8, 8, 8, 20, 0, 20)];
    const you = expectRoof(straightSkeleton(u), u);
    expect(peak(you)).toBeCloseTo(4, 9);
    expect(you.faces.filter((face) => face.nodes.length === 3)).toHaveLength(2);
  });

  it('a courtyard: the faces of the hole slope down to it, in either ring orientation', () => {
    const outer = ring(0, 0, 30, 0, 30, 20, 0, 20),
      hole = ring(8, 6, 22, 6, 22, 14, 8, 14);
    for (const rings of [
      [outer, hole],
      [[...outer].reverse(), [...hole].reverse()],
    ]) {
      const skeleton = expectRoof(straightSkeleton(rings), rings);
      expect(skeleton.faces).toHaveLength(8);
      // The courtyard sides are 6 m from the long walls: their ridge is at 3 m.
      expect(has(skeleton, 5, 3, 3)).toBe(true);
      expect(peak(skeleton)).toBeCloseTo(4, 9);
    }
  });

  it('a near-collinear vertex joins its edge, a slight kink keeps its own face', () => {
    // 1 cm off the line: one face over both pieces, the vertex still on its base.
    const merged = [ring(0, 0, 10, 0.01, 20, 0, 20, 10, 12, 10, 12, 18, 0, 18)];
    const one = expectRoof(straightSkeleton(merged), merged);
    expect(one.faces).toHaveLength(6);
    expect(one.faces[0]!.base).toBe(3);
    // 0.5 degrees: two faces, nearly parallel, meeting along a short valley.
    const kink = [ring(0, 0, 10, -0.09, 20, 0, 20, 10, 12, 10, 12, 18, 0, 18)];
    expect(expectRoof(straightSkeleton(kink), kink).faces).toHaveLength(7);
  });

  it('a 0.2 m step in a wall', () => {
    const rings = [ring(0, 0, 20, 0, 20, 10, 10, 10, 10, 10.2, 0, 10.2)];
    const skeleton = expectRoof(straightSkeleton(rings), rings);
    expect(skeleton.faces).toHaveLength(6);
    // The reflex corner's path reaches the end wall's at 5 m: no higher ridge over the 0.2 m.
    expect(peak(skeleton)).toBeCloseTo(5, 9);
    expect(has(skeleton, 5, 5.2, 5)).toBe(true);
  });

  it('is unchanged by rotation and works for both ring orientations', () => {
    const l = ring(0, 0, 20, 0, 20, 8, 8, 8, 8, 20, 0, 20);
    const angle = 0.7;
    const turned = l.map((p) => ({
      x: 100 + p.x * Math.cos(angle) - p.y * Math.sin(angle),
      y: -50 + p.x * Math.sin(angle) + p.y * Math.cos(angle),
    }));
    for (const rings of [[turned], [[...turned].reverse()]]) {
      const skeleton = expectRoof(straightSkeleton(rings), rings);
      expect(peak(skeleton)).toBeCloseTo(4, 9);
      expect(skeleton.faces).toHaveLength(6);
    }
  });

  it('combs with equal teeth, exactly orthogonal or within a centimetre, all succeed', () => {
    const random = createRandom(227);
    for (let n = 0; n < 200; n++) {
      const teeth = 1 + Math.floor(random.next() * 4),
        depth = random.uniform(6, 12),
        width = random.uniform(5, 13);
      const points: Vec2[] = [{ x: 0, y: 0 }];
      const spans: number[][] = [];
      let x = 0;
      for (let i = 0; i < teeth; i++) {
        const start = x + (i ? random.uniform(3, 11) : 0);
        spans.push([start, start + width, random.uniform(5, 20)]);
        x = start + width;
      }
      points.push({ x, y: 0 });
      for (const [a, b, h] of spans.reverse())
        points.push(
          { x: b!, y: depth },
          { x: b!, y: depth + h! },
          { x: a!, y: depth + h! },
          { x: a!, y: depth },
        );
      const outline = points.filter((p, i) => {
        const q = points[(i + 1) % points.length]!;
        return p.x !== q.x || p.y !== q.y;
      });
      const angle = random.uniform(0, Math.PI),
        jitter = n % 2 ? 0.01 : 0;
      const rings = [
        outline.map((p) => ({
          x: p.x * Math.cos(angle) - p.y * Math.sin(angle) + random.uniform(-jitter, jitter),
          y: p.x * Math.sin(angle) + p.y * Math.cos(angle) + random.uniform(-jitter, jitter),
        })),
      ];
      expectRoof(straightSkeleton(rings), rings);
    }
  });

  it('fails safe on a self-crossing outline and on a spike of no width', () => {
    expect(straightSkeleton([ring(0, 0, 10, 10, 10, 0, 0, 10)])).toBeUndefined();
    expect(
      straightSkeleton([ring(0, 0, 10, 0, 10, 10, 5, 10, 5, 20, 5, 10, 0, 10)]),
    ).toBeUndefined();
  });
});
