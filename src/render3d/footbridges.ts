import Flatbush from 'flatbush';
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import {
  nearestOnPolyline,
  pointInPolygon,
  preparePolygon,
  segmentDistance,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CWalkLink } from '../network';
import type { CityGeometry } from '../render/types';
import { walkGeometry, type WalkShape } from '../render/walk-geometry';
import type { ContextAreaFeature, ContextFeature, HandrailSide } from '../schema';
import { roadSurfaceAt, type cityHeights } from './heights';
import { walkHeight } from './walk';

type Heights = ReturnType<typeof cityHeights>;

/** TASK-262: a footbridge's parts, in metres. */
export const footbridgeSize = {
  /** Deck depth under the paving, with a fascia on each open side. */
  deckM: 0.5,
  /** Handrail height above the paving. */
  railM: 1.0,
  postSpacingM: 1.5,
  /** At most this far between piers along a deck. */
  pierSpacingM: 15,
  /** A pier moves at most this far along its deck to clear a carriageway or a track. */
  pierSlideM: 7,
  /** Piers closer than this to one already placed are dropped (parallel decks share one). */
  pierMergeM: 5,
  /** Clear distance from a track's centre line to a pier's centre. */
  trackClearM: 2.2,
  /** A canopy's clear height above the deck. */
  canopyM: 3,
  /** A roof is a deck's canopy when most of it lies within this of the deck's centre line. */
  canopyReachM: 4,
  canopyPostSpacingM: 5,
  /** TASK-275: a covered way's own canopy (no roof mapped over it): its slab depth. */
  lightCanopyDepthM: 0.12,
  /** TASK-275: a bridge track's deck reaches this far from its centre line (half a bed, the
   * deck's 1 m beyond it, and a margin). */
  trackOverM: 3.5,
};

/** A walkable surface or a building, to tell an open deck edge (a drop) from one that meets
 * another deck, a road, a platform, stairs or a building at the deck's height. */
interface Floor {
  box: readonly [number, number, number, number];
  shape?: WalkShape;
  inside: (p: Vec2) => boolean;
  /** The surface height at `p`; for a building, its top (its base is the ground). */
  z: (p: Vec2) => number;
  building?: boolean;
  carriageway?: boolean;
}

const closed = (ring: Vec2[]) =>
  ring.length && (ring[0]!.x !== ring.at(-1)!.x || ring[0]!.y !== ring.at(-1)!.y)
    ? [...ring, ring[0]!]
    : ring;

/** A point-in-ring test, prepared on its first use (most rings are never asked). */
function within(ring: Vec2[]) {
  let test: ((p: Vec2) => boolean) | undefined;
  return (p: Vec2) => (test ??= preparePolygon(ring))(p);
}

function inTriangle(p: Vec2, [a, b, c]: Vec2[]) {
  const d1 = (p.x - b!.x) * (a!.y - b!.y) - (a!.x - b!.x) * (p.y - b!.y);
  const d2 = (p.x - c!.x) * (b!.y - c!.y) - (b!.x - c!.x) * (p.y - c!.y);
  const d3 = (p.x - a!.x) * (c!.y - a!.y) - (c!.x - a!.x) * (p.y - a!.y);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function bounds(points: Vec2[], margin = 0) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return [x0 - margin, y0 - margin, x1 + margin, y1 + margin] as const;
}

/** A mapped walk way raised above the ground: a footbridge deck or its stairs. Sidewalks of
 * road bridges and junction corners ride on the road's own deck. */
export function isFootbridge(city: CompiledCity, link: CWalkLink) {
  return (
    link.road === undefined &&
    link.node === undefined &&
    !link.generated &&
    link.kind !== 'sidewalk' &&
    link.kind !== 'corner' &&
    link.kind !== 'access' &&
    link.kind !== 'crossing' &&
    Math.max(link.layer, city.walk.nodes[link.from]!.layer, city.walk.nodes[link.to]!.layer) > 0
  );
}

/** A drawn walk way with its paving height and the TASK-275 tags of its mapped way. */
interface Way {
  shape: WalkShape;
  z: (p: Vec2) => number;
  handrail?: HandrailSide[];
  covered: boolean;
}

interface Model {
  bridges: Way[];
  /** TASK-275: stair flights off the decks whose handrails OSM maps, and covered ways at grade. */
  flights: Way[];
  coveredGround: Way[];
  floors: Floor[];
  floorIndex: Flatbush;
  tracks: Vec2[][];
  /** TASK-275: a bridge track's deck level (its layer, at least 1), else 0. */
  trackDecks: number[];
  trackIndex: Flatbush | undefined;
  canopies: Map<ContextAreaFeature, number>;
  /** Every `building=roof`: TASK-275 keeps a light canopy from under one. */
  roofs: ContextAreaFeature[];
}

const models = new WeakMap<Heights, { source: CityGeometry; model: Model }>();

function model(city: CompiledCity, source: CityGeometry, heights: Heights): Model {
  const cached = models.get(heights);
  if (cached?.source === source) return cached.model;
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  const shapes = walkGeometry(city, source);
  const floors: Floor[] = [];
  const bridges: Way[] = [],
    flights: Way[] = [],
    coveredGround: Way[] = [];
  for (const shape of shapes) {
    const l = shape.link;
    const z = walkHeight(city, heights, l);
    floors.push({
      box: bounds(shape.polygons.flat()),
      shape,
      inside: (p) => shape.polygons.some((t) => inTriangle(p, t)),
      z,
    });
    // A compiled piece of a mapped way keeps its id before the slash and its direction.
    const mapped = l.generated ? undefined : source.walk?.links[l.id.split('/')[0]!];
    const way: Way = { shape, z, handrail: mapped?.handrail, covered: mapped?.covered === true };
    if (isFootbridge(city, l)) bridges.push(way);
    else if (
      way.handrail &&
      l.kind === 'steps' &&
      Math.abs(z(l.line[0]!) - z(l.line.at(-1)!)) >= 0.3
    )
      flights.push(way);
    if (
      way.covered &&
      l.layer === 0 &&
      city.walk.nodes[l.from]!.layer === 0 &&
      city.walk.nodes[l.to]!.layer === 0
    )
      coveredGround.push(way);
  }
  for (const road of city.roads) {
    const ring = closed(road.surface);
    floors.push({
      box: bounds(ring),
      inside: within(ring),
      z: (p) => roadSurfaceAt(road, heights.roads[road.idx]!, p),
      carriageway: true,
    });
  }
  for (const node of city.nodes) {
    if (node.outline.length < 3) continue;
    const ring = closed(node.outline);
    floors.push({
      box: bounds(ring),
      inside: within(ring),
      z: () => heights.nodes[node.idx]!,
      carriageway: true,
    });
  }
  const platforms = [
    ...(city.rail?.platforms ?? []).flatMap((p) =>
      p.shape.kind === 'polygon' ? [{ ring: p.shape.ring, layer: p.layer }] : [],
    ),
    ...(city.rail?.tramStops ?? []).flatMap((s) =>
      s.platform?.kind === 'generated' ? [{ ring: s.platform.ring, layer: s.layer }] : [],
    ),
  ];
  for (const { ring, layer } of platforms) {
    const r = closed(ring);
    floors.push({ box: bounds(r), inside: within(r), z: (p) => ground(p) + layer * 5 });
  }
  const roofs: ContextAreaFeature[] = [];
  for (const f of source.context?.features ?? []) {
    if (f.kind !== 'area' || f.class !== 'building') continue;
    if (f.sub === 'roof') {
      roofs.push(f);
      continue;
    }
    const ring = closed(f.rings[0]!);
    const top = f.heightM ?? (f.levels === undefined ? 10 : f.levels * 3);
    floors.push({
      box: bounds(ring),
      inside: within(ring),
      z: (p) => ground(p) + top,
      building: true,
    });
  }
  const floorIndex = new Flatbush(Math.max(1, floors.length));
  for (const floor of floors) floorIndex.add(...floor.box);
  if (!floors.length) floorIndex.add(0, 0, 0, 0);
  floorIndex.finish();
  const open = (city.rail?.tracks ?? []).filter((t) => !t.tunnel);
  const tracks = open.flatMap((t) => t.line.slice(1).map((b, i) => [t.line[i]!, b]));
  const trackDecks = open.flatMap((t) =>
    t.line.slice(1).map(() => (t.bridge && !t.covered ? Math.max(1, t.layer) : 0)),
  );
  let trackIndex: Flatbush | undefined;
  if (tracks.length) {
    trackIndex = new Flatbush(tracks.length);
    for (const segment of tracks) trackIndex.add(...bounds(segment, footbridgeSize.trackClearM));
    trackIndex.finish();
  }
  const result: Model = {
    bridges,
    flights,
    coveredGround,
    floors,
    floorIndex,
    tracks,
    trackDecks,
    roofs,
    trackIndex,
    canopies: new Map(),
  };
  // A roof on posts (`building=roof`) mostly over a footbridge deck is the deck's canopy: it
  // stands `canopyM` above the deck instead of the importer's default 3 m above the ground.
  const reach = footbridgeSize.canopyReachM;
  for (const roof of roofs) {
    const ring = closed(roof.rings[0]!);
    const [x0, y0, x1, y1] = bounds(ring);
    const decks = floorIndex.search(x0 - reach, y0 - reach, x1 + reach, y1 + reach).filter((i) => {
      const link = floors[i]!.shape?.link;
      return link && link.kind !== 'steps' && isFootbridge(city, link);
    });
    if (!decks.length) continue;
    let samples = 0,
      top = -Infinity,
      hits = 0;
    for (let x = x0 + 0.75; x < x1; x += 1.5)
      for (let y = y0 + 0.75; y < y1; y += 1.5) {
        const p = { x, y };
        if (!pointInPolygon(p, ring)) continue;
        samples++;
        let deck = -Infinity;
        for (const i of decks) {
          const nearest = nearestOnPolyline(floors[i]!.shape!.link.line, p);
          if (nearest.away <= reach)
            deck = Math.max(deck, floors[i]!.z(nearest.point) - ground(nearest.point));
        }
        if (deck > 0.3) {
          hits++;
          top = Math.max(top, deck);
        }
      }
    const lifted = top + footbridgeSize.canopyM;
    if (samples && hits >= samples / 2 && (roof.minHeightM ?? 3) < lifted)
      result.canopies.set(roof, lifted);
  }
  models.set(heights, { source, model: result });
  return result;
}

/** The context features with each footbridge canopy raised over its deck (TASK-262). */
export function liftCanopies(
  city: CompiledCity,
  source: CityGeometry,
  heights: Heights,
  features: ContextFeature[],
): ContextFeature[] {
  const { canopies } = model(city, source, heights);
  if (!canopies.size) return features;
  return features.map((f) =>
    f.kind === 'area' && canopies.has(f) ? { ...f, minHeightM: canopies.get(f)! } : f,
  );
}

export interface FootbridgeCounts {
  /** Connected groups of raised walk ways. */
  bridges: number;
  links: number;
  piers: number;
  /** Railing runs (both sides of a straight deck are two) and their length. */
  railings: number;
  railingM: number;
  canopies: number;
  canopyPosts: number;
  /** TASK-275: raised ways and stair flights whose railings follow their mapped `handrail`, and
   * the length of their centre handrails. */
  handrailLinks: number;
  centerRailM: number;
  /** TASK-275: covered ways (raised, or at grade), those that get a canopy of their own, its
   * area and posts. */
  coveredLinks: number;
  lightCanopies: number;
  lightCanopyM2: number;
  lightCanopyPosts: number;
}

/** Decks with depth and fascias, railings along open edges, piers and canopy posts; TASK-275:
 * railings by the mapped `handrail`, and a light canopy over covered ways with nothing over them. */
export function buildFootbridges(city: CompiledCity, source: CityGeometry, heights: Heights) {
  const m = model(city, source, heights);
  const size = footbridgeSize;
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  const deck: number[] = [],
    rails: number[] = [],
    canopy: number[] = [];
  const posts: { p: Vec2; base: number; top: number }[] = [];
  const postGrids = new Map<string, Set<string>>();
  /** `grid`: posts in one grid keep `spacing` apart (TASK-275: one per canopy side). */
  const addPost = (p: Vec2, base: number, top: number, spacing: number, grid = '') => {
    const cell = spacing * 0.8;
    const key = `${spacing}${grid}`;
    const postGrid = postGrids.get(key) ?? postGrids.set(key, new Set()).get(key)!;
    const cx = Math.floor(p.x / cell),
      cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) if (postGrid.has(`${cx + dx},${cy + dy}`)) return false;
    postGrid.add(`${cx},${cy}`);
    posts.push({ p, base, top });
    return true;
  };
  /** Whether the deck at height `z`, just outside its edge at `q`, meets something walkable or a
   * building rather than a drop. */
  const meets = (q: Vec2, z: number, self: WalkShape) => {
    for (const i of m.floorIndex.search(q.x, q.y, q.x, q.y)) {
      const floor = m.floors[i]!;
      if (floor.shape === self || !floor.inside(q)) continue;
      const top = floor.z(q);
      if (floor.building ? z <= top + 1 : Math.abs(top - z) < 1) return true;
    }
    return false;
  };
  const canopyRings = [...m.canopies].map(([roof, lifted]) => ({
    ring: closed(roof.rings[0]!),
    lifted,
  }));
  const canopyAt = (p: Vec2) => {
    for (const { ring, lifted } of canopyRings)
      if (pointInPolygon(p, ring)) return ground(p) + lifted;
    return undefined;
  };
  const roofRings = m.roofs.map((roof) => ({
    ring: closed(roof.rings[0]!),
    box: bounds(roof.rings[0]!),
    under: m.canopies.get(roof) ?? roof.minHeightM ?? 3,
  }));
  /** TASK-275: whether something stands over the paving at `p`, height `z`: a roof (a footbridge
   * canopy or any `building=roof`) above it, a building taller than it, a road, junction, walk or
   * platform surface more than 1 m above it, or a bridge track's deck (within `trackOverM` of its
   * centre line) more than 1 m above it. */
  const over = (p: Vec2, z: number) => {
    for (const { ring, box, under } of roofRings)
      if (
        p.x >= box[0] &&
        p.y >= box[1] &&
        p.x <= box[2] &&
        p.y <= box[3] &&
        ground(p) + under > z &&
        pointInPolygon(p, ring)
      )
        return true;
    for (const i of m.floorIndex.search(p.x, p.y, p.x, p.y)) {
      const floor = m.floors[i]!;
      if (floor.inside(p) && floor.z(p) > z + 1) return true;
    }
    if (m.trackIndex)
      for (const i of m.trackIndex.search(
        p.x - size.trackOverM,
        p.y - size.trackOverM,
        p.x + size.trackOverM,
        p.y + size.trackOverM,
      )) {
        const [a, b] = m.tracks[i]!,
          deck = m.trackDecks[i]!;
        if (deck && ground(p) + deck * 5 > z + 1 && segmentDistance(p, a!, b!) < size.trackOverM)
          return true;
      }
    return false;
  };
  const counts: FootbridgeCounts = {
    bridges: 0,
    links: m.bridges.length,
    piers: 0,
    railings: 0,
    railingM: 0,
    canopies: m.canopies.size,
    canopyPosts: 0,
    handrailLinks: 0,
    centerRailM: 0,
    coveredLinks: 0,
    lightCanopies: 0,
    lightCanopyM2: 0,
    lightCanopyPosts: 0,
  };
  const quad = (target: number[], a: number[], b: number[], c: number[], d: number[]) =>
    target.push(...a, ...b, ...c, ...a, ...c, ...d);
  /** A handrail (a band and its top) and a knee rail from `p0` to `p1` at paving heights `z0`,
   * `z1`, 4 cm inside an edge whose outward normal is `n`, with its posts. */
  const railing = (p0: Vec2, p1: Vec2, z0: number, z1: number, nx: number, ny: number) => {
    const i0 = { x: p0.x - nx * 0.04, y: p0.y - ny * 0.04 },
      i1 = { x: p1.x - nx * 0.04, y: p1.y - ny * 0.04 };
    const top0 = z0 + size.railM,
      top1 = z1 + size.railM;
    quad(
      rails,
      [i0.x, top0, i0.y],
      [i1.x, top1, i1.y],
      [i1.x, top1 - 0.06, i1.y],
      [i0.x, top0 - 0.06, i0.y],
    );
    quad(
      rails,
      [i0.x, top0, i0.y],
      [i1.x, top1, i1.y],
      [i1.x - nx * 0.06, top1, i1.y - ny * 0.06],
      [i0.x - nx * 0.06, top0, i0.y - ny * 0.06],
    );
    quad(
      rails,
      [i0.x, z0 + 0.5, i0.y],
      [i1.x, z1 + 0.5, i1.y],
      [i1.x, z1 + 0.46, i1.y],
      [i0.x, z0 + 0.46, i0.y],
    );
    addPost(i0, z0, top0, size.postSpacingM);
  };
  /**
   * The paving's boundary edges (those of one triangle only) in pieces of at most 1 m, each with
   * its edge's outward normal and, for TASK-275's tags, its side of the link in the link's
   * direction: `left` or `right` within 45 degrees of square to the link, none across an end.
   */
  const boundary = (
    shape: WalkShape,
    visit: (
      piece: { p0: Vec2; p1: Vec2; mid: Vec2; lengthM: number; first: boolean },
      nx: number,
      ny: number,
      side: 'left' | 'right' | undefined,
    ) => void,
  ) => {
    const ids = new Map<Vec2, number>();
    const id = (p: Vec2) => {
      let i = ids.get(p);
      if (i === undefined) ids.set(p, (i = ids.size));
      return i;
    };
    const edges = new Map<number, { a: Vec2; b: Vec2; c: Vec2; n: number }>();
    for (const tri of shape.polygons)
      for (let k = 0; k < 3; k++) {
        const a = tri[k]!,
          b = tri[(k + 1) % 3]!,
          c = tri[(k + 2) % 3]!;
        const ia = id(a),
          ib = id(b);
        const key = Math.min(ia, ib) * 1e6 + Math.max(ia, ib);
        const seen = edges.get(key);
        if (seen) seen.n++;
        else edges.set(key, { a, b, c, n: 1 });
      }
    for (const { a, b, c, n } of edges.values()) {
      if (n !== 1) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-3) continue;
      let nx = -(b.y - a.y) / length,
        ny = (b.x - a.x) / length;
      if (nx * (c.x - a.x) + ny * (c.y - a.y) > 0) {
        nx = -nx;
        ny = -ny;
      }
      // The left of a heading d is (d.y, -d.x) with y south (`offsetPolyline`'s right is -that).
      const d = nearestOnPolyline(shape.link.line, {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      }).direction;
      const left = nx * d.y - ny * d.x;
      const side = left > Math.SQRT1_2 ? 'left' : left < -Math.SQRT1_2 ? 'right' : undefined;
      const pieces = Math.ceil(length / 1);
      for (let j = 0; j < pieces; j++) {
        const p0 = { x: a.x + ((b.x - a.x) * j) / pieces, y: a.y + ((b.y - a.y) * j) / pieces };
        const p1 = {
          x: a.x + ((b.x - a.x) * (j + 1)) / pieces,
          y: a.y + ((b.y - a.y) * (j + 1)) / pieces,
        };
        const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        visit({ p0, p1, mid, lengthM: length / pieces, first: j === 0 }, nx, ny, side);
      }
    }
  };
  /** TASK-275: a centre handrail along the link's line. */
  const centreRail = ({ shape, z }: Way) => {
    const line = shape.link.line;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!,
        b = line[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-3) continue;
      const pieces = Math.ceil(length / 1);
      for (let j = 0; j < pieces; j++) {
        const p0 = { x: a.x + ((b.x - a.x) * j) / pieces, y: a.y + ((b.y - a.y) * j) / pieces };
        const p1 = {
          x: a.x + ((b.x - a.x) * (j + 1)) / pieces,
          y: a.y + ((b.y - a.y) * (j + 1)) / pieces,
        };
        railing(p0, p1, z(p0), z(p1), -(b.y - a.y) / length, (b.x - a.x) / length);
        counts.centerRailM += length / pieces;
      }
    }
  };
  for (const way of m.bridges) {
    const { shape, z, handrail } = way;
    const raised = (p: Vec2) => z(p) - ground(p);
    const l = shape.link;
    const stairs = l.kind === 'steps';
    const curved =
      city.walk.nodes[l.from]!.layer !== l.layer || city.walk.nodes[l.to]!.layer !== l.layer;
    // The deck's underside follows the paving's triangles, split on ramps as the paving is.
    const under = (tri: Vec2[]) => {
      const lengths = tri.map((p, i) =>
        Math.hypot(p.x - tri[(i + 1) % 3]!.x, p.y - tri[(i + 1) % 3]!.y),
      );
      const edge = lengths.indexOf(Math.max(...lengths));
      if (curved && lengths[edge]! > 2) {
        const a = tri[edge]!,
          b = tri[(edge + 1) % 3]!,
          c = tri[(edge + 2) % 3]!;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        under([a, mid, c]);
        under([mid, b, c]);
        return;
      }
      if (!tri.some((p) => raised(p) > 0.3)) return;
      for (const p of tri) deck.push(p.x, Math.max(ground(p), z(p) - size.deckM), p.y);
    };
    for (const tri of shape.polygons) under(tri);
    if (handrail) counts.handrailLinks++;
    let run = false;
    boundary(shape, ({ p0, p1, mid, lengthM, first }, nx, ny, side) => {
      if (first) run = false;
      const zm = z(mid),
        h = zm - ground(mid);
      const open = h > 0.3 && !meets({ x: mid.x + nx * 0.3, y: mid.y + ny * 0.3 }, zm, shape);
      const z0 = z(p0),
        z1 = z(p1);
      if (open)
        quad(
          deck,
          [p0.x, z0, p0.y],
          [p1.x, z1, p1.y],
          [p1.x, Math.max(ground(p1), z1 - size.deckM), p1.y],
          [p0.x, Math.max(ground(p0), z0 - size.deckM), p0.y],
        );
      // TASK-262: a railing on an open edge 1 m up. TASK-275: on a side, only where the mapped
      // `handrail` names it; stairs carry a named handrail along the whole flight, also beside a
      // wall or near the ground.
      const ruled = open && h >= 1;
      const railed = handrail && side ? handrail.includes(side) && (stairs || ruled) : ruled;
      if (!railed) {
        run = false;
        return;
      }
      if (!run) counts.railings++;
      run = true;
      counts.railingM += lengthM;
      railing(p0, p1, z0, z1, nx, ny);
      const roof = canopyAt(mid);
      if (roof !== undefined && addPost(mid, zm, roof, size.canopyPostSpacingM))
        counts.canopyPosts++;
    });
    if (handrail?.includes('center')) centreRail(way);
  }
  // TASK-275: stair flights off the decks carry their mapped handrails on the sides it names.
  for (const way of m.flights) {
    const { shape, z, handrail } = way;
    counts.handrailLinks++;
    let run = false;
    boundary(shape, ({ p0, p1, lengthM, first }, nx, ny, side) => {
      if (first) run = false;
      if (!side || !handrail!.includes(side)) {
        run = false;
        return;
      }
      if (!run) counts.railings++;
      run = true;
      counts.railingM += lengthM;
      railing(p0, p1, z(p0), z(p1), nx, ny);
    });
    if (handrail!.includes('center')) centreRail(way);
  }
  // TASK-275: a covered way gets a light canopy, `canopyM` over its paving on posts along its
  // sides, wherever nothing stands over it (`over`): a raised way under a mapped roof keeps that
  // roof as its canopy (TASK-262); at grade, the paving under a building is not drawn. Along the
  // link in 1 m steps, a step is open when its centre line and both edges (0.1 m in) are; the
  // paving is cut square to the link where open runs begin and end.
  const top = size.canopyM + size.lightCanopyDepthM;
  for (const way of [...m.bridges.filter((w) => w.covered), ...m.coveredGround]) {
    const { shape, z } = way;
    const l = shape.link;
    counts.coveredLinks++;
    const a = l.line[0]!,
      b = l.line.at(-1)!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-3) continue;
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length },
      n = { x: d.y, y: -d.x };
    const half = Math.min(l.widthM, 3) / 2;
    const station = (p: Vec2) => (p.x - a.x) * d.x + (p.y - a.y) * d.y;
    const at = (s: number, across: number) => ({
      x: a.x + d.x * s + n.x * across,
      y: a.y + d.y * s + n.y * across,
    });
    const steps = Math.max(1, Math.round(length));
    const runs: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
      const s = ((i + 0.5) * length) / steps;
      const clear = [0, half - 0.1, 0.1 - half].every((across) => {
        const p = at(s, across);
        return !over(p, z(p));
      });
      if (!clear) continue;
      const s0 = (i * length) / steps,
        s1 = ((i + 1) * length) / steps;
      if (runs.at(-1)?.[1] === s0) runs.at(-1)![1] = s1;
      else runs.push([s0, s1]);
    }
    if (!runs.length) continue;
    // Runs reaching an end take the paving beyond it too (the round joins at bends).
    const open = runs.map(([s0, s1]): [number, number] => [
      s0 === 0 ? -Infinity : s0,
      s1 > length - 1e-6 ? Infinity : s1,
    ]);
    let area = 0;
    const emit = (tri: Vec2[]) => {
      area += Math.abs(
        ((tri[1]!.x - tri[0]!.x) * (tri[2]!.y - tri[0]!.y) -
          (tri[2]!.x - tri[0]!.x) * (tri[1]!.y - tri[0]!.y)) /
          2,
      );
      for (const lift of [size.canopyM, top])
        for (const p of tri) canopy.push(p.x, z(p) + lift, p.y);
    };
    /** Keeps the part of a convex polygon where `sign * (station - s) >= 0`. */
    const clip = (polygon: Vec2[], s: number, sign: number) => {
      if (!Number.isFinite(s)) return polygon;
      const out: Vec2[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i]!,
          q = polygon[(i + 1) % polygon.length]!;
        const fp = sign * (station(p) - s),
          fq = sign * (station(q) - s);
        if (fp >= 0) out.push(p);
        if (fp >= 0 !== fq >= 0) {
          const t = fp / (fp - fq);
          out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        }
      }
      return out;
    };
    const piece = (tri: Vec2[]) => {
      // Split to 2 m so the canopy follows a ramp's or a flight's height as the paving does.
      const lengths = tri.map((p, i) =>
        Math.hypot(p.x - tri[(i + 1) % 3]!.x, p.y - tri[(i + 1) % 3]!.y),
      );
      const edge = lengths.indexOf(Math.max(...lengths));
      if (lengths[edge]! > 2) {
        const p = tri[edge]!,
          q = tri[(edge + 1) % 3]!,
          r = tri[(edge + 2) % 3]!;
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        piece([p, mid, r]);
        piece([mid, q, r]);
        return;
      }
      for (const [s0, s1] of open) {
        const kept = clip(clip(tri, s0, 1), s1, -1);
        for (let k = 2; k < kept.length; k++) emit([kept[0]!, kept[k - 1]!, kept[k]!]);
      }
    };
    for (const tri of shape.polygons) piece(tri);
    if (area < 0.01) continue;
    counts.lightCanopies++;
    counts.lightCanopyM2 += area;
    const fascia = (p0: Vec2, p1: Vec2) =>
      quad(
        canopy,
        [p0.x, z(p0) + size.canopyM, p0.y],
        [p1.x, z(p1) + size.canopyM, p1.y],
        [p1.x, z(p1) + top, p1.y],
        [p0.x, z(p0) + top, p0.y],
      );
    for (const [s0, s1] of open)
      for (const s of [s0, s1]) if (Number.isFinite(s)) fascia(at(s, half), at(s, -half));
    boundary(shape, ({ p0, p1, mid }, nx, ny, side) => {
      const s = station(mid);
      if (!open.some(([s0, s1]) => s >= s0 && s <= s1)) return;
      fascia(p0, p1);
      const zm = z(mid);
      const inset = { x: mid.x - nx * 0.1, y: mid.y - ny * 0.1 };
      if (side && addPost(inset, zm, zm + size.canopyM, size.canopyPostSpacingM, side))
        counts.lightCanopyPosts++;
    });
  }
  // Bridges: groups of raised ways joined at a raised walk node (not through the ground).
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const up = parent.get(key);
    if (up === undefined || up === key) return key;
    const root = find(up);
    parent.set(key, root);
    return root;
  };
  const nodeKey = (l: CWalkLink, node: number) =>
    city.walk.nodes[node]!.layer > 0 ? `${node}` : `${node}@${l.idx}`;
  for (const { shape } of m.bridges) {
    const a = find(nodeKey(shape.link, shape.link.from)),
      b = find(nodeKey(shape.link, shape.link.to));
    if (a !== b) parent.set(a, b);
  }
  counts.bridges = new Set(
    m.bridges.map(({ shape }) => find(nodeKey(shape.link, shape.link.from))),
  ).size;
  // Piers: at the ends of each raised span and at most `pierSpacingM` apart between, under the
  // deck's centre line; moved along the deck off carriageways and tracks, or left out so the
  // deck spans them; none inside a building (it carries the deck), on a stair flight or along
  // stairs.
  const piers: { p: Vec2; base: number; top: number; heading: number; widthM: number }[] = [];
  const pierGrid = new Map<string, Vec2[]>();
  const near = (p: Vec2) => {
    const cell = size.pierMergeM;
    const cx = Math.floor(p.x / cell),
      cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const q of pierGrid.get(`${cx + dx},${cy + dy}`) ?? [])
          if (Math.hypot(q.x - p.x, q.y - p.y) < cell) return true;
    return false;
  };
  const blocked = (p: Vec2, deckZ: number) => {
    for (const i of m.floorIndex.search(p.x, p.y, p.x, p.y)) {
      const floor = m.floors[i]!;
      if (!floor.inside(p)) continue;
      if (floor.building) return true;
      if (floor.carriageway && floor.z(p) < deckZ - 1) return true;
      if (floor.shape?.link.kind === 'steps') return true;
    }
    if (m.trackIndex)
      for (const i of m.trackIndex.search(p.x, p.y, p.x, p.y)) {
        const [a, b] = m.tracks[i]!;
        if (segmentDistance(p, a!, b!) < size.trackClearM) return true;
      }
    return false;
  };
  const candidates: {
    link: CWalkLink;
    z: (p: Vec2) => number;
    s: number;
    lo: number;
    hi: number;
    end: boolean;
  }[] = [];
  for (const { shape, z } of m.bridges) {
    const l = shape.link;
    if (l.kind === 'steps') continue;
    const at = (s: number) => pointOn(l, s);
    const tall = (s: number) => z(at(s)) - ground(at(s)) > 1.5;
    const step = 0.5;
    let start: number | undefined;
    for (let s = 0; s <= l.lengthM + 1e-9; s += step) {
      const t = Math.min(s, l.lengthM);
      if (tall(t) && start === undefined) start = t;
      if ((!tall(t) || t === l.lengthM) && start !== undefined) {
        const end = tall(t) ? t : t - step;
        const span = end - start;
        const n = Math.max(1, Math.ceil(span / size.pierSpacingM));
        for (let k = 0; k <= n; k++)
          candidates.push({
            link: l,
            z,
            s: start + (span * k) / n,
            lo: start,
            hi: end,
            end: k === 0 || k === n,
          });
        start = undefined;
      }
      if (t === l.lengthM) break;
    }
  }
  candidates.sort((a, b) => Number(b.end) - Number(a.end));
  for (const c of candidates) {
    for (let offset = 0; offset <= size.pierSlideM; offset += 0.5) {
      const options = offset ? [c.s - offset, c.s + offset] : [c.s];
      const s = options.find((s) => {
        if (s < c.lo || s > c.hi) return false;
        const p = pointOn(c.link, s);
        return !blocked(p, c.z(p));
      });
      if (s === undefined) continue;
      const p = pointOn(c.link, s);
      if (near(p)) break;
      const top = c.z(p) - size.deckM,
        base = ground(p);
      if (top - base < 0.8) break;
      const ahead = pointOn(c.link, Math.min(c.link.lengthM, s + 0.5)),
        behind = pointOn(c.link, Math.max(0, s - 0.5));
      piers.push({
        p,
        base,
        top,
        heading: Math.atan2(ahead.y - behind.y, ahead.x - behind.x),
        widthM: Math.min(c.link.widthM, 3),
      });
      const key = `${Math.floor(p.x / size.pierMergeM)},${Math.floor(p.y / size.pierMergeM)}`;
      pierGrid.set(key, [...(pierGrid.get(key) ?? []), p]);
      break;
    }
  }
  counts.piers = piers.length;
  const group = new Group();
  group.name = 'footbridges';
  const mesh = (positions: number[], color: number, shadow: boolean) => {
    const geometry = new BufferGeometry().setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3),
    );
    geometry.computeVertexNormals();
    const result = new Mesh(geometry, new MeshLambertMaterial({ color, side: DoubleSide }));
    result.castShadow = shadow;
    result.receiveShadow = true;
    group.add(result);
    return result;
  };
  mesh(deck, 0x9aa39f, true);
  mesh(rails, 0x56625f, false);
  mesh(canopy, 0xd3d8d5, true);
  const box = new BoxGeometry(1, 1, 1);
  const transform = new Object3D();
  const pierMesh = new InstancedMesh(
    box,
    new MeshLambertMaterial({ color: 0x95a29c }),
    piers.length * 2,
  );
  piers.forEach((pier, i) => {
    transform.rotation.set(0, -pier.heading, 0);
    transform.position.set(pier.p.x, (pier.base + pier.top - 0.35) / 2, pier.p.y);
    transform.scale.set(0.45, pier.top - 0.35 - pier.base, 0.45);
    transform.updateMatrix();
    pierMesh.setMatrixAt(2 * i, transform.matrix);
    transform.position.set(pier.p.x, pier.top - 0.175, pier.p.y);
    transform.scale.set(0.5, 0.35, pier.widthM + 0.3);
    transform.updateMatrix();
    pierMesh.setMatrixAt(2 * i + 1, transform.matrix);
  });
  pierMesh.castShadow = pierMesh.receiveShadow = true;
  const postMesh = new InstancedMesh(
    box.clone(),
    new MeshLambertMaterial({ color: 0x56625f }),
    posts.length,
  );
  transform.rotation.set(0, 0, 0);
  posts.forEach((post, i) => {
    const thick = post.top - post.base > size.railM + 0.5 ? 0.12 : 0.05;
    transform.position.set(post.p.x, (post.base + post.top) / 2, post.p.y);
    transform.scale.set(thick, post.top - post.base, thick);
    transform.updateMatrix();
    postMesh.setMatrixAt(i, transform.matrix);
  });
  group.add(pierMesh, postMesh);
  counts.railingM = Math.round(counts.railingM);
  counts.centerRailM = Math.round(counts.centerRailM);
  counts.lightCanopyM2 = Math.round(counts.lightCanopyM2);
  return { group, counts, piers };
}

function pointOn(link: CWalkLink, s: number): Vec2 {
  const line = link.line,
    c = link.cumulative;
  let i = 1;
  while (i < line.length - 1 && c[i]! < s) i++;
  const span = c[i]! - c[i - 1]!;
  const t = span > 0 ? Math.max(0, Math.min(1, (s - c[i - 1]!) / span)) : 0;
  return {
    x: line[i - 1]!.x + (line[i]!.x - line[i - 1]!.x) * t,
    y: line[i - 1]!.y + (line[i]!.y - line[i - 1]!.y) * t,
  };
}
