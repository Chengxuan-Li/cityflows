import {
  BufferGeometry,
  Color,
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
    landuse: 0,
    green: 1,
    water: 2,
    parking: 3,
    building: 4,
    waterway: 5,
    rail: 6,
    tram: 7,
  };
  for (const feature of [...features].sort((a, b) => order[a.class] - order[b.class])) {
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
    ground.push(paint(geometry, color));
  }
  return {
    buildings: merged(buildings),
    ground: merged(ground),
    buildingCount: buildings.length,
    groundCount: ground.length,
  };
}
