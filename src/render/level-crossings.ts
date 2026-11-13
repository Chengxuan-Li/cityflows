import type { Vec2 } from '../geo/vec2';
import type { LevelCrossing } from '../network/level-crossings';
import type { RailGraph } from '../network/rail';
import { headingAtDistance, pointAtDistance } from '../geo/polyline';

export const crossingColors = {
  post: 0x68716b,
  red: 0xb84c46,
  white: 0xf5f1df,
  dark: 0x343b38,
  lamp: 0x8f3e38,
  lit: 0xff5146,
  tram: 0xf1df9b,
};
export interface CrossingPart extends Vec2 {
  heading: number;
  length: number;
  width: number;
  bottom: number;
  height: number;
  color: number;
  roll?: number;
  kind?: 'arm' | 'lamp' | 'tram-signal';
}
export interface CrossingDrawing {
  layer: number;
  parts: CrossingPart[];
  marks: { a: Vec2; b: Vec2 }[];
  crosses: { pos: Vec2; heading: number }[];
}
export function crossingCounts(facilities: readonly LevelCrossing[]) {
  const approaches = facilities.flatMap((f) => f.approaches);
  return {
    rail: facilities.filter((f) => f.kind === 'rail').length,
    tram: facilities.filter((f) => f.kind === 'tram').length,
    approaches: approaches.length,
    gates: approaches.filter((a) => a.barrier).length,
    lights: approaches.filter((a) => a.lights).length,
    bells: approaches.filter((a) => a.bell).length,
  };
}
export const noLevelCrossings = crossingCounts([]);
/** Closed tram crossings also distinguish a rail hold from permission to enter. */
export function crossingAspect(state: number, timeS: number, railReady = false) {
  return state === 0
    ? 0
    : 1 + (state - 1) * 2 + (state === 2 && railReady ? 2 : 0) + (Math.floor(timeS * 2) % 2);
}
export interface TramCrossingSignal {
  pos: Vec2;
  heading: number;
}
/** Tram-facing signals stand beside the track before its road conflict, never on internal track links. */
export function tramCrossingSignals(f: LevelCrossing, graph?: RailGraph): TramCrossingSignal[] {
  if (f.kind !== 'tram' || !graph) return [];
  return graph.tracks.flatMap((t) => {
    const from = f.nodes.includes(t.from),
      to = f.nodes.includes(t.to);
    if (
      t.kind !== 'tram' ||
      from === to ||
      (from && t.preferredDirection === 'forward') ||
      (to && t.preferredDirection === 'backward')
    )
      return [];
    const outward =
      headingAtDistance(t.line, t.cumulative, from ? 0 : t.lengthM) + (from ? 0 : Math.PI);
    const setback = Math.max(
      3,
      ...f.approaches.map(
        (a) => a.halfWidthM / Math.max(0.25, Math.abs(Math.sin(outward - a.heading))) + 3,
      ),
    );
    const s = from ? Math.min(setback, t.lengthM - 0.5) : Math.max(0.5, t.lengthM - setback);
    const p = pointAtDistance(t.line, t.cumulative, s),
      heading = headingAtDistance(t.line, t.cumulative, s) + (from ? Math.PI : 0);
    return [
      { pos: { x: p.x - Math.sin(heading) * 2.2, y: p.y + Math.cos(heading) * 2.2 }, heading },
    ];
  });
}
/** Both views consume these exact metres, headings and snapshot-controlled aspects. */
export function crossingDrawings(
  facilities: readonly LevelCrossing[],
  states?: Uint8Array,
  timeS = 0,
  railReady?: Uint8Array,
  tramSignals?: readonly (readonly TramCrossingSignal[])[],
): CrossingDrawing[] {
  return facilities.map((f, index) => {
    const state = states?.[index] ?? 0;
    const drawing: CrossingDrawing = { layer: f.layer, parts: [], marks: [], crosses: [] };
    for (const a of f.approaches) {
      const c = Math.cos(a.heading),
        s = Math.sin(a.heading),
        right = { x: -s, y: c };
      const add = (
        pos: Vec2,
        length: number,
        width: number,
        bottom: number,
        height: number,
        color: number,
        heading = a.heading,
        roll = 0,
        kind?: CrossingPart['kind'],
      ) =>
        drawing.parts.push({ ...pos, heading, length, width, bottom, height, color, roll, kind });
      add(a.post, 0.16, 0.16, 0, 3.2, crossingColors.post);
      drawing.marks.push({
        a: { x: a.pos.x - right.x * a.halfWidthM, y: a.pos.y - right.y * a.halfWidthM },
        b: { x: a.pos.x + right.x * a.halfWidthM, y: a.pos.y + right.y * a.halfWidthM },
      });
      if (f.kind === 'rail') {
        drawing.crosses.push({ pos: a.post, heading: a.heading });
        for (const roll of [-Math.PI / 4, Math.PI / 4]) {
          add(a.post, 1.4, 0.12, 2.7, 0.22, crossingColors.white, a.heading + Math.PI / 2, roll);
          for (const sign of [-1, 1]) {
            const dx = Math.cos(roll) * 0.5 * sign,
              dy = Math.sin(roll) * 0.5 * sign;
            add(
              { x: a.post.x + right.x * dx, y: a.post.y + right.y * dx },
              0.36,
              0.14,
              2.7 + dy,
              0.23,
              crossingColors.red,
              a.heading + Math.PI / 2,
              roll,
            );
          }
        }
      }
      if (a.lights) {
        add(a.post, 0.24, f.kind === 'tram' ? 0.48 : 0.85, 1.8, 0.6, crossingColors.dark);
        const count = f.kind === 'tram' ? 1 : 2;
        for (let i = 0; i < count; i++) {
          const lateral = (i - (count - 1) / 2) * 0.4;
          add(
            {
              x: a.post.x - c * 0.14 + right.x * lateral,
              y: a.post.y - s * 0.14 + right.y * lateral,
            },
            0.04,
            0.22,
            2.03,
            0.2,
            state !== 0 && (count === 1 || Math.floor(timeS * 2) % 2 === i)
              ? crossingColors.lit
              : crossingColors.lamp,
            a.heading,
            0,
            'lamp',
          );
        }
      }
      if (a.bell) add(a.post, 0.35, 0.35, 3.25, 0.18, crossingColors.dark);
      if (a.barrier) {
        const gate = { x: a.post.x + c * 0.8, y: a.post.y + s * 0.8 };
        add(gate, 0.65, 0.65, 0, 0.9, crossingColors.post);
        const length = Math.min(6, 2 * a.halfWidthM + 0.8),
          roll = state === 2 ? 0 : Math.PI / 2,
          side = Math.sign((a.post.x - a.pos.x) * right.x + (a.post.y - a.pos.y) * right.y),
          inward = { x: -right.x * side, y: -right.y * side },
          heading = Math.atan2(inward.y, inward.x);
        for (let h = 0; h < length; h += 0.5)
          add(
            {
              x: gate.x + inward.x * (h + 0.25) * Math.cos(roll),
              y: gate.y + inward.y * (h + 0.25) * Math.cos(roll),
            },
            Math.min(0.5, length - h),
            0.22,
            0.9 + (h + 0.25) * Math.sin(roll) - 0.08,
            0.16,
            Math.round(h * 2) % 2 ? crossingColors.red : crossingColors.white,
            heading,
            roll,
            'arm',
          );
      }
    }
    for (const signal of tramSignals?.[index] ?? []) {
      const ready = state === 2 && railReady?.[index] === 1;
      const add = (
        length: number,
        width: number,
        bottom: number,
        height: number,
        color: number,
        kind?: CrossingPart['kind'],
      ) =>
        drawing.parts.push({
          ...signal.pos,
          heading: signal.heading,
          length,
          width,
          bottom,
          height,
          color,
          kind,
        });
      add(0.16, 0.16, 0, 3.2, crossingColors.post);
      add(0.24, 0.52, 1.8, 0.6, crossingColors.dark);
      drawing.parts.push({
        x: signal.pos.x - Math.cos(signal.heading) * 0.14,
        y: signal.pos.y - Math.sin(signal.heading) * 0.14,
        heading: signal.heading,
        length: 0.04,
        width: ready ? 0.07 : 0.32,
        bottom: ready ? 1.9 : 2.03,
        height: ready ? 0.32 : 0.07,
        color: crossingColors.tram,
        kind: 'tram-signal',
      });
    }
    return drawing;
  });
}
