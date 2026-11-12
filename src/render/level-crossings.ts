import type { Vec2 } from '../geo/vec2';
import type { LevelCrossing } from '../network/level-crossings';

export const crossingColors = {
  post: 0x68716b,
  red: 0xb84c46,
  white: 0xf5f1df,
  dark: 0x343b38,
  lamp: 0x8f3e38,
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
/** Both views consume these exact metres, headings and equipment dimensions. Gates stand open;
 * the visual delivery does not claim a train-protection state. */
export function crossingDrawings(facilities: readonly LevelCrossing[]): CrossingDrawing[] {
  return facilities.map((f) => {
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
      ) => drawing.parts.push({ ...pos, heading, length, width, bottom, height, color, roll });
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
            f.kind === 'tram' ? 0.32 : 0.22,
            2.03,
            f.kind === 'tram' ? 0.07 : 0.2,
            f.kind === 'tram' ? crossingColors.tram : crossingColors.lamp,
          );
        }
      }
      if (a.bell) add(a.post, 0.35, 0.35, 3.25, 0.18, crossingColors.dark);
      if (a.barrier) {
        const gate = { x: a.post.x + c * 0.8, y: a.post.y + s * 0.8 };
        add(gate, 0.65, 0.65, 0, 0.9, crossingColors.post);
        // Upright striped arm: no closure is implied until train interaction is implemented.
        const length = Math.min(6, 2 * a.halfWidthM + 0.8);
        for (let h = 0; h < length; h += 0.5)
          add(
            gate,
            0.16,
            0.22,
            0.9 + h,
            Math.min(0.5, length - h),
            Math.round(h * 2) % 2 ? crossingColors.red : crossingColors.white,
          );
      }
    }
    return drawing;
  });
}
