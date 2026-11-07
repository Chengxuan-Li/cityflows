import type { Graphics } from 'pixi.js';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CRoad } from '../network';
import { drawRoad } from '../render/layers/roads';
import { drawTransitions } from '../render/layers/transitions';
import { style } from '../render/style';
import type { CityGeometry } from '../render/types';

/** Read the existing drawing commands, like the junction audit does. Offsets, clipping,
 * dash phase and taper geometry remain owned by the 2D layers (TASK-095). */
export function roadMarkings(city: CompiledCity, road: CRoad, source: CityGeometry): Vec2[][] {
  const lines: Vec2[][] = [];
  let paths: Vec2[][] = [];
  const pen = {
    poly(points: Vec2[] | number[]) {
      paths.push(
        typeof points[0] === 'number'
          ? Array.from({ length: points.length / 2 }, (_, i) => ({
              x: points[2 * i] as number,
              y: points[2 * i + 1] as number,
            }))
          : (points as Vec2[]),
      );
      return this;
    },
    moveTo(x: number, y: number) {
      paths.push([{ x, y }]);
      return this;
    },
    lineTo(x: number, y: number) {
      paths.at(-1)!.push({ x, y });
      return this;
    },
    fill() {
      paths = [];
      return this;
    },
    stroke({ width }: { width: number }) {
      if (width === style.dividerWidthM) lines.push(...paths.filter((p) => p.length > 1));
      paths = [];
      return this;
    },
  };
  const graphics = pen as unknown as Graphics;
  drawRoad(graphics, graphics, city, road, false, graphics, source);
  drawTransitions(graphics, graphics, city, road);
  return lines;
}
