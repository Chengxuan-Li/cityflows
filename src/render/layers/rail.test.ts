import { Graphics } from 'pixi.js';
import { expect, it } from 'vitest';
import { drawRail } from './rail';

it('submits same-style rail polygons together in draw order', () => {
  const graphics = new Graphics();
  const polygons = [
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ],
    [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
  ];
  drawRail(graphics, { layer: 0, polygons, color: 0xabcd12, alpha: 0.6 });
  const instructions = graphics.context.instructions;
  expect(instructions).toHaveLength(1);
  const fill = instructions[0]!;
  expect(fill.action).toBe('fill');
  if (fill.action !== 'fill') throw new Error('Expected polygon fill');
  expect(fill.data.style).toMatchObject({ color: 0xabcd12, alpha: 0.6 });
  expect(fill.data.path.shapePath.shapePrimitives.map(({ shape }) => shape)).toMatchObject([
    { points: [0, 0, 2, 0, 2, 2] },
    { points: [0, 0, 2, 2, 0, 2] },
  ]);
  graphics.destroy();
});
