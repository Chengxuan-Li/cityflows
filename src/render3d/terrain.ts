import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { booleanOpD, ClipType, FillRule, areaD, simplifyPathD } from 'clipper2-ts';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import Flatbush from 'flatbush';
import { pointInPolygon } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City, ContextFeature } from '../schema/city';
import type { Bounds } from '../render/camera';

export interface Terrain {
  grid: City['terrain'];
  groundAt(x: number, y: number): number;
  surfaceAt(x: number, y: number): number;
  patches: { rings: Vec2[][]; level: number; bounds: Bounds; building: boolean }[];
  patchIndex?: Flatbush;
}

/** Share vertices before GPU upload; the clipped triangles otherwise repeat every corner. */
export function indexTerrain(geometry: BufferGeometry) {
  geometry.deleteAttribute('normal');
  const indexed = mergeVertices(geometry);
  geometry.dispose();
  indexed.computeVertexNormals();
  return indexed;
}

export function createTerrain(
  grid?: City['terrain'],
  features: readonly ContextFeature[] = [],
): Terrain {
  const binary = grid ? atob(grid.heights) : '';
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const data = new DataView(bytes.buffer);
  const groundAt = (x: number, y: number): number => {
    if (!grid) return 0;
    const col = Math.max(0, Math.min(grid.cols - 1, (x - grid.originM.x) / grid.cellM));
    const row = Math.max(0, Math.min(grid.rows - 1, (y - grid.originM.y) / grid.cellM));
    const c = Math.min(grid.cols - 2, Math.floor(col)),
      r = Math.min(grid.rows - 2, Math.floor(row));
    const dx = col - c,
      dy = row - r;
    const at = (c: number, r: number) => data.getInt16((r * grid.cols + c) * 2, true) / 10;
    return (
      grid.baseM +
      (at(c, r) * (1 - dx) + at(c + 1, r) * dx) * (1 - dy) +
      (at(c, r + 1) * (1 - dx) + at(c + 1, r + 1) * dx) * dy
    );
  };
  const surfaceAt = (x: number, y: number) => {
    if (!grid) return 0;
    const col = Math.floor((x - grid.originM.x) / grid.cellM),
      row = Math.floor((y - grid.originM.y) / grid.cellM);
    const x0 = grid.originM.x + col * grid.cellM,
      y0 = grid.originM.y + row * grid.cellM;
    const dx = (x - x0) / grid.cellM,
      dy = (y - y0) / grid.cellM;
    if (dx + dy <= 1) {
      const h = groundAt(x0, y0);
      return (
        h + (groundAt(x0 + grid.cellM, y0) - h) * dx + (groundAt(x0, y0 + grid.cellM) - h) * dy
      );
    }
    const h = groundAt(x0 + grid.cellM, y0 + grid.cellM);
    return (
      h +
      (groundAt(x0, y0 + grid.cellM) - h) * (1 - dx) +
      (groundAt(x0 + grid.cellM, y0) - h) * (1 - dy)
    );
  };
  const patches = grid
    ? features.flatMap((feature) =>
        feature.kind === 'area' && (feature.class === 'water' || feature.class === 'building')
          ? [
              {
                rings: feature.rings.map((ring, i) =>
                  areaD(ring) > 0 === (i === 0) ? ring : [...ring].reverse(),
                ),
                level: 0,
                bounds: ringBounds(feature.rings[0]!),
                building: feature.class === 'building',
              },
            ]
          : [],
      )
    : [];
  const terrain: Terrain = { grid, groundAt, surfaceAt, patches };
  if (patches.length) {
    terrain.patchIndex = new Flatbush(patches.length);
    for (const area of patches) {
      area.level = lowestGround(area.rings, terrain, area.building);
      const b = area.bounds;
      terrain.patchIndex.add(b.minX, b.minY, b.maxX, b.maxY);
    }
    terrain.patchIndex.finish();
  }
  return terrain;
}

function ringBounds(ring: Vec2[]): Bounds {
  return {
    minX: Math.min(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)),
    maxX: Math.max(...ring.map((p) => p.x)),
    maxY: Math.max(...ring.map((p) => p.y)),
  };
}
const nearbyPatches = (terrain: Terrain, b: Bounds) =>
  terrain.patchIndex?.search(b.minX, b.minY, b.maxX, b.maxY).map((i) => terrain.patches[i]!) ?? [];

/** Beyond the sampled extent each axis is constant; retain only its two outer strips. */
function gridAxis(min: number, max: number, origin: number, count: number, step: number) {
  const values = [min];
  for (
    let n = Math.max(0, Math.floor((min - origin) / step) + 1);
    n < count && origin + n * step < max;
    n++
  )
    values.push(origin + n * step);
  values.push(max);
  return values;
}

export function triangulate(rings: Vec2[][], simplify = true): Vec2[][] {
  if (simplify) rings = rings.map((ring) => simplifyPathD(ring, 0.00001));
  const outer = rings.filter((ring) => areaD(ring) > 0),
    holes = rings.filter((ring) => areaD(ring) < 0);
  return outer.flatMap((ring) => {
    const inside = holes.filter((hole) => pointInPolygon(hole[0]!, ring));
    const points = [...ring, ...inside.flat()];
    return ShapeUtils.triangulateShape(
      ring.map((p) => new Vector2(p.x, p.y)),
      inside.map((hole) => hole.map((p) => new Vector2(p.x, p.y))),
    ).map((triangle) => triangle.map((i) => points[i]!));
  });
}

/** Union flat asphalt within each terrain triangle, avoiding the strip seams that
 * would otherwise multiply into thousands of tiny clipped triangles. */
export function terrainAreas(rings: Vec2[][], terrain: Terrain) {
  rings = rings.map((ring) => (areaD(ring) < 0 ? [...ring].reverse() : ring));
  const positions: number[] = [];
  if (rings.length) {
    const index = new Flatbush(rings.length),
      bounds = rings.map(ringBounds);
    for (const b of bounds) index.add(b.minX, b.minY, b.maxX, b.maxY);
    index.finish();
    const grid = terrain.grid!,
      step = grid.cellM;
    const xs = gridAxis(
      Math.min(...bounds.map((b) => b.minX)),
      Math.max(...bounds.map((b) => b.maxX)),
      grid.originM.x,
      grid.cols,
      step,
    );
    const ys = gridAxis(
      Math.min(...bounds.map((b) => b.minY)),
      Math.max(...bounds.map((b) => b.maxY)),
      grid.originM.y,
      grid.rows,
      step,
    );
    for (let row = 0; row < ys.length - 1; row++)
      for (let col = 0; col < xs.length - 1; col++) {
        const x = xs[col]!,
          y = ys[row]!,
          right = xs[col + 1]!,
          bottom = ys[row + 1]!;
        const nearby = index.search(x, y, right, bottom).map((i) => rings[i]!);
        if (!nearby.length) continue;
        const cell = [
          { x, y },
          { x: right, y },
          { x: right, y: bottom },
          { x, y: bottom },
        ];
        const c = Math.floor(((x + right) / 2 - grid.originM.x) / step),
          r = Math.floor(((y + bottom) / 2 - grid.originM.y) / step);
        const gx = grid.originM.x + c * step,
          gy = grid.originM.y + r * step;
        const clips =
          c >= 0 && c < grid.cols - 1 && r >= 0 && r < grid.rows - 1
            ? [
                [
                  { x: gx, y: gy },
                  { x: gx + step, y: gy },
                  { x: gx, y: gy + step },
                ],
                [
                  { x: gx + step, y: gy },
                  { x: gx + step, y: gy + step },
                  { x: gx, y: gy + step },
                ],
              ]
            : [cell];
        for (const clip of clips) {
          const paths = booleanOpD(ClipType.Intersection, nearby, [clip], FillRule.NonZero, 5);
          for (const triangle of triangulate(paths))
            for (const p of triangle.reverse())
              positions.push(p.x, terrain.surfaceAt(p.x, p.y), p.y);
        }
      }
  }
  const geometry = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  );
  const merged = mergeGroundPlanes(geometry, terrain, 0);
  merged.computeVertexNormals();
  return merged;
}

/** Excavate water and building footprints, retaining island/courtyard holes. */
function cutGround(geometry: BufferGeometry, terrain: Terrain) {
  if (!terrain.patches.length) return geometry;
  const input = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = input.getAttribute('position'),
    color = input.getAttribute('color');
  const positions: number[] = [],
    colors: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const triangle = [0, 1, 2].map((j) => ({ x: p.getX(i + j), y: p.getZ(i + j) }));
    const nearby = nearbyPatches(terrain, ringBounds(triangle));
    let pieces = [triangle];
    if (nearby.length) {
      if (areaD(triangle) < 0) triangle.reverse();
      const rings = booleanOpD(
        ClipType.Difference,
        [triangle],
        nearby.flatMap((area) => area.rings),
        FillRule.NonZero,
        5,
      );
      pieces = triangulate(rings).map((triangle) => triangle.reverse());
    }
    for (const part of pieces)
      for (const vertex of part) {
        positions.push(vertex.x, terrain.surfaceAt(vertex.x, vertex.y), vertex.y);
        if (color) colors.push(color.getX(i), color.getY(i), color.getZ(i));
      }
  }
  if (input !== geometry) input.dispose();
  geometry.dispose();
  const result = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  );
  if (color) result.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return result;
}

/** The decimetre grid gives each cell triangle an exact, quantized plane. Merge
 * matching planes only after verifying all corners against that plane. */
function mergeGroundPlanes(geometry: BufferGeometry, terrain: Terrain, offset: number) {
  const grid = terrain.grid!;
  const input = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = input.getAttribute('position'),
    positions: number[] = [];
  const planes = new Map<string, { sx: number; sy: number; k: number; rings: Vec2[][] }>();
  type Corner = Vec2 & { h: number; plane: string; shared: boolean };
  const corners = new Map<string, Corner[]>();
  const pointKey = (p: Vec2) => [Math.round(p.x * 1e5), Math.round(p.y * 1e5)].join(',');
  const step = 0.1 / grid.cellM;
  for (let i = 0; i < p.count; i += 3) {
    const vertices = [0, 1, 2].map((j) => ({
      x: p.getX(i + j),
      y: p.getZ(i + j),
      h: p.getY(i + j),
    }));
    const [a, b, c] = vertices as [
      (typeof vertices)[number],
      (typeof vertices)[number],
      (typeof vertices)[number],
    ];
    const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    const sx =
      Math.round(((b.h - a.h) * (c.y - a.y) - (c.h - a.h) * (b.y - a.y)) / det / step) * step;
    const sy =
      Math.round(((b.x - a.x) * (c.h - a.h) - (c.x - a.x) * (b.h - a.h)) / det / step) * step;
    const k =
      sx === 0 && sy === 0
        ? a.h
        : grid.baseM +
          offset +
          Math.round(
            (vertices.reduce(
              (sum, v) => sum + v.h - sx * (v.x - grid.originM.x) - sy * (v.y - grid.originM.y),
              0,
            ) /
              3 -
              grid.baseM -
              offset) *
              10,
          ) /
            10;
    const valid =
      Number.isFinite(k) &&
      !vertices.some(
        (v) =>
          Math.abs(v.h - k - sx * (v.x - grid.originM.x) - sy * (v.y - grid.originM.y)) > 0.0001,
      );
    const key = valid ? [sx, sy, k].join(',') : `unmerged:${i}`;
    for (const v of vertices) {
      const keyXY = pointKey(v),
        list = corners.get(keyXY) ?? [];
      const stored = list.find((p) => p.h === v.h);
      if (stored) {
        if (stored.plane !== key) stored.shared = true;
      } else list.push({ ...v, plane: key, shared: false });
      corners.set(keyXY, list);
    }
    if (!valid) {
      for (const v of vertices) positions.push(v.x, v.h, v.y);
      continue;
    }
    let plane = planes.get(key);
    if (!plane) {
      plane = { sx, sy, k, rings: [] };
      planes.set(key, plane);
    }
    const ring = vertices.map(({ x, y }) => ({ x, y }));
    if (areaD(ring) < 0) ring.reverse();
    plane.rings.push(ring);
  }
  for (const { sx, sy, k, rings } of planes.values()) {
    const height = (v: Vec2) => k + sx * (v.x - grid.originM.x) + sy * (v.y - grid.originM.y);
    const corner = (v: Vec2) => {
      let closest: Corner | undefined;
      let distance = 0.0002;
      for (const c of corners.get(pointKey(v)) ?? []) {
        const d = Math.abs(c.h - height(v));
        if (d < distance) {
          closest = c;
          distance = d;
        }
      }
      return closest;
    };
    const union =
      rings.length > 1 ? booleanOpD(ClipType.Union, rings, [], FillRule.NonZero, 5) : rings;
    const paths = union.map((ring) =>
      ring.filter((v, i) => {
        if (corner(v)?.shared) return true;
        const a = ring[(i + ring.length - 1) % ring.length]!,
          b = ring[(i + 1) % ring.length]!;
        return Math.abs((v.x - a.x) * (b.y - v.y) - (v.y - a.y) * (b.x - v.x)) > 1e-8;
      }),
    );
    for (const triangle of triangulate(paths, false))
      for (const v of triangle.reverse()) {
        const original = corner(v);
        positions.push(original?.x ?? v.x, original?.h ?? height(v), original?.y ?? v.y);
      }
  }
  if (input !== geometry) input.dispose();
  geometry.dispose();
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
}

/** Shared-vertex mesh, also used for draped basemap tiles (with their UVs). */
export function groundMesh(terrain: Terrain, bounds: Bounds, offset = 0) {
  const step =
    terrain.grid?.cellM ?? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const xs = gridAxis(
    bounds.minX,
    bounds.maxX,
    terrain.grid?.originM.x ?? bounds.minX,
    terrain.grid?.cols ?? 2,
    step,
  );
  const ys = gridAxis(
    bounds.minY,
    bounds.maxY,
    terrain.grid?.originM.y ?? bounds.minY,
    terrain.grid?.rows ?? 2,
    step,
  );
  const cols = xs.length - 1,
    rows = ys.length - 1;
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let row = 0; row <= rows; row++)
    for (let col = 0; col <= cols; col++) {
      const x = xs[col]!,
        y = ys[row]!;
      positions.push(x, terrain.surfaceAt(x, y) + offset, y);
      uvs.push(
        (x - bounds.minX) / (bounds.maxX - bounds.minX),
        1 - (y - bounds.minY) / (bounds.maxY - bounds.minY),
      );
      if (row < rows && col < cols) {
        const a = row * (cols + 1) + col,
          b = a + cols + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  let geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (terrain.grid) {
    geometry = drape(geometry, terrain, offset);
    const p = geometry.getAttribute('position'),
      uv: number[] = [];
    for (let i = 0; i < p.count; i++)
      uv.push(
        (p.getX(i) - bounds.minX) / (bounds.maxX - bounds.minX),
        1 - (p.getZ(i) - bounds.minY) / (bounds.maxY - bounds.minY),
      );
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
  const patches = nearbyPatches(terrain, bounds);
  if (patches.length) {
    const cut = geometry,
      p = cut.getAttribute('position');
    const positions = Array.from(p.array);
    const rectangle = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ];
    for (const area of patches) {
      const rings = booleanOpD(ClipType.Intersection, area.rings, [rectangle], FillRule.EvenOdd, 5);
      for (const triangle of triangulate(rings))
        for (const p of triangle.reverse()) positions.push(p.x, area.level + offset, p.y);
    }
    cut.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const uv: number[] = [];
    for (let i = 0; i < positions.length; i += 3)
      uv.push(
        (positions[i]! - bounds.minX) / (bounds.maxX - bounds.minX),
        1 - (positions[i + 2]! - bounds.minY) / (bounds.maxY - bounds.minY),
      );
    cut.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    cut.computeVertexNormals();
    geometry = cut;
  }
  if (!terrain.grid) return geometry;
  geometry = mergeGroundPlanes(geometry, terrain, offset);
  const p = geometry.getAttribute('position'),
    uv: number[] = [];
  for (let i = 0; i < p.count; i++)
    uv.push(
      (p.getX(i) - bounds.minX) / (bounds.maxX - bounds.minX),
      1 - (p.getZ(i) - bounds.minY) / (bounds.maxY - bounds.minY),
    );
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return indexTerrain(geometry);
}

/** Clip to the ground's grid triangles so overlapping areas share exactly the same plane. */
export function drape(
  geometry: BufferGeometry,
  terrain: Terrain,
  offset = -0.025,
  relative = false,
  fillPatches = false,
) {
  const patchPositions: number[] = [],
    patchColors: number[] = [];
  if (fillPatches && !relative) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = source.getAttribute('position'),
      colors = source.getAttribute('color');
    for (let i = 0; i < p.count; i += 3) {
      const triangle = [0, 1, 2].map((j) => ({ x: p.getX(i + j), y: p.getZ(i + j) }));
      if (areaD(triangle) < 0) triangle.reverse();
      for (const area of nearbyPatches(terrain, ringBounds(triangle))) {
        const rings = booleanOpD(
          ClipType.Intersection,
          [triangle],
          area.rings,
          FillRule.EvenOdd,
          5,
        );
        for (const part of triangulate(rings))
          for (const vertex of part.reverse()) {
            patchPositions.push(vertex.x, area.level + offset, vertex.y);
            if (colors) patchColors.push(colors.getX(i), colors.getY(i), colors.getZ(i));
          }
      }
    }
    if (source !== geometry) source.dispose();
  }
  if (!relative) geometry = cutGround(geometry, terrain);
  const input = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = input.getAttribute('position');
  const values: number[] = [];
  const inputColors = input.getAttribute('color'),
    colors: number[] = [];
  const step = terrain.grid!.cellM;
  const clip = (ring: Vec2[], distance: (p: Vec2) => number) => {
    const result: Vec2[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!,
        da = distance(a),
        db = distance(b);
      if (da >= 0) result.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return result;
  };
  for (let i = 0; i < position.count; i += 3) {
    const at = (j: number) => ({ x: position.getX(j), y: position.getZ(j) });
    const triangle = [at(i), at(i + 1), at(i + 2)];
    const [a, b, c] = triangle as [Vec2, Vec2, Vec2];
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 1e-10) continue;
    const heights = triangle.map((p, j) => position.getY(i + j) - terrain.surfaceAt(p.x, p.y));
    const relativeHeight = (p: Vec2) => {
      if (!relative) return 0;
      const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / denominator;
      const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / denominator;
      return heights[0]! * u + heights[1]! * v + heights[2]! * (1 - u - v);
    };
    const color = inputColors
      ? [inputColors.getX(i), inputColors.getY(i), inputColors.getZ(i)]
      : [];
    const xs = gridAxis(
      Math.min(...triangle.map((p) => p.x)),
      Math.max(...triangle.map((p) => p.x)),
      terrain.grid!.originM.x,
      terrain.grid!.cols,
      step,
    );
    const ys = gridAxis(
      Math.min(...triangle.map((p) => p.y)),
      Math.max(...triangle.map((p) => p.y)),
      terrain.grid!.originM.y,
      terrain.grid!.rows,
      step,
    );
    for (let row = 0; row < ys.length - 1; row++)
      for (let col = 0; col < xs.length - 1; col++) {
        const left = xs[col]!,
          right = xs[col + 1]!,
          top = ys[row]!,
          bottom = ys[row + 1]!;
        let ring = clip(triangle, (p) => p.x - left);
        ring = clip(ring, (p) => right - p.x);
        ring = clip(ring, (p) => p.y - top);
        ring = clip(ring, (p) => bottom - p.y);
        const c = Math.floor(((left + right) / 2 - terrain.grid!.originM.x) / step),
          r = Math.floor(((top + bottom) / 2 - terrain.grid!.originM.y) / step);
        const inside = c >= 0 && c < terrain.grid!.cols - 1 && r >= 0 && r < terrain.grid!.rows - 1;
        const x = terrain.grid!.originM.x + c * step,
          y = terrain.grid!.originM.y + r * step;
        for (const side of inside ? [-1, 1] : [0]) {
          const half = side ? clip(ring, (p) => side * (p.x - x + p.y - y - step)) : ring;
          for (let j = 1; j < half.length - 1; j++) {
            const a = half[0]!,
              b = half[j]!,
              c = half[j + 1]!;
            if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-8) continue;
            for (const p of [a, b, c]) {
              values.push(p.x, terrain.surfaceAt(p.x, p.y) + offset + relativeHeight(p), p.y);
              if (inputColors) colors.push(...color);
            }
          }
        }
      }
  }
  if (input !== geometry) input.dispose();
  geometry.dispose();
  for (const n of patchPositions) values.push(n);
  for (const n of patchColors) colors.push(n);
  const result = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(values, 3),
  );
  if (inputColors) result.setAttribute('color', new Float32BufferAttribute(colors, 3));
  result.computeVertexNormals();
  return result;
}

export function lowestGround(rings: readonly Vec2[][], terrain: Terrain, includeInterior = false) {
  let lowest = Infinity;
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!,
        b = ring[i]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / terrain.grid!.cellM));
      for (let j = 0; j <= steps; j++)
        lowest = Math.min(
          lowest,
          terrain.groundAt(a.x + ((b.x - a.x) * j) / steps, a.y + ((b.y - a.y) * j) / steps),
        );
    }
  if (includeInterior) {
    const bounds = ringBounds(rings[0]!),
      grid = terrain.grid!;
    const firstCol = Math.max(0, Math.ceil((bounds.minX - grid.originM.x) / grid.cellM));
    const lastCol = Math.min(
      grid.cols - 1,
      Math.floor((bounds.maxX - grid.originM.x) / grid.cellM),
    );
    const firstRow = Math.max(0, Math.ceil((bounds.minY - grid.originM.y) / grid.cellM));
    const lastRow = Math.min(
      grid.rows - 1,
      Math.floor((bounds.maxY - grid.originM.y) / grid.cellM),
    );
    for (let row = firstRow; row <= lastRow; row++)
      for (let col = firstCol; col <= lastCol; col++) {
        const p = { x: grid.originM.x + col * grid.cellM, y: grid.originM.y + row * grid.cellM };
        if (pointInPolygon(p, rings[0]!) && !rings.slice(1).some((ring) => pointInPolygon(p, ring)))
          lowest = Math.min(lowest, terrain.groundAt(p.x, p.y));
      }
  }
  return lowest;
}
