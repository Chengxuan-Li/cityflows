import type { Graphics } from 'pixi.js';
import { expect, test } from 'vitest';
import { drawContext } from '../../src/render/layers/context';

test('T44 building courtyards stay open and surroundings do not receive pointer events', () => {
  const layer = drawContext([
    {
      kind: 'area',
      class: 'building',
      rings: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
          { x: 0, y: 0 },
        ],
        [
          { x: 5, y: 5 },
          { x: 15, y: 5 },
          { x: 15, y: 15 },
          { x: 5, y: 15 },
          { x: 5, y: 5 },
        ],
      ],
    },
  ]);
  const shapes = layer.container.children[0] as Graphics;
  expect(shapes.containsPoint({ x: 2, y: 2 })).toBe(true);
  expect(shapes.containsPoint({ x: 10, y: 10 })).toBe(false);
  expect(layer.container.eventMode).toBe('none');
  layer.container.destroy({ children: true, context: true });
});

test('T44 rail has cross ties, tram is thinner, and waterways retain tagged width', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ];
  const rail = drawContext([{ kind: 'line', class: 'rail', line }]);
  const tram = drawContext([{ kind: 'line', class: 'tram', line }]);
  const water = drawContext([{ kind: 'line', class: 'waterway', line, widthM: 8 }]);
  const height = (layer: typeof rail) => layer.container.children[0]!.getLocalBounds().height;
  expect(rail.ties.getLocalBounds().height).toBeGreaterThan(2.6);
  expect(tram.ties.getLocalBounds().height).toBe(0);
  expect(height(tram)).toBeLessThan(height(rail));
  expect(height(water)).toBeCloseTo(8);
  for (const layer of [rail, tram, water])
    layer.container.destroy({ children: true, context: true });
});

test('T44 multiple courtyards do not cut the underlying land-use fill', () => {
  const rectangle = (a: number, b: number) => [
    { x: a, y: a },
    { x: b, y: a },
    { x: b, y: b },
    { x: a, y: b },
    { x: a, y: a },
  ];
  const layer = drawContext([
    { kind: 'area', class: 'landuse', rings: [rectangle(0, 100)] },
    {
      kind: 'area',
      class: 'building',
      rings: [rectangle(20, 80), rectangle(30, 40), rectangle(60, 70)],
    },
  ]);
  const shapes = layer.container.children[0] as Graphics;
  expect(shapes.containsPoint({ x: 35, y: 35 })).toBe(true);
  expect(shapes.containsPoint({ x: 65, y: 65 })).toBe(true);
  layer.container.destroy({ children: true, context: true });
});
