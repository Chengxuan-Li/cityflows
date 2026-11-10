import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CRoad } from '../network';
import { crossingStripes } from '../render/layers/roads';
import { signalLayout } from './signals';
import { placeHue } from '../render/style';
import type { CityGeometry } from '../render/types';
import { cityHeights, heightAt, roadStation, type RoadHeight } from './heights';
import { buildMarkings, goreTriangles, triangleHeight } from './markings';
import { paintedGores } from '../render/marking-geometry';
import { buildContext } from './context';
import { drape, indexTerrain, terrainAreas } from './terrain';

type Vertex = [number, number, number];
const vertex = (p: Vec2, z: number): Vertex => [p.x, z, p.y];
const mix = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function polygon(target: number[], ring: Vec2[], z: (p: Vec2) => number) {
  const points = ring.map((p) => new Vector2(p.x, p.y));
  for (const triangle of ShapeUtils.triangulateShape(points, [])) {
    // x-east/z-south, y-up: reverse earcut's winding to face the sky.
    for (const i of [triangle[2]!, triangle[1]!, triangle[0]!])
      target.push(...vertex(ring[i]!, z(ring[i]!)));
  }
}

function quad(target: number[], a: Vertex, b: Vertex, c: Vertex, d: Vertex) {
  target.push(...a, ...b, ...c, ...a, ...c, ...d);
}

export function buffer(positions: number[], smooth = false) {
  let geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  if (smooth) geometry = mergeVertices(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

/** Surface strips keep both edges at exactly the same station. Subdivision on ramps
 * avoids triangulating a long bridge into a single flat chord across its eased profile. */
function roadSurface(surfaces: number[], slabs: number[], road: CRoad, height: RoadHeight) {
  const count = road.surface.length / 2;
  const ramp = height.fromM !== height.deckM || height.toM !== height.deckM;
  for (let i = 1; i < count; i++) {
    const s0 = road.stations[i - 1]! - road.stations[0]!;
    const s1 = road.stations[i]! - road.stations[0]!;
    const steps = ramp ? Math.max(1, Math.ceil((s1 - s0) / 0.5)) : 1;
    const left0 = road.surface[i - 1]!,
      left1 = road.surface[i]!;
    const right0 = road.surface[2 * count - i]!,
      right1 = road.surface[2 * count - i - 1]!;
    for (let j = 0; j < steps; j++) {
      const t0 = j / steps,
        t1 = (j + 1) / steps;
      const z0 = heightAt(height, s0 + (s1 - s0) * t0);
      const z1 = heightAt(height, s0 + (s1 - s0) * t1);
      const a = mix(left0, left1, t0),
        b = mix(left0, left1, t1);
      const c = mix(right0, right1, t1),
        d = mix(right0, right1, t0);
      // Earcut triangulates the actual compiled surface, with known station heights.
      const zs = new Map([
        [a, z0 + (height.crossfall?.(s0 + (s1 - s0) * t0, a) ?? 0)],
        [b, z1 + (height.crossfall?.(s0 + (s1 - s0) * t1, b) ?? 0)],
        [c, z1 + (height.crossfall?.(s0 + (s1 - s0) * t1, c) ?? 0)],
        [d, z0 + (height.crossfall?.(s0 + (s1 - s0) * t0, d) ?? 0)],
      ]);
      polygon(surfaces, [a, b, c, d], (p) => zs.get(p)!);
      if (
        z0 - (height.ground?.(s0 + (s1 - s0) * t0) ?? 0) > 0 ||
        z1 - (height.ground?.(s0 + (s1 - s0) * t1) ?? 0) > 0
      ) {
        quad(slabs, vertex(a, z0), vertex(b, z1), vertex(b, z1 - 0.8), vertex(a, z0 - 0.8));
        quad(slabs, vertex(c, z1), vertex(d, z0), vertex(d, z0 - 0.8), vertex(c, z1 - 0.8));
        quad(
          slabs,
          vertex(a, z0 - 0.8),
          vertex(b, z1 - 0.8),
          vertex(c, z1 - 0.8),
          vertex(d, z0 - 0.8),
        );
      }
    }
  }
  if (Math.max(height.fromM, height.toM, height.deckM) > 0)
    for (const end of [0, count - 1]) {
      const z = heightAt(height, end === 0 ? 0 : height.lengthM);
      if (z - (height.ground?.(end === 0 ? 0 : height.lengthM) ?? 0) <= 0) continue;
      const a = road.surface[end]!,
        b = road.surface[road.surface.length - end - 1]!;
      quad(slabs, vertex(a, z), vertex(b, z), vertex(b, z - 0.8), vertex(a, z - 0.8));
    }
}

export function buildGeometry(city: CompiledCity, source: CityGeometry, omitContextGround = false) {
  const heights = cityHeights(city, source);
  const surfaces: number[] = [],
    slabs: number[] = [],
    crossings: number[] = [];
  const landSurfaces: number[] = [],
    landCrossings: number[] = [];
  const flatAreas: Vec2[][] = [];
  const piers: { x: number; y: number; height: number; base: number }[] = [];
  for (const road of city.roads) {
    const height = heights.roads[road.idx]!;
    const surfaceTarget = height.crossfall ? landSurfaces : surfaces;
    const crossingTarget = height.crossfall ? landCrossings : crossings;
    if (height.crossfall && height.fromM === 0 && height.toM === 0 && height.deckM === 0)
      flatAreas.push(road.surface);
    else roadSurface(surfaceTarget, slabs, road, height);
    const z = (p: Vec2) => {
      const s = roadStation(road, p);
      return heightAt(height, s) + (height.crossfall?.(s, p) ?? 0) + 0.02;
    };
    for (const atEnd of [false, true])
      for (const stripe of crossingStripes(city, road, atEnd, source))
        polygon(crossingTarget, stripe, z);
    if (Math.max(height.fromM, height.toM, height.deckM) > 0) {
      for (let s = 15; s < height.lengthM; s += 30) {
        const top = heightAt(height, s) - 0.8;
        if (top <= 0) continue;
        // Midpoint between the two compiled surface edges, including carriageway shifts.
        const left = road.surface.slice(0, road.surface.length / 2);
        const right = road.surface.slice(road.surface.length / 2).reverse();
        const station = s + road.stations[0]!;
        let i = 1;
        while (i < road.stations.length - 1 && road.stations[i]! < station) i++;
        const t = (station - road.stations[i - 1]!) / (road.stations[i]! - road.stations[i - 1]!);
        const a = mix(left[i - 1]!, left[i]!, t),
          b = mix(right[i - 1]!, right[i]!, t);
        const x = (a.x + b.x) / 2,
          y = (a.y + b.y) / 2;
        const base = heights.terrain.groundAt(x, y);
        if (top > base) piers.push({ x, y, height: top - base, base });
      }
    }
  }
  for (const node of city.nodes) {
    const z = heights.nodes[node.idx]!;
    const ground = heights.terrain.groundAt(node.pos.x, node.pos.y);
    const followsGround = source.terrain && source.nodes[node.id]!.layer === 0;
    if (followsGround) {
      if (node.outline.length >= 3) flatAreas.push(node.outline);
    } else polygon(surfaces, node.outline, () => z);
    for (const gore of paintedGores(city, node))
      for (const triangle of goreTriangles(city, heights, gore))
        polygon(surfaces, triangle.points, (p) => triangleHeight(triangle, p));
    if (z - ground > 0)
      for (let i = 0; i < node.outline.length; i++) {
        const a = node.outline[i]!,
          b = node.outline[(i + 1) % node.outline.length]!;
        quad(slabs, vertex(a, z), vertex(b, z), vertex(b, z - 0.8), vertex(a, z - 0.8));
      }
  }
  const places: number[] = [],
    colors: number[] = [];
  for (const place of city.places) {
    if (source.places[place.id]!.station?.platforms.length) continue;
    const shape = source.places[place.id]!.shape;
    const ring =
      shape.kind === 'polygon'
        ? shape.ring
        : Array.from({ length: 24 }, (_, i) => ({
            x: shape.pos.x + 6 * Math.cos((i * Math.PI) / 12),
            y: shape.pos.y + 6 * Math.sin((i * Math.PI) / 12),
          }));
    const start = places.length;
    polygon(places, ring, () => -0.02);
    const color = placeHue(place.id);
    for (let i = start; i < places.length; i += 3)
      colors.push(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
  }
  let placeGeometry = buffer(places);
  placeGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  if (source.terrain)
    placeGeometry = indexTerrain(drape(placeGeometry, heights.terrain, -0.02, false, true));
  const { heads, supports } = signalLayout(city, heights);
  if (source.terrain)
    for (const part of [...heads, ...supports]) {
      const road = city.roads['road' in part ? part.road : city.lanes[part.lane]!.road]!;
      part.height += heights.roads[road.idx]!.crossfall?.(roadStation(road, part), part) ?? 0;
    }
  const terrainBuffer = (
    flat: number[],
    land: number[],
    smooth = false,
    areas?: Vec2[][],
    areaOffset = 0,
  ) => {
    if (!source.terrain) return buffer(flat, smooth);
    const a = buffer(flat),
      b = drape(buffer(land), heights.terrain, 0, true);
    const parts = [a, b];
    if (areas) parts.push(terrainAreas(areas, heights.terrain).translate(0, areaOffset, 0));
    const result = mergeGeometries(parts)!;
    a.dispose();
    b.dispose();
    parts[2]?.dispose();
    return indexTerrain(result);
  };
  const context = buildContext(
    (source.context?.features ?? []).filter(
      (f) => !city.rail || (f.class !== 'rail' && f.class !== 'tram'),
    ),
    heights.terrain,
    !omitContextGround,
  );
  if (source.terrain) context.ground = indexTerrain(context.ground);
  const surfaceGeometry = terrainBuffer(surfaces, landSurfaces, true, flatAreas);
  const positions = surfaceGeometry.getAttribute('position');
  const uv = new Float32BufferAttribute(new Float32Array(positions.count * 2), 2);
  for (let i = 0; i < positions.count; i++)
    uv.setXY(i, positions.getX(i) / 2.56, positions.getZ(i) / 2.56);
  surfaceGeometry.setAttribute('uv', uv);
  return {
    context,
    surfaces: surfaceGeometry,
    slabs: buffer(slabs),
    markings: buildMarkings(city, source, heights),
    crossings: terrainBuffer(crossings, landCrossings),
    places: placeGeometry,
    piers,
    heads,
    supports,
    heights,
  };
}
