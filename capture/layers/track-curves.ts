import { cumulativeLengths, distance, pointAtDistance } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import type { RailGraph } from '../../src/network/rail';

type Track = RailGraph['tracks'][number];
type End = { track: Track; start: boolean };
type Pose = { p: Vec2; bearing: number };
type Path = {
  at(s: number): Pose;
  metres(s: number): number;
  station(m: number): number;
  length: number;
};
export type TrackCurve = Path & { origin: number; sense: number; joined: [boolean, boolean] };

/** Short facing links between parallel tracks, drawn as turnouts (the tracks layer's
 * `crossovers`, by track id). */
export type IsCrossover = (t: Track) => boolean;
const subtract = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (p: Vec2, k: number) => ({ x: p.x * k, y: p.y * k });
// A zero vector stays zero: a track folding back on itself at a node (tram loops) has no
// tangent there, and a straight Hermite end is the honest fallback.
const unit = (p: Vec2) => {
  const length = Math.hypot(p.x, p.y);
  return length > 1e-9 ? scale(p, 1 / length) : p;
};
const nodeOf = ({ track, start }: End) => (start ? track.fromNode : track.toNode);
const outward = ({ track: t, start }: End) => {
  const a = start ? t.line[0]! : t.line.at(-1)!;
  const b = (start ? t.line : [...t.line].reverse()).find((p) => distance(a, p) > 0.001)!;
  return unit(subtract(b, a));
};

// The mapped station parameter stays available for the height profile and rolling stock.
// An arc-length table supplies metric distances for textures and fittings.
function measured(total: number, at: Path['at']): Path {
  const n = Math.max(1, Math.ceil(total / 0.5));
  const arc = cumulativeLengths(Array.from({ length: n + 1 }, (_, i) => at((i * total) / n).p));
  const length = arc[n]!;
  return {
    at,
    length,
    metres(s) {
      const a = Math.min(n, Math.max(0, (s / total) * n));
      const i = Math.min(n - 1, Math.floor(a));
      return arc[i]! + (a - i) * (arc[i + 1]! - arc[i]!);
    },
    station(m) {
      let lo = 0,
        hi = n;
      m = Math.max(0, Math.min(length, m));
      while (hi - lo > 1) {
        const mid = (lo + hi) >>> 1;
        if (arc[mid]! > m) hi = mid;
        else lo = mid;
      }
      return ((lo + (m - arc[lo]!) / (arc[hi]! - arc[lo]!)) * total) / n;
    },
  };
}

function mainCurve(t: Track, a: Vec2, b: Vec2) {
  const points = t.line.filter((p, i) => i === 0 || distance(p, t.line[i - 1]!) > 0.001);
  const stations = cumulativeLengths(points);
  const dirs = points.map((p, i) => {
    if (!i) return a;
    if (i === points.length - 1) return scale(b, -1);
    const l = unit(subtract(p, points[i - 1]!)),
      r = unit(subtract(points[i + 1]!, p));
    return unit({ x: l.x + r.x, y: l.y + r.y });
  });
  return measured(t.lengthM, (s) => {
    let lo = 0,
      hi = points.length - 1;
    while (hi - lo > 1) {
      const i = (lo + hi) >>> 1;
      if (s < stations[i]!) hi = i;
      else lo = i;
    }
    const p = points[lo]!,
      q = points[hi]!,
      dl = dirs[lo]!,
      dr = dirs[hi]!;
    const span = stations[hi]! - stations[lo]!;
    const x = Math.max(0, Math.min(1, (s - stations[lo]!) / span)),
      y = 1 - x;
    const h = x * x * (3 - 2 * x),
      l = x * y * y * span,
      r = -x * x * y * span;
    const dh = (6 * x * y) / span,
      ld = y * (1 - 3 * x),
      rd = x * (3 * x - 2);
    return {
      p: {
        x: p.x + h * (q.x - p.x) + l * dl.x + r * dr.x,
        y: p.y + h * (q.y - p.y) + l * dl.y + r * dr.y,
      },
      bearing: Math.atan2(
        dh * (q.y - p.y) + ld * dl.y + rd * dr.y,
        dh * (q.x - p.x) + ld * dl.x + rd * dr.x,
      ),
    };
  });
}

function turnout(t: Track, departure: Vec2, arrival: Vec2) {
  const p = t.line[0]!,
    q = t.line.at(-1)!,
    delta = subtract(q, p);
  const align = (d: Vec2) => scale(d, delta.x * d.x + delta.y * d.y < 0 ? -t.lengthM : t.lengthM);
  const a = align(departure),
    b = align(arrival);
  const f = 0.31;
  const mid = {
    x: (delta.x - (f * (a.x + b.x)) / 2) / (1 - f),
    y: (delta.y - (f * (a.y + b.y)) / 2) / (1 - f),
  };
  // Integrate a smoothstep blend of the tangent vectors. Each easement is tangent
  // to both its main line and the diagonal; the middle has zero curvature.
  const entry = (origin: Vec2, from: Vec2, to: Vec2, x: number, reverse: boolean): Pose => {
    const integrated = f * x * x * x * (1 - x / 2),
      blend = x * x * (3 - 2 * x);
    const offset = subtract(to, from),
      sign = reverse ? -1 : 1;
    return {
      p: {
        x: origin.x + sign * (from.x * f * x + offset.x * integrated),
        y: origin.y + sign * (from.y * f * x + offset.y * integrated),
      },
      bearing: Math.atan2(from.y + offset.y * blend, from.x + offset.x * blend),
    };
  };
  const start = entry(p, a, mid, 1, false).p;
  return measured(t.lengthM, (s) => {
    const x = s / t.lengthM;
    if (x < f) return entry(p, a, mid, x / f, false);
    if (x > 1 - f) return entry(q, b, mid, (1 - x) / f, true);
    return {
      p: { x: start.x + (x - f) * mid.x, y: start.y + (x - f) * mid.y },
      bearing: Math.atan2(mid.y, mid.x),
    };
  });
}

export function trackCurves(graph: RailGraph, tracks: Track[], isCrossover: IsCrossover) {
  const selected = new Set(tracks.map((t) => t.idx));
  const ends = graph.nodes.map((n): End[] =>
    n.tracks.flatMap((i) => {
      const track = graph.tracks[i]!;
      return selected.has(i) && !isCrossover(track)
        ? [{ track, start: n.idx === track.fromNode }]
        : [];
    }),
  );
  const mate = ({ track, start }: End) => {
    const options = ends[start ? track.fromNode : track.toNode]!;
    if (options.length !== 2) return;
    return options.find((other) => other.track !== track);
  };
  const tangent = (end: End) => {
    const d = outward(end),
      other = mate(end);
    if (!other) return d;
    const through = subtract(d, outward(other));
    return Math.hypot(through.x, through.y) > 1e-6 ? unit(through) : d;
  };
  const curves = new Map<number, TrackCurve>();
  const mains = tracks.filter((t) => !isCrossover(t));
  const chain = (first: End) => {
    let next: End | undefined = first,
      origin = 0;
    while (next && !curves.has(next.track.idx)) {
      const t: Track = next.track,
        a: End = { track: t, start: true },
        b: End = { track: t, start: false };
      const path = mainCurve(t, tangent(a), tangent(b));
      const sense = next.start ? 1 : -1;
      curves.set(t.idx, {
        ...path,
        sense,
        origin: origin + (sense < 0 ? path.length : 0),
        joined: [!!mate(a), !!mate(b)],
      });
      origin += path.length;
      next = mate(next.start ? b : a);
    }
  };
  for (const t of mains)
    for (const start of [true, false]) if (!mate({ track: t, start })) chain({ track: t, start });
  for (const t of mains) chain({ track: t, start: true });
  for (const t of tracks.filter(isCrossover)) {
    const endsFor = (start: boolean) => ends[nodeOf({ track: t, start })]![0];
    const a = endsFor(true),
      b = endsFor(false);
    const path =
      a && b
        ? turnout(t, tangent(a), tangent(b))
        : measured(t.lengthM, (s) => {
            const d = subtract(t.line.at(-1)!, t.line[0]!);
            return { p: pointAtDistance(t.line, t.cumulative, s), bearing: Math.atan2(d.y, d.x) };
          });
    curves.set(t.idx, { ...path, sense: 1, origin: 0, joined: [!!a, !!b] });
  }
  return { curves, ends };
}
