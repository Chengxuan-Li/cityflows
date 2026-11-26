import Flatbush from 'flatbush';
import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshLambertMaterial,
  ShapeUtils,
  Vector2,
  type BufferAttribute,
  type Group,
  type Material,
} from 'three';
import { pointInPolygon } from '../../src/geo/polyline';

// Intro mock (not a product feature): for the intro cut only (bench/intro/detail.ts), the docks and
// the river sit below the land: the water's surface is cut out of the flat ground layers, the
// water mirror lies `WATER_Y` down, and concrete quay walls drop to it wherever land meets water.

type Vec2 = { x: number; y: number };
export const WATER_Y = -1.8;

/** Point-in-water over the water areas, with an edge index: a ray to +x counts crossings per
 * area, so overlapping areas and their holes are both right. */
export function waterIndex(areas: Vec2[][][]) {
  const edges: { a: Vec2; b: Vec2; area: number; ring: Vec2[] }[] = [];
  areas.forEach((rings, area) => {
    for (const ring of rings)
      for (let i = 1; i < ring.length; i++)
        edges.push({ a: ring[i - 1]!, b: ring[i]!, area, ring });
  });
  const index = new Flatbush(Math.max(1, edges.length));
  for (const { a, b } of edges)
    index.add(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  if (!edges.length) index.add(0, 0, 0, 0);
  index.finish();
  const inside = (p: Vec2) => {
    const parity = new Map<number, boolean>();
    for (const i of index.search(p.x, p.y, Infinity, p.y)) {
      const e = edges[i];
      if (!e) continue;
      const { a, b } = e;
      if (a.y > p.y === b.y > p.y) continue;
      const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (x > p.x) parity.set(e.area, !parity.get(e.area));
    }
    for (const odd of parity.values()) if (odd) return true;
    return false;
  };
  /** The water areas' rings whose edges come within the box. */
  const ringsNear = (x0: number, y0: number, x1: number, y1: number) => {
    const rings = new Set<Vec2[]>();
    for (const i of index.search(x0, y0, x1, y1)) if (edges[i]) rings.add(edges[i]!.ring);
    return [...rings];
  };
  return { inside, ringsNear, edges };
}
type Water = ReturnType<typeof waterIndex>;

/** Splits clipper's result into outlines with the holes inside them, and triangulates them. */
function triangulate(paths: Vec2[][]) {
  const outers = paths.filter((p) => areaD(p) > 0),
    holes = paths.filter((p) => areaD(p) < 0);
  const triangles: Vec2[][] = [];
  for (const outer of outers) {
    const own = holes.filter((h) => pointInPolygon(h[0]!, [...outer, outer[0]!]));
    const all = [outer, ...own];
    const flat = all.flat();
    for (const [a, b, c] of ShapeUtils.triangulateShape(
      outer.map((p) => new Vector2(p.x, p.y)),
      own.map((h) => h.map((p) => new Vector2(p.x, p.y))),
    ))
      triangles.push([flat[a!]!, flat[b!]!, flat[c!]!]);
  }
  return triangles;
}

/** The land: the base ground's rectangle with the water cut out of it, at its own height. */
export function cutGround(ground: Mesh | undefined, water: Water, areas: Vec2[][][]) {
  if (!ground) return () => {};
  ground.updateMatrixWorld();
  ground.geometry.computeBoundingBox();
  const box = ground.geometry.boundingBox!.clone().applyMatrix4(ground.matrixWorld);
  const y = (box.min.y + box.max.y) / 2;
  const rect = [
    { x: box.min.x, y: box.min.z },
    { x: box.max.x, y: box.min.z },
    { x: box.max.x, y: box.max.z },
    { x: box.min.x, y: box.max.z },
  ];
  const subject = [areaD(rect) > 0 ? rect : [...rect].reverse()];
  const land = booleanOpD(
    ClipType.Difference,
    subject,
    areas.flat().map((ring) => ring.slice(0, -1)),
    FillRule.NonZero,
    2,
  ) as Vec2[][];
  const positions: number[] = [];
  for (const [a, b, c] of triangulate(land))
    for (const p of areaD([a!, b!, c!]) > 0 ? [a!, c!, b!] : [a!, b!, c!])
      positions.push(p.x, y, p.y);
  const geometry = new BufferGeometry().setAttribute(
    'position',
    new Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  void water;
  const old = {
    geometry: ground.geometry,
    rotation: ground.rotation.clone(),
    position: ground.position.clone(),
  };
  ground.geometry = geometry;
  ground.rotation.set(0, 0, 0);
  ground.position.set(0, 0, 0);
  return () => {
    geometry.dispose();
    ground.geometry = old.geometry;
    ground.rotation.copy(old.rotation);
    ground.position.copy(old.position);
  };
}

/** Rebuilds a flat, unindexed mesh without what lies over the water: triangles clear of it stay,
 * the rest are clipped by it, their attributes carried over from their first corner. A triangle
 * `dropWater` names is left out when its centre is in the water; without `clip`, any is. */
export function cutFlat(
  mesh: Mesh,
  water: Water,
  dropWater?: (tri: number) => boolean,
  clip = true,
) {
  const geometry = mesh.geometry as BufferGeometry;
  if (geometry.index) return () => {};
  const position = geometry.getAttribute('position') as BufferAttribute;
  const names = Object.keys(geometry.attributes);
  const out = new Map<string, number[]>(names.map((n) => [n, []]));
  const copyVertex = (i: number) => {
    for (const n of names) {
      const a = geometry.getAttribute(n) as BufferAttribute;
      const list = out.get(n)!;
      for (let k = 0; k < a.itemSize; k++) list.push(a.array[i * a.itemSize + k]!);
    }
  };
  let changed = false;
  for (let t = 0; t < position.count / 3; t++) {
    const tri = [0, 1, 2].map((k) => ({
      x: position.getX(t * 3 + k),
      y: position.getZ(t * 3 + k),
      h: position.getY(t * 3 + k),
    }));
    const centre = {
      x: (tri[0]!.x + tri[1]!.x + tri[2]!.x) / 3,
      y: (tri[0]!.y + tri[1]!.y + tri[2]!.y) / 3,
    };
    if ((dropWater?.(t) || !clip) && water.inside(centre)) {
      changed = true;
      continue;
    }
    if (!clip) {
      for (let k = 0; k < 3; k++) copyVertex(t * 3 + k);
      continue;
    }
    const xs = tri.map((p) => p.x),
      ys = tri.map((p) => p.y);
    const rings = water.ringsNear(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    );
    if (!rings.length && !water.inside(centre)) {
      for (let k = 0; k < 3; k++) copyVertex(t * 3 + k);
      continue;
    }
    changed = true;
    if (!rings.length) continue; // wholly inside the water
    const subject = [areaD(tri) > 0 ? tri : [...tri].reverse()];
    const pieces = booleanOpD(
      ClipType.Difference,
      subject.map((r) => r.map(({ x, y }) => ({ x, y }))),
      rings.map((ring) => ring.slice(0, -1)),
      FillRule.NonZero,
      3,
    ) as Vec2[][];
    const h = tri[0]!.h;
    for (const piece of triangulate(pieces))
      for (const p of areaD(piece) > 0 ? [piece[0]!, piece[2]!, piece[1]!] : piece) {
        copyVertex(t * 3);
        const list = out.get('position')!;
        list.splice(list.length - 3, 3, p.x, h, p.y);
      }
  }
  if (!changed) return () => {};
  const rebuilt = new BufferGeometry();
  for (const n of names) {
    const a = geometry.getAttribute(n) as BufferAttribute;
    rebuilt.setAttribute(n, new Float32BufferAttribute(out.get(n)!, a.itemSize));
  }
  rebuilt.computeBoundingSphere();
  const old = mesh.geometry;
  mesh.geometry = rebuilt;
  return () => {
    rebuilt.dispose();
    mesh.geometry = old;
  };
}

/** Concrete quay walls from the land's edge down past the water, along every water edge with land
 * on one side: weathered above, dark and wet at the waterline. */
export function quayWalls(water: Water, parent: Group) {
  const positions: number[] = [],
    normals: number[] = [],
    colours: number[] = [];
  const bands: [number, [number, number, number]][] = [
    [0.0, [0.7, 0.68, 0.64]],
    [WATER_Y + 0.5, [0.5, 0.5, 0.46]],
    [WATER_Y + 0.15, [0.24, 0.27, 0.24]],
    [WATER_Y - 1.0, [0.16, 0.18, 0.17]],
  ];
  for (const { a, b } of water.edges) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.05) continue;
    const n = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const left = water.inside({ x: m.x + n.x * 0.8, y: m.y + n.y * 0.8 }),
      right = water.inside({ x: m.x - n.x * 0.8, y: m.y - n.y * 0.8 });
    if (left === right) continue;
    // The wall faces the water.
    const f = left ? n : { x: -n.x, y: -n.y };
    for (let k = 1; k < bands.length; k++) {
      const [top, ct] = bands[k - 1]!,
        [bottom, cb] = bands[k]!;
      const quad = [
        [a, top, ct],
        [b, top, ct],
        [b, bottom, cb],
        [a, top, ct],
        [b, bottom, cb],
        [a, bottom, cb],
      ] as const;
      for (const [p, y, c] of quad) {
        positions.push(p.x, y, p.y);
        normals.push(f.x, 0, f.y);
        colours.push(...c);
      }
    }
  }
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new Float32BufferAttribute(normals, 3))
    .setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();
  const material: Material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const walls = new Mesh(geometry, material);
  walls.name = 'intro-quays';
  walls.receiveShadow = true;
  parent.add(walls);
  return () => {
    walls.removeFromParent();
    geometry.dispose();
    material.dispose();
  };
}
