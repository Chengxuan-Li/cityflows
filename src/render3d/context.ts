import {
  BufferGeometry,
  Color,
  DataTexture,
  MeshLambertMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Path,
  Shape,
  ShapeGeometry,
  ShapeUtils,
  Vector2,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import Flatbush from 'flatbush';
import { parallelOffset } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { ContextFeature } from '../schema';
import { groundSurface, surfaceGrain, type Surface } from '../render/vegetation';
import { style } from '../render/style';
import { drape, lowestGround, triangulate, type Terrain } from './terrain';

function shape(rings: Vec2[][]) {
  const points = (ring: Vec2[], clockwise: boolean) => {
    const result = ring.map((p) => new Vector2(p.x, -p.y));
    if (ShapeUtils.isClockWise(result) !== clockwise) result.reverse();
    return result;
  };
  const result = new Shape(points(rings[0]!, true));
  result.holes = rings.slice(1).map((ring) => new Path(points(ring, false)));
  return result;
}

function paint(geometry: BufferGeometry, fill: number, wall = fill) {
  const color = new Color(fill);
  const colors = new Float32BufferAttribute(
    new Float32Array(geometry.getAttribute('position').count * 3),
    3,
  );
  for (let i = 0; i < colors.count; i++) colors.setXYZ(i, color.r, color.g, color.b);
  color.setHex(wall);
  for (const group of geometry.groups)
    if (group.materialIndex === 1)
      for (let i = group.start; i < group.start + group.count; i++)
        colors.setXYZ(i, color.r, color.g, color.b);
  geometry.setAttribute('color', colors);
  return geometry;
}

function merged(geometries: BufferGeometry[]) {
  const geometry = geometries.length
    ? mergeGeometries(geometries, false)!
    : new BufferGeometry().setAttribute('position', new Float32BufferAttribute([], 3));
  for (const part of geometries) part.dispose();
  return geometry;
}

/** Display-only surroundings. Metric x/east, z/south, y/up; roofs retain courtyard holes. */
export function buildContext(
  features: readonly ContextFeature[],
  terrain?: Terrain,
  groundMeshes = true,
) {
  const buildings: BufferGeometry[] = [],
    ground: BufferGeometry[] = [];
  let groundCount = 0;
  const order = {
    tree: -1,
    tree_row: -1,
    landuse: 0,
    green: 1,
    water: 2,
    parking: 3,
    building: 4,
    waterway: 5,
    rail: 6,
    tram: 7,
  };
  const rank = (f: ContextFeature) =>
    f.kind === 'area' && f.sub === 'path' ? 3.5 : order[f.class];
  for (const feature of [...features].sort((a, b) => rank(a) - rank(b))) {
    if (feature.kind === 'point' || feature.class === 'tree_row') continue;
    if (feature.kind === 'area' && feature.class === 'building') {
      const geometry = new ExtrudeGeometry(shape(feature.rings), {
        depth: feature.heightM ?? (feature.levels === undefined ? 10 : feature.levels * 3),
        bevelEnabled: false,
        steps: 1,
        curveSegments: 1,
      }).rotateX(-Math.PI / 2);
      if (terrain?.grid) geometry.translate(0, lowestGround(feature.rings, terrain, true), 0);
      buildings.push(paint(geometry, style.context.building, style.context.buildingEdge));
      continue;
    }
    groundCount++;
    if (!groundMeshes) continue;
    let rings: Vec2[][], color: number;
    if (feature.kind === 'area') {
      rings = feature.rings;
      color =
        feature.class === 'landuse'
          ? (style.context.landuseSub[feature.sub ?? ''] ?? style.context.landuse)
          : style.context[feature.class];
    } else {
      const width =
        feature.class === 'waterway'
          ? (feature.widthM ?? 2)
          : feature.class === 'tram'
            ? 0.45
            : 0.7;
      rings = [
        [
          ...parallelOffset(feature.line, -width / 2),
          ...parallelOffset(feature.line, width / 2).reverse(),
        ],
      ];
      color = feature.class === 'waterway' ? style.context.water : style.context[feature.class];
    }
    let geometry: BufferGeometry = new ShapeGeometry(shape(rings), 1)
      .toNonIndexed()
      .rotateX(-Math.PI / 2)
      .translate(0, -0.025, 0);
    if (terrain?.grid) {
      if (feature.class === 'water') {
        geometry.translate(0, lowestGround(rings, terrain), 0);
        geometry.deleteAttribute('uv');
      } else geometry = drape(geometry, terrain);
    }
    const surface = feature.kind === 'area' ? groundSurface(feature) : undefined;
    const surfaceIndex = surface
      ? ['grass', 'meadow', 'forest', 'pavement'].indexOf(surface) + 1
      : 0;
    const p = geometry.getAttribute('position');
    const uv = new Float32BufferAttribute(new Float32Array(p.count * 2), 2);
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2.56, p.getZ(i) / 2.56);
    geometry.setAttribute('uv', uv);
    geometry.setAttribute(
      'surfaceIndex',
      new Float32BufferAttribute(new Float32Array(p.count).fill(surfaceIndex), 1),
    );
    ground.push(paint(geometry, color));
  }
  return {
    buildings: merged(buildings),
    ground: merged(ground),
    buildingCount: buildings.length,
    groundCount,
  };
}

/** One ordered context mesh, with five repeatable grains in one atlas and one draw call. */
export function groundMaterial() {
  const pixels = new Uint8Array(320 * 64 * 4).fill(255);
  const surfaces: Surface[] = ['grass', 'meadow', 'forest', 'pavement'];
  surfaces.forEach((surface, i) => {
    const grain = surfaceGrain(surface);
    for (let y = 0; y < 64; y++)
      pixels.set(grain.subarray(y * 256, (y + 1) * 256), (y * 320 + (i + 1) * 64) * 4);
  });
  const map = new DataTexture(pixels, 320, 64, RGBAFormat);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.colorSpace = SRGBColorSpace;
  map.needsUpdate = true;
  const material = new MeshLambertMaterial({
    vertexColors: true,
    map,
    transparent: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float surfaceIndex; varying float vSurfaceIndex;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSurfaceIndex = surfaceIndex;',
      );
    shader.fragmentShader =
      'varying float vSurfaceIndex;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        'diffuseColor *= texture2D(map, vec2((fract(vMapUv.x) * 63.0 + 0.5 + vSurfaceIndex * 64.0) / 320.0, fract(vMapUv.y)));',
      );
  };
  return material;
}

/** Split the shared terrain by context boundaries, keeping one colour pass and exact heights. */
export function buildTerrainGround(ground: BufferGeometry, features: readonly ContextFeature[]) {
  const order = {
    tree: -1,
    tree_row: -1,
    landuse: 0,
    green: 1,
    water: 2,
    parking: 3,
    building: 4,
    waterway: 5,
    rail: 6,
    tram: 7,
  };
  // TASK-106's path areas rank between parking and buildings, as in the flat ground.
  const rank = (f: ContextFeature) =>
    f.kind === 'area' && f.sub === 'path' ? 3.5 : order[f.class];
  const areas = [...features]
    .sort((a, b) => rank(a) - rank(b))
    .flatMap((feature) => {
      if (feature.kind === 'point' || feature.class === 'tree_row') return [];
      if (feature.class === 'building') return [];
      let rings: Vec2[][];
      if (feature.kind === 'area') rings = feature.rings;
      else {
        const width =
          feature.class === 'waterway'
            ? (feature.widthM ?? 2)
            : feature.class === 'tram'
              ? 0.45
              : 0.7;
        rings = [
          [
            ...parallelOffset(feature.line, -width / 2),
            ...parallelOffset(feature.line, width / 2).reverse(),
          ],
        ];
      }
      rings = rings.map((ring, i) => (areaD(ring) > 0 === (i === 0) ? ring : [...ring].reverse()));
      const colour =
        feature.class === 'landuse'
          ? (style.context.landuseSub[feature.sub ?? ''] ?? style.context.landuse)
          : feature.class === 'waterway'
            ? style.context.water
            : style.context[feature.class];
      return [{ rings, color: new Color(colour) }];
    });
  const index = areas.length ? new Flatbush(areas.length) : undefined;
  for (const { rings } of areas) {
    const points = rings[0]!;
    index!.add(
      Math.min(...points.map((p) => p.x)),
      Math.min(...points.map((p) => p.y)),
      Math.max(...points.map((p) => p.x)),
      Math.max(...points.map((p) => p.y)),
    );
  }
  index?.finish();
  const opaque = { positions: [] as number[], colors: [] as number[], normals: [] as number[] };
  const transparent = {
    positions: [] as number[],
    colors: [] as number[],
    normals: [] as number[],
  };
  const p = ground.getAttribute('position'),
    n = ground.getAttribute('normal');
  const count = ground.index?.count ?? p.count;
  const background = new Color(style.background);
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map((j) => ground.index?.getX(i + j) ?? i + j);
    const vertices = ids.map((j) => ({ x: p.getX(j), y: p.getZ(j), h: p.getY(j) }));
    const [a, b, c] = vertices as [
      (typeof vertices)[number],
      (typeof vertices)[number],
      (typeof vertices)[number],
    ];
    const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(det) < 1e-8) continue;
    const triangle = vertices.map(({ x, y }) => ({ x, y }));
    if (areaD(triangle) < 0) triangle.reverse();
    let pieces = [triangle];
    const emit = (paths: Vec2[][], color: Color, covered: boolean) => {
      for (const triangle of triangulate(paths))
        for (const v of triangle.reverse()) {
          const u = ((v.x - a.x) * (c.y - a.y) - (v.y - a.y) * (c.x - a.x)) / det;
          const w = ((b.x - a.x) * (v.y - a.y) - (b.y - a.y) * (v.x - a.x)) / det;
          const h = a.h + u * (b.h - a.h) + w * (c.h - a.h);
          for (const target of covered ? [opaque, transparent] : [opaque]) {
            target.positions.push(v.x, h, v.y);
            target.colors.push(color.r, color.g, color.b);
            for (let axis = 0; axis < 3; axis++)
              target.normals.push(
                n.getComponent(ids[0]!, axis) * (1 - u - w) +
                  n.getComponent(ids[1]!, axis) * u +
                  n.getComponent(ids[2]!, axis) * w,
              );
          }
        }
    };
    const nearby =
      index
        ?.search(
          Math.min(a.x, b.x, c.x),
          Math.min(a.y, b.y, c.y),
          Math.max(a.x, b.x, c.x),
          Math.max(a.y, b.y, c.y),
        )
        .sort((a, b) => b - a) ?? [];
    for (const j of nearby) {
      const area = areas[j]!;
      emit(
        booleanOpD(ClipType.Intersection, pieces, area.rings, FillRule.NonZero, 5),
        area.color,
        true,
      );
      pieces = booleanOpD(ClipType.Difference, pieces, area.rings, FillRule.NonZero, 5);
      if (!pieces.length) break;
    }
    emit(pieces, background, false);
  }
  const buffer = (data: typeof opaque) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(data.colors, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(data.normals, 3));
    const result = mergeVertices(geometry);
    geometry.dispose();
    return result;
  };
  return { opaque: buffer(opaque), transparent: buffer(transparent) };
}
