import { expect, test } from 'vitest';
import { orderedLayers } from '../../src/render/scene';

test('stacks unique grades from lowest to highest even when encountered out of order', () => {
  expect(orderedLayers([0, 1, -1, 1, -10, 2])).toEqual([-10, -1, 0, 1, 2]);
});

test('keeps a base grade available for ground-level overlays', () => {
  expect(orderedLayers([2])).toEqual([0, 2]);
});
