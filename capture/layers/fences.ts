import {
  areaD,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
  simplifyPathD,
  unionD,
} from 'clipper2-ts';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Path,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
} from 'three';
import Flatbush from 'flatbush';
import {
  cumulativeLengths,
  distance,
  pointAtDistance,
  pointInPolygon,
  preparePolygon,
  segmentDistance,
  trimPolyline,
} from '../../src/geo/polyline';
import { railHeightAt, type RailGraph, type RailHeights } from '../../src/network/rail';
import type { Vec2 } from '../../src/geo/vec2';

/** Fences layer: palisades built as connected runs along at-grade railways (`rail`) and
 * chain-link round the airport boundary (`airport`), open at roads and water. */
export const params = { rail: true, airport: true };

const precision = 3;
const same = (a: Vec2, b: Vec2) => distance(a, b) < 0.0008;
export function offsetCorridor(lines: Vec2[][], halfWidth: number) {
  // Rounded end caps connect ways with a shared node. The union removes the
  // interior edges and leaves a single vertex where diverging corridors meet.
  return unionD(
    inflatePathsD(lines, halfWidth, JoinType.Miter, EndType.Round, 2, precision, 0.04),
    [],
    FillRule.NonZero,
    precision,
  ).map((ring) => simplifyPathD(ring, 0.035));
}

export function insetPerimeter(rings: Vec2[][], inset: number) {
  const oriented = rings.map((ring, i) =>
    areaD(ring) > 0 === (i === 0) ? ring : [...ring].reverse(),
  );
  return inflatePathsD(oriented, -inset, JoinType.Miter, EndType.Polygon, 2, precision);
}

export function fenceRuns(rings: readonly Vec2[][], clear: (p: Vec2) => boolean) {
  const output: Vec2[][] = [];
  const along = (a: Vec2, b: Vec2, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const loop = same(ring[0]!, ring.at(-1)!) ? ring : [...ring, ring[0]!];
    const runs: Vec2[][] = [];
    let run: Vec2[] = [];
    const end = () => {
      if (run.length > 1 && cumulativeLengths(run).at(-1)! > 0.3) runs.push(run);
      run = [];
    };
    const append = (p: Vec2) => {
      const b = run.at(-1),
        a = run.at(-2);
      if (b && same(b, p)) return;
      if (
        a &&
        b &&
        Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) < 0.00001 &&
        (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) > 0
      )
        run[run.length - 1] = p;
      else run.push(p);
    };
    let prev = loop[0]!,
      wasClear = clear(prev);
    if (wasClear) append(prev);
    // Clip the outline with a finer cadence than the fence bays. Keep mapped
    // corners, and locate each opening between adjacent clear/blocked samples.
    for (let i = 1; i < loop.length; i++) {
      const a = loop[i - 1]!,
        b = loop[i]!;
      const steps = Math.max(1, Math.ceil(distance(a, b) / 0.75));
      for (let k = 1; k <= steps; k++) {
        const p = k === steps ? b : along(a, b, k / steps);
        const ok = clear(p);
        if (ok !== wasClear) {
          let lo = 0,
            hi = 1;
          for (let j = 0; j < 8; j++) {
            const mid = (lo + hi) * 0.5;
            if (clear(along(prev, p, mid)) === wasClear) lo = mid;
            else hi = mid;
          }
          append(along(prev, p, wasClear ? lo : hi));
          if (wasClear) end();
        }
        if (ok) append(p);
        prev = p;
        wasClear = ok;
      }
    }
    end();
    const first = runs[0],
      last = runs.at(-1);
    if (first && last && first !== last && same(first[0]!, last.at(-1)!)) {
      runs[0] = [...last, ...first.slice(1)];
      runs.pop();
    }
    output.push(...runs);
  }
  return output;
}

function texture(kind: 'palisade' | 'chain') {
  const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
  const g = canvas.getContext('2d')!;
  g.strokeStyle = kind === 'palisade' ? '#33433b' : '#8a8f92';
  g.fillStyle = g.strokeStyle;
  if (kind === 'palisade') {
    for (let x = 4; x < 128; x += 16) g.fillRect(x, 6, 5, 122);
    g.fillRect(0, 22, 128, 6);
    g.fillRect(0, 100, 128, 6);
  } else {
    g.lineWidth = 3;
    for (let k = -128; k < 256; k += 22) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + 128, 128);
      g.moveTo(k + 128, 0);
      g.lineTo(k, 128);
      g.stroke();
    }
    g.fillRect(0, 0, 128, 7);
    g.fillRect(0, 121, 128, 7);
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  map.wrapS = RepeatWrapping;
  return map;
}

function coping(runs: Vec2[][], width: number, y: number, height: number, color: number) {
  const strips = runs.flatMap((run) => {
    const loop = same(run[0]!, run.at(-1)!);
    return inflatePathsD(
      [loop ? run.slice(0, -1) : run],
      width / 2,
      JoinType.Miter,
      loop ? EndType.Joined : EndType.Butt,
      2,
      precision,
    );
  });
  // The filled outline keeps the inside of even a sharp V closed without
  // stacking two independently capped and coplanar bars.
  const rings = unionD(strips, [], FillRule.NonZero, precision);
  const outers = rings
    .filter((r) => areaD(r) > 0)
    .map((ring) => ({
      ring,
      inside: preparePolygon([...ring, ring[0]!]),
      area: areaD(ring),
      shape: new Shape(),
    }))
    .sort((a, b) => a.area - b.area);
  const write = (shape: Path, ring: Vec2[]) => {
    shape.moveTo(ring[0]!.x, -ring[0]!.y);
    for (const p of ring.slice(1)) shape.lineTo(p.x, -p.y);
    shape.closePath();
  };
  for (const { shape, ring } of outers) write(shape, ring);
  for (const ring of rings.filter((r) => areaD(r) < 0)) {
    const owner = outers.find((o) => o.inside(ring[0]!));
    if (!owner) continue;
    const hole = new Path();
    write(hole, ring);
    owner.shape.holes.push(hole);
  }
  const geometry = new ExtrudeGeometry(
    outers.map((o) => o.shape),
    { depth: height, bevelEnabled: false },
  );
  geometry.rotateX(-Math.PI / 2).translate(0, y - height / 2, 0);
  return new Mesh(geometry, new MeshLambertMaterial({ color }));
}

export function fenceMesh(runs: Vec2[][], height: number, kind: 'palisade' | 'chain') {
  const group = new Group();
  group.name = 'capture-fence-' + kind;
  if (!runs.length) return group;
  const positions: number[] = [],
    uvs: number[] = [];
  const posts = new Map<string, Vec2>();
  const post = (p: Vec2) => posts.set(`${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`, p);
  const pitch = kind === 'palisade' ? 1.2 : 0.9;
  for (const run of runs) {
    const along = cumulativeLengths(run),
      total = along.at(-1)!;
    const corners = [0];
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]!,
        b = run[i]!,
        q = run[i + 1];
      const first = along[i - 1]! / pitch,
        last = along[i]! / pitch;
      positions.push(
        a.x,
        0,
        a.y,
        b.x,
        0,
        b.y,
        b.x,
        height,
        b.y,
        a.x,
        0,
        a.y,
        b.x,
        height,
        b.y,
        a.x,
        height,
        a.y,
      );
      uvs.push(first, 0, last, 0, last, 1, first, 0, last, 1, first, 1);
      if (
        q &&
        ((b.x - a.x) * (q.x - b.x) + (b.y - a.y) * (q.y - b.y)) /
          (distance(a, b) * distance(b, q)) <
          0.95
      )
        corners.push(along[i]!);
    }
    corners.push(total);
    for (let i = 1; i < corners.length; i++) {
      const start = corners[i - 1]!,
        stop = corners[i]!;
      const count = Math.ceil((stop - start) / 3);
      post(pointAtDistance(run, along, start));
      for (let j = 1; j < count; j++)
        post(pointAtDistance(run, along, start + ((stop - start) * j) / count));
    }
    post(run.at(-1)!);
  }
  const panelsGeo = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  panelsGeo.computeVertexNormals();
  const panels = new Mesh(
    panelsGeo,
    new MeshLambertMaterial({ map: texture(kind), alphaTest: 0.45, side: DoubleSide }),
  );
  panels.name = 'panels';
  const postsMesh = new InstancedMesh(
    new BoxGeometry(0.09, height + 0.08, 0.09).translate(0, (height + 0.08) / 2, 0),
    new MeshLambertMaterial({ color: kind === 'palisade' ? 0x33433b : 0x7c8285 }),
    posts.size,
  );
  postsMesh.name = 'posts';
  const object = new Object3D();
  [...posts.values()].forEach((p, i) => {
    object.position.set(p.x, 0, p.y);
    object.updateMatrix();
    postsMesh.setMatrixAt(i, object.matrix);
  });
  postsMesh.computeBoundingSphere();
  for (const mesh of [panels, postsMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (kind === 'palisade') {
    for (const [width, y, h, color] of [
      [0.23, 0.085, 0.14, 0x8f8b7e],
      [0.096, height - 0.023, 0.047, 0x586158],
    ] as const) {
      const bar = coping(runs, width, y, h, color);
      bar.receiveShadow = true;
      group.add(bar);
    }
  }
  return group;
}

/** Points every `step` metres along `line`, with the heading there and the distance along. */
function alongLine(line: readonly Vec2[], step: number) {
  const out: { p: Vec2; d: Vec2; s: number }[] = [];
  let s = 0,
    next = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-3) continue;
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    for (; next <= s + length; next += step) {
      const u = next - s;
      out.push({ p: { x: a.x + d.x * u, y: a.y + d.y * u }, d, s: next });
    }
    s += length;
  }
  return out;
}
export interface RailVergeRun {
  points: Vec2[];
  vergeSide: number;
  track: number;
}

interface Inside {
  (p: Vec2): boolean;
}
interface Clearance {
  (p: Vec2, reach: number): number;
}
export function segmentClearance(lines: { line: readonly Vec2[]; pad: number }[]): Clearance {
  const segments: { a: Vec2; b: Vec2; pad: number }[] = [];
  for (const { line, pad } of lines)
    for (let i = 1; i < line.length; i++) segments.push({ a: line[i - 1]!, b: line[i]!, pad });
  const index = new Flatbush(Math.max(1, segments.length));
  for (const { a, b } of segments)
    index.add(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  if (!segments.length) index.add(0, 0, 0, 0);
  index.finish();
  return (p, reach) => {
    let best = Infinity;
    for (const i of index.search(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
      const s = segments[i];
      if (s) best = Math.min(best, segmentDistance(p, s.a, s.b) - s.pad);
    }
    return best;
  };
}

/** Palisade fences 1.8 m tall, 3.4 m out from each at-grade railway track, where neither another
 * track, a platform, a road nor water is in the way. */
export function railFences(
  rail: RailGraph | undefined,
  heights: RailHeights | undefined,
  roads: Clearance,
  water: Inside,
) {
  if (!rail || !heights) return { group: new Group(), verges: [] as RailVergeRun[] };
  const tracks = rail.tracks.filter((t) => t.kind !== 'tram');
  const centre = segmentClearance(tracks.map((t) => ({ line: t.line, pad: 0 })));
  const platforms = rail.platforms
    .map((p) => (p.shape.kind === 'polygon' ? p.shape.ring : null))
    .filter((r): r is Vec2[] => !!r);
  const nearPlatform = (p: Vec2) =>
    platforms.some(
      (ring) =>
        pointInPolygon(p, ring) ||
        ring.some((q, i) => i > 0 && segmentDistance(p, ring[i - 1]!, q) < 2.5),
    );
  const bayM = 3;
  const verges: RailVergeRun[] = [];
  const clear = (p: Vec2) =>
    centre(p, 4) > 2.6 && roads(p, 12) > 0.8 && !water(p) && !nearPlatform(p);
  const ground = tracks.filter((t) => heights.grades[t.idx] === 'ground');
  // Preserve the established verge planting's local stationing, independently
  // of the fence geometry now built from the whole formation's outline.
  for (const track of ground) {
    const samples = alongLine(track.line, bayM);
    for (const side of [-1, 1]) {
      let run: Vec2[] = [];
      const close = () => {
        if (run.length > 1) verges.push({ points: run, vergeSide: side, track: track.idx });
        run = [];
      };
      for (const { p, d, s } of samples) {
        const q = { x: p.x - d.y * side * 3.4, y: p.y + d.x * side * 3.4 };
        const ok = Math.abs(railHeightAt(heights, track, s)) < 0.8 && clear(q);
        if (ok) run.push(q);
        else close();
      }
      close();
    }
  }
  const lines = ground.flatMap((track) => {
    const h = heights.profiles[track.idx]!;
    if (h.every((y) => Math.abs(y) < 0.8)) return [track.line];
    if (h.length === 1) return [];
    const segments: [number, number][] = [];
    const step = track.lengthM / (h.length - 1);
    for (let i = 1; i < h.length; i++) {
      const a = h[i - 1]!,
        b = h[i]!;
      if ((a >= 0.8 && b >= 0.8) || (a <= -0.8 && b <= -0.8)) continue;
      const lo = a === b ? 0 : Math.max(0, (Math.sign(a) * 0.8 - a) / (b - a));
      const hi = a === b ? 1 : Math.min(1, (Math.sign(b) * 0.8 - a) / (b - a));
      const from = (i - 1 + (Math.abs(a) < 0.8 ? 0 : lo)) * step;
      const to = (i - 1 + (Math.abs(b) < 0.8 ? 1 : hi)) * step;
      const last = segments.at(-1);
      if (to <= from) continue;
      if (last && Math.abs(last[1] - from) < 0.001) last[1] = to;
      else segments.push([from, to]);
    }
    return segments.map(([a, b]) => trimPolyline(track.line, a, track.lengthM - b));
  });
  const runs = fenceRuns(offsetCorridor(lines, 3.4), clear);
  return { group: fenceMesh(runs, 1.8, 'palisade'), verges };
}

/** The airport perimeter follows its closed rings, with openings at roads and water. */
export function airportFence(boundary: Vec2[][] | undefined, roads: Clearance, water: Inside) {
  // Set the posts inside the mapped boundary so coincident shore edges can
  // join on dry ground instead of alternately clipping the same straight run.
  const runs = fenceRuns(
    insetPerimeter(boundary ?? [], 0.28),
    (p) => roads(p, 12) > 0.5 && !water(p),
  );
  return fenceMesh(runs, 2.4, 'chain');
}
