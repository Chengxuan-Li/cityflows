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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { parallelOffset } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { ContextFeature } from '../schema';
import { groundSurface, surfaceGrain, type Surface } from '../render/vegetation';
import { style } from '../render/style';

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
export function buildContext(features: readonly ContextFeature[]) {
  const buildings: BufferGeometry[] = [],
    ground: BufferGeometry[] = [];
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
      buildings.push(paint(geometry, style.context.building, style.context.buildingEdge));
      continue;
    }
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
    const geometry = new ShapeGeometry(shape(rings), 1)
      .toNonIndexed()
      .rotateX(-Math.PI / 2)
      .translate(0, -0.025, 0);
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
    groundCount: ground.length,
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
