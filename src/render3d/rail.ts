import Flatbush from 'flatbush';
import {
  areaD,
  booleanOpD,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
} from 'clipper2-ts';
import { earcut } from 'pixi.js';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import type { CompiledCity, CRoad } from '../network';
import { railHeightAt, railHeights, type RailGraph, type RailHeights } from '../network/rail';
import { cityGrades } from '../render/grades';
import { bedWidthM, railGeometry, type RailShape } from '../render/rail-geometry';
import { walkGeometry } from '../render/walk-geometry';
import type { CityGeometry, Pick } from '../render/types';
import { style } from '../render/style';
import { surfaceTexture } from './vegetation';
import type { Vec2 } from '../geo/vec2';
import {
  railSheetReachM,
  raiseRailProfiles,
  roadSurfaceAt,
  type cityHeights,
  type RailClearanceFloor,
} from './heights';
import { RailPaintCache } from './rail-paint-cache';
import {
  boxOf,
  distance,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  preparePolygon,
  segmentIntersection,
} from '../geo/polyline';
import { walkHeight } from './walk';

type Track = RailGraph['tracks'][number];

/** TASK-135: top and foot of each tram part above its grade; railway paint stays at 0.06 m. The
 * bed stays below the 0.14 m kerbs so median islands cover it, as in 2D. */
const tramHeights: Record<NonNullable<RailShape['tram']>, [number, number]> = {
  bed: [0.12, 0],
  sleepers: [0.13, 0.13],
  rail: [0.17, 0.12],
  street: [0.06, 0],
  // TASK-220: the road surfaces' own lift, so the asphalt meets them flush.
  paving: [0.02, 0.02],
};
/** TASK-220: embedded track in a pedestrian street sits on its footways (0.14 m, `walk.ts`). */
const onWalkM = 0.145;
// A deterministic mottle in [-1, 1] from the position, the procedural grass tone.
const mottle = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
};

/** TASK-132: structure sizes in metres and colours. A tunnel tube's walls stand `tubeM` from the
 * bed's edge and its roof `tubeHeightM` over the rail; decks reach `deckM` beyond the bed with
 * parapets `parapetM` high; piers every `pierSpacingM`; cutting walls end `parapetM` above
 * ground, and embankments fall at 1:1.5. */
const structure = {
  tubeM: 1,
  tubeHeightM: 6.3,
  deckM: 1,
  deckDepthM: 1,
  parapetM: 0.9,
  /** TASK-260: gaps up to twice this between the decks or embankments of neighbouring tracks close. */
  closeM: 1.5,
  /** TASK-260: an embankment's end walls (abutments and wing walls) reach this far along it. */
  wingM: 4,
  pierSpacingM: 20,
  pierM: 1.4,
  embankment: 1.5,
  colors: {
    concrete: 0xc8c5bb,
    deck: 0xb9b8b0,
    pier: 0x95a29c,
    bank: 0xbcb69e,
    tube: 0x98a09a,
  },
};

const trackAt = (track: Track, p: Vec2) => nearestOnPolyline(track.line, p).along;

/** The rail top above the terrain at `p` on `track`, in the 3D frame. */
export function railElevation(
  heights: ReturnType<typeof cityHeights>,
  rail: RailHeights,
  track: Track,
  s: number,
  p: Vec2,
) {
  return heights.terrain.groundAt(p.x, p.y) + railHeightAt(rail, track, s);
}

/** Vertex-colour triangles with face normals, for the structures' meshes. */
class Builder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  private readonly color = new Color();
  triangle(a: number[], b: number[], c: number[], hex: number) {
    this.color.setHex(hex);
    for (const v of [a, b, c]) {
      this.positions.push(v[0]!, v[1]!, v[2]!);
      this.colors.push(this.color.r, this.color.g, this.color.b);
    }
  }
  quad(a: number[], b: number[], c: number[], d: number[], hex: number) {
    this.triangle(a, b, c, hex);
    this.triangle(a, c, d, hex);
  }
  /** A vertical wall along `a`-`b` between the heights given at each end. */
  wall(a: Vec2, b: Vec2, a0: number, a1: number, b0: number, b1: number, hex: number) {
    this.quad([a.x, a0, a.y], [b.x, b0, b.y], [b.x, b1, b.y], [a.x, a1, a.y], hex);
  }
  /** An oriented box: centre, along-axis unit `u`, half sizes along `u` and across, bottom, top. */
  box(c: Vec2, u: Vec2, along: number, across: number, z0: number, z1: number, hex: number) {
    const v = { x: -u.y, y: u.x };
    const corner = (i: number, j: number) => ({
      x: c.x + u.x * along * i + v.x * across * j,
      y: c.y + u.y * along * i + v.y * across * j,
    });
    const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let k = 0; k < 4; k++) this.wall(ring[k]!, ring[(k + 1) % 4]!, z0, z1, z0, z1, hex);
    this.quad(
      [ring[0]!.x, z1, ring[0]!.y],
      [ring[1]!.x, z1, ring[1]!.y],
      [ring[2]!.x, z1, ring[2]!.y],
      [ring[3]!.x, z1, ring[3]!.y],
      hex,
    );
  }
  mesh(material: MeshLambertMaterial) {
    const geometry = new BufferGeometry()
      .setAttribute('position', new Float32BufferAttribute(this.positions, 3))
      .setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    return new Mesh(geometry, material);
  }
}

type Sample = { p: Vec2; h: number; half: number; track: Track; s: number; heading: number };
/** Samples of the tracks where `keep` holds, every 2 m, for the union outlines of a structure. */
function samples(
  rail: RailGraph,
  heights: RailHeights,
  keep: (t: Track, h: number) => boolean,
): Sample[] {
  const out: Sample[] = [];
  for (const t of rail.tracks) {
    const n = Math.max(1, Math.ceil(t.lengthM / 2));
    for (let i = 0; i <= n; i++) {
      const s = (i * t.lengthM) / n,
        h = railHeightAt(heights, t, s);
      if (keep(t, h))
        out.push({
          p: pointAtDistance(t.line, t.cumulative, s),
          h,
          half: bedWidthM(t) / 2,
          track: t,
          s,
          heading: headingAtDistance(t.line, t.cumulative, s),
        });
    }
  }
  return out;
}

/**
 * The union outline of `margin` metres beyond the bed around consecutive samples, with each
 * ring vertex's nearest sample, edges split to 2 m. An edge whose midpoint lies on a track
 * (`cap`) closes the band across the track's end. TASK-260: `close` fills gaps narrower than
 * twice it between neighbouring tracks (a morphological closing), so parallel tracks share one
 * outline; `minus` is cut out.
 */
function band(points: Sample[], margin: number, close = 0, minus: Vec2[][] = []) {
  // Runs of consecutive samples along one track, each inflated whole so its outline stays smooth.
  const pieces: Vec2[][] = [];
  const fromEnd = new Map<Sample, number>();
  let run: typeof points = [];
  for (const q of [...points, undefined]) {
    const last = run.at(-1);
    if (q && last && q.track === last.track && distance(q.p, last.p) < 2.5) run.push(q);
    else {
      for (const r of run)
        fromEnd.set(r, Math.min(Math.abs(r.s - run[0]!.s), Math.abs(run.at(-1)!.s - r.s)));
      if (run.length > 1)
        pieces.push(
          ...inflatePathsD(
            [run.map((r) => r.p)],
            run[0]!.half + margin,
            JoinType.Round,
            EndType.Butt,
            2,
            3,
          ),
        );
      run = q ? [q] : [];
    }
  }
  if (!pieces.length) return { rings: [], nearest: () => points[0]!, fromEnd };
  let union = booleanOpD(ClipType.Union, pieces, [], FillRule.NonZero, 3);
  if (close)
    union = inflatePathsD(
      inflatePathsD(union, close, JoinType.Round, EndType.Polygon, 2, 3),
      -close,
      JoinType.Round,
      EndType.Polygon,
      2,
      3,
    );
  if (minus.length) union = booleanOpD(ClipType.Difference, union, minus, FillRule.NonZero, 3);
  const rings = union.map((ring) => {
    const out: Vec2[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!,
        n = Math.max(1, Math.ceil(distance(a, b) / 2));
      for (let k = 0; k < n; k++)
        out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    return out;
  });
  const spatial = new Flatbush(points.length);
  for (const { p } of points) spatial.add(p.x, p.y, p.x, p.y);
  spatial.finish();
  const nearest = (p: Vec2) => points[spatial.neighbors(p.x, p.y, 1)[0]!]!;
  return { rings, nearest, fromEnd };
}
/** TASK-260: an edge that runs across its nearest track rather than along it, or lies within
 * `endM` of where the track leaves the structure: the end of a structure, gaps between tracks
 * ending side by side or at staggered stations included. */
const isAcross = (a: Vec2, b: Vec2, outline: ReturnType<typeof band>, endM = 0) => {
  const q = outline.nearest({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const d = distance(a, b) || 1;
  return (
    outline.fromEnd.get(q)! < endM ||
    Math.abs(((b.x - a.x) * Math.cos(q.heading) + (b.y - a.y) * Math.sin(q.heading)) / d) < 0.7
  );
};
const isCap = (a: Vec2, b: Vec2, nearest: (p: Vec2) => { p: Vec2; half: number }) => {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    s = nearest(m);
  return distance(m, s.p) < s.half * 0.6;
};
const signedArea = (r: Vec2[]) =>
  r.reduce((sum, p, i) => sum + p.x * r[(i + 1) % r.length]!.y - r[(i + 1) % r.length]!.x * p.y, 0);
const largest = (rings: Vec2[][]) =>
  rings.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a), rings[0]!);
/** TASK-260: whether segment `a`-`b` lies along one of `rings`' edges. */
function alongRings(rings: Vec2[][]) {
  const segments = rings.flatMap((ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length]!]));
  if (!segments.length) return () => false;
  const spatial = new Flatbush(segments.length);
  for (const [a, b] of segments)
    spatial.add(
      Math.min(a!.x, b!.x),
      Math.min(a!.y, b!.y),
      Math.max(a!.x, b!.x),
      Math.max(a!.y, b!.y),
    );
  spatial.finish();
  return (a: Vec2, b: Vec2) => {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return spatial
      .search(m.x - 0.01, m.y - 0.01, m.x + 0.01, m.y + 0.01)
      .some((i) => nearestOnPolyline(segments[i]!, m).away < 0.01);
  };
}
/** Triangles covering the outline rings, holes included. */
function fill(rings: Vec2[][]) {
  if (!rings.length) return [];
  const sign = Math.sign(signedArea(largest(rings)));
  const outers = rings.filter((r) => Math.sign(signedArea(r)) === sign);
  const holes = rings.filter((r) => Math.sign(signedArea(r)) !== sign);
  return outers.flatMap((outer) => {
    const inner = holes.filter((h) => inside(h[0]!, outer));
    const points = [...outer, ...inner.flat()];
    let end = outer.length;
    const indices = earcut(
      points.flatMap((p) => [p.x, p.y]),
      inner.map((h) => {
        const at = end;
        end += h.length;
        return at;
      }),
      2,
    );
    return Array.from({ length: indices.length / 3 }, (_, i) =>
      [0, 1, 2].map((k) => points[indices[i * 3 + k]!]!),
    );
  });
}
function inside(p: Vec2, ring: Vec2[]) {
  let contains = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y))
      contains = !contains;
  }
  return contains;
}

/**
 * TASK-260: the rail height across a structure's outline, one continuous sheet through every
 * track on it: each track near `p` gives its height at the station abreast, weighted by the
 * inverse square of the distance beyond its bed, so the sheet meets each bed at that track's
 * height and blends between tracks that the profiles leave at different heights; on a bed it is
 * that track's height.
 */
function heightField(rail: RailHeights, points: Sample[]) {
  if (!points.length) return () => 0;
  const spatial = new Flatbush(points.length);
  for (const { p } of points) spatial.add(p.x, p.y, p.x, p.y);
  spatial.finish();
  const nearest = new Map<Track, { q: Sample; d: number }>();
  return (p: Vec2) => {
    // Each track's nearest sample within reach.
    nearest.clear();
    const reach = railSheetReachM;
    for (const i of spatial.search(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
      const q = points[i]!,
        d = (q.p.x - p.x) ** 2 + (q.p.y - p.y) ** 2,
        best = nearest.get(q.track);
      if (d <= reach * reach && (!best || d < best.d)) nearest.set(q.track, { q, d });
    }
    let sum = 0,
      weights = 0,
      onBed = Infinity;
    for (const { q } of nearest.values()) {
      const ux = Math.cos(q.heading),
        uy = Math.sin(q.heading),
        dx = p.x - q.p.x,
        dy = p.y - q.p.y;
      const along = q.s + dx * ux + dy * uy,
        s = Math.max(0, Math.min(q.track.lengthM, along)),
        past = Math.abs(along - s),
        aside = Math.abs(dx * uy - dy * ux) - q.half,
        h = railHeightAt(rail, q.track, s);
      if (aside < 1e-3 && past < 1e-3) onBed = Math.min(onBed, h);
      const w = 1 / (Math.hypot(Math.max(0, aside), past) + 0.05) ** 2;
      sum += w * h;
      weights += w;
    }
    // On overlapping beds the lowest bed's height, so the sheet never covers a bed (TASK-280: the
    // network gives tracks that share a bed one profile, so their heights agree to a few cm).
    if (onBed < Infinity) return onBed;
    return weights ? sum / weights : points[spatial.neighbors(p.x, p.y, 1)[0]!]!.h;
  };
}

/** TASK-260: the triangles of `fill`, cut on a `cellM` grid and along the tracks' beds so a
 * surface lifted by a height field follows it; the outline alone gave triangles across whole
 * decks, whose straight faces cut through the tracks between their corners. Cells of one parity
 * never share an edge, so each clipped piece lies within one cell. */
function cellTriangles(
  rings: Vec2[][],
  beds: Vec2[][],
  points: Sample[],
  margin: number,
  cellM = 2,
) {
  const keys = new Set<number>();
  const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  for (const { p, half } of points) {
    const r = half + margin + cellM;
    for (let i = Math.floor((p.x - r) / cellM); i <= Math.floor((p.x + r) / cellM); i++)
      for (let j = Math.floor((p.y - r) / cellM); j <= Math.floor((p.y + r) / cellM); j++)
        keys.add(key(i, j));
  }
  const parity: Vec2[][][] = [[], []];
  for (const k of keys) {
    const i = Math.floor(k / 65536) - 32768,
      j = (k % 65536) - 32768;
    const [x0, y0, x1, y1] = [i * cellM, j * cellM, (i + 1) * cellM, (j + 1) * cellM];
    parity[(i + j) & 1]!.push([
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ]);
  }
  // Beds apart from the rest, so the sheet's corners lie on their edges: a triangle across a bed's
  // edge would cut through the bed where the sheet steps between tracks at different heights.
  const parts = [
    booleanOpD(ClipType.Intersection, rings, beds, FillRule.NonZero, 3),
    booleanOpD(ClipType.Difference, rings, beds, FillRule.NonZero, 3),
  ];
  return parts.flatMap((part) =>
    parity.flatMap((cells) =>
      cells.length && part.length
        ? fill(booleanOpD(ClipType.Intersection, part, cells, FillRule.NonZero, 3))
        : [],
    ),
  );
}

function bridgeDeck(graph: RailGraph, rail: RailHeights) {
  const bridges = samples(graph, rail, (t) => rail.grades[t.idx] === 'bridge');
  const outline = band(bridges, structure.deckM, structure.closeM);
  const triangles = cellTriangles(
    outline.rings,
    band(bridges, 0).rings,
    bridges,
    structure.deckM + structure.closeM,
  );
  return { bridges, outline, triangles };
}

const bounds = (ring: Vec2[]) => {
  const { minX, minY, maxX, maxY } = boxOf(ring);
  return [minX, minY, maxX, maxY] as const;
};

/** Paved footprints and surface heights, indexed once for the deck cells and pier feet. */
export function railPassages(
  city: CompiledCity,
  source: CityGeometry,
  heights: ReturnType<typeof cityHeights>,
) {
  const surfaces: {
    id: string;
    layer: number;
    clearance: number;
    ring: Vec2[];
    height: (p: Vec2) => number;
    road?: CRoad;
    inside?: (p: Vec2) => boolean;
  }[] = [];
  for (const r of city.roads)
    if (r.surface.length >= 3)
      surfaces.push({
        id: r.id,
        layer: r.grade,
        clearance: 4.5,
        ring: r.surface,
        road: r,
        inside: preparePolygon([...r.surface, r.surface[0]!]),
        height: (p) => roadSurfaceAt(r, heights.roads[r.idx]!, p),
      });
  for (const n of city.nodes)
    if (n.outline.length >= 3)
      surfaces.push({
        id: n.id,
        layer: n.grade,
        clearance: 4.5,
        ring: n.outline,
        inside: preparePolygon([...n.outline, n.outline[0]!]),
        height: (p) =>
          heights.nodes[n.idx]! +
          (n.grade === 0
            ? heights.terrain.surfaceAt(p.x, p.y) - heights.terrain.groundAt(n.pos.x, n.pos.y)
            : 0),
      });
  for (const { link, layer, polygons } of walkGeometry(city, source)) {
    const pitch = walkHeight(city, heights, link);
    const rise =
      link.kind === 'steps' ? Math.abs(pitch(link.line[0]!) - pitch(link.line.at(-1)!)) : 0;
    // A tread can stand a full riser above the pitch line returned by walkHeight.
    const riser = rise >= 0.3 ? rise / Math.max(2, Math.round(rise / 0.17)) : 0;
    const height = riser ? (p: Vec2) => pitch(p) + riser : pitch;
    for (const ring of polygons)
      surfaces.push({
        id: link.id,
        layer,
        clearance: 2.5,
        ring,
        height,
        inside: preparePolygon([...ring, ring[0]!]),
      });
  }
  const index = new Flatbush(Math.max(1, surfaces.length));
  for (const { ring } of surfaces) index.add(...bounds(ring));
  if (!surfaces.length) index.add(0, 0, 0, 0);
  index.finish();
  const shared = new Map<number, boolean>();
  const sharedRoadDeck = (t: Track) => {
    if (t.kind !== 'tram' || (t.form ?? 'embedded') !== 'embedded') return false;
    let carriesRoad = shared.get(t.idx);
    if (carriesRoad !== undefined) return carriesRoad;
    const s = t.lengthM / 2;
    const p = pointAtDistance(t.line, t.cumulative, s);
    const heading = headingAtDistance(t.line, t.cumulative, s);
    const half = bedWidthM(t) / 2 + structure.deckM;
    const x = Math.sin(heading) * half,
      y = Math.cos(heading) * half;
    const a = { x: p.x - x, y: p.y + y },
      b = { x: p.x + x, y: p.y - y };
    // The street and its embedded tram are on one deck if they run abreast on the same layer.
    // Lifting just the track would split the two surfaces and break the street-running tram.
    carriesRoad = index.search(...bounds([a, b])).some((i) => {
      const surface = surfaces[i];
      if (!surface?.road || surface.layer !== t.layer) return false;
      const q = nearestOnPolyline(surface.road.reference, p);
      return (
        Math.abs(q.direction.x * Math.cos(heading) + q.direction.y * Math.sin(heading)) >
          Math.cos(Math.PI / 6) &&
        (surface.inside!(p) ||
          surface.ring.some((v, k) =>
            segmentIntersection(a, b, v, surface.ring[(k + 1) % surface.ring.length]!),
          ))
      );
    });
    shared.set(t.idx, carriesRoad);
    return carriesRoad;
  };
  const overlaps = (ring: Vec2[], track: Track) =>
    index.search(...bounds(ring)).flatMap((i) => {
      const s = surfaces[i];
      if (!s || s.layer >= Math.max(1, track.layer)) return [];
      return booleanOpD(ClipType.Intersection, [ring], [s.ring], FillRule.NonZero, 3)
        .filter((overlap) => Math.abs(areaD(overlap)) > 1e-6)
        .map((points) => ({ surface: s, points }));
    });
  const atPavement = (t: Track, p: Vec2, h: number) => {
    const z = heights.terrain.groundAt(p.x, p.y) + h;
    return index.search(p.x, p.y, p.x, p.y).some((i) => {
      const s = surfaces[i];
      return !!s?.inside && s.layer === t.layer && s.inside(p) && Math.abs(s.height(p) - z) < 0.2;
    });
  };
  return { sharedRoadDeck, overlaps, atPavement };
}

function clearanceFloors(
  city: CompiledCity,
  rail: RailHeights,
  heights: ReturnType<typeof cityHeights>,
  deck: ReturnType<typeof bridgeDeck>,
  passages: ReturnType<typeof railPassages>,
) {
  const raised = samples(city.rail!, rail, (t, h) => rail.grades[t.idx] === 'ground' && h > 0.2);
  const field = heightField(rail, [...deck.bridges, ...raised]);
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  const floors: RailClearanceFloor[] = [];
  for (const triangle of deck.triangles) {
    const middle = {
      x: (triangle[0]!.x + triangle[1]!.x + triangle[2]!.x) / 3,
      y: (triangle[0]!.y + triangle[1]!.y + triangle[2]!.y) / 3,
    };
    const track = deck.outline.nearest(middle).track;
    if (passages.sharedRoadDeck(track)) continue;
    const hits = passages.overlaps(triangle, track);
    if (!hits.length) continue;
    // Bound the whole cell by its highest pavement point. Allow for mesh coordinates rounded
    // to millimetres and for the chord used to draw the pavement between height samples.
    const required = Math.max(
      ...hits.flatMap(({ surface, points }) =>
        points.map((p) => surface.height(p) + surface.clearance + structure.deckDepthM + 0.03),
      ),
    );
    for (const p of triangle) {
      const height = required - ground(p);
      if (height > field(p)) floors.push({ p, layer: track.layer, height });
    }
  }
  return floors;
}

/**
 * TASK-132: tunnel tubes, portals and cutting walls, bridge decks with parapets and piers, and
 * embankments under raised ground track. The translucent tube shows, with the tunnel's track and
 * trains, only when "See below ground" is on; the portals and cutting walls always do.
 */
function buildStructures(
  city: CompiledCity,
  rail: RailHeights,
  heights: ReturnType<typeof cityHeights>,
  bridge: ReturnType<typeof bridgeDeck>,
  passages: ReturnType<typeof railPassages> | undefined,
  lifted: boolean,
) {
  const graph = city.rail!;
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  const solid = new Builder(),
    tube = new Builder();
  const { concrete, deck, pier, bank, tube: tubeColor } = structure.colors;
  // Tunnel tubes.
  const tunnels = samples(graph, rail, (t) => rail.grades[t.idx] === 'tunnel');
  const tubes = band(tunnels, structure.tubeM);
  for (const ring of tubes.rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      if (isCap(a, b, tubes.nearest)) continue;
      const za = ground(a) + tubes.nearest(a).h,
        zb = ground(b) + tubes.nearest(b).h;
      tube.wall(
        a,
        b,
        za - 0.3,
        za + structure.tubeHeightM,
        zb - 0.3,
        zb + structure.tubeHeightM,
        tubeColor,
      );
    }
  for (const triangle of fill(tubes.rings)) {
    const [a, b, c] = triangle.map((p) => [
      p.x,
      ground(p) + tubes.nearest(p).h + structure.tubeHeightM,
      p.y,
    ]);
    tube.triangle(a!, b!, c!, tubeColor);
  }
  // Cutting walls beside ground track below grade, ending above the ground as parapets.
  const cuttings = samples(graph, rail, (t, h) => rail.grades[t.idx] === 'ground' && h < -0.2);
  const cutting = band(cuttings, 1.5);
  for (const ring of cutting.rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      if (isCap(a, b, cutting.nearest)) continue;
      const ga = ground(a),
        gb = ground(b);
      solid.wall(
        a,
        b,
        ga + cutting.nearest(a).h - 0.3,
        ga + structure.parapetM,
        gb + cutting.nearest(b).h - 0.3,
        gb + structure.parapetM,
        concrete,
      );
    }
  // Portals: two jambs and a lintel at the tunnel's mouth, up to a headwall above the ground.
  for (const portal of rail.portals.filter((p) => p.kind === 'tunnel')) {
    const t = graph.tracks[portal.track]!,
      p = graph.nodes[portal.node]!.pos,
      s = portal.atEnd ? t.lengthM : 0;
    const h = railHeightAt(rail, t, s),
      g = ground(p);
    const heading = headingAtDistance(t.line, t.cumulative, s) + (portal.atEnd ? Math.PI : 0);
    const u = { x: Math.cos(heading), y: Math.sin(heading) },
      v = { x: -u.y, y: u.x };
    const half = bedWidthM(t) / 2 + structure.tubeM,
      top = Math.max(g + h + structure.tubeHeightM, g + structure.parapetM);
    for (const side of [-1, 1])
      solid.box(
        { x: p.x + v.x * side * (half + 0.45), y: p.y + v.y * side * (half + 0.45) },
        u,
        0.5,
        0.45,
        g + h - 0.5,
        top,
        concrete,
      );
    solid.box(p, u, 0.5, half, g + h + structure.tubeHeightM - 1, top, concrete);
  }
  // TASK-260: bridge decks and the embankments under raised ground track as one structure: the
  // decks' outline, and the embankments' outline less the decks, with gaps between neighbouring
  // tracks closed; one height sheet through every track on either, so the deck surface, the
  // embankment top and the walls between them meet. Parapets and slopes stand on outer edges
  // only; where an embankment meets a deck or ends, a wall stands from the ground to its top.
  const { triangles: deckTriangles, outline: decks } = bridge;
  const bridges = bridge.bridges.map((q) => ({ ...q, h: railHeightAt(rail, q.track, q.s) }));
  const raised = samples(graph, rail, (t, h) => rail.grades[t.idx] === 'ground' && h > 0.2);
  const banks = band(raised, structure.deckM, structure.closeM, decks.rings);
  const field = heightField(rail, [...bridges, ...raised]);
  // Triangles share their corner objects: each corner's height once.
  const memo = new Map<Vec2, number>();
  const sheet = (p: Vec2) => {
    let h = memo.get(p);
    if (h === undefined) memo.set(p, (h = field(p)));
    return h;
  };
  const top = (p: Vec2) => ground(p) + sheet(p);
  const onDeck = alongRings(decks.rings),
    onBank = alongRings(banks.rings);
  for (const [a, b, c] of deckTriangles) {
    const [za, zb, zc] = [top(a!), top(b!), top(c!)],
      depth = structure.deckDepthM;
    solid.triangle([a!.x, za, a!.y], [b!.x, zb, b!.y], [c!.x, zc, c!.y], deck);
    solid.triangle(
      [a!.x, za - depth, a!.y],
      [c!.x, zc - depth, c!.y],
      [b!.x, zb - depth, b!.y],
      deck,
    );
  }
  let parapets = 0;
  for (const ring of decks.rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      // The embankment's wall closes the deck's side where the two meet.
      if (onBank(a, b)) continue;
      const za = top(a),
        zb = top(b);
      solid.wall(a, b, za - structure.deckDepthM, za, zb - structure.deckDepthM, zb, concrete);
      if (!isAcross(a, b, decks)) {
        solid.wall(a, b, za, za + structure.parapetM, zb, zb + structure.parapetM, concrete);
        parapets++;
      }
    }
  for (const t of graph.tracks.filter((t) => rail.grades[t.idx] === 'bridge'))
    for (let s = structure.pierSpacingM / 2; s < t.lengthM; s += structure.pierSpacingM) {
      const p = pointAtDistance(t.line, t.cumulative, s),
        h = railHeightAt(rail, t, s) - structure.deckDepthM;
      const heading = headingAtDistance(t.line, t.cumulative, s);
      const u = { x: Math.cos(heading), y: Math.sin(heading) },
        half = structure.pierM / 2;
      const foot = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([x, y]) => ({
        x: p.x + half * (x! * u.x - y! * u.y),
        y: p.y + half * (x! * u.y + y! * u.x),
      }));
      const base = ground(p);
      const obstructs = passages?.overlaps(foot, t).some(({ surface, points }) =>
        points.some((q) => {
          const z = surface.height(q);
          return z <= base + h && z + surface.clearance >= base;
        }),
      );
      if (h > 0.5 && !obstructs) solid.box(p, u, half, half, base, base + h, pier);
    }
  const bankTriangles = cellTriangles(
    banks.rings,
    band(raised, 0).rings,
    raised,
    structure.deckM + structure.closeM,
    // The corrected ramps meet both an existing slope and a clearance floor. Sample their
    // embankment tops at the deck's resolution so a chord does not cut across a rail bed.
    lifted ? 2 : 4,
  );
  for (const [a, b, c] of bankTriangles)
    solid.triangle([a!.x, top(a!), a!.y], [b!.x, top(b!), b!.y], [c!.x, top(c!), c!.y], bank);
  let walls = 0;
  // Outward normals: the band lies on one side of every ring's direction (holes run the other
  // way round), the side the outer rings' signed area gives.
  const sign = banks.rings.length ? Math.sign(signedArea(largest(banks.rings))) : 1;
  // TASK-280: track at grade beside an embankment, which its slope would bury.
  const flat = samples(graph, rail, (t, h) => rail.grades[t.idx] !== 'tunnel' && h <= 0.2);
  const flatIndex = new Flatbush(Math.max(1, flat.length));
  for (const { p } of flat) flatIndex.add(p.x, p.y, p.x, p.y);
  if (!flat.length) flatIndex.add(0, 0, 0, 0);
  flatIndex.finish();
  for (const ring of banks.rings) {
    const n = ring.length;
    const normal = (a: Vec2, b: Vec2) => {
      const d = distance(a, b) || 1;
      return { x: (sign * (b.y - a.y)) / d, y: (-sign * (b.x - a.x)) / d };
    };
    // A slope from `a`-`b` that would reach a bed at grade: a retaining wall stands instead.
    const besideFlat = (a: Vec2, b: Vec2) => {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        u = normal(a, b),
        half = distance(a, b) / 2,
        reach = structure.embankment * Math.max(0, sheet(a), sheet(b)),
        r = reach + half + 2;
      return flatIndex.search(m.x - r, m.y - r, m.x + r, m.y + r).some((i) => {
        const q = flat[i];
        if (!q) return false;
        const dx = q.p.x - m.x,
          dy = q.p.y - m.y,
          out = dx * u.x + dy * u.y;
        return (
          out > -q.half && out < reach + q.half && Math.abs(dx * u.y - dy * u.x) < half + q.half
        );
      });
    };
    const wall = ring.map((a, i) => {
      const b = ring[(i + 1) % n]!;
      return onDeck(a, b) || isAcross(a, b, banks, structure.wingM) || besideFlat(a, b);
    });
    // Each slope foot lies out along its vertex's normal, from the slope edges beside it only.
    const foot = ring.map((p, i) => {
      const h = (n + i - 1) % n,
        e0 = wall[h] ? { x: 0, y: 0 } : normal(ring[h]!, p),
        e1 = wall[i] ? { x: 0, y: 0 } : normal(p, ring[(i + 1) % n]!);
      const len = Math.hypot(e0.x + e1.x, e0.y + e1.y) || 1,
        reach = (structure.embankment * Math.max(0, sheet(p))) / len;
      const q = { x: p.x + (e0.x + e1.x) * reach, y: p.y + (e0.y + e1.y) * reach };
      return [q.x, ground(q), q.y];
    });
    for (let i = 0; i < n; i++) {
      const a = ring[i]!,
        j = (i + 1) % n,
        b = ring[j]!;
      if (wall[i]) {
        solid.wall(a, b, ground(a), top(a), ground(b), top(b), concrete);
        walls++;
      } else solid.quad([a.x, top(a), a.y], [b.x, top(b), b.y], foot[j]!, foot[i]!, bank);
      // Where a slope meets a wall, a wing closes the slope's end.
      if (wall[i] !== wall[j])
        solid.triangle([b.x, top(b), b.y], foot[j]!, [b.x, ground(b), b.y], bank);
    }
  }
  const solidMesh = solid.mesh(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  const tubeMesh = tube.mesh(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  solidMesh.name = 'rail-structures';
  tubeMesh.name = 'rail-tubes';
  return {
    solidMesh,
    tubeMesh,
    counts: {
      tunnels: tunnels.length,
      cuttings: cuttings.length,
      bridges: bridges.length,
      decks: decks.rings.length,
      deckTriangles: deckTriangles.length,
      parapets,
      embankments: banks.rings.length,
      embankmentWalls: walls,
    },
  };
}

export function buildRail(
  city: CompiledCity,
  source: CityGeometry,
  heights: ReturnType<typeof cityHeights>,
) {
  const group = new Group();
  const { roadGrades, nodeGrades } = cityGrades(city);
  const base = city.rail ? railHeights(city, roadGrades, nodeGrades) : undefined;
  let rail = base;
  const bridge = rail && bridgeDeck(city.rail!, rail);
  const passages = bridge?.triangles.length ? railPassages(city, source, heights) : undefined;
  if (rail && bridge && passages) {
    const sharedRoadDecks = new Set(
      city
        .rail!.tracks.filter((t) => rail!.grades[t.idx] === 'bridge' && passages.sharedRoadDeck(t))
        .map((t) => t.idx),
    );
    rail = raiseRailProfiles(
      city.rail!,
      rail,
      clearanceFloors(city, rail, heights, bridge, passages),
      sharedRoadDecks,
      passages.atPavement,
    );
  }
  // Tracks above ground in one batch; tunnel track in another shown with "See below ground".
  const batches = [0, 1].map(() => ({
    positions: [] as number[],
    colors: [] as number[],
    spans: [] as { pick: Pick | undefined; from: number; to: number }[],
  }));
  // TASK-220: embedded track's street paving, lit and grained as the road asphalt it continues.
  const paving = { positions: [] as number[], colors: [] as number[], uvs: [] as number[] };
  const color = new Color();
  const side = new Color();
  for (const shape of railGeometry(city, source)) {
    if (shape.only2d) continue;
    const track = shape.pick?.kind === 'track' ? city.rail!.tracks[shape.pick.track] : undefined;
    const batch = batches[track && rail!.grades[track.idx] === 'tunnel' ? 1 : 0]!;
    const { positions, colors } = shape.tram === 'paving' ? paving : batch;
    const from = colors.length;
    color.setHex(shape.color);
    side.copy(color).multiplyScalar(0.72);
    const [top, foot] = (
      shape.tram ? tramHeights[shape.tram] : shape.crossing ? [0.085, 0.085] : [0.06, 0.06]
    ).map((h) => (shape.onWalk ? h + onWalkM : h)) as [number, number];
    // TASK-260: on ramps and bridges triangles split to 4 m, so the paint follows the profile (and
    // the terrain) as closely as the structures' sheet under it.
    const ramp =
      track && (rail!.profiles[track.idx]!.length > 1 || rail!.grades[track.idx] === 'bridge');
    const node = shape.node === undefined ? undefined : city.rail!.nodes[shape.node]!;
    const nodeTrack = node && city.rail!.tracks[node.tracks[0]!]!;
    const z = (p: Vec2, offset: number) =>
      (shape.crossing
        ? heights.terrain.surfaceAt(p.x, p.y)
        : track
          ? railElevation(heights, rail!, track, trackAt(track, p), p)
          : nodeTrack
            ? railElevation(
                heights,
                rail!,
                nodeTrack,
                nodeTrack.fromNode === node.idx ? 0 : nodeTrack.lengthM,
                p,
              )
            : heights.terrain.groundAt(p.x, p.y) + shape.layer * 5) + offset;
    const emit = (tri: Vec2[]) => {
      if (ramp) {
        const lengths = tri.map((p, i) => distance(p, tri[(i + 1) % 3]!));
        const edge = lengths.indexOf(Math.max(...lengths));
        if (lengths[edge]! > 4) {
          const a = tri[edge]!,
            b = tri[(edge + 1) % 3]!,
            c = tri[(edge + 2) % 3]!,
            mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          emit([a, mid, c]);
          emit([mid, b, c]);
          return;
        }
      }
      for (const p of [...tri].reverse()) {
        positions.push(p.x, z(p, top), p.y);
        if (shape.tram === 'paving') paving.uvs.push(p.x / 2.56, p.y / 2.56);
        if (shape.grass) {
          const k = 1 + 0.07 * mottle(p.x, p.y);
          colors.push(color.r * k, color.g * k, color.b * k);
        } else colors.push(color.r, color.g, color.b);
      }
    };
    for (const polygon of shape.polygons)
      if (polygon.length === 4) {
        emit([polygon[0]!, polygon[1]!, polygon[2]!]);
        emit([polygon[0]!, polygon[2]!, polygon[3]!]);
      } else emit(polygon);
    // Sides of raised tram parts, a shade darker than their tops.
    if (top > foot)
      for (const ring of shape.outline ?? [])
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!,
            b = ring[(i + 1) % ring.length]!;
          positions.push(
            ...[a.x, z(a, top), a.y, b.x, z(b, top), b.y, b.x, z(b, foot), b.y],
            ...[a.x, z(a, top), a.y, b.x, z(b, foot), b.y, a.x, z(a, foot), a.y],
          );
          for (let k = 0; k < 6; k++) colors.push(side.r, side.g, side.b);
        }
    if (shape.tram !== 'paving') batch.spans.push({ pick: shape.pick, from, to: colors.length });
  }
  const meshes = batches.map(({ positions, colors }) => {
    const geometry = new BufferGeometry()
      .setAttribute('position', new Float32BufferAttribute(positions, 3))
      .setAttribute('color', new Float32BufferAttribute(colors, 3));
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
    );
    group.add(mesh);
    return mesh;
  });
  const below = meshes[1]!;
  below.name = 'rail-below';
  below.visible = false;
  const structures =
    rail && bridge && buildStructures(city, rail, heights, bridge, passages, rail !== base);
  if (structures) group.add(structures.solidMesh, structures.tubeMesh);
  const paintCache = new RailPaintCache(meshes[0]!);
  group.add(paintCache.mesh);
  if (paving.positions.length) {
    const mesh = new Mesh(
      new BufferGeometry()
        .setAttribute('position', new Float32BufferAttribute(paving.positions, 3))
        .setAttribute('color', new Float32BufferAttribute(paving.colors, 3))
        .setAttribute('uv', new Float32BufferAttribute(paving.uvs, 2))
        .setAttribute(
          'normal',
          new Float32BufferAttribute(
            Array.from({ length: paving.positions.length / 3 }, () => [0, 1, 0]).flat(),
            3,
          ),
        ),
      new MeshLambertMaterial({
        vertexColors: true,
        side: DoubleSide,
        map: surfaceTexture('asphalt'),
      }),
    );
    mesh.name = 'tram-paving';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (structures) {
    const material = structures.tubeMesh.material as MeshLambertMaterial;
    material.transparent = true;
    material.opacity = 0.35;
    material.depthWrite = false;
    structures.tubeMesh.renderOrder = 4;
  }
  const setBelowGround = (enabled: boolean) => {
    below.visible = enabled;
    if (structures) structures.tubeMesh.visible = enabled;
  };
  setBelowGround(false);
  const select = (pick: Pick | null) => {
    const accent = new Color(style.selection);
    batches.forEach(({ colors, spans }, i) => {
      const attribute = meshes[i]!.geometry.getAttribute('color');
      (attribute.array as Float32Array).set(colors);
      for (const span of spans)
        if (pick && JSON.stringify(span.pick) === JSON.stringify(pick))
          for (let k = span.from; k < span.to; k += 3)
            attribute.setXYZ(k / 3, accent.r, accent.g, accent.b);
      attribute.needsUpdate = true;
    });
  };
  return {
    group,
    select,
    setBelowGround,
    paintCache,
    heights: rail,
    structures: structures?.counts,
  };
}

/** Screen-space picking follows elevated rail geometry rather than projecting to the ground. */
export function pickRail3D(
  city: CompiledCity,
  rail: RailHeights | undefined,
  screen: Vec2,
  project: (p: Vec2, heightM: number) => Vec2,
  belowGround = false,
): Pick | null {
  if (!city.rail || !rail) return null;
  for (const p of city.places)
    if (city.rail.platforms.some((s) => s.station === p.id)) {
      const v = project(p.centroid, 0);
      if (Math.hypot(v.x - screen.x, v.y - screen.y) < 9) return { kind: 'place', place: p.idx };
    }
  for (const [platform, p] of city.rail.platforms.entries()) {
    const line = (
      p.shape.kind === 'polygon'
        ? p.shape.ring
        : p.shape.kind === 'line'
          ? p.shape.line
          : [p.shape.pos]
    ).map((v) => project(v, p.layer * 5));
    const { away } = nearestOnPolyline(line, screen);
    // Platforms are narrow: their centre and outline remain selectable at overview zoom.
    const centre = {
      x: line.reduce((s, p) => s + p.x, 0) / line.length,
      y: line.reduce((s, p) => s + p.y, 0) / line.length,
    };
    if (away < 4 || Math.hypot(centre.x - screen.x, centre.y - screen.y) < 5)
      return { kind: 'platform', platform };
  }
  let hit: Pick | null = null,
    best = 5;
  for (const t of city.rail.tracks) {
    if (!belowGround && rail.grades[t.idx] === 'tunnel') continue;
    const ramp = rail.profiles[t.idx]!.length > 1;
    const line = [t.line[0]!];
    for (let i = 1; i < t.line.length; i++) {
      const a = t.line[i - 1]!,
        b = t.line[i]!,
        steps = ramp ? Math.max(1, Math.ceil(distance(a, b) / 5)) : 1;
      for (let j = 1; j <= steps; j++)
        line.push({ x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps });
    }
    const d = nearestOnPolyline(
      line.map((p) => project(p, railHeightAt(rail, t, trackAt(t, p)))),
      screen,
    ).away;
    if (d < best) {
      best = d;
      hit = { kind: 'track', track: t.idx };
    }
  }
  return hit;
}
