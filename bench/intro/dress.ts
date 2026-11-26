import Flatbush from 'flatbush';
import { pointInPolygon, segmentDistance } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import type { City, ContextFeature } from '../../src/schema';

// Intro mock (not a product feature): set dressing for the intro's own project copy
// (bench/intro/build-project.ts), so the app draws it as it draws any mapped roof or tree.
//   - houses and low blocks near King George V get pitched roofs (OSM maps few of them);
//   - trees are planted where the reference views show them: along the DLR, in the parks and
//     gardens, and along the streets, never on buildings, roads, track, water or the airfield.

type Area = Extract<ContextFeature, { kind: 'area' }>;
const focus = { x: 520, y: 260 };
// A small deterministic hash, so every build plants the same trees.
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const ringArea = (ring: readonly Vec2[]) => {
  let a = 0;
  for (let i = 1; i < ring.length; i++)
    a += ring[i - 1]!.x * ring[i]!.y - ring[i]!.x * ring[i - 1]!.y;
  return Math.abs(a) / 2;
};
const centroid = (ring: readonly Vec2[]) => ({
  x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
  y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
});
/** The sides of the smallest rectangle around `ring`, short then long. */
function boxSides(ring: readonly Vec2[]) {
  let best = { area: Infinity, short: 0, long: 0 };
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i]!.x - ring[i - 1]!.x,
      dy = ring[i]!.y - ring[i - 1]!.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue;
    const u = { x: dx / length, y: dy / length };
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
    if (area < best.area)
      best = { area, short: Math.min(u1 - u0, v1 - v0), long: Math.max(u1 - u0, v1 - v0) };
  }
  return best;
}

const notHomes = new Set([
  'industrial',
  'commercial',
  'retail',
  'warehouse',
  'office',
  'garage',
  'garages',
  'shed',
  'roof',
  'hangar',
  'service',
  'transportation',
  'train_station',
  'school',
  'church',
  'hospital',
  'university',
  'public',
  'construction',
  'parking',
  'kiosk',
  'supermarket',
  'civic',
  'government',
  'sports_hall',
  'hotel',
  'college',
  'stadium',
  'bridge',
  'storage_tank',
  'silo',
]);

/** Pitched roofs on the houses and low blocks within 1.5 km: gabled along long footprints,
 * hipped on squarer ones, tile or slate. Their walls keep their height under the roof; an
 * untagged house stands two storeys rather than the app's 10 m default. */
export function pitchRoofs(city: City) {
  let count = 0;
  for (const feature of city.context?.features ?? []) {
    if (feature.kind !== 'area' || feature.class !== 'building') continue;
    const area = feature as Area & {
      parts?: unknown[];
      roof?: { shape: string; heightM?: number; material?: string };
    };
    if (area.rings.length !== 1 || area.parts?.length) continue;
    if (area.roof && area.roof.shape !== 'flat') continue;
    if (notHomes.has(area.sub ?? '')) continue;
    const ring = area.rings[0]!;
    const c = centroid(ring);
    if (Math.hypot(c.x - focus.x, c.y - focus.y) > 1500) continue;
    const footprint = ringArea(ring);
    if (footprint < 25 || footprint > 900) continue;
    const walls =
      area.heightM ?? (area.levels !== undefined ? area.levels * 3 : footprint < 220 ? 6.2 : 10);
    if (walls > 13) continue;
    const { short, long } = boxSides(ring);
    const roofM = Math.min(4.2, Math.max(1.8, short * 0.42));
    const seed = Math.round(c.x * 7 + c.y * 13);
    area.heightM = walls + roofM;
    area.roof = {
      ...area.roof,
      shape: long / short > 1.45 && hash(seed) > 0.2 ? 'gabled' : 'hipped',
      heightM: roofM,
      material: hash(seed + 1) > 0.45 ? 'roof_tiles' : 'slate',
    };
    count++;
  }
  return count;
}

/** Segments in a spatial index, for distance queries. */
function segmentIndex(lines: { line: readonly Vec2[]; pad: number }[]) {
  const segments: { a: Vec2; b: Vec2; pad: number }[] = [];
  for (const { line, pad } of lines)
    for (let i = 1; i < line.length; i++) segments.push({ a: line[i - 1]!, b: line[i]!, pad });
  const index = new Flatbush(Math.max(1, segments.length));
  for (const { a, b } of segments)
    index.add(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  if (!segments.length) index.add(0, 0, 0, 0);
  index.finish();
  /** The least clearance from `p` to any segment's padded edge, within `reach`. */
  return (p: Vec2, reach: number) => {
    let best = Infinity;
    for (const i of index.search(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
      const s = segments[i];
      if (s) best = Math.min(best, segmentDistance(p, s.a, s.b) - s.pad);
    }
    return best;
  };
}
function ringIndex(rings: (readonly Vec2[])[]) {
  const index = new Flatbush(Math.max(1, rings.length));
  for (const ring of rings) {
    const xs = ring.map((p) => p.x),
      ys = ring.map((p) => p.y);
    index.add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }
  if (!rings.length) index.add(0, 0, 0, 0);
  index.finish();
  return (p: Vec2) =>
    index.search(p.x, p.y, p.x, p.y).some((i) => rings[i] && pointInPolygon(p, rings[i]!));
}

/** Trees within 1.3 km of the station, on a jittered 5.5 m grid: likeliest along the DLR, then in
 * parks and gardens and along streets, rare elsewhere. */
export function plantTrees(city: City) {
  const features = city.context?.features ?? [];
  const areas = features.filter((f): f is Area => f.kind === 'area');
  const buildings = areas.filter((f) => f.class === 'building').map((f) => f.rings[0]!);
  const insideBuilding = ringIndex(buildings);
  const buildingEdge = segmentIndex(buildings.map((line) => ({ line, pad: 0 })));
  const blocked = ringIndex([
    ...areas
      .filter((f) => f.class === 'water' || f.class === 'parking')
      .flatMap((f) => f.rings.slice(0, 1)),
    ...(city.airport?.boundary ?? []),
    ...Object.values(city.places)
      .filter((p) => p.shape.kind === 'polygon' && p.kind !== 'residential')
      .map((p) => (p.shape as { ring: Vec2[] }).ring),
  ]);
  const green = ringIndex(
    areas.filter((f) => f.class === 'green').flatMap((f) => f.rings.slice(0, 1)),
  );
  const road = segmentIndex(
    Object.values(city.roads).map((r) => ({
      line: r.centerline,
      pad: r.lanes.reduce((s, l) => s + l.widthM, 0) / 2 + 2.2,
    })),
  );
  const track = segmentIndex(
    Object.values(city.rail?.tracks ?? {}).map((t) => ({ line: t.line, pad: 0 })),
  );
  const walk = segmentIndex(
    Object.values(city.walk?.links ?? {}).map((l) => ({ line: l.line, pad: 1.2 })),
  );
  const existing = segmentIndex(
    features
      .filter((f) => f.kind === 'point' && f.class === 'tree')
      .map((f) => {
        const p = (f as { pos: Vec2 }).pos;
        return { line: [p, { x: p.x + 0.01, y: p.y }], pad: 0 };
      }),
  );
  const planted: ContextFeature[] = [];
  const step = 5.5,
    reach = 1300;
  let n = 0;
  for (let gx = focus.x - reach; gx <= focus.x + reach; gx += step)
    for (let gy = focus.y - reach; gy <= focus.y + reach; gy += step) {
      n++;
      const p = { x: gx + (hash(n) - 0.5) * step, y: gy + (hash(n + 0.5) - 0.5) * step };
      if (Math.hypot(p.x - focus.x, p.y - focus.y) > reach) continue;
      const toTrack = track(p, 16);
      if (toTrack < 4.5 || road(p, 12) < 0 || walk(p, 3) < 0) continue;
      if (insideBuilding(p) || buildingEdge(p, 3) < 2.2 || blocked(p)) continue;
      if (existing(p, 5) < 4.5) continue;
      const nearHome = buildingEdge(p, 16) < 14;
      const roadside = road(p, 12) < 3.5;
      const chance =
        toTrack < 18 ? 0.75 : green(p) ? 0.55 : roadside ? 0.24 : nearHome ? 0.3 : 0.04;
      if (hash(n * 1.37 + 9) > chance) continue;
      const heightM = 7 + hash(n * 2.1) * 9;
      planted.push({
        kind: 'point',
        class: 'tree',
        pos: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 },
        heightM: Math.round(heightM * 10) / 10,
        crownM: Math.round(heightM * (0.62 + hash(n * 3.3) * 0.3) * 10) / 10,
        sub: hash(n * 4.7) < 0.12 ? 'needleleaved' : 'broadleaved',
      } as ContextFeature);
    }
  features.push(...planted);
  return planted.length;
}

type ToLocal = (lon: number, lat: number) => Vec2;
const inBox = (p: Vec2, a: Vec2, b: Vec2) =>
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);

/** Canary Wharf's towers (30 m and up) are glazed: glass walls in a blue-grey. */
export function glazeCanaryWharf(city: City, local: ToLocal) {
  const a = local(-0.033, 51.4965),
    b = local(-0.004, 51.5115);
  let count = 0;
  for (const f of city.context?.features ?? []) {
    if (f.kind !== 'area' || f.class !== 'building') continue;
    const height = f.heightM ?? (f.levels !== undefined ? f.levels * 3 : 0);
    if (height < 30 || !inBox(centroid(f.rings[0]!), a, b)) continue;
    f.material = 'glass';
    f.colour = hash(Math.round(height)) > 0.5 ? '#6e8597' : '#7d93a3';
    count++;
  }
  return count;
}

/** ExCeL London: its halls are tagged `conference_centre` (bench/intro/detail.ts adds the roof
 * masts) and take a shallow vaulted roof in pale metal. */
export function shapeExcel(city: City, local: ToLocal) {
  const a = local(0.0175, 51.5052),
    b = local(0.0405, 51.5108);
  let count = 0;
  for (const f of city.context?.features ?? []) {
    if (f.kind !== 'area' || f.class !== 'building' || f.rings.length !== 1) continue;
    const ring = f.rings[0]!;
    if (ringArea(ring) < 6000 || !inBox(centroid(ring), a, b)) continue;
    const area = f as Area & { roof?: { shape: string; heightM?: number; colour?: string } };
    area.sub = 'conference_centre';
    area.heightM = Math.max(area.heightM ?? 0, 24);
    area.roof = { shape: 'round', heightM: 5, colour: '#dfe3e6' };
    count++;
  }
  return count;
}
