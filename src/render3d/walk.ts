import Flatbush from 'flatbush';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { drape } from './terrain';
import { heightAt, once, roadSurfaceAt, type cityHeights } from './heights';
import { walkGeometry } from '../render/walk-geometry';
import type { CompiledCity, CWalkLink } from '../network';
import type { CityGeometry } from '../render/types';
import { cumulativeLengths, distance, nearestOnPolyline, pointInPolygon } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import { computeVertexNormals } from './buffers';

type Heights = ReturnType<typeof cityHeights>;
const paving = 0.14;
const stairs = (link: CWalkLink) => link.kind === 'steps';
/** Links that say which level a walk node stands at: not stairs, which climb between levels, and
 * not the generated access links to entrances, which are all at grade. */
const levelling = (link: CWalkLink) => link.kind !== 'steps' && link.kind !== 'access';

/**
 * TASK-261: the grade each walk node stands at in 3D. The importer gives a node the grade of the
 * first way it reads there, so where a stair (`layer=1`) meets a footbridge (`layer=2`) the shared
 * node is at grade 0: the stair rose 5 m and fell back to the ground, the footbridge's spur fell 10
 * m to meet it. A stair's end stands at the level of the other walks that meet it there; the node's
 * own grade holds while any of them is at that grade, else the most common of theirs (ties to the
 * higher). Nodes without a stair keep their grade.
 */
export function walkLevels(city: CompiledCity): number[] {
  return city.walk.nodes.map((node) => {
    const links = node.links.map((i) => city.walk.links[i]!);
    if (!links.some(stairs)) return node.layer;
    const levels = links.filter(levelling).map((link) => link.layer);
    if (!levels.length || levels.includes(node.layer)) return node.layer;
    const count = (level: number) => levels.filter((l) => l === level).length;
    return levels.reduce((best, level) =>
      count(level) > count(best) || (count(level) === count(best) && level > best) ? level : best,
    );
  });
}

/** The paving height at each end of a stair. An end no other walk meets that lands on a road, or
 * within a pavement (2.5 m) of one, at the stair's own `layer` or its grade (a stair up to a road
 * bridge, Freiburg wl:6227) takes that surface's height, the stair's layer first. `roads` indexes
 * the road surfaces. */
export function stairEnds(
  city: CompiledCity,
  heights: Heights,
  levels: number[],
  roads: Flatbush,
  link: CWalkLink,
) {
  return [link.from, link.to].map((index) => {
    const node = city.walk.nodes[index]!;
    const p = node.pos;
    if (!node.links.some((i) => levelling(city.walk.links[i]!))) {
      const under = roads
        .search(p.x - 2.5, p.y - 2.5, p.x + 2.5, p.y + 2.5)
        .flatMap((i) => (city.roads[i] ? [city.roads[i]] : []))
        .filter((road) => {
          if (road.grade !== link.layer && road.grade !== levels[index]) return false;
          const ring = [...road.surface, road.surface[0]!];
          return pointInPolygon(p, ring) || nearestOnPolyline(ring, p).away < 2.5;
        });
      const road = under.find((r) => r.grade === link.layer) ?? under[0];
      if (road) return roadSurfaceAt(road, heights.roads[road.idx]!, p) + paving;
    }
    return heights.terrain.groundAt(p.x, p.y) + levels[index]! * 5 + paving;
  });
}

/** Road surfaces by their bounds, for `stairEnds`. */
export function roadIndex(city: CompiledCity) {
  const index = new Flatbush(Math.max(1, city.roads.length));
  for (const road of city.roads) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of road.surface) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    index.add(x0, y0, x1, y1);
  }
  if (!city.roads.length) index.add(0, 0, 0, 0);
  index.finish();
  return index;
}

/**
 * TASK-261: a flight of stairs from height `z0` at the start of `line` to `z1` at its end (owner's
 * bug 4: stairs drew as smooth ribbons, arched when both ends had the same grade). Risers of about
 * 17 cm, equal goings; each tread is level, the last flush with the upper landing. Under the
 * treads, side stringers and a soffit 25 cm below the pitch line close the flight.
 */
export function stairFlight(
  treads: number[],
  sides: number[],
  line: Vec2[],
  width: number,
  z0: number,
  z1: number,
) {
  if (z1 < z0) {
    line = [...line].reverse();
    [z0, z1] = [z1, z0];
  }
  const lengths = cumulativeLengths(line);
  const length = lengths.at(-1)!;
  const count = Math.max(2, Math.round((z1 - z0) / 0.17));
  const rise = (z1 - z0) / count,
    going = length / count;
  const half = width / 2;
  const normal = (i: number) => {
    const a = line[i]!,
      b = line[i + 1]!,
      d = distance(a, b);
    return { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
  };
  const segment = (s: number) => {
    let i = 0;
    while (i < line.length - 2 && lengths[i + 1]! <= s) i++;
    return i;
  };
  /** Left and right edge at station `s`; at an interior vertex `k`, the mitred corner. */
  const edges = (s: number, k?: number) => {
    let n: Vec2, p: Vec2;
    if (k !== undefined) {
      const a = normal(k - 1),
        b = normal(k);
      const m = { x: a.x + b.x, y: a.y + b.y },
        scale = 2 / Math.max(0.5, m.x * m.x + m.y * m.y);
      n = { x: m.x * scale, y: m.y * scale };
      p = line[k]!;
    } else {
      const i = segment(s);
      n = normal(i);
      const t = (s - lengths[i]!) / (lengths[i + 1]! - lengths[i]!);
      p = {
        x: line[i]!.x + (line[i + 1]!.x - line[i]!.x) * t,
        y: line[i]!.y + (line[i + 1]!.y - line[i]!.y) * t,
      };
    }
    return [
      { x: p.x + n.x * half, y: p.y + n.y * half },
      { x: p.x - n.x * half, y: p.y - n.y * half },
    ] as const;
  };
  const pitch = (s: number) => z0 + ((z1 - z0) * s) / length - 0.25;
  /** A quad facing `up` (+1), `down` (-1), or along the plan direction `facing`. */
  const quad = (target: number[], ring: [Vec2, number][], facing: Vec2 | number) => {
    const [a, b, c] = ring;
    const ux = b![0].x - a![0].x,
      uy = b![1] - a![1],
      uz = b![0].y - a![0].y;
    const vx = c![0].x - a![0].x,
      vy = c![1] - a![1],
      vz = c![0].y - a![0].y;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const along = typeof facing === 'number' ? ny * facing : nx * facing.x + nz * facing.y;
    const order = along >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) target.push(ring[i]![0].x, ring[i]![1], ring[i]![0].y);
  };
  for (let i = 0; i < count; i++) {
    const s0 = i * going,
      s1 = (i + 1) * going;
    const foot = z0 + i * rise,
      top = foot + rise;
    const cuts: [number, number | undefined][] = [[s0, undefined]];
    for (let k = 1; k < line.length - 1; k++)
      if (lengths[k]! > s0 && lengths[k]! < s1) cuts.push([lengths[k]!, k]);
    cuts.push([s1, undefined]);
    const [l0, r0] = edges(s0);
    // Risers face down the flight, against the travel direction (the left normal is (-dy, dx)).
    const n0 = normal(segment(s0));
    quad(
      sides,
      [
        [l0, foot],
        [r0, foot],
        [r0, top],
        [l0, top],
      ],
      { x: -n0.y, y: n0.x },
    );
    for (let j = 1; j < cuts.length; j++) {
      const [sa, ka] = cuts[j - 1]!,
        [sb, kb] = cuts[j]!;
      const [la, ra] = edges(sa, ka),
        [lb, rb] = edges(sb, kb);
      const n = normal(segment((sa + sb) / 2));
      quad(
        treads,
        [
          [la, top],
          [lb, top],
          [rb, top],
          [ra, top],
        ],
        1,
      );
      quad(
        sides,
        [
          [la, top],
          [lb, top],
          [lb, pitch(sb)],
          [la, pitch(sa)],
        ],
        n,
      );
      quad(
        sides,
        [
          [ra, top],
          [rb, top],
          [rb, pitch(sb)],
          [ra, pitch(sa)],
        ],
        { x: -n.x, y: -n.y },
      );
      quad(
        sides,
        [
          [la, pitch(sa)],
          [lb, pitch(sb)],
          [rb, pitch(sb)],
          [ra, pitch(sa)],
        ],
        -1,
      );
    }
  }
  const [l, r] = edges(length);
  const end = normal(line.length - 2);
  quad(
    sides,
    [
      [l, z1 - 0.25],
      [r, z1 - 0.25],
      [r, z1],
      [l, z1],
    ],
    { x: end.y, y: -end.x },
  );
}

const walkContexts = new WeakMap<CompiledCity, { levels: number[]; roads?: Flatbush }>();

/** The paved surface height of a walk link at `p` (the deck top on a bridge), as `buildWalk` draws
 * it: TASK-262 shares it with the footbridge structure under and along the walk. Merged with
 * TASK-261: node levels from `walkLevels`, stair ends from `stairEnds`, and a stair whose ends
 * differ by 0.3 m or more follows its flight's pitch line. */
export function walkHeight(
  city: CompiledCity,
  heights: Heights,
  l: CWalkLink,
): (p: Vec2) => number {
  let context = walkContexts.get(city);
  if (!context) walkContexts.set(city, (context = { levels: walkLevels(city) }));
  const { levels } = context;
  const fromGrade = levels[l.from]!,
    toGrade = levels[l.to]!;
  const ends = stairs(l)
    ? stairEnds(city, heights, levels, (context.roads ??= roadIndex(city)), l)
    : undefined;
  const deck = ends ? fromGrade : l.layer;
  if (ends && Math.abs(ends[1]! - ends[0]!) >= 0.3) {
    const length = cumulativeLengths(l.line).at(-1)! || 1;
    return (p) => {
      const t = Math.min(1, Math.max(0, nearestOnPolyline(l.line, p).along / length));
      return ends[0]! + (ends[1]! - ends[0]!) * t;
    };
  }
  return (p) => {
    if (l.road !== undefined)
      return roadSurfaceAt(city.roads[l.road]!, heights.roads[l.road]!, p) + paving;
    if (ends)
      return (
        ends[0]! +
        heights.terrain.groundAt(p.x, p.y) -
        heights.terrain.groundAt(l.line[0]!.x, l.line[0]!.y)
      );
    return (
      heights.terrain.groundAt(p.x, p.y) +
      (l.node !== undefined
        ? heights.nodes[l.node]! -
          heights.terrain.groundAt(city.nodes[l.node]!.pos.x, city.nodes[l.node]!.pos.y)
        : heightAt(
            { lengthM: l.lengthM, fromM: fromGrade * 5, toM: toGrade * 5, deckM: deck * 5 },
            nearestOnPolyline(l.line, p).along,
          )) +
      paving
    );
  };
}

export function buildWalk(city: CompiledCity, source: CityGeometry, heights: Heights) {
  const sidewalks: number[] = [],
    footways: number[] = [],
    steps: number[] = [];
  const landSidewalks: number[] = [],
    landFootways: number[] = [],
    landSteps: number[] = [];
  const levels = walkLevels(city);
  let roads: Flatbush | undefined;
  for (const shape of walkGeometry(city, source)) {
    const l = shape.link;
    const roadHeight = l.road === undefined ? undefined : heights.roads[l.road];
    const fromGrade = levels[l.from]!,
      toGrade = levels[l.to]!;
    const ends = stairs(l)
      ? stairEnds(city, heights, levels, (roads ??= roadIndex(city)), l)
      : undefined;
    if (ends && Math.abs(ends[1]! - ends[0]!) >= 0.3) {
      stairFlight(footways, steps, l.line, l.widthM, ends[0]!, ends[1]!);
      continue;
    }
    // A stair is level once its ends are: its own `layer` only says it passes over or under.
    const deck = ends ? fromGrade : l.layer;
    const ground =
      deck === 0 &&
      fromGrade === 0 &&
      toGrade === 0 &&
      (!roadHeight || (roadHeight.fromM === 0 && roadHeight.toM === 0 && roadHeight.deckM === 0));
    const target = shape.sidewalk
      ? ground
        ? landSidewalks
        : sidewalks
      : ground
        ? landFootways
        : footways;
    const hatchTarget = ground ? landSteps : steps;
    const z = once((p: Vec2) => {
      if (l.road !== undefined)
        return roadSurfaceAt(city.roads[l.road]!, heights.roads[l.road]!, p) + paving;
      if (ends)
        return (
          ends[0]! +
          heights.terrain.groundAt(p.x, p.y) -
          heights.terrain.groundAt(l.line[0]!.x, l.line[0]!.y)
        );
      return (
        heights.terrain.groundAt(p.x, p.y) +
        (l.node !== undefined
          ? heights.nodes[l.node]! -
            heights.terrain.groundAt(city.nodes[l.node]!.pos.x, city.nodes[l.node]!.pos.y)
          : heightAt(
              { lengthM: l.lengthM, fromM: fromGrade * 5, toM: toGrade * 5, deckM: deck * 5 },
              nearestOnPolyline(l.line, p).along,
            )) +
        paving
      );
    });
    const curvedHeight = roadHeight
      ? roadHeight.fromM !== roadHeight.deckM || roadHeight.toM !== roadHeight.deckM
      : fromGrade !== deck || toGrade !== deck;
    // The corners with their heights; on a ramp split at the longest edge (the first of equals)
    // down to 2 m, each new corner's height looked up once and passed down.
    const emit = (p: Vec2, q: Vec2, r: Vec2, zp: number, zq: number, zr: number) => {
      if (curvedHeight) {
        const pq = distance(p, q),
          qr = distance(q, r),
          rp = distance(r, p);
        if (pq >= qr && pq >= rp ? pq > 2 : qr >= rp ? qr > 2 : rp > 2) {
          const [a, b, c, za, zb, zc] =
            pq >= qr && pq >= rp
              ? [p, q, r, zp, zq, zr]
              : qr >= rp
                ? [q, r, p, zq, zr, zp]
                : [r, p, q, zr, zp, zq];
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const zm = z(mid);
          emit(a, mid, c, za, zm, zc);
          emit(mid, b, c, zm, zb, zc);
          return;
        }
      }
      target.push(r.x, zr, r.y, q.x, zq, q.y, p.x, zp, p.y);
    };
    for (const [p, q, r] of shape.polygons) emit(p!, q!, r!, z(p!), z(q!), z(r!));
    for (const [a, b] of shape.hatches) {
      const dx = b!.x - a!.x,
        dy = b!.y - a!.y,
        length = Math.hypot(dx, dy),
        x = (-dy / length) * 0.06,
        y = (dx / length) * 0.06;
      for (const p of [
        { x: a!.x + x, y: a!.y + y },
        { x: b!.x + x, y: b!.y + y },
        { x: b!.x - x, y: b!.y - y },
        { x: a!.x + x, y: a!.y + y },
        { x: b!.x - x, y: b!.y - y },
        { x: a!.x - x, y: a!.y - y },
      ])
        hatchTarget.push(p.x, z(p) + 0.01, p.y);
    }
  }
  const buffer = (data: number[]) => {
    const g = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(data, 3));
    computeVertexNormals(g);
    return g;
  };
  const surface = (raised: number[], land: number[], offset: number) => {
    const a = buffer(raised),
      flat = buffer(land);
    const b = source.terrain ? drape(flat, heights.terrain, offset, false, true) : flat;
    const result = mergeGeometries([a, b])!;
    a.dispose();
    b.dispose();
    if (b !== flat) flat.dispose();
    return result;
  };
  return {
    sidewalks: surface(sidewalks, landSidewalks, paving),
    footways: surface(footways, landFootways, paving),
    steps: surface(steps, landSteps, 0.15),
  };
}
