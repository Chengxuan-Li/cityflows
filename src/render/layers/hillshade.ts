import { Sprite, Texture } from 'pixi.js';
import type { City } from '../../schema/city';
import { style } from '../style';

/** Lambert hillshade, y south: light from north-west at 45 degrees. */
export function hillshadePixels(grid: NonNullable<City['terrain']>) {
  const binary = atob(grid.heights);
  const view = new DataView(Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer);
  const at = (x: number, y: number) =>
    view.getInt16(
      (Math.max(0, Math.min(grid.rows - 1, y)) * grid.cols +
        Math.max(0, Math.min(grid.cols - 1, x))) *
        2,
      true,
    ) / 10;
  const rgba = new Uint8ClampedArray(grid.cols * grid.rows * 4);
  for (let y = 0; y < grid.rows; y++)
    for (let x = 0; x < grid.cols; x++) {
      const dx =
        (at(x + 1, y) - at(x - 1, y)) / (grid.cellM * (x === 0 || x === grid.cols - 1 ? 1 : 2));
      const dy =
        (at(x, y + 1) - at(x, y - 1)) / (grid.cellM * (y === 0 || y === grid.rows - 1 ? 1 : 2));
      const light = (0.5 * dx + 0.5 * dy + Math.SQRT1_2) / Math.hypot(dx, dy, 1);
      const i = (y * grid.cols + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 90;
      rgba[i + 3] = Math.round(255 * Math.max(0, Math.SQRT1_2 - light));
    }
  return rgba;
}

export function drawHillshade(grid: NonNullable<City['terrain']>) {
  const canvas = document.createElement('canvas');
  canvas.width = grid.cols;
  canvas.height = grid.rows;
  const context = canvas.getContext('2d')!;
  context.putImageData(new ImageData(hillshadePixels(grid), grid.cols, grid.rows), 0, 0);
  const sprite = new Sprite(Texture.from(canvas));
  sprite.position.set(grid.originM.x - grid.cellM / 2, grid.originM.y - grid.cellM / 2);
  sprite.width = grid.cols * grid.cellM;
  sprite.height = grid.rows * grid.cellM;
  sprite.alpha = style.hillshadeAlpha;
  sprite.eventMode = 'none';
  return sprite;
}
