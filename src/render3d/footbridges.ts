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
import type { ContextAreaFeature, ContextFeature } from '../schema';
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

interface Model {
  bridges: { shape: WalkShape; z: (p: Vec2) => number }[];
  floors: Floor[];
  floorIndex: Flatbush;
  tracks: Vec2[][];
  trackIndex: Flatbush | undefined;
  canopies: Map<ContextAreaFeature, number>;
}

const models = new WeakMap<Heights, { source: CityGeometry; model: Model }>();

function model(city: CompiledCity, source: CityGeometry, heights: Heights): Model {
  const cached = models.get(heights);
  if (cached?.source === source) return cached.model;
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  const shapes = walkGeometry(city, source);
  const floors: Floor[] = [];
  const bridges: Model['bridges'] = [];
  for (const shape of shapes) {
    const z = walkHeight(city, heights, shape.link);
    floors.push({
      box: bounds(shape.polygons.flat()),
      shape,
      inside: (p) => shape.polygons.some((t) => inTriangle(p, t)),
      z,
    });
    if (isFootbridge(city, shape.link)) bridges.push({ shape, z });
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
  const tracks = (city.rail?.tracks ?? [])
    .filter((t) => !t.tunnel)
    .flatMap((t) => t.line.slice(1).map((b, i) => [t.line[i]!, b]));
  let trackIndex: Flatbush | undefined;
  if (tracks.length) {
    trackIndex = new Flatbush(tracks.length);
    for (const segment of tracks) trackIndex.add(...bounds(segment, footbridgeSize.trackClearM));
    trackIndex.finish();
  }
  const result: Model = {
    bridges,
    floors,
    floorIndex,
    tracks,
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
}

/** Decks with depth and fascias, railings along open edges, piers and canopy posts. */
export function buildFootbridges(city: CompiledCity, source: CityGeometry, heights: Heights) {
  const m = model(city, source, heights);
  const size = footbridgeSize;
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  const deck: number[] = [],
    rails: number[] = [];
  const posts: { p: Vec2; base: number; top: number }[] = [];
  const postGrids = new Map<number, Set<string>>();
  const addPost = (p: Vec2, base: number, top: number, spacing: number) => {
    const cell = spacing * 0.8;
    const postGrid = postGrids.get(spacing) ?? postGrids.set(spacing, new Set()).get(spacing)!;
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
  const counts: FootbridgeCounts = {
    bridges: 0,
    links: m.bridges.length,
    piers: 0,
    railings: 0,
    railingM: 0,
    canopies: m.canopies.size,
    canopyPosts: 0,
  };
  const quad = (target: number[], a: number[], b: number[], c: number[], d: number[]) =>
    target.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const { shape, z } of m.bridges) {
    const raised = (p: Vec2) => z(p) - ground(p);
    const l = shape.link;
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
    // Boundary edges: those of one triangle only, facing away from its third corner.
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
      const pieces = Math.ceil(length / 1);
      let run = false;
      for (let j = 0; j < pieces; j++) {
        const p0 = { x: a.x + ((b.x - a.x) * j) / pieces, y: a.y + ((b.y - a.y) * j) / pieces };
        const p1 = {
          x: a.x + ((b.x - a.x) * (j + 1)) / pieces,
          y: a.y + ((b.y - a.y) * (j + 1)) / pieces,
        };
        const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const zm = z(mid),
          h = zm - ground(mid);
        if (h <= 0.3 || meets({ x: mid.x + nx * 0.3, y: mid.y + ny * 0.3 }, zm, shape)) {
          run = false;
          continue;
        }
        const z0 = z(p0),
          z1 = z(p1);
        quad(
          deck,
          [p0.x, z0, p0.y],
          [p1.x, z1, p1.y],
          [p1.x, Math.max(ground(p1), z1 - size.deckM), p1.y],
          [p0.x, Math.max(ground(p0), z0 - size.deckM), p0.y],
        );
        if (h < 1) {
          run = false;
          continue;
        }
        if (!run) counts.railings++;
        run = true;
        counts.railingM += length / pieces;
        // Handrail (a band and its top) and a knee rail, 4 cm inside the edge.
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
        const canopy = canopyAt(mid);
        if (canopy !== undefined && addPost(mid, zm, canopy, size.canopyPostSpacingM))
          counts.canopyPosts++;
      }
    }
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
