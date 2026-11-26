import { towerHeightM } from './surfaces';
import Flatbush from 'flatbush';
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import {
  headingAtDistance,
  pointAtDistance,
  pointInPolygon,
  segmentDistance,
  trimPolyline,
} from '../../src/geo/polyline';
import { railHeightAt, type RailGraph, type RailHeights } from '../../src/network/rail';
import type { City } from '../../src/schema';
import { fenceMesh, fenceRuns, insetPerimeter, offsetCorridor } from './fences';

// Intro mock (not a product feature): props for the intro cut only (bench/intro/detail.ts installs
// them): fuller car parks, a few cars driving Hartmann Road, fences along the railway and round the airport, ExCeL's roof masts, and
// the airport terminal's curtain wall style on Canary Wharf's glazed towers.

type Vec2 = { x: number; y: number };
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---- parked cars
interface ParkedSnapshot {
  occupied: Uint8Array;
  vclass: Uint8Array;
  id: Uint32Array;
  hues: Uint32Array;
}
interface ParkedCars {
  setSnapshot(snapshot: ParkedSnapshot | null): void;
}
/** Real car colours, mostly white, grey, silver and black. */
export const carColours = [
  0xe8e8e6, 0xe8e8e6, 0xd9dadb, 0xb8bcc0, 0xb8bcc0, 0x8e9397, 0x5d6266, 0x2b2d30, 0x2b2d30,
  0x1f2a44, 0x6b1f24, 0x3c4b5c, 0x8a8f7a,
];
/** About 85 % of the spaces taken, the simulation's own parked cars kept; every car in a real
 * colour. */
export function fillParking(
  parked: ParkedCars | undefined,
  spaces: number,
  current: ParkedSnapshot | null,
) {
  if (!parked || !spaces) return () => {};
  const original = parked.setSnapshot.bind(parked);
  const fill = (snapshot: ParkedSnapshot | null): ParkedSnapshot => {
    const bytes = Math.ceil(spaces / 8);
    const occupied = new Uint8Array(bytes);
    if (snapshot) occupied.set(snapshot.occupied.subarray(0, bytes));
    const hues = new Uint32Array(spaces);
    for (let i = 0; i < spaces; i++) {
      if (hash(i * 0.731 + 5) < 0.85) occupied[i >> 3]! |= 1 << (i & 7);
      hues[i] = carColours[Math.floor(hash(i * 1.913) * carColours.length)]!;
    }
    return {
      occupied,
      vclass: snapshot?.vclass.slice(0, spaces) ?? new Uint8Array(spaces),
      id: snapshot?.id.slice(0, spaces) ?? new Uint32Array(spaces),
      hues,
    };
  };
  parked.setSnapshot = (snapshot) => original(fill(snapshot));
  parked.setSnapshot(current);
  return () => {
    parked.setSnapshot = original;
    original(current);
  };
}

// ---- through traffic
interface VehicleFrame {
  timeS: number;
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  speed: Float32Array;
  lateralM: Float32Array;
  lane: Int32Array;
  state: Uint8Array;
  vclass: Uint8Array;
  fade: Float32Array;
  poseLane?: Int32Array;
  motionLane?: Int32Array;
  vehicleHues?: Uint32Array;
}
interface VehicleLayer {
  modelGeometries?: readonly BufferGeometry[];
  setSnapshot(snapshot: VehicleFrame): void;
  poses: { snapshot: VehicleFrame | null };
}
interface DrivenLane {
  polyline: Vec2[];
  cumulative: Float64Array;
  lengthM: number;
}
interface RoadNetwork {
  roads: { id: string; lanes: number[] }[];
  lanes: DrivenLane[];
}
/** Hartmann Road, both ways along the airport from its west end: the residents' trips never take
 * it, so it would stand empty below the horizon shot. */
export const hartmannRoad = [
  ['r:1091', 'r:1757', 'r:1759', 'r:1405'],
  ['r:1406', 'r:1760', 'r:1758', 'r:1092'],
];
/** Adds `perRoute` cars to every snapshot the vehicle layer draws, driving each route (a chain of
 * roads' first lanes) on a loop at 36 to 46 km/h, spaced unevenly, in real colours. They are
 * posed outright (the app's posed-vehicle path), so they take the app's car models and lights,
 * shrinking away within a few metres of the route's ends. */
export function routeCars(
  vehicles: VehicleLayer | undefined,
  city: RoadNetwork | undefined,
  routes: readonly (readonly string[])[],
  perRoute: number,
) {
  if (!vehicles || !city) return () => {};
  const byId = new Map(city.roads.map((r) => [r.id, r]));
  const chains = routes
    .map((ids) => {
      const lanes = ids.map((id) => byId.get(id)?.lanes[0]).filter((l) => l !== undefined);
      if (lanes.length !== ids.length) return null;
      let total = 0;
      const starts = lanes.map((l) => {
        const at = total;
        total += city.lanes[l]!.lengthM;
        return at;
      });
      return { lanes, starts, total };
    })
    .filter((c) => c !== null);
  const cars = chains.flatMap((chain, r) =>
    Array.from({ length: perRoute }, (_, k) => ({
      chain,
      offset: ((k + hash(r * 31 + k) * 0.55) / perRoute) * chain.total,
      speed: 10 + hash(r * 7 + k * 3 + 1) * 2.8,
      colour: carColours[Math.floor(hash(r * 13 + k * 5 + 2) * carColours.length)]!,
    })),
  );
  if (!cars.length) return () => {};
  const original = vehicles.setSnapshot.bind(vehicles);
  const augment = (s: VehicleFrame): VehicleFrame => {
    const n = s.count,
      m = n + cars.length;
    const grow = <T extends Float32Array | Int32Array | Uint32Array | Uint8Array>(
      a: T | undefined,
      empty: number,
    ): T => {
      const TypedArray = (a?.constructor ?? Int32Array) as new (length: number) => T;
      const out = new TypedArray(m);
      out.fill(empty);
      if (a) out.set(a.subarray(0, n) as never);
      return out;
    };
    let lastId = s.vehicleHues?.length ?? 0;
    for (let i = 0; i < n; i++) lastId = Math.max(lastId, s.id[i]!);
    const out: VehicleFrame = {
      ...s,
      count: m,
      id: grow(s.id, 0),
      x: grow(s.x, 0),
      y: grow(s.y, 0),
      heading: grow(s.heading, 0),
      speed: grow(s.speed, 0),
      lateralM: grow(s.lateralM, 0),
      lane: grow(s.lane, 0),
      state: grow(s.state, 1),
      vclass: grow(s.vclass, 0),
      fade: grow(s.fade, 1),
      poseLane: grow(s.poseLane, -1),
      ...(s.motionLane ? { motionLane: grow(s.motionLane, 0) } : {}),
    };
    if (s.vehicleHues) {
      const hues = new Uint32Array(lastId + cars.length);
      hues.set(s.vehicleHues);
      out.vehicleHues = hues;
    }
    cars.forEach((car, k) => {
      const { chain } = car;
      const along =
        (((car.offset + car.speed * s.timeS) % chain.total) + chain.total) % chain.total;
      let j = chain.starts.length - 1;
      while (j > 0 && chain.starts[j]! > along) j--;
      const laneIndex = chain.lanes[j]!,
        lane = city.lanes[laneIndex]!;
      const u = Math.min(lane.lengthM, along - chain.starts[j]!);
      const p = pointAtDistance(lane.polyline, lane.cumulative, u);
      const i = n + k;
      out.id[i] = lastId + 1 + k;
      out.x[i] = p.x;
      out.y[i] = p.y;
      out.heading[i] = headingAtDistance(lane.polyline, lane.cumulative, u);
      out.speed[i] = car.speed;
      out.lane[i] = laneIndex;
      out.poseLane![i] = laneIndex;
      if (out.motionLane) out.motionLane[i] = laneIndex;
      out.fade[i] = Math.min(1, along / 6, (chain.total - along) / 6);
      if (out.vehicleHues) out.vehicleHues[lastId + k] = car.colour;
    });
    return out;
  };
  let source = vehicles.poses.snapshot;
  vehicles.setSnapshot = (snapshot) => {
    source = snapshot;
    original(augment(snapshot));
  };
  if (source) vehicles.setSnapshot(source);
  return () => {
    vehicles.setSnapshot = original;
    if (source) original(source);
  };
}

// ---- fences
/** Points every `step` metres along `line`, with the heading there and the distance along. */
function alongLine(line: readonly Vec2[], step: number) {
  const out: { p: Vec2; d: Vec2; s: number }[] = [];
  let s = 0,
    next = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-3) continue;
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    for (; next <= s + length; next += step) {
      const u = next - s;
      out.push({ p: { x: a.x + d.x * u, y: a.y + d.y * u }, d, s: next });
    }
    s += length;
  }
  return out;
}
export interface RailVergeRun {
  points: Vec2[];
  vergeSide: number;
  track: number;
}

interface Inside {
  (p: Vec2): boolean;
}
interface Clearance {
  (p: Vec2, reach: number): number;
}
export function segmentClearance(lines: { line: readonly Vec2[]; pad: number }[]): Clearance {
  const segments: { a: Vec2; b: Vec2; pad: number }[] = [];
  for (const { line, pad } of lines)
    for (let i = 1; i < line.length; i++) segments.push({ a: line[i - 1]!, b: line[i]!, pad });
  const index = new Flatbush(Math.max(1, segments.length));
  for (const { a, b } of segments)
    index.add(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  if (!segments.length) index.add(0, 0, 0, 0);
  index.finish();
  return (p, reach) => {
    let best = Infinity;
    for (const i of index.search(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
      const s = segments[i];
      if (s) best = Math.min(best, segmentDistance(p, s.a, s.b) - s.pad);
    }
    return best;
  };
}

/** Palisade fences 1.8 m tall, 3.4 m out from each at-grade railway track, where neither another
 * track, a platform, a road nor water is in the way. */
export function railFences(
  rail: RailGraph | undefined,
  heights: RailHeights | undefined,
  roads: Clearance,
  water: Inside,
) {
  if (!rail || !heights) return { group: new Group(), verges: [] as RailVergeRun[] };
  const tracks = rail.tracks.filter((t) => t.kind !== 'tram');
  const centre = segmentClearance(tracks.map((t) => ({ line: t.line, pad: 0 })));
  const platforms = rail.platforms
    .map((p) => (p.shape.kind === 'polygon' ? p.shape.ring : null))
    .filter((r): r is Vec2[] => !!r);
  const nearPlatform = (p: Vec2) =>
    platforms.some(
      (ring) =>
        pointInPolygon(p, ring) ||
        ring.some((q, i) => i > 0 && segmentDistance(p, ring[i - 1]!, q) < 2.5),
    );
  const bayM = 3;
  const verges: RailVergeRun[] = [];
  const clear = (p: Vec2) =>
    centre(p, 4) > 2.6 && roads(p, 12) > 0.8 && !water(p) && !nearPlatform(p);
  const ground = tracks.filter((t) => heights.grades[t.idx] === 'ground');
  // Preserve the established verge planting's local stationing, independently
  // of the fence geometry now built from the whole formation's outline.
  for (const track of ground) {
    const samples = alongLine(track.line, bayM);
    for (const side of [-1, 1]) {
      let run: Vec2[] = [];
      const close = () => {
        if (run.length > 1) verges.push({ points: run, vergeSide: side, track: track.idx });
        run = [];
      };
      for (const { p, d, s } of samples) {
        const q = { x: p.x - d.y * side * 3.4, y: p.y + d.x * side * 3.4 };
        const ok = Math.abs(railHeightAt(heights, track, s)) < 0.8 && clear(q);
        if (ok) run.push(q);
        else close();
      }
      close();
    }
  }
  const lines = ground.flatMap((track) => {
    const h = heights.profiles[track.idx]!;
    if (h.every((y) => Math.abs(y) < 0.8)) return [track.line];
    if (h.length === 1) return [];
    const segments: [number, number][] = [];
    const step = track.lengthM / (h.length - 1);
    for (let i = 1; i < h.length; i++) {
      const a = h[i - 1]!,
        b = h[i]!;
      if ((a >= 0.8 && b >= 0.8) || (a <= -0.8 && b <= -0.8)) continue;
      const lo = a === b ? 0 : Math.max(0, (Math.sign(a) * 0.8 - a) / (b - a));
      const hi = a === b ? 1 : Math.min(1, (Math.sign(b) * 0.8 - a) / (b - a));
      const from = (i - 1 + (Math.abs(a) < 0.8 ? 0 : lo)) * step;
      const to = (i - 1 + (Math.abs(b) < 0.8 ? 1 : hi)) * step;
      const last = segments.at(-1);
      if (to <= from) continue;
      if (last && Math.abs(last[1] - from) < 0.001) last[1] = to;
      else segments.push([from, to]);
    }
    return segments.map(([a, b]) => trimPolyline(track.line, a, track.lengthM - b));
  });
  const runs = fenceRuns(offsetCorridor(lines, 3.4), clear);
  return { group: fenceMesh(runs, 1.8, 'palisade'), verges };
}

/** The airport perimeter follows its closed rings, with openings at roads and water. */
export function airportFence(boundary: Vec2[][] | undefined, roads: Clearance, water: Inside) {
  // Set the posts inside the mapped boundary so coincident shore edges can
  // join on dry ground instead of alternately clipping the same straight run.
  const runs = fenceRuns(
    insetPerimeter(boundary ?? [], 0.28),
    (p) => roads(p, 12) > 0.5 && !water(p),
  );
  return fenceMesh(runs, 2.4, 'chain');
}

// ---- ExCeL
/** ExCeL's halls (`conference_centre`, from bench/intro/dress.ts): along both long sides of each
 * roof, white masts every 36 m rising 22 m above it, each stayed by cables to the roof. */
export function excelMasts(
  features: { kind: string; class?: string; sub?: string; rings?: Vec2[][]; heightM?: number }[],
) {
  const group = new Group();
  const white = new MeshLambertMaterial({ color: 0xf1f1ee });
  const lines: number[] = [];
  for (const f of features) {
    if (f.kind !== 'area' || f.class !== 'building' || f.sub !== 'conference_centre') continue;
    const ring = f.rings![0]!;
    // The footprint's long axis from its smallest box.
    let best = { area: Infinity, u: { x: 1, y: 0 }, u0: 0, u1: 0, v0: 0, v1: 0 };
    for (let i = 1; i < ring.length; i++) {
      const dx = ring[i]!.x - ring[i - 1]!.x,
        dy = ring[i]!.y - ring[i - 1]!.y;
      const l = Math.hypot(dx, dy);
      if (l < 1) continue;
      const u = { x: dx / l, y: dy / l };
      let u0 = Infinity,
        u1 = -Infinity,
        v0 = Infinity,
        v1 = -Infinity;
      for (const p of ring) {
        const a = p.x * u.x + p.y * u.y,
          b = -p.x * u.y + p.y * u.x;
        u0 = Math.min(u0, a);
        u1 = Math.max(u1, a);
        v0 = Math.min(v0, b);
        v1 = Math.max(v1, b);
      }
      const area = (u1 - u0) * (v1 - v0);
      if (area < best.area) best = { area, u, u0, u1, v0, v1 };
    }
    let { u, u0, u1, v0, v1 } = best;
    if (v1 - v0 > u1 - u0) {
      u = { x: -u.y, y: u.x };
      [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
    }
    const at = (a: number, b: number) => ({ x: u.x * a - u.y * b, y: u.y * a + u.x * b });
    const roof = (f.heightM ?? 24) + 2;
    const width = v1 - v0;
    for (let a = u0 + 20; a <= u1 - 20; a += 36)
      for (const b of [v0 + width * 0.22, v1 - width * 0.22]) {
        const p = at(a, b);
        if (!pointInPolygon(p, ring)) continue;
        const mast = new Mesh(new CylinderGeometry(0.35, 0.6, 22, 8), white);
        mast.position.set(p.x, roof + 11, p.y);
        mast.castShadow = true;
        group.add(mast);
        const top = [p.x, roof + 22, p.y];
        for (const [da, db] of [
          [-14, 0],
          [14, 0],
          [0, -width * 0.18],
          [0, width * 0.18],
        ] as const) {
          const q = at(a + da, b + db);
          lines.push(...top, q.x, roof - 1, q.y);
        }
      }
  }
  const cables = new LineSegments(
    new BufferGeometry().setAttribute('position', new Float32BufferAttribute(lines, 3)),
    new LineBasicMaterial({ color: 0xd8dad8 }),
  );
  cables.material.userData.lit = false;
  group.add(cables);
  return group;
}

// ---- glazed towers
/** The airport terminal's curtain wall (`terminalGlazing` in src/render3d/apron.ts: its glass
 * colour, panes a storey high between floor slabs, mullions about every 2.2 m with the wall
 * showing between, a warm glow after dark) as a mipmapped texture, so towers kilometres off
 * filter to their mix of glass and frame instead of aliasing pane by pane. 16 x 16 panes a tile;
 * after dark about half of them are lit, office by office. */
function curtainTextures() {
  const cells = 16,
    w = 32,
    h = 48;
  const make = (paint: (g: CanvasRenderingContext2D, i: number, j: number) => void) => {
    const canvas = Object.assign(document.createElement('canvas'), {
      width: cells * w,
      height: cells * h,
    });
    const g = canvas.getContext('2d')!;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) paint(g, i, j);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 16;
    return texture;
  };
  // A pane spans 92 % of its width (the terminal's 0.04 to 0.96) and its storey less 0.35 m.
  const pane = (g: CanvasRenderingContext2D, i: number, j: number) =>
    g.fillRect(i * w + w * 0.04, j * h + h * 0.09, w * 0.92, h * 0.91);
  const map = make((g, i, j) => {
    g.fillStyle = '#d6cbbd';
    g.fillRect(i * w, j * h, w, h);
    g.fillStyle = '#7f97a7';
    pane(g, i, j);
  });
  const glow = make((g, i, j) => {
    g.fillStyle = '#000000';
    g.fillRect(i * w, j * h, w, h);
    // Offices lit in short runs along a floor.
    const run = Math.floor((i + (j % 2)) / 2) + j * 7;
    if (hash(run * 3.7 + 0.3) < 0.3) {
      g.fillStyle = hash(i + j * 31) < 0.85 ? '#ffffff' : '#9a9a9a';
      pane(g, i, j);
    }
  });
  return { map, glow };
}
export function glazedTowers(
  features: NonNullable<City['context']>['features'],
  night: () => number,
) {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [];
  for (const f of features) {
    if (f.kind !== 'area' || f.class !== 'building' || f.material !== 'glass') continue;
    const heightM = f.heightM ?? (f.levels === undefined ? 10 : f.levels * 3);
    if (heightM >= towerHeightM) continue;
    // The terminal's storeys: about 4 m, from 0.8 m up to 1.5 m below the roof.
    const storeys = Math.max(1, Math.round((heightM - 1.5) / 4));
    const storeyM = (heightM - 1.5 - 0.8) / storeys;
    const ring = f.rings[0]!;
    let area = 0;
    for (let i = 1; i < ring.length; i++)
      area += ring[i - 1]!.x * ring[i]!.y - ring[i]!.x * ring[i - 1]!.y;
    const sign = area > 0 ? 1 : -1;
    // Each tower starts somewhere else in the tile, so the lit pattern never repeats in a row.
    const seed = Math.round(ring[0]!.x * 3 + ring[0]!.y * 7);
    let along = Math.floor(hash(seed) * 16);
    const lift = Math.floor(hash(seed + 1) * 16);
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!,
        b = ring[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 3) continue;
      const n = { x: (sign * (b.y - a.y)) / length, y: (sign * -(b.x - a.x)) / length };
      const pa = { x: a.x + n.x * 0.12, y: a.y + n.y * 0.12 },
        pb = { x: b.x + n.x * 0.12, y: b.y + n.y * 0.12 };
      // Whole panes along each wall, as the terminal rounds them.
      const panes = Math.max(1, Math.round(length / 2.2));
      const u0 = along,
        u1 = along + panes;
      const low = 0.8,
        high = 0.8 + storeys * storeyM;
      for (const [p, y, u, v] of [
        [pa, low, u0, 0],
        [pb, low, u1, 0],
        [pb, high, u1, storeys],
        [pa, low, u0, 0],
        [pb, high, u1, storeys],
        [pa, high, u0, storeys],
      ] as const) {
        positions.push(p.x, y, p.y);
        normals.push(n.x, 0, n.y);
        uvs.push(u / 16, (v + lift) / 16);
      }
      along += panes;
    }
  }
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new Float32BufferAttribute(normals, 3))
    .setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  const { map, glow } = curtainTextures();
  const material = new MeshLambertMaterial({
    map,
    emissive: 0xffe2b0,
    emissiveMap: glow,
    emissiveIntensity: 0,
    side: DoubleSide,
  });
  const glazing = new Mesh(geometry, material);
  glazing.name = 'intro-glazing';
  glazing.castShadow = true;
  glazing.receiveShadow = true;
  glazing.onBeforeRender = () => {
    // Lit only once it is properly dark.
    material.emissiveIntensity = 0.3 * Math.max(0, (night() - 0.45) / 0.55);
  };
  return glazing;
}
