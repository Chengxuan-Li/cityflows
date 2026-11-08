import Flatbush from 'flatbush';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
} from '../geo/polyline';
import { createRandom } from '../geo/random';
import { crossingEnabled, crossingPlacement } from '../network/crossings';
import type { ContextFeature } from '../schema';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import type { CityGeometry } from './types';
import { cityGrades } from './grades';

export type TreeSource = 'osm' | 'row' | 'wood' | 'scrub' | 'park' | 'street';
export interface Tree {
  pos: Vec2;
  heightM: number;
  crownM: number;
  leafType: 'broadleaved' | 'needleleaved';
  source: TreeSource;
}
type Area = Extract<ContextFeature, { kind: 'area' }>;
type Obstacle =
  { rings: Vec2[][] } | { pos: Vec2; radius: number } | { line: Vec2[]; width: number };
const inside = (p: Vec2, rings: Vec2[][]) =>
  pointInPolygon(p, rings[0]!) && !rings.slice(1).some((r) => pointInPolygon(p, r));
const closed = (ring: Vec2[]) => [...ring, ring[0]!];
const ringArea = (ring: Vec2[]) =>
  Math.abs(
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      return sum + p.x * q.y - p.y * q.x;
    }, 0) / 2,
  );

/** Pure display geometry. Exclusions test the whole canopy, including imported trees. */
export function placeTrees(city: CompiledCity, source: CityGeometry) {
  const trees: Tree[] = [];
  const counts = { osm: 0, row: 0, wood: 0, scrub: 0, park: 0, street: 0 };
  let generated = 0,
    capped = false;
  const root = createRandom(106);
  const features = source.context?.features ?? [];
  const obstacles: Obstacle[] = [];
  for (const road of city.roads)
    if (road.surface.length) obstacles.push({ rings: [closed(road.surface)] });
  for (const node of city.nodes) {
    obstacles.push({ pos: node.pos, radius: 15 });
    if (node.outline.length) obstacles.push({ rings: [closed(node.outline)] });
  }
  for (const road of city.roads)
    for (const end of [false, true]) {
      if (crossingEnabled(city, road, end, source))
        for (const stripe of crossingPlacement(city, road, end).stripes)
          obstacles.push({ rings: [closed(stripe)] });
    }
  for (const connector of city.connectors) {
    const lane = city.lanes[connector.lane]!;
    const road = city.roads[lane.road]!;
    const width = road.lanes.reduce((sum, i) => sum + city.lanes[i]!.widthM, 0);
    obstacles.push({
      pos: pointAtDistance(lane.polyline, lane.cumulative, connector.positionM),
      radius: width + 4,
    });
  }
  for (const feature of features) {
    if (
      feature.kind === 'area' &&
      (['building', 'water', 'parking'].includes(feature.class) ||
        feature.sub === 'path' ||
        feature.sub === 'pitch' ||
        feature.sub === 'playground')
    )
      obstacles.push({ rings: feature.rings });
    if (feature.kind === 'line' && feature.class !== 'tree_row')
      obstacles.push({
        line: feature.line,
        width: feature.widthM ?? (feature.class === 'waterway' ? 2 : 2.5),
      });
  }
  const index = new Flatbush(Math.max(1, obstacles.length));
  for (const obstacle of obstacles) {
    const points =
      'rings' in obstacle
        ? obstacle.rings[0]!
        : 'line' in obstacle
          ? obstacle.line
          : [obstacle.pos];
    const padding =
      'radius' in obstacle ? obstacle.radius : 'width' in obstacle ? obstacle.width / 2 : 0;
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
    index.add(x0 - padding, y0 - padding, x1 + padding, y1 + padding);
  }
  if (!obstacles.length) index.add(0, 0, 0, 0);
  index.finish();
  const clear = (p: Vec2, radius: number) => {
    for (const i of index.search(p.x - radius, p.y - radius, p.x + radius, p.y + radius)) {
      const obstacle = obstacles[i];
      if (!obstacle) continue;
      if ('pos' in obstacle) {
        if (distance(p, obstacle.pos) < obstacle.radius + radius) return false;
      } else if ('line' in obstacle) {
        if (nearestOnPolyline(obstacle.line, p).away < obstacle.width / 2 + radius) return false;
      } else if (
        inside(p, obstacle.rings) ||
        obstacle.rings.some((r) => nearestOnPolyline(r, p).away < radius)
      )
        return false;
    }
    return true;
  };
  // A small dynamic grid bounds Poisson-disc neighbour work, including the 60000-tree case.
  const cells = new Map<string, Tree[]>();
  const neighbours = (p: Vec2, radius: number, reject: (t: Tree) => boolean) => {
    for (let y = Math.floor((p.y - radius) / 8); y <= Math.floor((p.y + radius) / 8); y++)
      for (let x = Math.floor((p.x - radius) / 8); x <= Math.floor((p.x + radius) / 8); x++)
        if (cells.get(`${x},${y}`)?.some(reject)) return true;
    return false;
  };
  const add = (tree: Tree, spacing = 0) => {
    if (!clear(tree.pos, tree.crownM / 2)) return false;
    if (
      neighbours(
        tree.pos,
        Math.max(spacing, 8),
        (other) =>
          distance(tree.pos, other.pos) <
          Math.max(
            spacing,
            tree.source === 'street' && (other.source === 'osm' || other.source === 'row') ? 8 : 2,
          ),
      )
    )
      return false;
    if (tree.source !== 'osm' && generated >= 60000) {
      capped = true;
      return false;
    }
    trees.push(tree);
    counts[tree.source]++;
    if (tree.source !== 'osm') generated++;
    const key = `${Math.floor(tree.pos.x / 8)},${Math.floor(tree.pos.y / 8)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(tree);
    return true;
  };
  const make = (
    pos: Vec2,
    source: TreeSource,
    rng: ReturnType<typeof createRandom>,
    tagged?: Extract<ContextFeature, { kind: 'point' }>,
  ): Tree => ({
    pos,
    source,
    heightM:
      tagged?.heightM ?? rng.uniform(source === 'scrub' ? 3 : 8, source === 'scrub' ? 6 : 14),
    crownM:
      tagged?.crownM ??
      rng.uniform(
        source === 'street' || source === 'scrub' ? 3 : 4,
        source === 'street' ? 4.5 : source === 'scrub' ? 4 : 6,
      ),
    leafType:
      tagged?.sub === 'needleleaved' || (!tagged?.sub && rng.next() < 0.15)
        ? 'needleleaved'
        : 'broadleaved',
  });
  features.forEach((feature, i) => {
    if (feature.kind === 'point') add(make(feature.pos, 'osm', root.derive(`point:${i}`), feature));
  });
  features.forEach((feature, i) => {
    if (feature.kind !== 'line' || feature.class !== 'tree_row') return;
    const lengths = cumulativeLengths(feature.line),
      rng = root.derive(`row:${i}`);
    for (let s = 0; s <= lengths.at(-1)!; s += feature.spacingM ?? 8) {
      if (generated >= 60000) {
        capped = true;
        break;
      }
      add(make(pointAtDistance(feature.line, lengths, s), 'row', rng));
    }
  });
  const corridors = new Map<string, typeof city.roads>();
  for (const road of city.roads)
    if (road.corridorId) {
      if (!corridors.has(road.corridorId)) corridors.set(road.corridorId, []);
      corridors.get(road.corridorId)!.push(road);
    }
  // Street trees stand on the ground: none along bridges, tunnels or the ramps onto them, where
  // a ground-level tree would grow through a deck (seen in 3D at the TASK-105 merge).
  const { nodeGrades, roadGrades } = cityGrades(city, source);
  for (const road of [...city.roads].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!['residential', 'tertiary', 'secondary', 'primary'].includes(road.roadClass)) continue;
    if (roadGrades[road.idx] || nodeGrades[road.from] || nodeGrades[road.to]) continue;
    const half = road.surface.length / 2;
    const edges = [road.surface.slice(0, half), road.surface.slice(half).reverse()];
    for (const [side, edge] of edges.entries()) {
      if (edge.length < 2) continue;
      const lengths = cumulativeLengths(edge),
        rng = root.derive(`${road.id}:${side}`);
      for (let station = 15; station < lengths.at(-1)! - 15; station += 12) {
        if (generated >= 60000) {
          capped = true;
          break;
        }
        const p = pointAtDistance(edge, lengths, station + rng.uniform(-2, 2));
        const direction = nearestOnPolyline(edge, p).direction;
        const sign = side === 0 ? -1 : 1;
        const offset = { x: -direction.y * sign, y: direction.x * sign };
        // A divided corridor's inward side is a median, even where the gap is wide.
        const centre = nearestOnPolyline(city.lanes[road.lanes[0]!]!.polyline, p).point;
        const median =
          road.corridorId &&
          corridors.get(road.corridorId)!.some((other) => {
            if (other === road) return false;
            const q = nearestOnPolyline(city.lanes[other.lanes[0]!]!.polyline, centre).point;
            return (q.x - centre.x) * offset.x + (q.y - centre.y) * offset.y > 0.1;
          });
        if (median) continue;
        add(make({ x: p.x + offset.x * 2.5, y: p.y + offset.y * 2.5 }, 'street', rng), 8);
      }
    }
  }
  features.forEach((feature, i) => {
    if (feature.kind !== 'area' || feature.class !== 'green') return;
    const sub = feature.sub;
    if (!['wood', 'forest', 'scrub', 'park'].includes(sub ?? '')) return;
    const kind = sub === 'scrub' ? 'scrub' : sub === 'park' ? 'park' : 'wood';
    const density = kind === 'wood' ? 40 : kind === 'scrub' ? 60 : 300;
    const area =
      ringArea(feature.rings[0]!) - feature.rings.slice(1).reduce((sum, r) => sum + ringArea(r), 0);
    const target = Math.round(area / density),
      rng = root.derive(`area:${i}`);
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of feature.rings[0]!) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    let placed = 0;
    for (let attempt = 0; placed < target && attempt < Math.min(target, 60000) * 40; attempt++) {
      if (generated >= 60000) {
        capped = true;
        break;
      }
      const tree = make({ x: rng.uniform(x0, x1), y: rng.uniform(y0, y1) }, kind, rng);
      if (
        !inside(tree.pos, feature.rings) ||
        feature.rings.some((r) => nearestOnPolyline(r, tree.pos).away < tree.crownM / 2)
      )
        continue;
      if (add(tree, Math.sqrt(density) * 0.7)) placed++;
    }
  });
  return { trees, counts, capped };
}

export type Surface = 'grass' | 'meadow' | 'forest' | 'pavement' | 'asphalt';
export function groundSurface(feature: Area): Surface | undefined {
  if (feature.class === 'parking' || feature.sub === 'path') return 'pavement';
  if (feature.class !== 'green') return;
  if (feature.sub === 'wood' || feature.sub === 'forest' || feature.sub === 'scrub')
    return 'forest';
  return feature.sub === 'meadow' ? 'meadow' : 'grass';
}

/** A repeatable, faint greyscale grain; consumers tint it with their existing palette. */
export function surfaceGrain(surface: Surface): Uint8Array {
  const random = createRandom(106).derive(surface),
    pixels = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) {
    const grain = Math.round(random.uniform(surface === 'forest' ? 228 : 240, 255));
    pixels.set([grain, grain, grain, 255], i * 4);
  }
  return pixels;
}
