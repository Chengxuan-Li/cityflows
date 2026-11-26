import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  boxOf,
  nearestOnPolyline,
  pointAtDistance,
  segmentIntersection,
} from '../../src/geo/polyline';
import { createRandom } from '../../src/geo/random';
import type { Vec2 } from '../../src/geo/vec2';
import type { TrainPose, TrainTrackPose } from '../../src/network/trains';
import type { RailGraph, RailHeights } from '../../src/network/rail';
import { railElevation } from '../../src/render3d/rail';

import { isCrossover, trackCurves } from './track-curves';
import { grain, patchMaterial } from './weathering';

type Heights = Parameters<typeof railElevation>[0];
type Section = readonly [offset: number, height: number];
export type IntroTrainView = {
  elevation(pose: TrainTrackPose): number;
  update(trains: TrainPose[], below: boolean, selected: string | null): void;
};

const railHeadM = 0.248;

type Sample = { p: Vec2; bearing: number; y: number; s: number; m: number; sense: number };
const offsetAt = ({ p, bearing }: Sample, offset: number) => ({
  x: p.x - Math.sin(bearing) * offset,
  y: p.y + Math.cos(bearing) * offset,
});

const webSection = (z: number): Section[] => [
  [z - 0.058, 0.156],
  [z - 0.017, 0.173],
  [z - 0.016, 0.222],
  [z - 0.035, 0.225],
  [z - 0.035, 0.242],
  [z + 0.035, 0.242],
  [z + 0.035, 0.225],
  [z + 0.016, 0.222],
  [z + 0.017, 0.173],
  [z + 0.058, 0.156],
];
const headSection = (z: number): Section[] => [
  [z - 0.035, 0.242],
  [z - 0.021, railHeadM],
  [z + 0.021, railHeadM],
  [z + 0.035, 0.242],
];

function sideSection(side: number, section: readonly Section[]): Section[] {
  return side > 0
    ? [...section]
    : section.map(([offset, height]): Section => [-offset, height]).reverse();
}

/** One batch per finish. UVs stay in track metres as the section follows bends and grades. */
class Strip {
  readonly positions: number[] = [];
  readonly uv: number[] = [];

  add(samples: Sample[], section: readonly Section[]) {
    for (let j = 1; j < samples.length; j++) {
      const a = samples[j - 1]!,
        b = samples[j]!;
      for (let i = 1; i < section.length; i++) {
        const l = section[i - 1]!,
          r = section[i]!;
        for (const [p, [offset, height]] of [
          [a, l],
          [b, r],
          [b, l],
          [a, l],
          [a, r],
          [b, r],
        ] as const) {
          this.positions.push(
            p.p.x - Math.sin(p.bearing) * offset,
            p.y + height,
            p.p.y + Math.cos(p.bearing) * offset,
          );
          this.uv.push(offset * p.sense, p.m);
        }
      }
    }
  }

  bridge(previous: readonly [Sample, Sample], next: readonly [Sample, Sample]) {
    for (const sample of [previous[0], next[1], next[0], previous[0], previous[1], next[1]]) {
      this.positions.push(sample.p.x, sample.y + 0.076, sample.p.y);
      this.uv.push(0, sample.m);
    }
  }

  mesh(material: Material) {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    const mesh = new Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}

// The app batches above-ground paint; its screen-space cache uses this same geometry.
// Keep the original vertex arrays so selection colours and cache references stay valid.
function hideOldTrack(parent: Group, tracks: RailGraph['tracks'], gaps: Map<number, number[]>) {
  const geometry = (parent.children[0] as Mesh).geometry;
  const position = geometry.getAttribute('position'),
    colors = geometry.getAttribute('color');
  const index = geometry.getIndex();
  const targets = [0x8aa6a6, 0x777b78, 0x77857d, 0xb6aa98].map((hex) => new Color(hex));
  const areas = tracks.map((t) => ({ t, bounds: boxOf(t.line) }));
  const keep: number[] = [];
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const a = index ? index.getX(i) : i,
      b = index ? index.getX(i + 1) : i + 1,
      c = index ? index.getX(i + 2) : i + 2;
    if (
      targets.some(
        (rgb) =>
          Math.abs(colors.getX(a) - rgb.r) +
            Math.abs(colors.getY(a) - rgb.g) +
            Math.abs(colors.getZ(a) - rgb.b) <
          0.0002,
      )
    ) {
      const p = {
        x: (position.getX(a) + position.getX(b) + position.getX(c)) / 3,
        y: (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3,
      };
      if (
        areas.some(({ t, bounds: { minX, minY, maxX, maxY } }) => {
          if (p.x < minX - 1.55 || p.x > maxX + 1.55 || p.y < minY - 1.55 || p.y > maxY + 1.55)
            return false;
          const projection = nearestOnPolyline(t.line, p);
          return (
            projection.away < 1.54 &&
            !gaps.get(t.idx)!.some((s) => Math.abs(s - projection.along) < 6)
          );
        })
      )
        continue;
    }
    keep.push(a, b, c);
  }
  geometry.setIndex(keep);
  return () => geometry.setIndex(index);
}

function trackMaterial(finish: 'ballast' | 'cess' | 'tray', color: number) {
  const material = new MeshLambertMaterial({ color, side: DoubleSide });
  const texture =
    finish === 'ballast'
      ? `
    vec2 world=vTrackWorld;
    float compact=weathering(world*0.29);
    float gritA=grit(world*vec2(16.0,14.0));
    float gritB=grit(mat2(0.81,-0.59,0.59,0.81)*world*26.0);
    float packing=grit(world*5.7);
    float metalDust=0.12*weathering(world*0.72+38.3);
    float stone=0.72*gritA+0.35*gritB;
    float shadow=smoothstep(0.067,0.42,compact+0.19*packing);
    diffuseColor.rgb *= vec3(1.035,1.02,1.0)
      *(0.93+0.36*packing+0.61*stone-0.43*shadow+metalDust);
    `
      : `
    vec2 p=vChain;
    float profile=INTROPROFILE;
    float q=p.y/profile;
    vec2 aa=fwidth(p/vec2(0.58,profile));
    float panel=floor(q);
    float tag=hashCell(vec2(panel,floor(p.x/0.63)+127.0));
    float resolved=1.0-smoothstep(0.11,0.47,aa.y);
    float seamStrength=seam(q,0.019/profile,aa.y)*mix(0.45,1.2,tag);
    float replacement=smoothstep(0.94,0.99,tag)*resolved;
    vec2 world=vTrackWorld;
    float damp=smoothstep(0.02,0.39,weathering(world*0.31+7.6));
    float chip=grit(world*13.8);
    diffuseColor.rgb *= mix(vec3(1.035,1.0,0.95),vec3(1.06,1.04,1.01),replacement)
      *(0.96-0.39*seamStrength+(tag-0.5)*0.19*resolved-0.32*damp+0.19*chip);
    `.replace('INTROPROFILE', finish === 'tray' ? '1.83' : '2.54');
  patchMaterial(material, 'track-' + finish, (shader) => {
    const varying = 'varying vec2 vChain, vTrackWorld;\n';
    shader.vertexShader =
      varying +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvChain=uv; vTrackWorld=(modelMatrix*vec4(transformed,1.0)).xz;',
      );
    shader.fragmentShader =
      grain +
      varying +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${texture}`,
      );
  });
  return material;
}

function fittings() {
  function box(w: number, h: number, l: number, x: number, y: number, z: number, hex: number) {
    const g = new BoxGeometry(w, h, l).translate(x, y, z);
    const color = new Color(hex),
      rgb: number[] = [];
    for (let i = 0; i < g.getAttribute('position').count; i++) rgb.push(color.r, color.g, color.b);
    g.setAttribute('color', new Float32BufferAttribute(rgb, 3));
    return g;
  }
  const sleeper = [
    box(0.22, 0.042, 2.49, 0, 0.123, 0, 0x4a4b4d),
    box(0.19, 0.014, 0.88, 0, 0.144, 0, 0x42444a),
    ...[-0.75, 0.75].flatMap((z) => [
      box(0.21, 0.025, 0.22, 0, 0.157, z, 0x3a3633),
      box(0.082, 0.037, 0.046, 0, 0.173, z - 0.089, 0x604337),
      box(0.082, 0.037, 0.046, 0, 0.173, z + 0.089, 0x604337),
    ]),
  ];
  const bracket = [
    box(0.25, 0.047, 0.36, 0, 0.103, 0, 0x66615b),
    box(0.155, 0.145, 0.13, 0, 0.179, -0.11, 0xb4a78d),
    box(0.19, 0.036, 0.18, 0, 0.21, -0.11, 0xb0a896),
    box(0.11, 0.03, 0.31, 0, 0.267, -0.022, 0xa79b8e),
  ];
  const meshes = [sleeper, bracket].map((parts) => {
    const g = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    return g;
  });
  return meshes;
}

export function trackDetail(
  parent: Group | undefined,
  graph: RailGraph | undefined,
  heights: Heights | undefined,
  rail: RailHeights | undefined,
  daylight: () => number,
  trains?: IntroTrainView,
) {
  if (!parent || !graph || !heights || !rail) return () => {};
  // Detail the DLR corridor in the filmed area. The original paint stays available for
  // unmapped crossings, structures and the rest of the network, including the rail cache.
  const tracks = graph.tracks.filter(
    (t) =>
      t.kind === 'light_rail' &&
      t.name === 'Docklands Light Railway' &&
      rail.grades[t.idx] !== 'tunnel' &&
      t.line.some((p) => p.x > -650 && p.x < 920 && p.y > 75 && p.y < 320),
  );
  const detailed = new Set(tracks.map((t) => t.idx));
  const { curves, ends } = trackCurves(graph, tracks);
  const gaps = new Map<number, number[]>();
  const bed = new Strip(),
    web = new Strip(),
    head = new Strip(),
    power = new Strip(),
    cover = new Strip(),
    cess = new Strip(),
    kerbs = new Strip(),
    tray = new Strip(),
    fittingsSteel = new Strip();
  const ties: { sample: Sample; width: number }[] = [],
    brackets: { sample: Sample; side: number }[] = [];
  type Track = RailGraph['tracks'][number];
  const at = (t: Track, s: number): Sample => {
    const curve = curves.get(t.idx)!;
    const { p, bearing } = curve.at(s);
    return {
      p,
      bearing,
      s,
      y: railElevation(heights, rail, t, s, p),
      m: curve.origin + curve.sense * curve.metres(s),
      sense: curve.sense,
    };
  };
  function stations(start: number, end: number, step: number) {
    return Array.from({ length: Math.ceil((end - start) / step) + 1 }, (_, i) =>
      Math.min(end, start + i * step),
    );
  }
  // Find the rail-on-rail crossings, using the actual swept gauge rather than
  // the intersection of the mapped centre lines (which is at the switch toes).
  type Frog = {
    branch: Track;
    branchS: number;
    branchZ: number;
    stock: Track;
    stockS: number;
    stockZ: number;
  };
  const frogs: Frog[] = [];
  const gauge = [-0.75, 0.75];
  for (const branch of tracks.filter(isCrossover)) {
    const route = stations(0, branch.lengthM, 0.28).map((s) => at(branch, s));
    for (const node of [branch.fromNode, branch.toNode]) {
      for (const { track: stock, start } of ends[node]!) {
        const length = Math.min(stock.lengthM, 25);
        const rail = stations(0, length, 0.4).map((s) => at(stock, start ? s : stock.lengthM - s));
        for (const branchZ of gauge)
          for (const stockZ of gauge) {
            if (
              Math.sign(branchZ * stockZ) ===
              Math.sign(Math.cos(route[0]!.bearing - rail[0]!.bearing))
            )
              continue;
            for (let i = 1; i < route.length; i++) {
              const a = route[i - 1]!,
                b = route[i]!,
                p = offsetAt(a, branchZ),
                q = offsetAt(b, branchZ);
              for (let j = 1; j < rail.length; j++) {
                const c = rail[j - 1]!,
                  d = rail[j]!,
                  r = offsetAt(c, stockZ),
                  z = offsetAt(d, stockZ);
                const hit = segmentIntersection(p, q, r, z);
                if (!hit) continue;
                const between = (first: Sample, last: Sample, origin: Vec2) =>
                  first.s +
                  ((last.s - first.s) * Math.hypot(hit.x - origin.x, hit.y - origin.y)) /
                    Math.hypot(last.p.x - first.p.x, last.p.y - first.p.y);
                frogs.push({
                  branch,
                  branchZ,
                  branchS: between(a, b, p),
                  stock,
                  stockZ,
                  stockS: between(c, d, r),
                });
              }
            }
          }
      }
    }
  }
  const stockFrogs = (t: Track, z: number) =>
    frogs.flatMap((f) =>
      f.stock === t && f.stockZ === z
        ? [f.stockS]
        : f.branch === t && f.branchZ === z
          ? [f.branchS]
          : [],
    );
  for (const t of tracks) {
    const curve = curves.get(t.idx)!;
    const branch = isCrossover(t);
    const point = (s: number) => at(t, s);
    const switchSide = (start: boolean) => {
      const on = point(start ? 0 : t.lengthM);
      const fromNode = (end: (typeof ends)[number][number]) =>
        at(end.track, end.start ? 0 : end.track.lengthM).bearing + (end.start ? 0 : Math.PI);
      const end = ends[start ? t.fromNode : t.toNode]!.find(
        (e) => Math.cos(on.bearing - fromNode(e)) * (start ? 1 : -1) > 0,
      );
      if (!end) return undefined;
      return (s: number) =>
        at(
          end.track,
          end.start ? Math.min(end.track.lengthM, s) : Math.max(0, end.track.lengthM - s),
        );
    };
    const approaches = branch ? ([switchSide(true), switchSide(false)] as const) : undefined;
    const clearance = (p: Sample) => {
      if (!approaches) return Infinity;
      const main = p.s < t.lengthM / 2 ? approaches[0]?.(p.s) : approaches[1]?.(t.lengthM - p.s);
      if (!main) return Infinity;
      return Math.abs(
        (p.p.x - main.p.x) * Math.sin(main.bearing) - (p.p.y - main.p.y) * Math.cos(main.bearing),
      );
    };
    const crossings = graph.crossings
      .filter((c) => c.track === t.idx)
      .map((c) => nearestOnPolyline(t.line, c.pos).along);
    gaps.set(t.idx, crossings);
    const draw = (start: number, end: number) => {
      if (end - start < 0.2) return;
      const samples = stations(start, end, branch ? 0.4 : 0.72).map(point);
      // Let branch ballast underlap the through bed. The finish is sampled in world
      // space so their union has the same stone colour and no coplanar surface.
      const ballast = branch ? samples.map((p) => ({ ...p, y: p.y - 0.021 })) : samples;
      bed.add(ballast, [
        [-1.49, 0.068],
        [-1.23, 0.125],
        [1.23, 0.125],
        [1.49, 0.068],
      ]);
      const span = (from: number, to: number) => [
        point(from),
        ...samples.filter((p) => p.s > from + 0.0001 && p.s < to - 0.0001),
        point(to),
      ];
      for (const z of gauge) {
        const cuts = stockFrogs(t, z)
          .filter((s) => s > start && s < end)
          .sort((a, b) => a - b);
        let from = start;
        for (const cut of [...cuts, end + 0.07]) {
          const to = Math.min(end, cut - 0.07);
          if (to > from + 0.01) {
            const run = span(from, to);
            if (branch)
              run.forEach((p) => {
                // Blend the machined switch point out of the stock rail.
                const d = clearance(p);
                p.y -= 0.027 * Math.max(0, 1 - d / 0.12);
              });
            web.add(run, webSection(z));
            head.add(run, headSection(z));
          }
          from = cut + 0.07;
        }
      }
      const minM = curve.origin + curve.sense * curve.metres(start);
      const maxM = curve.origin + curve.sense * curve.metres(end);
      for (
        let i = Math.ceil(Math.min(minM, maxM) / 0.64 - 0.35);
        (i + 0.35) * 0.64 < Math.max(minM, maxM);
        i++
      ) {
        const s = curve.station(((i + 0.35) * 0.64 - curve.origin) * curve.sense);
        if (s < start || s >= end) continue;
        const sample = point(s);
        if (clearance(sample) < 1.48) continue;
        const frog = frogs.some((f) => f.stock === t && Math.abs(s - f.stockS) < 3.6);
        ties.push({ sample, width: frog ? 1.4 : 1 });
      }
      if (branch) return; // Insulated turnout zone. Through-line conductor rails flank both points.
      // Find the near-parallel companion so the conductor and outer cess stay on the
      // same side of the formation even when a mapped way reverses direction.
      const mid = point((start + end) / 2);
      let nearest = 14;
      let side = (mid.p.y < 249 ? -1 : 1) * (Math.cos(mid.bearing) < 0 ? -1 : 1);
      for (const other of tracks) {
        if (other === t || isCrossover(other) || other.layer !== t.layer) continue;
        const q = nearestOnPolyline(other.line, mid.p);
        if (q.away < 2.5 || q.away >= nearest || q.along < 0.6 || q.along > other.lengthM - 0.6)
          continue;
        const across =
          Math.cos(mid.bearing) * (q.point.y - mid.p.y) -
          Math.sin(mid.bearing) * (q.point.x - mid.p.x);
        if (Math.abs(across) < q.away * 0.93) continue;
        nearest = q.away;
        side = across < 0 ? 1 : -1;
      }
      const formation =
        rail.grades[t.idx] === 'ground'
          ? samples.filter((p) => p.p.x > 320 && p.p.x < 785 && p.p.y > 215 && p.p.y < 282)
          : [];
      if (formation.length > 1) {
        cess.add(
          formation,
          sideSection(side, [
            [1.43, 0.071],
            [1.49, 0.089],
            [3.03, 0.092],
            [3.1, 0.071],
          ]),
        );
        kerbs.add(
          formation,
          sideSection(side, [
            [3.03, 0.076],
            [3.045, 0.108],
            [3.115, 0.108],
            [3.13, 0.064],
          ]),
        );
        tray.add(
          formation,
          sideSection(side, [
            [1.62, 0.085],
            [1.64, 0.16],
            [2.1, 0.15],
            [2.12, 0.088],
          ]),
        );
        // Occasional covers in the cess stand proud of the slabs; they break up the
        // repeated joints without peppering the whole walkway with pale specks.
        const fittings = createRandom(946 + t.idx);
        for (
          let s = formation[0]!.s + fittings.uniform(2, 5);
          s < formation.at(-1)!.s - 0.6;
          s += fittings.uniform(8, 15)
        ) {
          const trap = fittings.uniform(2.33, 2.79);
          kerbs.add(
            [point(s), point(s + fittings.uniform(0.13, 0.27))],
            sideSection(side, [
              [trap, 0.091],
              [trap + 0.015, 0.111],
              [trap + 0.16, 0.111],
              [trap + 0.18, 0.094],
            ]),
          );
        }
        if (nearest > 5.1) {
          tray.add(
            formation,
            sideSection(-side, [
              [1.51, 0.07],
              [1.54, 0.116],
              [1.91, 0.116],
              [1.94, 0.069],
            ]),
          );
          kerbs.add(
            formation,
            sideSection(-side, [
              [1.9, 0.108],
              [1.925, 0.127],
              [1.996, 0.127],
              [2.02, 0.065],
            ]),
          );
        }
      }
      const offset = 1.32 * side;
      const jointGap = (node: number) =>
        graph.nodes[node]!.tracks.some((i) => isCrossover(graph.tracks[i]!)) ? 5.5 : 0;
      const low = start + (start === 0 ? jointGap(t.fromNode) : 0.6);
      const high = end - (end === t.lengthM ? jointGap(t.toNode) : 0.6);
      const attach = (from: number, to: number) => {
        if (to - from < 1.35) return;
        const run = span(from, to);
        power.add(run, [
          [offset - 0.052, 0.162],
          [offset - 0.048, 0.214],
          [offset + 0.048, 0.214],
          [offset + 0.052, 0.162],
          [offset - 0.052, 0.162],
        ]);
        cover.add(run, [
          [offset - 0.111, 0.234],
          [offset - 0.105, 0.285],
          [offset - 0.078, 0.303],
          [offset + 0.078, 0.303],
          [offset + 0.105, 0.285],
          [offset + 0.111, 0.234],
        ]);
        for (let s = from + 0.63; s < to - 0.33; s += 2.5 + 0.12 * Math.sin(point(s).m * 0.45))
          brackets.push({ sample: point(s), side });
      };
      // Phase the intentional cover breaks in chain metres, independent of mapped way breaks.
      const interval = 22.7,
        chainLo = point(low).m,
        chainHi = point(high).m;
      let from = low;
      const breaks: [number, number][] = [];
      for (
        let k = Math.floor(Math.min(chainLo, chainHi) / interval);
        k <= Math.ceil(Math.max(chainLo, chainHi) / interval);
        k++
      ) {
        const m = k * interval + 3.2 * Math.sin(k * 91.7);
        const a = curve.station((m - 0.27 - curve.origin) * curve.sense);
        const b = curve.station((m + 0.27 - curve.origin) * curve.sense);
        if (Math.max(a, b) > low && Math.min(a, b) < high)
          breaks.push([Math.min(a, b), Math.max(a, b)]);
      }
      for (const [a, b] of breaks.sort((a, b) => a[0] - b[0])) {
        attach(from, Math.min(high, a));
        from = Math.max(from, b);
      }
      attach(from, high);
    };
    let start = 0;
    for (const crossing of crossings.sort((a, b) => a - b)) {
      draw(start, crossing - 6);
      start = Math.max(start, crossing + 6);
    }
    draw(start, t.lengthM);
  }
  // The four turnouts share a bed between the main lines. Below both shoulders
  // and the branch bed, this joins the formation without coplanar overlap.
  const links = tracks.filter(isCrossover);
  if (links.length) {
    const west = Math.min(...links.flatMap((t) => t.line.map((p) => p.x))) - 6;
    const east = Math.max(...links.flatMap((t) => t.line.map((p) => p.x))) + 6;
    const groundLines = tracks.filter((t) => !isCrossover(t) && rail.grades[t.idx] === 'ground');
    const atX = (t: Track, x: number) => {
      let lo = 0,
        hi = t.lengthM;
      const forward = t.line.at(-1)!.x > t.line[0]!.x;
      for (let i = 0; i < 15; i++) {
        const mid = (lo + hi) / 2;
        if (curves.get(t.idx)!.at(mid).p.x < x === forward) lo = mid;
        else hi = mid;
      }
      return at(t, (lo + hi) / 2);
    };
    let previous: [Sample, Sample] | undefined;
    for (const x of stations(west, east, 0.8)) {
      const matches = groundLines
        .filter(
          (t) =>
            x >= Math.min(t.line[0]!.x, t.line.at(-1)!.x) &&
            x < Math.max(t.line[0]!.x, t.line.at(-1)!.x),
        )
        .map((t) => atX(t, x))
        .sort((a, b) => a.p.y - b.p.y);
      if (matches.length !== 2) {
        previous = undefined;
        continue;
      }
      const [south, north] = matches as [Sample, Sample];
      const mid = (south.p.y + north.p.y) * 0.5;
      const fade = Math.min(1, (x - west) / 6, (east - x) / 6);
      const half = Math.max(0, (north.p.y - south.p.y) * 0.5 - 1.15) * fade;
      const fill: [Sample, Sample] = [
        { ...south, p: { x, y: mid - half } },
        { ...north, p: { x, y: mid + half } },
      ];
      if (previous) bed.bridge(previous, fill);
      previous = fill;
    }
    for (const t of links)
      for (const sign of [1, -1]) {
        const toe = sign > 0 ? 0 : t.lengthM;
        for (const s of [1.55, 2.22]) {
          const centre = toe + sign * s;
          fittingsSteel.add(
            [at(t, centre - 0.045), at(t, centre + 0.045)],
            [
              [-1.03, 0.172],
              [-1.03, 0.205],
              [1.05, 0.205],
              [1.05, 0.172],
            ],
          );
        }
      }
  }
  const restorePaint = hideOldTrack(parent, tracks, gaps);
  for (const f of frogs) {
    for (const [t, s, z] of [
      [f.stock, f.stockS, f.stockZ],
      [f.branch, f.branchS, f.branchZ],
    ] as const) {
      // Short check rails on the opposite rail and tapered manganese wing rails at the frog.
      const guard = -z + Math.sign(z) * 0.12;
      const wing = z - Math.sign(z) * 0.12;
      for (const [offset, extent] of [
        [guard, 2.05],
        [wing, 1.3],
      ] as const) {
        const run = stations(Math.max(0, s - extent), Math.min(t.lengthM, s + extent), 0.22).map(
          (d) => {
            const pose = at(t, d);
            const taper = Math.max(0, Math.abs(d - s) / extent - 0.64);
            const p = offsetAt(pose, -Math.sign(z) * taper * 0.22);
            return { ...pose, p };
          },
        );
        fittingsSteel.add(run, [
          [offset - 0.025, 0.181],
          [offset - 0.023, 0.237],
          [offset + 0.023, 0.237],
          [offset + 0.025, 0.181],
        ]);
      }
    }
  }
  const group = new Group();
  group.name = 'intro-track';

  const polish = new MeshPhongMaterial({
    color: 0xc0c3c2,
    specular: 0xf1f5ff,
    shininess: 30,
    side: DoubleSide,
    emissive: 0xa1a6ab,
  });
  const shroud = new MeshLambertMaterial({
    color: 0xb7b4ab,
    emissive: 0x98968a,
    side: DoubleSide,
  });
  const concrete = new MeshLambertMaterial({ vertexColors: true });
  concrete.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'varying vec3 vTrackPos;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvTrackPos=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xyz;',
      );
    shader.fragmentShader =
      'varying vec3 vTrackPos;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
       float footprint=length(fwidth(vTrackPos));
       diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.051,0.052,0.055),smoothstep(0.19,0.50,footprint));`,
      );
  };
  concrete.customProgramCacheKey = () => 'intro-track-concrete';
  const materials = [
    trackMaterial('ballast', 0x45454a),
    new MeshLambertMaterial({ color: 0x79594c, side: DoubleSide }),
    polish,
    new MeshLambertMaterial({ color: 0x5b5552, side: DoubleSide }),
    shroud,
    concrete,
    trackMaterial('cess', 0x898681),
    new MeshLambertMaterial({ color: 0xc1b9a8, side: DoubleSide }),
    trackMaterial('tray', 0x96918a),
  ];
  [bed, web, head, power, cover].forEach((strip, i) => group.add(strip.mesh(materials[i]!)));
  [cess, kerbs, tray].forEach((strip, i) => group.add(strip.mesh(materials[6 + i]!)));
  group.add(fittingsSteel.mesh(materials[1]!));
  // Skylight glints off polished steel even when the low sun misses the top of the head.
  group.children[2]!.onBeforeRender = () => {
    polish.emissiveIntensity = 0.54 * daylight();
  };
  group.children[4]!.onBeforeRender = () => {
    shroud.emissiveIntensity = 0.27 * daylight();
  };
  const [sleeperGeometry, bracketGeometry] = fittings();
  const sleeper = new InstancedMesh(sleeperGeometry!, materials[5]!, ties.length);
  const insulator = new InstancedMesh(bracketGeometry!, materials[5]!, brackets.length);
  const transform = new Object3D(),
    colour = new Color(),
    random = createRandom(745);
  ties.forEach(({ sample, width }, i) => {
    transform.rotation.y = -sample.bearing;
    const wear = 0.5 + 0.25 * Math.sin(sample.m * 0.089) + 0.13 * Math.sin(sample.m * 0.71);
    transform.position.set(sample.p.x, sample.y + random.uniform(-0.013, 0.004), sample.p.y);
    transform.scale.set(random.uniform(0.88, 1.12), 1, width * random.uniform(0.94, 1.07));
    transform.updateMatrix();
    sleeper.setMatrixAt(i, transform.matrix);
    const tone =
      random.next() < 0.045
        ? random.uniform(0.99, 1.19)
        : random.uniform(0.63, 1.04) * (0.87 + 0.21 * wear);
    sleeper.setColorAt(
      i,
      colour.setRGB(tone * random.uniform(0.92, 1.1), tone, tone * random.uniform(0.88, 1.09)),
    );
  });
  transform.scale.setScalar(1);
  brackets.forEach(({ sample, side }, i) => {
    transform.rotation.y = -sample.bearing + (side < 0 ? Math.PI : 0);
    transform.position.set(
      sample.p.x - side * 1.32 * Math.sin(sample.bearing),
      sample.y,
      sample.p.y + side * 1.32 * Math.cos(sample.bearing),
    );
    transform.updateMatrix();
    insulator.setMatrixAt(i, transform.matrix);
  });
  sleeper.receiveShadow = insulator.receiveShadow = true;
  group.add(sleeper, insulator);
  // The app's rolling-stock origin is at the wheel tread. Lift the visual pose onto the
  // new railhead and ease the lift out near a plain app-rendered section or a road crossing.
  const elevation = trains?.elevation,
    update = trains?.update;
  if (trains && update) {
    const align = <T extends TrainTrackPose>(p: T): T => {
      const curve = curves.get(p.track);
      if (!curve) return p;
      const t = graph.tracks[p.track]!;
      const recorded = pointAtDistance(t.line, t.cumulative, p.trackM);
      const at = curve.at(p.trackM).p;
      return { ...p, x: p.x + at.x - recorded.x, y: p.y + at.y - recorded.y };
    };
    trains.update = function (poses, below, selected) {
      update.call(
        this,
        poses.map((train) => ({
          ...train,
          cars: train.cars.map((car) => {
            const front = align(car.front),
              rear = align(car.rear),
              centre = align(car);
            const base = Math.atan2(car.front.y - car.rear.y, car.front.x - car.rear.x);
            const heading = car.heading + Math.atan2(front.y - rear.y, front.x - rear.x) - base;
            return { ...centre, front, rear, heading };
          }),
        })),
        below,
        selected,
      );
    };
  }
  if (trains && elevation) {
    trains.elevation = function (pose) {
      const base = elevation.call(this, pose);
      if (!detailed.has(pose.track)) return base;
      const t = graph.tracks[pose.track]!;
      const joined = curves.get(t.idx)!.joined;
      let clearance = Math.min(
        joined[0] ? Infinity : pose.trackM,
        joined[1] ? Infinity : t.lengthM - pose.trackM,
        ...gaps.get(t.idx)!.map((s) => Math.max(0, Math.abs(s - pose.trackM) - 6)),
      );
      clearance = Math.max(0, Math.min(1, clearance / 10));
      return base + railHeadM * clearance * clearance * (3 - 2 * clearance);
    };
  }
  parent.add(group);
  return () => {
    restorePaint();
    if (trains && elevation) trains.elevation = elevation;
    if (trains && update) trains.update = update;
    group.removeFromParent();
    for (const mesh of group.children as Mesh[]) mesh.geometry.dispose();
    materials.forEach((m) => m.dispose());
  };
}
