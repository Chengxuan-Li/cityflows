import Flatbush from 'flatbush';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  pointAtDistance,
  preparePolygon,
  segmentDistance,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import { railHeightAt, railHeights, type RailGraph } from './rail';
import type { CompiledCity } from './types';

type Track = RailGraph['tracks'][number];

/** TASK-134: overhead line sizes (metres) and placement rules. */
export const catenaryRule = {
  /** Contact wire above the rail top, and the messenger wire above the contact wire. */
  contactM: 5.5,
  messengerM: 1.2,
  /** Tracks share supports when within this angle of each other and this gap of the bundle's
   * edge. */
  bundleAngleDeg: 30,
  bundleGapM: 25,
  /** Support spacing: straight track, gentle curves, and curves tighter than `curveRadiusM`. */
  straightM: 60,
  gentleM: 50,
  gentleRadiusM: 1500,
  curveM: 40,
  curveRadiusM: 500,
  /** How far a support may move along its track to clear an obstacle. */
  shiftM: 10,
  /** A mast's distance from the outer track's centreline (railway, tram). */
  mastOffsetM: 3,
  tramMastOffsetM: 2.2,
  /** On a bridge deck, inside its parapet (1 m beyond the bed). */
  bridgeMastOffsetM: 2.3,
  /** Free distance from a mast to a track's centreline (railway, tram). */
  railClearM: 2.2,
  tramClearM: 1.4,
  /** Radius kept free around a level-crossing node and a switch's frog. */
  levelCrossingM: 6,
  frogM: 5,
  /** Distance kept from a line or point platform. */
  platformM: 1,
  /** A bundle of this many tracks gets a portal and two masts; fewer get one mast with an arm. */
  portalTracks: 3,
  /** A wider portal also stands on masts between its tracks, in the widest clear gaps. */
  portalMaxM: 60,
  /** How much further out than `mastOffsetM` a portal's mast may stand (beyond a yard road). */
  portalReachM: 15,
  /** Tracks whose rails differ by more than this do not share a support. */
  levelM: 2.5,
  /** Fixings of the wire in tunnels and under roofs. */
  fixingM: 50,
};

export interface CatenaryDrop {
  track: number;
  /** Metres along the track. */
  s: number;
  pos: Vec2;
  /** Rail top above the ground there. */
  h: number;
}
export interface CatenarySupport {
  kind: 'portal' | 'cantilever';
  tram: boolean;
  /** The 2D grade it stands in (its reference track's layer). */
  layer: number;
  /** Mast feet; `h` is the foot's height above the ground (the rail top beside it). */
  masts: { pos: Vec2; h: number; osmId?: number }[];
  /** The cross member: portal beam between the masts, or the arm from the mast over its tracks. */
  beam: [Vec2, Vec2];
  /** The highest rail top it spans, above the ground. */
  h: number;
  /** Registration points: where the wires of a track hang from this support. */
  drops: CatenaryDrop[];
  /** Every track the cross member spans, with or without a drop. */
  spans: number[];
  /** Metres moved along the track to clear an obstacle. */
  shiftM: number;
}
export interface CatenaryWire {
  layer: number;
  /** Tunnel wire: drawn only with "See below ground" in 3D, not in 2D. */
  hidden: boolean;
  /** Points along the track; spans between consecutive points are straight with a sag. */
  points: { pos: Vec2; h: number; support: boolean }[];
  tracks: number[];
}
export interface Catenary {
  /** Per track: wired by its tags (`contactLine`, wired when untagged). */
  wired: boolean[];
  supports: CatenarySupport[];
  wires: CatenaryWire[];
  /** Connected groups of tracks sharing supports. */
  bundles: number;
  /** Positions with no clear spot within `shiftM`, left without a support. */
  skipped: { track: number; pos: Vec2 }[];
  /** Mapped `power=catenary_mast` nodes, used as masts or listed with the reason they are not. */
  mapped: { osmId: number; pos: Vec2; used: boolean; reason?: string }[];
  /** Frog points kept clear (for tests and the report). */
  frogs: Vec2[];
}

export const isWired = (t: Pick<Track, 'contactLine'>) => t.contactLine ?? true;
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const box = (points: readonly Vec2[]) =>
  [
    Math.min(...points.map((p) => p.x)),
    Math.min(...points.map((p) => p.y)),
    Math.max(...points.map((p) => p.x)),
    Math.max(...points.map((p) => p.y)),
  ] as const;
function index<T>(items: T[], points: (item: T) => readonly Vec2[]) {
  const spatial = new Flatbush(Math.max(1, items.length));
  for (const item of items) spatial.add(...box(points(item)));
  if (!items.length) spatial.add(0, 0, 0, 0);
  spatial.finish();
  return (x0: number, y0: number, x1: number, y1: number) =>
    spatial
      .search(x0, y0, x1, y1)
      .filter((i) => i < items.length)
      .sort((a, b) => a - b);
}

interface Chain {
  /** Sections in order, each possibly reversed against its stored line. */
  parts: { track: number; reversed: boolean; start: number }[];
  line: Vec2[];
  lengths: Float64Array;
  length: number;
  layer: number;
  grade: 'open' | 'tunnel' | 'covered';
  tram: boolean;
  /** Chain distances of this chain's drops. */
  anchors: number[];
}

const cached = new WeakMap<RailGraph, Catenary>();
/**
 * TASK-134: overhead lines. Wired tracks are chained through their continuations; chains are
 * walked longest first, and wherever a chain's supports are further apart than the spacing a
 * support is placed across it. A support spans every wired track of the same system (railway or
 * tram) and level that crosses its cross line within `bundleAngleDeg`, chained outward while
 * each next track lies within `bundleGapM` of the last: a portal with a mast on each side for
 * `portalTracks` or more tracks, one mast with an arm otherwise. Tracks it spans get a drop
 * unless one of theirs is near already, so later chains fill only their own gaps. A support
 * moves up to `shiftM` along its track until its masts stand clear of every track, platform,
 * frog, level crossing and road surface at or above them (first also with its drops clear of
 * frogs, crossings and roads), or is skipped. Mapped catenary masts are placed first, as they
 * are. Tunnel and covered track carry the wire on fixings, without masts.
 */
export function catenary(
  city: CompiledCity,
  roadGrades: readonly number[],
  nodeGrades: readonly number[],
): Catenary {
  const rail = city.rail!;
  const hit = cached.get(rail);
  if (hit) return hit;
  const heights = railHeights(city, roadGrades, nodeGrades);
  const rule = catenaryRule;
  const wired = rail.tracks.map(isWired);
  const tracks = rail.tracks;
  const at = (t: Track, s: number) => pointAtDistance(t.line, t.cumulative, s);
  const heightOf = (t: Track, s: number) => railHeightAt(heights, t, s);
  const gradeOf = (t: Track): Chain['grade'] =>
    heights.grades[t.idx] === 'tunnel'
      ? 'tunnel'
      : heights.grades[t.idx] === 'covered'
        ? 'covered'
        : 'open';

  // Segments of every track that is not in a tunnel, for cross lines and clearances.
  const segments: { track: number; i: number }[] = [];
  for (const t of tracks)
    if (heights.grades[t.idx] !== 'tunnel')
      for (let i = 1; i < t.line.length; i++) segments.push({ track: t.idx, i });
  const segmentIndex = index(segments, ({ track, i }) => [
    tracks[track]!.line[i - 1]!,
    tracks[track]!.line[i]!,
  ]);

  // Frogs: where two branches leaving a switch in the same direction are a gauge apart.
  const outward = (t: Track, node: number) => {
    const line = t.fromNode === node ? t.line : [...t.line].reverse();
    const a = line[0]!,
      b = line.find((p) => distance(p, a) > 0)!;
    const d = distance(a, b);
    return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  };
  const frogs: Vec2[] = [];
  for (const n of rail.nodes) {
    if (n.kind !== 'switch') continue;
    for (const [k, i] of n.tracks.entries())
      for (const j of n.tracks.slice(k + 1)) {
        const a = tracks[i]!,
          b = tracks[j]!;
        if (a === b) continue;
        const u = outward(a, n.idx),
          v = outward(b, n.idx);
        if (u.x * v.x + u.y * v.y < Math.cos((rule.bundleAngleDeg * Math.PI) / 180)) continue;
        for (let s = 1; s <= Math.min(a.lengthM, 80); s++) {
          const p = at(a, a.fromNode === n.idx ? s : a.lengthM - s);
          const q = nearestOnPolyline(b.line, p);
          if (q.away >= 1.5) {
            frogs.push({ x: (p.x + q.point.x) / 2, y: (p.y + q.point.y) / 2 });
            break;
          }
        }
      }
  }
  const frogIndex = index(frogs, (p) => [p]);
  const crossingNodes = rail.nodes.filter((n) => n.kind === 'level_crossing').map((n) => n.pos);
  const crossingIndex = index(crossingNodes, (p) => [p]);
  const surfaces = [
    ...city.roads.map((r) => ({ ring: r.surface, grade: roadGrades[r.idx]! })),
    ...city.nodes.map((n) => ({ ring: n.outline, grade: nodeGrades[n.idx]! })),
  ]
    .filter((s) => s.ring.length >= 3 && s.grade >= 0)
    .map((s) => ({ ...s, inside: preparePolygon([...s.ring, s.ring[0]!]) }));
  const surfaceIndex = index(surfaces, (s) => s.ring);
  const platforms = rail.platforms.map((p) =>
    p.shape.kind === 'polygon'
      ? { points: p.shape.ring, inside: preparePolygon(p.shape.ring) }
      : { points: p.shape.kind === 'line' ? p.shape.line : [p.shape.pos], inside: () => false },
  );
  const platformIndex = index(platforms, (p) => p.points);
  const near = (search: typeof frogIndex, p: Vec2, r: number) =>
    search(p.x - r, p.y - r, p.x + r, p.y + r);
  /** On a road or junction surface at or above height `h`. */
  const onRoad = (p: Vec2, h: number) =>
    near(surfaceIndex, p, 0).some((i) => {
      const s = surfaces[i]!;
      return s.grade * 5 >= h - rule.levelM && s.inside(p);
    });
  const nearFrogOrCrossing = (p: Vec2) =>
    near(frogIndex, p, rule.frogM).some((i) => distance(frogs[i]!, p) < rule.frogM) ||
    near(crossingIndex, p, rule.levelCrossingM).some(
      (i) => distance(crossingNodes[i]!, p) < rule.levelCrossingM,
    );
  /** Whether a mast may stand at `p`, at height `h`. */
  const standable = (p: Vec2, h: number) => {
    if (nearFrogOrCrossing(p) || onRoad(p, h)) return false;
    for (const i of near(platformIndex, p, rule.platformM + 2)) {
      const q = platforms[i]!;
      if (q.inside(p) || nearestOnPolyline(q.points, p).away < rule.platformM + 1) return false;
    }
    for (const i of near(segmentIndex, p, rule.railClearM)) {
      const { track, i: k } = segments[i]!,
        t = tracks[track]!;
      const a = t.line[k - 1]!,
        b = t.line[k]!;
      const clear = t.kind === 'tram' ? rule.tramClearM : rule.railClearM;
      if (segmentDistance(p, a, b) >= clear) continue;
      const s = t.cumulative[k - 1]! + nearestOnPolyline([a, b], p).along;
      if (Math.abs(heightOf(t, s) - h) < rule.levelM + 1) return false;
    }
    return true;
  };

  // Chains of wired sections of one grade, layer and system through their continuations.
  const key = (t: Track) => `${t.kind === 'tram'}/${t.layer}/${gradeOf(t)}`;
  const next = new Map<string, number[]>();
  for (const c of rail.connections) {
    const list = next.get(`${c.from}/${c.node}`) ?? [];
    list.push(c.to);
    next.set(`${c.from}/${c.node}`, list);
  }
  const chainOf = new Int32Array(tracks.length).fill(-1);
  const chains: Chain[] = [];
  for (const t of tracks) {
    if (!wired[t.idx] || chainOf[t.idx]! >= 0) continue;
    const id = chains.length;
    chainOf[t.idx] = id;
    let parts = [{ track: t.idx, reversed: false }];
    // Extend at the end node of `last` (reversed: its start node), straightest first.
    const extend = (forward: boolean) => {
      for (;;) {
        const last = forward ? parts.at(-1)! : parts[0]!;
        const lt = tracks[last.track]!;
        const node = last.reversed === forward ? lt.fromNode : lt.toNode;
        const into = outward(lt, node);
        const options = (next.get(`${lt.idx}/${node}`) ?? [])
          .filter((j) => chainOf[j]! < 0 && wired[j] && key(tracks[j]!) === key(t))
          .map((j) => {
            const o = outward(tracks[j]!, node);
            return { j, turn: o.x * into.x + o.y * into.y };
          })
          .sort((a, b) => a.turn - b.turn || a.j - b.j);
        const best = options[0];
        if (!best) return;
        chainOf[best.j] = id;
        const nt = tracks[best.j]!;
        const part = {
          track: best.j,
          reversed: forward ? nt.toNode === node : nt.fromNode === node,
        };
        parts = forward ? [...parts, part] : [part, ...parts];
      }
    };
    extend(true);
    extend(false);
    const line: Vec2[] = [];
    const placed = parts.map((p) => {
      const pts = p.reversed ? [...tracks[p.track]!.line].reverse() : tracks[p.track]!.line;
      const start = line.length ? cumulativeLengths(line).at(-1)! : 0;
      line.push(...(line.length ? pts.slice(1) : pts));
      return { ...p, start };
    });
    const lengths = cumulativeLengths(line);
    chains.push({
      parts: placed,
      line,
      lengths,
      length: lengths.at(-1)!,
      layer: t.layer,
      grade: gradeOf(t),
      tram: t.kind === 'tram',
      anchors: [],
    });
  }
  const partOf = (track: number) => {
    const c = chains[chainOf[track]!]!;
    return { chain: c, part: c.parts.find((p) => p.track === track)! };
  };
  /** Chain distance of metre `s` on `track`, and back. */
  const toChain = (track: number, s: number) => {
    const { chain, part } = partOf(track);
    return { chain, d: part.start + (part.reversed ? tracks[track]!.lengthM - s : s) };
  };
  const fromChain = (c: Chain, d: number) => {
    const part = [...c.parts].reverse().find((p) => p.start <= d + 1e-9) ?? c.parts[0]!;
    const t = tracks[part.track]!;
    const local = Math.max(0, Math.min(t.lengthM, d - part.start));
    return { t, s: part.reversed ? t.lengthM - local : local };
  };
  const headingAt = (c: Chain, d: number) => {
    const a = pointAtDistance(c.line, c.lengths, Math.max(0, d - 2)),
      b = pointAtDistance(c.line, c.lengths, Math.min(c.length, d + 2));
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const spacingAt = (c: Chain, d: number) => {
    const a = pointAtDistance(c.line, c.lengths, Math.max(0, d - 15)),
      m = pointAtDistance(c.line, c.lengths, d),
      b = pointAtDistance(c.line, c.lengths, Math.min(c.length, d + 15));
    const ab = distance(a, b),
      turn = Math.abs(cross({ x: m.x - a.x, y: m.y - a.y }, { x: b.x - m.x, y: b.y - m.y }));
    // Radius of the circle through the three points.
    const radius = turn < 1e-9 ? Infinity : (distance(a, m) * distance(m, b) * ab) / (2 * turn);
    return radius < rule.curveRadiusM
      ? rule.curveM
      : radius < rule.gentleRadiusM
        ? rule.gentleM
        : rule.straightM;
  };

  /** The tracks a cross line at `p` square to heading `h` spans: offsets along its normal. */
  const sweep = (ref: Track, p: Vec2, h: number, tram: boolean, level: number) => {
    const n = { x: -Math.sin(h), y: Math.cos(h) },
      u = { x: Math.cos(h), y: Math.sin(h) };
    const reach = 400;
    const found = new Map<number, { o: number; s: number; pos: Vec2; dir: Vec2 }>();
    found.set(ref.idx, { o: 0, s: nearestOnPolyline(ref.line, p).along, pos: p, dir: u });
    const ends = [
      { x: p.x - n.x * reach, y: p.y - n.y * reach },
      { x: p.x + n.x * reach, y: p.y + n.y * reach },
    ];
    for (const i of segmentIndex(...box(ends))) {
      const { track, i: k } = segments[i]!;
      const t = tracks[track]!;
      if (
        track === ref.idx ||
        !wired[track] ||
        chainOf[track]! < 0 ||
        chains[chainOf[track]!]!.grade !== 'open' ||
        (t.kind === 'tram') !== tram
      )
        continue;
      const a = t.line[k - 1]!,
        b = t.line[k]!,
        e = { x: b.x - a.x, y: b.y - a.y },
        w = { x: a.x - p.x, y: a.y - p.y };
      const den = cross(n, e),
        len = Math.hypot(e.x, e.y);
      if (Math.abs(den) < 1e-12 || len === 0) continue;
      const o = cross(w, e) / den,
        f = cross(w, n) / den;
      if (f < 0 || f > 1 || Math.abs(o) > reach) continue;
      if (Math.abs(e.x * u.x + e.y * u.y) / len < Math.cos((rule.bundleAngleDeg * Math.PI) / 180))
        continue;
      const s = t.cumulative[k - 1]! + f * len;
      if (Math.abs(heightOf(t, s) - level) > rule.levelM) continue;
      const old = found.get(track);
      if (!old || Math.abs(o) < Math.abs(old.o))
        found.set(track, {
          o,
          s,
          pos: { x: a.x + e.x * f, y: a.y + e.y * f },
          dir: { x: e.x / len, y: e.y / len },
        });
    }
    const sorted = [...found.entries()]
      .map(([track, v]) => ({ track, ...v }))
      .sort((a, b) => a.o - b.o || a.track - b.track);
    const zero = sorted.findIndex((q) => q.track === ref.idx);
    let lo = zero,
      hi = zero;
    while (lo > 0 && sorted[lo]!.o - sorted[lo - 1]!.o <= rule.bundleGapM) lo--;
    while (hi < sorted.length - 1 && sorted[hi + 1]!.o - sorted[hi]!.o <= rule.bundleGapM) hi++;
    return { n, members: sorted.slice(lo, hi + 1) };
  };
  /** A cross line square to the mean direction of the tracks it spans, so a crossover or a
   * converging track does not skew a portal across a track field. */
  const crossSection = (ref: Track, p: Vec2, h: number, tram: boolean, level: number) => {
    const first = sweep(ref, p, h, tram, level);
    const u = { x: Math.cos(h), y: Math.sin(h) },
      sum = { x: 0, y: 0 };
    for (const { dir } of first.members) {
      const sign = dir.x * u.x + dir.y * u.y < 0 ? -1 : 1;
      sum.x += sign * dir.x;
      sum.y += sign * dir.y;
    }
    const mean = Math.atan2(sum.y, sum.x);
    return Math.abs(Math.sin(mean - h)) < 0.01 ? first : sweep(ref, p, mean, tram, level);
  };

  const supports: CatenarySupport[] = [];
  const skipped: Catenary['skipped'] = [];
  /** Builds the support across chain `c` at distance `d`, or null where it cannot stand. */
  const design = (
    c: Chain,
    d: number,
    strict: boolean,
    mapped?: { pos: Vec2; osmId: number },
  ): CatenarySupport | null => {
    const { t, s } = fromChain(c, d);
    const p = at(t, s),
      h = heightOf(t, s);
    const { n, members } = crossSection(t, p, headingAt(c, d), c.tram, h);
    const level = Math.max(...members.map((m) => heightOf(tracks[m.track]!, m.s)));
    const point = (o: number) => ({ x: p.x + n.x * o, y: p.y + n.y * o });
    const lo = members[0]!.o,
      hi = members.at(-1)!.o;
    const offset = c.tram
      ? rule.tramMastOffsetM
      : heights.grades[t.idx] === 'bridge'
        ? rule.bridgeMastOffsetM
        : rule.mastOffsetM;
    const portal = members.length >= rule.portalTracks;
    if (strict && members.some((m) => nearFrogOrCrossing(m.pos) || onRoad(m.pos, h))) return null;
    let feet: number[] | undefined;
    /** The first spot clear for a mast from offset `o` outward (`dir`), within `extra` metres. */
    const outward = (o: number, dir: number, extra: number) => {
      for (let k = 0; k <= 2 * extra; k++)
        if (standable(point(o + (dir * k) / 2), h)) return o + (dir * k) / 2;
      return undefined;
    };
    // Masts between the tracks of a portal wider than `portalMaxM`, in its widest clear gaps.
    const between = () => {
      const mids: number[] = [];
      let from = 0;
      for (let i = 1; i < members.length; i++) {
        if (members[i]!.o - members[from]!.o <= rule.portalMaxM) continue;
        let best: { j: number; gap: number } | undefined;
        for (let j = from + 1; j <= i; j++) {
          const gap = members[j]!.o - members[j - 1]!.o;
          const mid = (members[j]!.o + members[j - 1]!.o) / 2;
          if ((!best || gap > best.gap) && standable(point(mid), h)) best = { j, gap };
        }
        if (!best) continue;
        mids.push((members[best.j]!.o + members[best.j - 1]!.o) / 2);
        from = best.j;
      }
      return mids;
    };
    const mappedAt = mapped ? (mapped.pos.x - p.x) * n.x + (mapped.pos.y - p.y) * n.y : NaN;
    if (mapped) {
      const other =
        mappedAt < (lo + hi) / 2
          ? outward(hi + offset, 1, rule.portalReachM)
          : outward(lo - offset, -1, rule.portalReachM);
      feet =
        portal && (mappedAt <= lo || mappedAt >= hi) && other !== undefined
          ? [mappedAt, ...between(), other]
          : [mappedAt];
    } else if (portal) {
      const left = outward(lo - offset, -1, rule.portalReachM),
        right = left === undefined ? undefined : outward(hi + offset, 1, rule.portalReachM);
      if (left !== undefined && right !== undefined) feet = [left, ...between(), right];
    } else {
      // Railways: a mast on either side; trams also a centre pole between two tracks, or a pole
      // beyond the road beside them.
      let o = outward(hi + offset, 1, 2) ?? outward(lo - offset, -1, 2);
      if (o === undefined && c.tram && members.length === 2 && hi - lo >= 2 * rule.tramClearM)
        o = outward((lo + hi) / 2, 1, 0);
      if (o === undefined && c.tram)
        o = outward(hi + offset, 1, 12) ?? outward(lo - offset, -1, 12);
      if (o !== undefined) feet = [o];
    }
    if (!feet) return null;
    const ends = portal ? feet : [...feet, lo - 0.5, hi + 0.5];
    return {
      kind: portal ? 'portal' : 'cantilever',
      tram: c.tram,
      layer: t.layer,
      masts: feet.map((o, i) => ({
        pos: i === 0 && mapped ? mapped.pos : point(o),
        h,
        ...(i === 0 && mapped ? { osmId: mapped.osmId } : {}),
      })),
      beam: [point(Math.min(...ends)), point(Math.max(...ends))],
      h: level,
      drops: members.map((m) => ({
        track: m.track,
        s: m.s,
        pos: m.pos,
        h: heightOf(tracks[m.track]!, m.s),
      })),
      spans: members.map((m) => m.track),
      shiftM: 0,
    };
  };
  /** Keeps the drops (always the reference track's) whose chains have no drop within `gap`
   * yet, and records them. */
  const commit = (support: CatenarySupport, ref: number, gap: number) => {
    support.drops = support.drops.filter((drop) => {
      const { chain, d } = toChain(drop.track, drop.s);
      if (drop.track !== ref && chain.anchors.some((a) => Math.abs(a - d) < gap)) return false;
      chain.anchors.push(d);
      return true;
    });
    supports.push(support);
  };

  // Mapped masts first, at their own positions.
  const mapped: Catenary['mapped'] = [];
  for (const m of [...(rail.masts ?? [])].sort((a, b) => a.osmId - b.osmId)) {
    let best: { track: number; s: number; away: number } | undefined;
    for (const i of near(segmentIndex, m.pos, 8)) {
      const { track, i: k } = segments[i]!,
        t = tracks[track]!;
      if (chainOf[track]! < 0 || chains[chainOf[track]!]!.grade !== 'open') continue;
      const q = nearestOnPolyline([t.line[k - 1]!, t.line[k]!], m.pos);
      if (q.away <= 8 && (!best || q.away < best.away))
        best = { track, s: t.cumulative[k - 1]! + q.along, away: q.away };
    }
    if (!best) {
      mapped.push({ ...m, used: false, reason: 'no wired open track within 8 m' });
      continue;
    }
    const { chain, d } = toChain(best.track, best.s);
    const twin = supports.find(
      (s) =>
        s.masts.some((q) => q.osmId !== undefined) &&
        s.drops.some((q) => {
          const o = toChain(q.track, q.s);
          return o.chain === chain && Math.abs(o.d - d) < 8;
        }),
    );
    if (twin) {
      // The other mast of a mapped portal, unless it stands on the same side as the first.
      const first = twin.masts.find((q) => q.osmId !== undefined)!;
      const axis = { x: twin.beam[1].x - twin.beam[0].x, y: twin.beam[1].y - twin.beam[0].y };
      const o = (q: Vec2) => (q.x - first.pos.x) * axis.x + (q.y - first.pos.y) * axis.y;
      if (!twin.drops.some((q) => o(q.pos) * (o(q.pos) - o(m.pos)) < 0)) {
        mapped.push({ ...m, used: false, reason: `beside mapped mast ${first.osmId}` });
        continue;
      }
      twin.masts = [first, { pos: m.pos, h: first.h, osmId: m.osmId }];
      twin.beam = o(m.pos) > 0 ? [first.pos, m.pos] : [m.pos, first.pos];
      twin.kind = 'portal';
      mapped.push({ ...m, used: true });
      continue;
    }
    const support = design(chain, d, false, m);
    if (!support) {
      mapped.push({ ...m, used: false, reason: 'no track spanned' });
      continue;
    }
    commit(support, best.track, 0);
    mapped.push({ ...m, used: true });
  }

  // Then every open chain, longest first, fills its gaps.
  const order = chains
    .map((_, i) => i)
    .filter((i) => chains[i]!.grade === 'open')
    .sort((a, b) => chains[b]!.length - chains[a]!.length || a - b);
  const place = (c: Chain, target: number, spacing: number) => {
    for (const strict of [true, false])
      for (let k = 0; k <= 2 * rule.shiftM; k++) {
        const shift = k % 2 ? (k + 1) / 2 : -k / 2;
        const d = target + shift;
        if (d < 0 || d > c.length) continue;
        const support = design(c, d, strict);
        if (!support) continue;
        support.shiftM = Math.abs(shift);
        commit(support, fromChain(c, d).t.idx, 0.4 * spacing);
        return d;
      }
    const { t, s } = fromChain(c, target);
    skipped.push({ track: t.idx, pos: at(t, s) });
    return target;
  };
  /** The tightest spacing among the tracks a cross line at chain distance `d` spans. */
  const rowSpacing = (c: Chain, d: number) => {
    const { t, s } = fromChain(c, d);
    const { members } = crossSection(t, at(t, s), headingAt(c, d), c.tram, heightOf(t, s));
    return Math.min(
      ...members.map((m) => {
        const { chain, d } = toChain(m.track, m.s);
        return spacingAt(chain, d);
      }),
    );
  };
  /** Distance from the chain's start (end) node to the nearest drop of another chain there. */
  const beyond = (c: Chain, atEnd: boolean) => {
    const part = atEnd ? c.parts.at(-1)! : c.parts[0]!,
      t = tracks[part.track]!;
    const node = part.reversed === atEnd ? t.fromNode : t.toNode;
    let best = Infinity;
    for (const j of rail.nodes[node]!.tracks) {
      const other = chains[chainOf[j]!];
      if (!other || other === c || other.grade !== 'open' || other.tram !== c.tram) continue;
      const at = toChain(j, tracks[j]!.fromNode === node ? 0 : tracks[j]!.lengthM).d;
      for (const a of other.anchors) best = Math.min(best, Math.abs(a - at));
    }
    return best;
  };
  /**
   * Hangs chain `c` from an existing support whose cross member crosses it between chain
   * distances `from` and `to` (or, for a portal, crosses within `bundleGapM` beyond a mast that
   * can move out past it), the furthest such crossing; returns its chain distance.
   */
  const extend = (c: Chain, from: number, to: number) => {
    if (to <= from) return undefined;
    const piece = [
      pointAtDistance(c.line, c.lengths, from),
      ...c.line.filter((_, i) => c.lengths[i]! > from && c.lengths[i]! < to),
      pointAtDistance(c.line, c.lengths, to),
    ];
    const [x0, y0, x1, y1] = box(piece);
    const margin = rule.bundleGapM + rule.mastOffsetM;
    const cos = Math.cos((rule.bundleAngleDeg * Math.PI) / 180);
    let best:
      | { support: CatenarySupport; d: number; pos: Vec2; o: number; length: number; ax: Vec2 }
      | undefined;
    for (const support of supports) {
      if (support.tram !== c.tram) continue;
      const [a, b] = support.beam;
      if (
        Math.max(a.x, b.x) < x0 - margin ||
        Math.min(a.x, b.x) > x1 + margin ||
        Math.max(a.y, b.y) < y0 - margin ||
        Math.min(a.y, b.y) > y1 + margin
      )
        continue;
      const length = distance(a, b);
      if (length === 0) continue;
      const ax = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      const ext = support.kind === 'portal' ? rule.bundleGapM : 0;
      const start = { x: a.x - ax.x * ext, y: a.y - ax.y * ext },
        span = length + 2 * ext;
      let run = from;
      for (let k = 1; k < piece.length; k++) {
        const q0 = piece[k - 1]!,
          q1 = piece[k]!,
          e = { x: q1.x - q0.x, y: q1.y - q0.y },
          len = Math.hypot(e.x, e.y);
        const den = cross(ax, e);
        if (len > 0 && Math.abs(den) > 1e-12 && Math.abs(den) / len >= cos) {
          const w = { x: q0.x - start.x, y: q0.y - start.y };
          const along = cross(w, e) / den,
            f = cross(w, ax) / den;
          const d = run + f * len;
          if (f >= 0 && f <= 1 && along >= 0 && along <= span && (!best || d > best.d)) {
            const { t, s } = fromChain(c, d);
            if (Math.abs(heightOf(t, s) - support.h) <= rule.levelM)
              best = {
                support,
                d,
                pos: { x: q0.x + e.x * f, y: q0.y + e.y * f },
                o: along - ext,
                length,
                ax,
              };
          }
        }
        run += len;
      }
    }
    if (!best) return undefined;
    const { support, d, pos, o, length, ax } = best;
    const { t, s } = fromChain(c, d);
    if (o < 0 || o > length) {
      // Move the mast at that end out past the new track.
      const end = o < 0 ? 0 : 1;
      const offset = o < 0 ? o - rule.mastOffsetM : o + rule.mastOffsetM;
      const foot = { x: support.beam[0].x + ax.x * offset, y: support.beam[0].y + ax.y * offset };
      const old = support.masts.findIndex((m) => distance(m.pos, support.beam[end]) < 0.01);
      if (old < 0 || support.masts[old]!.osmId !== undefined || !standable(foot, support.h))
        return undefined;
      support.masts[old] = { pos: foot, h: support.masts[old]!.h };
      support.beam[end] = foot;
    }
    support.drops.push({ track: t.idx, s, pos, h: heightOf(t, s) });
    support.spans.push(t.idx);
    c.anchors.push(d);
    return d;
  };
  for (const i of order) {
    const c = chains[i]!;
    if (c.length < 10) continue;
    const start = Math.min(spacingAt(c, 0) / 2, beyond(c, false)),
      end = Math.min(spacingAt(c, c.length) / 2, beyond(c, true));
    const stops = [...c.anchors].sort((a, b) => a - b);
    let a = -start;
    for (const [k, b] of [...stops, c.length + end].entries()) {
      // Between drops of supports already placed (by tracks alongside), a span up to a quarter
      // longer than this track's spacing stands, so a row of portals is not doubled for the
      // track with the tightest spacing class; a curve under 500 m still gets its own supports.
      const slack = k < stops.length ? 1.25 : 1.05;
      for (;;) {
        // The tightest spacing over the next span; the last two spans of a gap share it evenly.
        let spacing = Infinity;
        for (let x = Math.max(0, a); x <= Math.min(c.length, a + rule.straightM); x += 10)
          spacing = Math.min(spacing, spacingAt(c, x));
        if (!(b - a > spacing * slack)) break;
        // A row of portals takes the tightest spacing of the tracks it spans.
        spacing = Math.min(spacing, rowSpacing(c, a + Math.min(spacing, (b - a) / 2)));
        a =
          extend(c, a + spacing / 2, Math.min(a + spacing, b - 0.4 * spacing)) ??
          place(c, a + (b - a < 2 * spacing ? (b - a) / 2 : spacing), spacing);
      }
      a = Math.max(a, b);
    }
    if (!c.anchors.length) place(c, c.length / 2, spacingAt(c, c.length / 2));
  }

  // Bundles: tracks joined by the supports that span them.
  const root = Int32Array.from(tracks, (_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  const spanned = new Set<number>();
  for (const s of supports)
    for (const t of s.spans) {
      spanned.add(t);
      root[find(t)] = find(s.spans[0]!);
    }
  const bundles = new Set([...spanned].map(find)).size;

  // Wires along each chain, through its drops, with fixings in tunnels and under roofs.
  const wires: CatenaryWire[] = chains.map((c) => {
    const stops: { d: number; support: boolean }[] =
      c.grade === 'open'
        ? c.anchors.map((d) => ({ d, support: true }))
        : Array.from({ length: Math.max(0, Math.ceil(c.length / rule.fixingM) - 1) }, (_, k) => ({
            d: ((k + 1) * c.length) / Math.ceil(c.length / rule.fixingM),
            support: true,
          }));
    stops.push({ d: 0, support: false }, { d: c.length, support: false });
    stops.sort((a, b) => a.d - b.d);
    const points: CatenaryWire['points'] = [];
    const add = (d: number, support: boolean) => {
      const { t, s } = fromChain(c, d);
      points.push({ pos: at(t, s), h: heightOf(t, s), support });
    };
    for (const [k, stop] of stops.entries()) {
      if (k > 0) {
        // A chord far off the track on a curve follows the track instead, every 10 m.
        const from = stops[k - 1]!.d,
          to = stop.d;
        if (to - from < 0.5) continue;
        const a = pointAtDistance(c.line, c.lengths, from),
          b = pointAtDistance(c.line, c.lengths, to);
        let off = 0;
        for (let x = from; x <= to; x += 5)
          off = Math.max(off, segmentDistance(pointAtDistance(c.line, c.lengths, x), a, b));
        if (off > 0.3) {
          const pieces = Math.ceil((to - from) / 10);
          for (let j = 1; j < pieces; j++) add(from + ((to - from) * j) / pieces, false);
        }
      }
      add(stop.d, stop.support);
    }
    return {
      layer: c.layer,
      hidden: c.grade === 'tunnel',
      points,
      tracks: c.parts.map((p) => p.track),
    };
  });
  const result = { wired, supports, wires, bundles, skipped, mapped, frogs };
  cached.set(rail, result);
  return result;
}
