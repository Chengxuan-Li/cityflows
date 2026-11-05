import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { grid5x5 } from '../src/fixtures/grid5x5';
import { town } from '../src/fixtures/town';
import { cumulativeLengths, headingAtDistance, preparePolygon } from '../src/geo/polyline';
import type { Vec2 } from '../src/geo/vec2';
import { importOsm } from '../src/importers/osm';
import { compile, type CompiledCity, type CNode, type CRoad } from '../src/network';
import { SETBACK_CAP_M } from '../src/network/junctions';
import type { City } from '../src/schema';

// Junction shape audit (TASK-074, architecture 5.1): per node, how far the drawn junction is
// from one clean surface. Usage: node --experimental-strip-types --import ./bench/register.ts
// ./bench/junction-audit.ts [--json out.json]

export const auditCities = ['grid', 'town', 'sindelfingen', 'munich'] as const;
export type AuditCity = (typeof auditCities)[number];

export function loadAuditCity(name: AuditCity): City {
  if (name === 'grid') return grid5x5();
  if (name === 'town') return town();
  const [file, bbox] =
    name === 'munich'
      ? (['munich-donnersberger', [11.525, 48.135, 11.545, 48.148]] as const)
      : (['sindelfingen-a81', [8.98, 48.69, 9.0, 48.702]] as const);
  const result = importOsm(readFileSync(`fixtures/osm/${file}.osm`, 'utf8'), {
    importerVersion: '1',
    drivingSide: 'right',
    bbox: [...bbox],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.city;
}

export function compileAuditCity(name: AuditCity): CompiledCity {
  const result = compile(loadAuditCity(name));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
  return result.compiled;
}

export interface NodeAudit {
  id: string;
  /** m², cells covered by two or more incident road surfaces and not by the outline. */
  overlapM2: number;
  /** Road ids of the pair with the largest share of `overlapM2`. */
  worstPair: string;
  selfIntersections: number;
  movementsEscaping: number;
  edgesOff: number;
  /** Degrees, largest heading change where the curb leaves a road edge (gore tips excluded). */
  curbTurnDeg: number;
  curbKinks: number;
  sharpCorners: number;
  cappedEnds: number;
}

const CELL_M = 0.25;
// The cell grid is offset unevenly so axis-aligned, diagonal and shared road edges never pass
// through a cell centre.
const OFFSET_X = 0.0123,
  OFFSET_Y = 0.0371;
const NEAR_M = 60;

/** The road end's surface from the node out to `NEAR_M` (or half the road), as a closed ring,
 * and probe points across it 0.5 m before that far cut. */
export function nearSurface(road: CRoad, atEnd: boolean) {
  const ring = road.surface;
  const half = ring.length / 2;
  let left = ring.slice(0, half),
    right = ring.slice(half).reverse();
  if (atEnd) {
    left = left.reverse();
    right = right.reverse();
  }
  const at = (line: Vec2[], lengths: Float64Array, s: number) => {
    let i = 1;
    while (i < line.length - 1 && lengths[i]! < s) i++;
    const t = Math.max(
      0,
      Math.min(1, (s - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]! || 1)),
    );
    const a = line[i - 1]!,
      b = line[i]!;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const sides = [left, right].map((line) => {
    const lengths = cumulativeLengths(line);
    const limit = Math.min(NEAR_M, lengths.at(-1)! / 2);
    return {
      kept: [...line.filter((_, i) => lengths[i]! < limit), at(line, lengths, limit)],
      probe: at(line, lengths, Math.max(0, limit - 0.5)),
    };
  });
  const [l, r] = sides as [(typeof sides)[0], (typeof sides)[0]];
  const piece = [...l.kept, ...r.kept.reverse()];
  piece.push(piece[0]!);
  const probes = Array.from({ length: 9 }, (_, i) => ({
    x: l.probe.x + ((r.probe.x - l.probe.x) * (i + 0.5)) / 9,
    y: l.probe.y + ((r.probe.y - l.probe.y) * (i + 0.5)) / 9,
  }));
  return { ring: piece, probes };
}

function bounds(ring: Vec2[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function lineDistance(p: Vec2, line: Vec2[]): number {
  let closest = Infinity;
  for (let i = 1; i < line.length; i++)
    closest = Math.min(closest, segmentDistance(p, line[i - 1]!, line[i]!));
  return closest;
}

function properCrossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(a, b, c),
    d2 = side(a, b, d),
    d3 = side(c, d, a),
    d4 = side(c, d, b);
  return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
}

export function selfIntersections(ring: Vec2[]): number {
  let count = 0;
  for (let i = 1; i < ring.length; i++)
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 1 && j === ring.length - 1) continue;
      if (properCrossing(ring[i - 1]!, ring[i]!, ring[j - 1]!, ring[j]!)) count++;
    }
  return count;
}

/** One road end at a node: its trimmed corners (left, right in outward travel) and side edges. */
function roadEnds(net: CompiledCity, node: CNode) {
  return net.roads.flatMap((road) =>
    [false, true]
      .filter((atEnd) => (atEnd ? road.to : road.from) === node.idx)
      .map((atEnd) => {
        const ring = road.surface;
        const half = ring.length / 2;
        const leftEdge = ring.slice(0, half),
          rightEdge = ring.slice(half).reverse();
        const left = atEnd ? leftEdge.at(-1)! : leftEdge[0]!;
        const right = atEnd ? rightEdge.at(-1)! : rightEdge[0]!;
        return {
          road,
          atEnd,
          corners: [left, right],
          edges: [leftEdge, rightEdge],
          near: nearSurface(road, atEnd),
        };
      }),
  );
}

export function auditNode(net: CompiledCity, node: CNode): NodeAudit {
  const ends = roadEnds(net, node);
  const outline = node.outline;
  const covered = outline.length ? preparePolygon(outline, 1e-6) : () => false;
  // Overlap: unique cells inside two or more road-end surfaces and outside the outline.
  const pieces = ends.map((end) => ({
    inside: preparePolygon(end.near.ring, 0),
    box: bounds(end.near.ring),
    probes: end.near.probes,
  }));
  const cells = new Set<number>(),
    bodyCells = new Set<number>();
  const byPair = new Map<string, number>();
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const a = pieces[i]!.box,
        b = pieces[j]!.box;
      const minX = Math.max(a.minX, b.minX),
        maxX = Math.min(a.maxX, b.maxX),
        minY = Math.max(a.minY, b.minY),
        maxY = Math.min(a.maxY, b.maxY);
      if (minX >= maxX || minY >= maxY) continue;
      const body =
        pieces[i]!.probes.some(pieces[j]!.inside) || pieces[j]!.probes.some(pieces[i]!.inside);
      let pair = 0;
      for (let ix = Math.floor((minX - OFFSET_X) / CELL_M); ; ix++) {
        const x = (ix + 0.5) * CELL_M + OFFSET_X;
        if (x > maxX) break;
        for (let iy = Math.floor((minY - OFFSET_Y) / CELL_M); ; iy++) {
          const y = (iy + 0.5) * CELL_M + OFFSET_Y;
          if (y > maxY) break;
          const p = { x, y };
          if (!pieces[i]!.inside(p) || !pieces[j]!.inside(p) || covered(p)) continue;
          pair++;
          (body ? bodyCells : cells).add(ix * 4_194_304 + iy);
        }
      }
      if (pair && !body) {
        const key = `${ends[i]!.road.id}/${ends[j]!.road.id}`;
        byPair.set(key, (byPair.get(key) ?? 0) + pair);
      }
    }
  const worstPair = [...byPair].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '';
  const audit: NodeAudit = {
    id: node.id,
    overlapM2: [...cells].filter((cell) => !bodyCells.has(cell)).length * CELL_M * CELL_M,
    bodyOverlapM2: bodyCells.size * CELL_M * CELL_M,
    worstPair,
    selfIntersections: selfIntersections(outline),
    movementsEscaping: 0,
    edgesOff: 0,
    curbTurnDeg: 0,
    curbKinks: 0,
    sharpCorners: 0,
    cappedEnds: node.setbacks.filter((s) => s >= SETBACK_CAP_M - 1e-6).length,
  };
  if (!outline.length) return audit;
  const inside = preparePolygon(outline, 0.1);
  for (const index of node.movements) {
    const m = net.movements[index]!;
    const width = Math.min(net.lanes[m.fromLane]!.widthM, net.lanes[m.toLane]!.widthM) / 2;
    const escapes = m.polyline.some((p, k) => {
      const h = headingAtDistance(m.polyline, m.cumulative, m.cumulative[k]!);
      return [-1, 0, 1].some(
        (side) =>
          !inside({ x: p.x - Math.sin(h) * width * side, y: p.y + Math.cos(h) * width * side }),
      );
    });
    if (escapes) audit.movementsEscaping++;
  }
  const ring = outline.filter(
    (p, i) => i === 0 || Math.hypot(p.x - outline[i - 1]!.x, p.y - outline[i - 1]!.y) > 1e-6,
  );
  if (Math.hypot(ring[0]!.x - ring.at(-1)!.x, ring[0]!.y - ring.at(-1)!.y) <= 1e-6) ring.pop();
  const n = ring.length;
  const cuts = ends.map((end) => end.corners);
  const onCut = (p: Vec2) => cuts.some(([a, b]) => segmentDistance(p, a!, b!) <= 0.05);
  const onSurfaces = (p: Vec2) =>
    new Set(
      ends
        .filter((end) => end.edges.some((edge) => lineDistance(p, edge) <= 0.1))
        .map((e) => e.road),
    ).size;
  for (const end of ends) {
    const [left, right] = end.corners;
    const middle = { x: (left!.x + right!.x) / 2, y: (left!.y + right!.y) / 2 };
    if ([left!, right!, middle].some((p) => lineDistance(p, outline) > 0.1)) audit.edgesOff++;
    for (const side of [0, 1]) {
      const corner = end.corners[side]!;
      let k = -1,
        best = 0.1;
      ring.forEach((p, i) => {
        const away = Math.hypot(p.x - corner.x, p.y - corner.y);
        if (away <= best) {
          best = away;
          k = i;
        }
      });
      if (k < 0) continue;
      const edge = end.edges[side]!;
      // The edge's outward direction at the cut, and its line toward the node.
      const near = end.atEnd ? edge.at(-2)! : edge[1]!;
      const length = Math.hypot(near.x - corner.x, near.y - corner.y);
      const out = { x: (near.x - corner.x) / length, y: (near.y - corner.y) / length };
      const alongEdge = (p: Vec2) =>
        lineDistance(p, edge) <= 0.05 ||
        lineDistance(p, [corner, { x: corner.x - out.x * 200, y: corner.y - out.y * 200 }]) <= 0.05;
      const step = [1, -1].find((s) => !onCut(ring[(k + s + n) % n]!));
      if (step === undefined || [1, -1].every((s) => !onCut(ring[(k + s + n) % n]!))) continue;
      let at = k;
      for (let guard = 0; guard < n && alongEdge(ring[(at + step + n) % n]!); guard++)
        at = (at + step + n) % n;
      const departure = ring[at]!,
        next = ring[(at + step + n) % n]!;
      if (onSurfaces(departure) >= 2 && at !== k) continue; // gore tip
      // Traversal along the edge runs toward the node, then into the curb.
      let direction = { x: -out.x, y: -out.y };
      if (lineDistance(departure, edge) <= 0.05 && at !== k) {
        let closest = Infinity;
        for (let i = 1; i < edge.length; i++) {
          const a = edge[i - 1]!,
            b = edge[i]!;
          const away = segmentDistance(departure, a, b);
          if (away < closest) {
            closest = away;
            const l = Math.hypot(b.x - a.x, b.y - a.y);
            const sign = end.atEnd ? 1 : -1;
            direction = { x: (sign * (b.x - a.x)) / l, y: (sign * (b.y - a.y)) / l };
          }
        }
      }
      const dx = next.x - departure.x,
        dy = next.y - departure.y;
      const turn =
        (Math.acos(
          Math.max(-1, Math.min(1, (dx * direction.x + dy * direction.y) / Math.hypot(dx, dy))),
        ) *
          180) /
        Math.PI;
      audit.curbTurnDeg = Math.max(audit.curbTurnDeg, turn);
      if (turn >= 5) audit.curbKinks++;
    }
  }
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n]!,
      p = ring[i]!,
      b = ring[(i + 1) % n]!;
    const turn = Math.abs(
      Math.atan2(
        (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x),
        (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y),
      ),
    );
    // A spike on one road's own edge is hidden by that road; a gore tip lies on two roads.
    if (turn > (150 * Math.PI) / 180 && onSurfaces(p) === 0) audit.sharpCorners++;
  }
  return audit;
}

export function auditJunctions(net: CompiledCity): NodeAudit[] {
  return net.nodes.map((node) => auditNode(net, node));
}

export function summarize(audits: NodeAudit[]) {
  const sum = (key: keyof NodeAudit) => audits.reduce((total, a) => total + (a[key] as number), 0);
  return {
    nodes: audits.length,
    overlapM2: Math.round(sum('overlapM2') * 100) / 100,
    overlapNodes: audits.filter((a) => a.overlapM2 > 0).length,
    bodyOverlapM2: Math.round(sum('bodyOverlapM2') * 100) / 100,
    selfIntersections: sum('selfIntersections'),
    movementsEscaping: sum('movementsEscaping'),
    edgesOff: sum('edgesOff'),
    curbTurnDeg: Math.round(Math.max(0, ...audits.map((a) => a.curbTurnDeg)) * 10) / 10,
    curbKinks: sum('curbKinks'),
    sharpCorners: sum('sharpCorners'),
    cappedEnds: sum('cappedEnds'),
  };
}

export function worstNodes(audits: NodeAudit[], count = 20): NodeAudit[] {
  return [...audits]
    .sort((a, b) => b.overlapM2 - a.overlapM2 || (a.id < b.id ? -1 : 1))
    .slice(0, count);
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/junction-audit.ts')) {
  const json = process.argv.indexOf('--json');
  const report: Record<string, { summary: ReturnType<typeof summarize>; nodes: NodeAudit[] }> = {};
  for (const name of auditCities) {
    const audits = auditJunctions(compileAuditCity(name));
    report[name] = { summary: summarize(audits), nodes: audits };
  }
  console.table(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.summary])));
  for (const name of auditCities) {
    console.info(`${name}: 20 worst nodes by overlap area`);
    console.table(
      worstNodes(report[name]!.nodes).map((a) => ({
        ...a,
        overlapM2: Math.round(a.overlapM2 * 100) / 100,
        bodyOverlapM2: Math.round(a.bodyOverlapM2 * 100) / 100,
        curbTurnDeg: Math.round(a.curbTurnDeg * 10) / 10,
      })),
    );
  }
  if (json > 0) writeFileSync(process.argv[json + 1]!, JSON.stringify(report, null, 1));
}
