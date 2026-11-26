import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { gradeProfiles, profileHeightAt } from '../network/heights';
import type { CityGeometry } from './types';
import {
  closed,
  elevated,
  ink,
  label,
  line,
  type DebugPrimitive,
} from './debug-geometry-primitives';

const ramp = [0x274176, 0x40899c, 0xa5cdb0, 0xefcc79, 0xc26343];
function mixColor(a: number, b: number, t: number) {
  const component = (shift: number) =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (component(16) << 16) | (component(8) << 8) | component(0);
}
/** Elevations are relative to the terrain grid's datum (baseM). */
export function heightDebugColor(elevationM: number, grade = 0) {
  const t = 2 + 2 * Math.tanh(elevationM / 35);
  const lower = Math.min(3, Math.floor(t));
  const color = mixColor(ramp[lower]!, ramp[lower + 1]!, t - lower);
  return grade > 0
    ? mixColor(color, 0xff831f, 0.65)
    : grade < 0
      ? mixColor(color, 0x7044b2, 0.7)
      : color;
}

const mix = (a: Vec2, b: Vec2, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
function groundSampler(grid: CityGeometry['terrain']) {
  if (!grid) return () => 0;
  const view = new DataView(Uint8Array.from(atob(grid.heights), (c) => c.charCodeAt(0)).buffer);
  const at = (x: number, y: number) => view.getInt16((grid.cols * y + x) * 2, true) / 10;
  return (p: Vec2) => {
    const cx = Math.max(0, Math.min(grid.cols - 1, (p.x - grid.originM.x) / grid.cellM));
    const cy = Math.max(0, Math.min(grid.rows - 1, (p.y - grid.originM.y) / grid.cellM));
    const x = Math.min(grid.cols - 2, Math.floor(cx)),
      y = Math.min(grid.rows - 2, Math.floor(cy));
    return (
      ((1 - (cx - x)) * at(x, y) + (cx - x) * at(x + 1, y)) * (1 - (cy - y)) +
      ((1 - (cx - x)) * at(x, y + 1) + (cx - x) * at(x + 1, y + 1)) * (cy - y)
    );
  };
}

export function heightDebugGeometry(city: CompiledCity, source?: CityGeometry): DebugPrimitive[] {
  const out: DebugPrimitive[] = [];
  const ground = groundSampler(source?.terrain),
    profiles = gradeProfiles(city);
  const grades = new Set([...city.roads.map((r) => r.grade), ...city.nodes.map((n) => n.grade)]);
  // Draw the top deck last at a crossing even when the lower road has a higher compiled index.
  for (const grade of [...grades].sort((a, b) => a - b)) {
    for (const node of city.nodes) {
      if (node.grade !== grade || !node.outline.length) continue;
      const z = profiles.nodes[node.idx]!;
      out.push({
        ...line(
          closed(node.outline).map((p) => elevated(p, z)),
          heightDebugColor(ground(node.pos) + z, grade),
        ),
        fill: true,
      });
    }
    for (const road of city.roads) {
      if (road.grade !== grade) continue;
      const profile = profiles.roads[road.idx]!,
        ring = road.surface;
      const varying =
        !!source?.terrain || profile.fromM !== profile.deckM || profile.toM !== profile.deckM;
      const lane = city.lanes[road.lanes[0]!]!;
      let steepest = 0,
        anchor = lane.polyline[Math.floor(lane.polyline.length / 2)]!;
      let labelHeight = profile.deckM;
      if (!varying) {
        out.push({
          ...line(
            closed(ring).map((p) => elevated(p, profile.deckM)),
            heightDebugColor(profile.deckM, grade),
          ),
          fill: true,
        });
      } else {
        for (let i = 1; i < road.stations.length; i++) {
          const s0 = road.stations[i - 1]! - road.stations[0]!,
            span = road.stations[i]! - road.stations[i - 1]!;
          if (!span) continue;
          const divisions = Math.max(1, Math.ceil(span / 12));
          const left0 = ring[i - 1]!,
            left1 = ring[i]!,
            right0 = ring[ring.length - i]!,
            right1 = ring[ring.length - i - 1]!;
          let a = left0,
            b = right0,
            z0 = profileHeightAt(profile, s0),
            h0 = ground(mix(a, b, 0.5)) + z0;
          for (let j = 1; j <= divisions; j++) {
            const t = j / divisions,
              c = mix(left0, left1, t),
              d = mix(right0, right1, t);
            const z1 = profileHeightAt(profile, s0 + t * span),
              center = mix(c, d, 0.5),
              h1 = ground(center) + z1;
            const slope = (h1 - h0) / (span / divisions);
            if (Math.abs(slope) > Math.abs(steepest)) {
              steepest = slope;
              anchor = center;
              labelHeight = z1;
            }
            out.push({
              ...line(
                [
                  elevated(a, z0),
                  elevated(c, z1),
                  elevated(d, z1),
                  elevated(b, z0),
                  elevated(a, z0),
                ],
                heightDebugColor((h0 + h1) / 2, grade),
              ),
              fill: true,
            });
            a = c;
            b = d;
            z0 = z1;
            h0 = h1;
          }
        }
      }
      out.push(
        label(
          elevated(anchor, labelHeight),
          (steepest > 0 ? '+' : '') + (steepest * 100).toFixed(1) + '%',
          ink.dark,
        ),
      );
    }
  }
  return out;
}
