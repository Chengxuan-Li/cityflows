import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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
        [a, z0],
        [b, z1],
        [c, z1],
        [d, z0],
      ]);
      polygon(surfaces, [a, b, c, d], (p) => zs.get(p)!);
      if (z0 > 0 || z1 > 0) {
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
      if (z <= 0) continue;
      const a = road.surface[end]!,
        b = road.surface[road.surface.length - end - 1]!;
      quad(slabs, vertex(a, z), vertex(b, z), vertex(b, z - 0.8), vertex(a, z - 0.8));
    }
}

export function buildGeometry(city: CompiledCity, source: CityGeometry) {
  const heights = cityHeights(city, source);
  const surfaces: number[] = [],
    slabs: number[] = [],
    crossings: number[] = [];
  const piers: { x: number; y: number; height: number }[] = [];
  for (const road of city.roads) {
    const height = heights.roads[road.idx]!;
    roadSurface(surfaces, slabs, road, height);
    const z = (p: Vec2) => heightAt(height, roadStation(road, p)) + 0.02;
    for (const atEnd of [false, true])
      for (const stripe of crossingStripes(city, road, atEnd, source))
        polygon(crossings, stripe, z);
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
        piers.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, height: top });
      }
    }
  }
  for (const node of city.nodes) {
    const z = heights.nodes[node.idx]!;
    polygon(surfaces, node.outline, () => z);
    for (const gore of paintedGores(city, node))
      for (const triangle of goreTriangles(city, heights, gore))
        polygon(surfaces, triangle.points, (p) => triangleHeight(triangle, p));
    if (z > 0)
      for (let i = 0; i < node.outline.length; i++) {
        const a = node.outline[i]!,
          b = node.outline[(i + 1) % node.outline.length]!;
        quad(slabs, vertex(a, z), vertex(b, z), vertex(b, z - 0.8), vertex(a, z - 0.8));
      }
  }
  const places: number[] = [],
    colors: number[] = [];
  for (const place of city.places) {
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
  const placeGeometry = buffer(places);
  placeGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const { heads, supports } = signalLayout(city, heights);
  return {
    context: buildContext(source.context?.features ?? []),
    surfaces: buffer(surfaces, true),
    slabs: buffer(slabs),
    markings: buildMarkings(city, source, heights),
    crossings: buffer(crossings),
    places: placeGeometry,
    piers,
    heads,
    supports,
    heights,
  };
}
