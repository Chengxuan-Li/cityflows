import type { Vec2 } from './vec2';

/** A skeleton node: a point and the time the wavefront reached it, its distance from the outline. */
export interface SkeletonNode extends Vec2 {
  t: number;
}

/** The roof face over one outline edge. `nodes` runs anticlockwise (positive shoelace area), the
 * first `base` of them along the edge (its two ends and any vertices merged into it), then the
 * skeleton back to the edge's start. */
export interface SkeletonFace {
  nodes: number[];
  base: number;
}

export interface StraightSkeleton {
  /** The input vertices first, ring by ring, at time 0, then the skeleton's own nodes. */
  nodes: SkeletonNode[];
  faces: SkeletonFace[];
  arcs: [number, number][];
}

/** Vertices within 2 cm of the line through their neighbours join the edge; the face over it keeps
 * them on its base, so the roof still meets the outline exactly. */
const straightTolerance = 0.02;
/** Events this close in time are simultaneous (edge events first). */
const timeTolerance = 1e-9;
/** Nodes this close (m), and this close in time, are one. */
const mergeDistance = 1e-4;
/** A loop this thin (m) is flat. */
const flatTolerance = 1e-6;

interface Edge extends Vec2 {
  dx: number;
  dy: number;
  /** Inward normal: the outline runs with its interior on the left. */
  nx: number;
  ny: number;
}

interface WavefrontVertex {
  node: number;
  t0: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  prev: number;
  next: number;
  reflex: boolean;
}

interface Arc {
  from: number;
  to: number;
  faces: [number, number];
}

class Degenerate extends Error {}

const signedArea = (ring: readonly Vec2[]) =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;

/** Drops repeated vertices and those within the tolerance of their neighbours' chord, keeping the
 * dropped ones (input indices) with the vertex that starts their edge. */
function simplify(ring: readonly Vec2[], offset: number) {
  const kept = ring.map((_, i) => i);
  for (let changed = true; changed && kept.length > 3;) {
    changed = false;
    for (let k = 0; k < kept.length && kept.length > 3; k++) {
      const a = ring[kept[(k + kept.length - 1) % kept.length]!]!,
        p = ring[kept[k]!]!,
        b = ring[kept[(k + 1) % kept.length]!]!;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      const along = length && ((p.x - a.x) * dx + (p.y - a.y) * dy) / length;
      const off = length && Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
      if (
        Math.hypot(p.x - a.x, p.y - a.y) < 1e-3 ||
        (length > 0 && off < straightTolerance && along > 0 && along < length)
      ) {
        kept.splice(k, 1);
        changed = true;
        k--;
      }
    }
  }
  return kept.map((index, k) => {
    const next = kept[(k + 1) % kept.length]!;
    const merged: number[] = [];
    for (let i = (index + 1) % ring.length; i !== next; i = (i + 1) % ring.length)
      merged.push(offset + i);
    return { node: offset + index, merged };
  });
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const orient = (p: Vec2, q: Vec2, r: Vec2) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = orient(c, d, a),
    d2 = orient(c, d, b),
    d3 = orient(a, b, c),
    d4 = orient(a, b, d);
  const tolerance = 1e-9;
  return (
    ((d1 > tolerance && d2 < -tolerance) || (d1 < -tolerance && d2 > tolerance)) &&
    ((d3 > tolerance && d4 < -tolerance) || (d3 < -tolerance && d4 > tolerance))
  );
}

function inside(rings: readonly Vec2[][], p: Vec2) {
  let crossings = 0;
  for (const ring of rings)
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y))
        crossings++;
    });
  return crossings % 2 === 1;
}

/**
 * TASK-227: the straight skeleton of a polygon (the first ring its outline, the others holes),
 * found by running the wavefront: every edge moves inward at unit speed, and at each step the
 * earliest event over all active vertices is found afresh (O(n^2) a step, n^3 in all; outlines
 * have tens of vertices). An edge event shrinks a wavefront edge to a point; a split event is a
 * reflex vertex reaching an edge, which splits its loop, or joins a hole's loop to the outline's.
 * Ties go to edge events, so a reflex vertex meeting a vertex (a vertex event) becomes a split
 * at the edge's end and a zero-length edge that collapses next. A loop left with no area (two
 * vertices, or a bar whose equal wings have gone) closes as ridges.
 *
 * Returns undefined, rather than a wrong roof, when the outline is degenerate (antiparallel
 * neighbours, a self-crossing ring) or the result fails its checks: every face a simple polygon
 * whose skeleton nodes lie at their time from the face's edge (1 mm) and inside the outline, and
 * the faces covering the outline's area within 0.1%.
 */
export function straightSkeleton(
  input: readonly (readonly Vec2[])[],
): StraightSkeleton | undefined {
  // The outline runs anticlockwise, holes clockwise; nodes keep the caller's vertex order.
  const reversed = input.map((ring, index) => signedArea(ring) > 0 !== (index === 0));
  const rings = input.map((ring, index) => (reversed[index] ? [...ring].reverse() : [...ring]));
  const nodeIndex: number[][] = [];
  const nodes: SkeletonNode[] = [];
  input.forEach((ring, r) => {
    nodeIndex.push(ring.map((_, i) => nodes.length + (reversed[r] ? ring.length - 1 - i : i)));
    for (const p of ring) nodes.push({ x: p.x, y: p.y, t: 0 });
  });
  const edges: Edge[] = [];
  const edgeNodes: { from: number; to: number; merged: number[] }[] = [];
  const loops: WavefrontVertex[][] = [];
  const arcs: Arc[] = [];
  try {
    rings.forEach((ring, r) => {
      // Simplify in the oriented ring, then name its vertices by their input node.
      const oriented = simplify(ring, 0).map(({ node, merged }) => ({
        node: nodeIndex[r]![node]!,
        merged: merged.map((i) => nodeIndex[r]![i]!),
      }));
      if (oriented.length < 3) throw new Degenerate();
      const first = edges.length;
      oriented.forEach(({ node, merged }, k) => {
        const to = oriented[(k + 1) % oriented.length]!.node;
        const a = nodes[node]!,
          b = nodes[to]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const dx = (b.x - a.x) / length,
          dy = (b.y - a.y) / length;
        edges.push({ x: a.x, y: a.y, dx, dy, nx: -dy, ny: dx });
        edgeNodes.push({ from: node, to, merged });
      });
      loops.push(
        oriented.map(({ node }, k) =>
          vertex(node, 0, first + ((k + oriented.length - 1) % oriented.length), first + k),
        ),
      );
    });
    run();
  } catch (error) {
    if (error instanceof Degenerate) return undefined;
    throw error;
  }

  function vertex(node: number, t0: number, prev: number, next: number): WavefrontVertex {
    const a = edges[prev]!,
      b = edges[next]!;
    const denominator = 1 + a.nx * b.nx + a.ny * b.ny;
    const { x, y } = nodes[node]!;
    // Antiparallel neighbours coincide: a spike of no width, such as a wing whose end has just
    // gone. The vertex stays put and the zero-time events that follow close the spike (a reflex
    // vertex at its root splits it off as a flat loop). Within 1e-5 rad, as a vertex nearly so
    // would move at 10^5 times the wavefront's speed. An outline spike is degenerate.
    if (denominator < 1e-10) {
      if (!t0) throw new Degenerate();
      return { node, t0, x, y, vx: 0, vy: 0, prev, next, reflex: false };
    }
    return {
      node,
      t0,
      x,
      y,
      vx: (a.nx + b.nx) / denominator,
      vy: (a.ny + b.ny) / denominator,
      prev,
      next,
      reflex: a.dx * b.dy - a.dy * b.dx < -1e-9,
    };
  }

  function run() {
    let time = 0;
    const at = (v: WavefrontVertex, t = time) => ({
      x: v.x + v.vx * (t - v.t0),
      y: v.y + v.vy * (t - v.t0),
    });
    const addNode = (p: Vec2) => nodes.push({ x: p.x, y: p.y, t: time }) - 1;
    const addArc = (from: number, to: number, faces: [number, number]) => {
      if (from !== to) arcs.push({ from, to, faces });
    };
    /** The vertex's path ends at `node` (made at the vertex's position when undefined). */
    const end = (v: WavefrontVertex, node?: number) => {
      if (node === undefined) {
        if (v.t0 >= time) return v.node;
        node = addNode(at(v));
      }
      addArc(v.node, node, [v.prev, v.next]);
      return node;
    };
    /** Adds the loop, or closes it when it has no area left: two vertices, or a comb's bar once
     * its exactly equal teeth have gone. A flat loop lies on a segment that each of its edges
     * covers in part; every piece between two of its vertices is a ridge between the two edges
     * covering it from either side. */
    const settle = (loop: (WavefrontVertex | { node: number; prev: number; next: number })[]) => {
      if (loop.length < 2) throw new Degenerate();
      const points = loop.map((v) => ('vx' in v ? at(v) : nodes[v.node]!));
      const far = (from: Vec2) =>
        points.reduce((best, p) =>
          Math.hypot(p.x - from.x, p.y - from.y) > Math.hypot(best.x - from.x, best.y - from.y)
            ? p
            : best,
        );
      const origin = far(points[0]!),
        extreme = far(origin);
      const length = Math.hypot(extreme.x - origin.x, extreme.y - origin.y);
      const ux = length ? (extreme.x - origin.x) / length : 1,
        uy = length ? (extreme.y - origin.y) / length : 0;
      const flat = points.every(
        (p) => Math.abs((p.x - origin.x) * uy - (p.y - origin.y) * ux) < flatTolerance,
      );
      if (loop.length >= 3 && !flat) {
        loops.push(loop.map((v) => ('vx' in v ? v : vertex(v.node, time, v.prev, v.next))));
        return;
      }
      if (!flat) throw new Degenerate();
      const ends = loop.map((v) => ('vx' in v ? end(v) : v.node));
      const along = points.map((p) => (p.x - origin.x) * ux + (p.y - origin.y) * uy);
      const stations: { s: number; node: number }[] = [];
      for (const [i, s] of along.entries())
        if (!stations.some((station) => Math.abs(station.s - s) < mergeDistance))
          stations.push({ s, node: ends[i]! });
      stations.sort((a, b) => a.s - b.s);
      for (let k = 0; k + 1 < stations.length; k++) {
        const middle = (stations[k]!.s + stations[k + 1]!.s) / 2;
        const covering = loop.flatMap((v, i) => {
          const a = along[i]!,
            b = along[(i + 1) % loop.length]!;
          return Math.min(a, b) < middle && middle < Math.max(a, b) ? [v.next] : [];
        });
        if (covering.length !== 2) throw new Degenerate();
        addArc(stations[k]!.node, stations[k + 1]!.node, covering as [number, number]);
      }
    };

    const limit = 20 * edges.length + 100;
    for (let step = 0; loops.length; step++) {
      if (step > limit) throw new Degenerate();
      let best:
        | { tau: number; kind: 'edge'; loop: number; index: number }
        | { tau: number; kind: 'split'; loop: number; index: number; target: number; at: number }
        | undefined;
      const position = new Map<WavefrontVertex, Vec2>();
      for (const loop of loops) for (const v of loop) position.set(v, at(v));
      loops.forEach((loop, l) =>
        loop.forEach((a, i) => {
          const b = loop[(i + 1) % loop.length]!,
            e = edges[a.next]!;
          const pa = position.get(a)!,
            pb = position.get(b)!;
          const length = (pb.x - pa.x) * e.dx + (pb.y - pa.y) * e.dy;
          const rate = (b.vx - a.vx) * e.dx + (b.vy - a.vy) * e.dy;
          let tau: number;
          if (rate < -1e-12) tau = Math.max(0, -length / rate);
          else if (length <= 1e-9) tau = 0;
          else return;
          if (!best || tau < best.tau - timeTolerance)
            best = { tau, kind: 'edge', loop: l, index: i };
        }),
      );
      loops.forEach((loop, l) =>
        loop.forEach((r, i) => {
          if (!r.reflex) return;
          const pr = position.get(r)!;
          loops.forEach((other, m) =>
            other.forEach((a, j) => {
              if (a.next === r.prev || a.next === r.next) return;
              const e = edges[a.next]!,
                b = other[(j + 1) % other.length]!;
              const approach = 1 - (r.vx * e.nx + r.vy * e.ny);
              if (approach <= 1e-9) return;
              const pa = position.get(a)!;
              const distance = (pr.x - pa.x) * e.nx + (pr.y - pa.y) * e.ny;
              if (distance < -1e-7) return;
              const tau = Math.max(0, distance) / approach;
              if (best && tau >= best.tau - timeTolerance) return;
              const later = time + tau;
              const qa = at(a, later),
                qb = at(b, later);
              const hit = { x: pr.x + r.vx * tau, y: pr.y + r.vy * tau };
              const span = (qb.x - qa.x) * e.dx + (qb.y - qa.y) * e.dy;
              const along = (hit.x - qa.x) * e.dx + (hit.y - qa.y) * e.dy;
              if (span <= 1e-9 || along < -1e-7 || along > span + 1e-7) return;
              best = { tau, kind: 'split', loop: l, index: i, target: m, at: j };
            }),
          );
        }),
      );
      if (!best) throw new Degenerate();
      time += best.tau;
      const event = best;
      if (event.kind === 'edge') {
        const loop = loops[event.loop]!;
        const a = loop[event.index]!,
          b = loop[(event.index + 1) % loop.length]!;
        const pa = at(a),
          pb = at(b);
        const node = addNode({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 });
        end(a, node);
        end(b, node);
        loops.splice(event.loop, 1);
        const rest = [...loop.slice(event.index + 2), ...loop.slice(0, event.index)].filter(
          (v) => v !== a && v !== b,
        );
        settle([{ node, prev: a.prev, next: b.next }, ...rest]);
        continue;
      }
      const loop = loops[event.loop]!;
      const r = loop[event.index]!;
      const node = addNode(at(r));
      end(r, node);
      const e = loops[event.target]![event.at]!.next;
      const first = { node, prev: r.prev, next: e },
        second = { node, prev: e, next: r.next };
      const around = [...loop.slice(event.index + 1), ...loop.slice(0, event.index)];
      if (event.target === event.loop) {
        // around: next(r) .. a, b .. prev(r).
        const a = loop[event.at]!;
        const cut = around.indexOf(a) + 1;
        loops.splice(event.loop, 1);
        settle([second, ...around.slice(0, cut)]);
        settle([first, ...around.slice(cut)]);
      } else {
        const other = loops[event.target]!;
        const fromB = [...other.slice(event.at + 1), ...other.slice(0, event.at + 1)];
        for (const index of [event.loop, event.target].sort((x, y) => y - x))
          loops.splice(index, 1);
        settle([first, ...fromB, second, ...around]);
      }
    }
  }

  // Simultaneous events leave coincident nodes joined by zero-length arcs (a square's apex is
  // two nodes): one node each, and the arcs between them dropped.
  const inputCount = input.reduce((sum, ring) => sum + ring.length, 0);
  const same = nodes.map((_, i) => i);
  for (let i = inputCount; i < nodes.length; i++) {
    const p = nodes[i]!;
    for (let j = inputCount; j < i; j++) {
      const q = nodes[j]!;
      if (
        same[j] === j &&
        Math.abs(p.x - q.x) < mergeDistance &&
        Math.abs(p.y - q.y) < mergeDistance &&
        Math.abs(p.t - q.t) < mergeDistance
      ) {
        same[i] = j;
        break;
      }
    }
  }
  const seen = new Set<string>();
  const kept: Arc[] = [];
  for (const arc of arcs) {
    const from = same[arc.from]!,
      to = same[arc.to]!;
    const [f, g] = arc.faces;
    const key =
      from < to
        ? `${from} ${to} ${Math.min(f, g)} ${Math.max(f, g)}`
        : `${to} ${from} ${Math.min(f, g)} ${Math.max(f, g)}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    kept.push({ from, to, faces: arc.faces });
  }

  // Each face: the edge, then the arcs bounding it, chained from the edge's end to its start.
  const byFace: number[][] = edges.map(() => []);
  kept.forEach((arc, index) => {
    byFace[arc.faces[0]]!.push(index);
    if (arc.faces[1] !== arc.faces[0]) byFace[arc.faces[1]]!.push(index);
  });
  const faces: SkeletonFace[] = [];
  for (let e = 0; e < edges.length; e++) {
    const { from, to, merged } = edgeNodes[e]!;
    const incident = byFace[e]!;
    const used = new Set<number>();
    const path: number[] = [];
    let node = to,
      arrived = -1;
    while (node !== from) {
      const options = incident.filter(
        (arc) => arc !== arrived && (kept[arc]!.from === node || kept[arc]!.to === node),
      );
      if (options.length !== 1 || used.has(options[0]!)) return undefined;
      arrived = options[0]!;
      used.add(arrived);
      const arc = kept[arrived]!;
      node = arc.from === node ? arc.to : arc.from;
      if (node !== from) path.push(node);
    }
    if (used.size !== incident.length) return undefined;
    faces.push({ nodes: [from, ...merged, to, ...path], base: merged.length + 2 });
  }

  // Checks: a wrong skeleton is drawn flat instead.
  const outline = input.map((ring) => [...ring]);
  const expected = outline.reduce(
    (sum, ring, i) => sum + (i ? -1 : 1) * Math.abs(signedArea(ring)),
    0,
  );
  let covered = 0;
  for (const [e, face] of faces.entries()) {
    const ring = face.nodes.map((i) => nodes[i]!);
    const area = signedArea(ring);
    if (!(area > 0)) return undefined;
    covered += area;
    const edge = edges[e]!;
    for (const [k, p] of ring.entries()) {
      if (k < face.base) continue;
      if (Math.abs((p.x - edge.x) * edge.nx + (p.y - edge.y) * edge.ny - p.t) > 1e-3)
        return undefined;
      if (!inside(outline, p)) return undefined;
    }
    for (let i = 0; i < ring.length; i++)
      for (let j = i + 2; j < ring.length; j++) {
        if (i === 0 && j === ring.length - 1) continue;
        if (segmentsCross(ring[i]!, ring[i + 1]!, ring[j]!, ring[(j + 1) % ring.length]!))
          return undefined;
      }
  }
  if (Math.abs(covered - expected) > 1e-3 * expected) return undefined;
  return { nodes, faces, arcs: kept.map(({ from, to }) => [from, to]) };
}
