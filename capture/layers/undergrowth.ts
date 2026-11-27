import Flatbush from 'flatbush';
import { CanvasTexture, Group, Vector4 } from 'three';
import {
  boxOf,
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  preparePolygon,
} from '../../src/geo/polyline';
import { createRandom } from '../../src/geo/random';
import type { Vec2 } from '../../src/geo/vec2';
import type { LightPoint } from '../../src/render3d/lights';
import { lowPlantMeshes, type LowPlant, type PlantKind } from './low-plants';
import { segmentClearance, type RailVergeRun } from './fences';

interface Plot {
  class?: string;
  sub?: string;
  rings: Vec2[][];
}
export interface PlantingRun {
  line: readonly Vec2[];
  side: number;
  offset: number;
  width: number;
  height: number;
}
interface Site {
  plots: Plot[];
  noPlantPolygons: Vec2[][];
  fences: readonly RailVergeRun[];
  tracks: Parameters<typeof segmentClearance>[0];
  runs: PlantingRun[];
  lamps: LightPoint[];
  blocked(p: Vec2): boolean;
  hidden?(p: Vec2): boolean;
  heightAt(x: number, y: number): number;
  artificial(): number;
  /** Where plants grow and the ground cover map lies: [minX, minY, maxX, maxY]. */
  area: readonly [number, number, number, number];
}

/** Plants layer: hedges, scrub and long grass along the rail fences, in the margins of greens and
 * along the location's own planting runs, with a ground-cover map the surfaces layer reads, all
 * inside `area` (around the shot's focus by default). `fenceLines` names the railways whose
 * fences take verge planting (every at-grade line when empty). */
export const params = {
  area: null as [number, number, number, number] | null,
  fenceLines: [] as string[],
};
const greens = {
  hedge: [0x6b8b55, 0x728c50, 0x81975d, 0x68794b, 0x8c9b61, 0x7a8d52, 0x958459],
  scrub: [0x647e54, 0x77944d, 0x859759, 0x81905f, 0x8a965d, 0x9b925b, 0xa18a55],
  grass: [0x809653, 0x8a9a59, 0x788c54, 0x98a26a, 0x9da25e],
};
const rough = (plot: Plot) =>
  ['railway', 'construction', 'brownfield', 'scrub', 'meadow'].includes(plot.sub ?? '');
const green = (plot: Plot) =>
  plot.class === 'green' &&
  ['grass', 'park', 'scrub', 'meadow', 'garden', 'grassland'].includes(plot.sub ?? '');
const close = (ring: readonly Vec2[]) => [...ring, ring[0]!];

function polygonIndex(rings: readonly Vec2[][], bounds: Vector4) {
  const items = rings
    .filter((r) => r.length >= 3)
    .map((ring) => ({ ring, box: boxOf(ring) }))
    .filter(
      ({ box }) =>
        box.maxX > bounds.x &&
        box.minX < bounds.x + bounds.z &&
        box.maxY > bounds.y &&
        box.minY < bounds.y + bounds.w,
    );
  const index = new Flatbush(Math.max(1, items.length));
  for (const { box } of items) index.add(box.minX, box.minY, box.maxX, box.maxY);
  if (!items.length) index.add(0, 0, 0, 0);
  index.finish();
  const tests = items.map(({ ring }) => preparePolygon(close(ring)));
  return (p: Vec2) => index.search(p.x, p.y, p.x, p.y).some((i) => tests[i]?.(p));
}

export function undergrowth(site: Site) {
  const [x0, y0, x1, y1] = site.area;
  const bounds = new Vector4(x0, y0, x1 - x0, y1 - y0);
  const inFrame = (p: Vec2) =>
    p.x > bounds.x + 3 &&
    p.x < bounds.x + bounds.z - 3 &&
    p.y > bounds.y + 3 &&
    p.y < bounds.y + bounds.w - 3;
  const canvas = Object.assign(document.createElement('canvas'), { width: 2048, height: 768 });
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / bounds.z,
    sy = canvas.height / bounds.w;
  ctx.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy);
  ctx.globalCompositeOperation = 'lighter';
  const brushes = ['47,0,0', '0,146,0', '0,0,104'].map((rgb) => {
    const brush = Object.assign(document.createElement('canvas'), { width: 48, height: 48 });
    const g = brush.getContext('2d')!;
    const fade = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    fade.addColorStop(0, `rgb(${rgb})`);
    fade.addColorStop(0.35, `rgba(${rgb},0.8)`);
    fade.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = fade;
    g.fillRect(0, 0, 48, 48);
    return brush;
  });
  function stamp(p: Vec2, angle: number, width: number, length: number, channel: number) {
    if (site.hidden?.(p)) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.drawImage(brushes[channel]!, -length / 2, -width / 2, length, width);
    ctx.restore();
  }
  for (const plot of site.plots) {
    if (!rough(plot) || !plot.rings[0]) continue;
    const box = boxOf(plot.rings[0]);
    if (
      box.maxX < bounds.x ||
      box.minX > bounds.x + bounds.z ||
      box.maxY < bounds.y ||
      box.minY > bounds.y + bounds.w
    )
      continue;
    ctx.fillStyle = 'rgb(147,0,0)';
    ctx.beginPath();
    for (const ring of plot.rings) {
      ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }

  const hard = polygonIndex(
    [
      ...site.noPlantPolygons,
      ...site.plots
        .filter(
          (p) =>
            p.class === 'building' ||
            p.class === 'parking' ||
            p.class === 'water' ||
            p.sub === 'pitch',
        )
        .flatMap((p) => p.rings.slice(0, 1)),
    ],
    bounds,
  );
  const trackClear = segmentClearance(site.tracks);
  const lampIndex = new Flatbush(Math.max(1, site.lamps.length));
  for (const l of site.lamps)
    lampIndex.add(l.x - l.radiusM, l.y - l.radiusM, l.x + l.radiusM, l.y + l.radiusM);
  if (!site.lamps.length) lampIndex.add(0, 0, 0, 0);
  lampIndex.finish();
  const lampAt = (p: Vec2) => {
    let light = 0;
    for (const i of lampIndex.search(p.x, p.y, p.x, p.y)) {
      const l = site.lamps[i];
      if (l)
        light = Math.max(
          light,
          Math.max(0, 1 - Math.hypot(l.x - p.x, l.y - p.y) / l.radiusM) ** 1.4,
        );
    }
    return light;
  };

  const plants: Record<PlantKind, LowPlant[]> = { hedge: [], scrub: [], grass: [] };
  const random = createRandom(7331);
  const shift = (p: Vec2, angle: number, along: number, out: number) => ({
    x: p.x + Math.cos(angle) * along - Math.sin(angle) * out,
    y: p.y + Math.sin(angle) * along + Math.cos(angle) * out,
  });
  const open = (p: Vec2) => inFrame(p) && trackClear(p, 6) > 3.43 && !site.blocked(p) && !hard(p);
  function plant(
    kind: PlantKind,
    p: Vec2,
    heading: number,
    length: number,
    width: number,
    height: number,
  ) {
    // Test the swept footprint, including the sides of the widest lobe near corners.
    if (!open(p)) return false;
    for (const [along, out] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
      [0, -0.55],
      [0, 0.55],
    ] as const)
      if (!open(shift(p, heading, along * length, out * width))) return false;
    const plant = {
      p,
      heading,
      length,
      width,
      height,
      colour: random.pick(greens[kind]),
      form: random.next() < 0.5 ? 0 : 1,
      lamp: lampAt(p),
    };
    if (!site.hidden?.(p)) plants[kind].push(plant);
    stamp(p, heading, width * (kind === 'grass' ? 1.48 : 1.3), length * 1.43, 2);
    stamp(p, heading, width * 1.64, length * 1.62, 1);
    return true;
  }

  function band({ line, side, offset, width, height }: PlantingRun, railway = false) {
    const chain = cumulativeLengths(line),
      total = chain.at(-1)!;
    if (total < 3) return;
    const phase = random.uniform(0, 6.283);
    for (let s = random.uniform(0.18, 1.16); s < total - 0.12; s += random.uniform(1.32, 2.29)) {
      const axis = pointAtDistance(line, chain, s);
      if (!inFrame(axis)) continue;
      const angle = headingAtDistance(line, chain, s);
      // On unwalled portions a mapped parallel or branch can face the fence; keep
      // the planting on the outside of the whole formation.
      if (railway && trackClear(shift(axis, angle, 0, side * 5.5), 6) < 3.25) continue;
      const swell =
        0.5 +
        0.29 * Math.sin(axis.x * 0.107 + axis.y * 0.035 + phase) +
        0.21 * Math.sin(axis.x * 0.027 - axis.y * 0.18 + 3.38);
      const opening = swell < 0.14 && random.next() < 0.73;
      const at = (out: number, along = 0) => shift(axis, angle, along, side * out);
      const rootOffset = offset + random.uniform(-0.21, 0.3);
      const skirt = at(rootOffset);
      const widthM = width * (0.85 + 0.21 * swell);
      // Extend the matte green verge under the broken shrub silhouette and its
      // longer grass while leaving hard surfaces clear at the sides.
      if (
        open(skirt) &&
        open(at(rootOffset - widthM * 0.43)) &&
        open(at(rootOffset + widthM * 0.43))
      )
        stamp(skirt, angle, widthM * 1.04, 3.6, 1);
      let rooted = false;
      if (!opening) {
        const kind: PlantKind = random.next() < 0.72 ? 'hedge' : 'scrub';
        const crown = width * (0.75 + 0.42 * swell + random.uniform(-0.1, 0.14));
        const rise = Math.min(2.5, height * (0.63 + 0.5 * swell + random.uniform(-0.08, 0.18)));
        const reach = random.uniform(2.25, 3.55);
        const yaw = angle + random.uniform(-0.11, 0.11);
        for (const move of [0, -0.55, 0.53, -0.91, 0.87]) {
          const p = at(rootOffset + move);
          const fit = Math.abs(move) > 0.7 ? 0.62 : Math.abs(move) > 0.01 ? 0.79 : 1;
          if (!plant(kind, p, yaw, reach * fit, crown * fit, rise * (0.82 + 0.18 * fit))) continue;
          rooted = true;
          // A lower trailing mound exposes the woody undersides and joins adjacent crowns.
          if (random.next() < 0.49)
            plant(
              'scrub',
              at(rootOffset + move + random.uniform(0.61, 1.13), random.uniform(-0.82, 0.65)),
              angle,
              random.uniform(1.1, 2.0),
              crown * 0.67,
              rise * 0.54,
            );
          break;
        }
      }
      for (const extra of [0.12, 0.94, -0.72]) {
        const p = at(rootOffset + extra, random.uniform(-0.66, 0.69));
        if (random.next() > (rooted ? 0.88 : 0.72)) continue;
        plant(
          'grass',
          p,
          angle + random.uniform(-0.65, 0.65),
          random.uniform(0.7, 1.31),
          random.uniform(0.5, 0.99),
          random.uniform(0.32, 0.68),
        );
      }
    }
  }

  for (const { points, vergeSide } of site.fences)
    band({ line: points, side: vergeSide, offset: 1.32, width: 2.0, height: 2.08 }, true);
  for (const run of site.runs) band(run);

  // Plant selected open-green margins, with the middle kept open for lawns and play.
  for (const plot of site.plots) {
    if (!green(plot)) continue;
    const ring = plot.rings[0]!,
      inside = preparePolygon(close(ring));
    if (!ring.some(inFrame)) continue;
    const edges = ring
      .map((p, i) => ({ p, q: ring[(i + 1) % ring.length]! }))
      .map((edge) => ({ ...edge, length: Math.hypot(edge.p.x - edge.q.x, edge.p.y - edge.q.y) }))
      .filter(({ length }) => length > 7 && length < 96)
      .sort((a, b) => b.length - a.length);
    for (const { p, q, length } of edges.slice(0, plot.sub === 'scrub' ? 2 : 1)) {
      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      const side = inside(shift(p, angle, length / 2, 0.85)) ? 1 : -1;
      const line = [
        shift(p, angle, length * 0.08, 0),
        shift(p, angle, length * (0.71 + random.next() * 0.22), 0),
      ];
      band({ line, side, offset: 1.45, width: 2.55, height: plot.sub === 'scrub' ? 1.71 : 1.39 });
    }
  }

  const group = new Group();
  group.name = 'capture-undergrowth';
  const release = lowPlantMeshes(group, plants, site.heightAt, site.artificial);
  const map = new CanvasTexture(canvas);
  map.flipY = false;
  map.anisotropy = 4;
  return {
    group,
    map,
    bounds,
    dispose: () => {
      group.removeFromParent();
      release();
      map.dispose();
    },
  };
}
