import { BufferGeometry, Color, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { pointInPolygon, segmentDistance, segmentsIntersect } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { WalkGraph } from '../network';
import type { ContextAreaFeature } from '../schema';
import type { MapPalette } from '../render/style';

/** TASK-263: an elevator (`building=elevator`, `building:part=elevator`) is drawn as a framed
 * glass shaft: no storeys, no office windows, a door where a mapped walkway reaches it, and its top
 * a cabin's height above the highest level it serves. */
export const isElevator = (piece: Pick<ContextAreaFeature, 'sub'>) => piece.sub === 'elevator';

/** The cabin, its door and the overrun above the top landing. */
export const elevatorHeadM = 3;
/** The walk deck of a layer, as `walk.ts` draws it. */
const layerM = 5;
const doorM = { width: 1, height: 2.1, frame: 0.1, sill: 0.25 };

export interface Landing {
  heightM: number;
  /** The edge of `shaftOutline` (from its vertex `edge` to the next) the door is on. */
  edge: number;
}

/** The outer ring, open and with a positive signed area (outward edge normals (dy, -dx)). */
export function shaftOutline(rings: readonly Vec2[][]): Vec2[] {
  const closed = rings[0]!;
  const ring =
    closed.length > 1 && closed[0]!.x === closed.at(-1)!.x && closed[0]!.y === closed.at(-1)!.y
      ? closed.slice(0, -1)
      : [...closed];
  const area = ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    return sum + a.x * b.y - b.x * a.y;
  }, 0);
  return area > 0 ? ring : ring.reverse();
}

/** The levels a shaft serves, read from the mapped walk links (not generated sidewalks or joins).
 * Its elevator is where links of two layers end together (within 0.5 m) in the outline or on it (within 0.3 m;
 * OSM's `highway=elevator` node). Each link from there whose far end lies outside is a landing at
 * its layer's deck (walkways below the ground are not drawn), with a door on the outline edge it
 * leaves through that faces its way out most. */
export function elevatorLandings(rings: readonly Vec2[][], walk?: WalkGraph): Landing[] {
  if (!walk) return [];
  const ring = shaftOutline(rings),
    closed = [...ring, ring[0]!];
  const xs = ring.map((p) => p.x),
    ys = ring.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs) - 0.3,
    Math.max(...xs) + 0.3,
    Math.min(...ys) - 0.3,
    Math.max(...ys) + 0.3,
  ];
  const ends: { at: Vec2; next: Vec2; far: Vec2; layer: number }[] = [];
  for (const link of walk.links) {
    if (link.generated) continue;
    const line = link.line;
    for (const [at, next, far] of [
      [line[0]!, line[1]!, line.at(-1)!],
      [line.at(-1)!, line.at(-2)!, line[0]!],
    ] as const)
      if (
        at.x >= minX &&
        at.x <= maxX &&
        at.y >= minY &&
        at.y <= maxY &&
        pointInPolygon(at, closed, 0.3)
      )
        ends.push({ at, next, far, layer: link.layer });
  }
  const landings: Landing[] = [];
  for (const { at, next, far, layer } of ends) {
    if (layer < 0 || pointInPolygon(far, closed, 0.3)) continue;
    if (!ends.some((o) => o.layer !== layer && Math.hypot(o.at.x - at.x, o.at.y - at.y) < 0.5))
      continue;
    const length = Math.hypot(next.x - at.x, next.y - at.y);
    let edge = -1,
      facing = -Infinity;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      if (segmentDistance(at, a, b) > 0.3 && !segmentsIntersect(at, far, a, b)) return;
      const side = Math.hypot(b.x - a.x, b.y - a.y);
      const dot = ((b.y - a.y) * (next.x - at.x) - (b.x - a.x) * (next.y - at.y)) / (side * length);
      if (dot > facing) [edge, facing] = [i, dot];
    });
    const heightM = layer * layerM;
    if (edge >= 0 && !landings.some((l) => l.heightM === heightM && l.edge === edge))
      landings.push({ heightM, edge });
  }
  return landings.sort((a, b) => a.heightM - b.heightM || a.edge - b.edge);
}

/** The shaft's top above its base: the tagged height or levels, else a head above the highest
 * landing (the ground when no walkway reaches it). */
export function elevatorTopM(piece: ContextAreaFeature, landings: readonly Landing[]) {
  return (
    piece.heightM ??
    (piece.levels !== undefined
      ? piece.levels * 3
      : Math.max(0, ...landings.map((l) => l.heightM)) + elevatorHeadM)
  );
}

type Point3 = [number, number, number];

/** The shaft, x/east, y/up, z/south from its base: glass walls between corner posts, a frame band
 * at each landing and under the top, a flat cap and a door per landing. The glass carries a
 * negative window pitch: no window grid by day, an even glow after dark (`buildingMaterial`). */
export function elevatorShaft(
  rings: readonly Vec2[][],
  low: number,
  top: number,
  landings: readonly Landing[],
  palette: MapPalette,
) {
  const positions: number[] = [],
    colours: number[] = [],
    windows: number[] = [];
  const metal = palette.buildings.walls.metal!;
  const glass = new Color(palette.buildings.window),
    frame = new Color(metal).multiplyScalar(0.55),
    door = new Color(metal).multiplyScalar(0.85),
    cap = new Color(palette.buildings.roofs.metal!).multiplyScalar(0.8);
  /** A planar polygon facing `toward` (wound counter-clockwise from that side). */
  const face = (points: Point3[], toward: Point3, colour: Color, pitch = 0) => {
    const [a, b, c] = points as [Point3, Point3, Point3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    const ordered =
      normal[0]! * toward[0] + normal[1]! * toward[1] + normal[2]! * toward[2] < 0
        ? [...points].reverse()
        : points;
    for (let i = 1; i + 1 < ordered.length; i++)
      for (const p of [ordered[0]!, ordered[i]!, ordered[i + 1]!]) {
        positions.push(...p);
        colours.push(colour.r, colour.g, colour.b);
        windows.push(0, 0, pitch);
      }
  };
  /** A box on a-b: `out` metres outward of it and `inward` inward, from z0 up to z1. */
  const box = (
    a: Vec2,
    b: Vec2,
    z0: number,
    z1: number,
    out: number,
    inward: number,
    colour: Color,
  ) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (b.y - a.y) / length,
      ny = -(b.x - a.x) / length;
    const centre: Point3 = [
      (a.x + b.x) / 2 + (nx * (out - inward)) / 2,
      (z0 + z1) / 2,
      (a.y + b.y) / 2 + (ny * (out - inward)) / 2,
    ];
    const p = (q: Vec2, offset: number, z: number): Point3 => [
      q.x + nx * offset,
      z,
      q.y + ny * offset,
    ];
    const ring = [p(a, out, 0), p(b, out, 0), p(b, -inward, 0), p(a, -inward, 0)];
    const at = (q: Point3, z: number): Point3 => [q[0], z, q[2]];
    const side = (points: Point3[]) => {
      const mid = points.reduce(
        (s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4, s[2] + q[2] / 4],
        [0, 0, 0],
      );
      face(points, [mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]], colour);
    };
    ring.forEach((q, i) => {
      const r = ring[(i + 1) % 4]!;
      side([at(q, z0), at(r, z0), at(r, z1), at(q, z1)]);
    });
    side(ring.map((q) => at(q, z1)));
    side(ring.map((q) => at(q, z0)));
  };
  const outline = shaftOutline(rings);
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / length,
      uy = (b.y - a.y) / length;
    face(
      [
        [a.x, low, a.y],
        [b.x, low, b.y],
        [b.x, top, b.y],
        [a.x, top, a.y],
      ],
      [uy, 0, -ux],
      glass,
      -1,
    );
    box(a, { x: a.x + ux * 0.18, y: a.y + uy * 0.18 }, low, top, 0.06, 0.12, frame);
    for (const z of new Set([low, ...landings.map((l) => l.heightM)]))
      if (z >= low && z < top - 0.6) box(a, b, z, z + doorM.sill, 0.04, 0.04, frame);
    box(a, b, top - 0.35, top, 0.05, 0.05, frame);
  });
  const points = outline.map((p) => new Vector2(p.x, p.y));
  for (const corners of ShapeUtils.triangulateShape(points, []))
    face(
      corners.map((i): Point3 => [outline[i]!.x, top, outline[i]!.y]),
      [0, 1, 0],
      cap,
    );
  for (const landing of landings) {
    if (landing.heightM < low || landing.heightM + doorM.sill + doorM.height > top) continue;
    const a = outline[landing.edge]!,
      b = outline[(landing.edge + 1) % outline.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const half = Math.min(doorM.width, length * 0.6) / 2;
    const at = (t: number) => ({
      x: a.x + ((b.x - a.x) * (length / 2 + t)) / length,
      y: a.y + ((b.y - a.y) * (length / 2 + t)) / length,
    });
    const z = landing.heightM + doorM.sill;
    box(
      at(-half - doorM.frame),
      at(half + doorM.frame),
      z,
      z + doorM.height + doorM.frame,
      0.06,
      0,
      frame,
    );
    box(at(-half), at(half), z, z + doorM.height, 0.09, 0, door);
  }
  const count = positions.length / 3;
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('color', new Float32BufferAttribute(colours, 3))
    .setAttribute('uv', new Float32BufferAttribute(new Float32Array(count * 2), 2))
    .setAttribute('windowInfo', new Float32BufferAttribute(windows, 3))
    .setAttribute('windowSeed', new Float32BufferAttribute(new Float32Array(count), 1));
  geometry.computeVertexNormals();
  return geometry;
}
