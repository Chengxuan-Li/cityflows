import { expect, test } from 'vitest';
import { osmLayer } from '../../src/importers/osm/roads';
import { orderedLayers } from '../../src/render/scene';

test.each([
  [{ bridge: 'yes' }, 1],
  [{ bridge: 'viaduct' }, 1],
  [{ bridge: 'no' }, 0],
  [{ tunnel: 'yes' }, -1],
  [{ covered: 'yes' }, -1],
  [{ bridge: 'yes', layer: '2' }, 2],
  [{ tunnel: 'yes', layer: '-2' }, -2],
  [{}, 0],
])('way tags %o give layer %i', (tags, layer) => {
  expect(osmLayer(tags)).toBe(layer);
});

test('a non-integer layer tag is unsupported rather than guessed', () => {
  expect(osmLayer({ layer: '1;2' })).toBeUndefined();
  expect(osmLayer({ layer: 'top' })).toBeUndefined();
});

test('grades draw from the lowest layer up and always include ground', () => {
  expect(orderedLayers([0, 1, -1, 1, 0])).toEqual([-1, 0, 1]);
  expect(orderedLayers([2])).toEqual([0, 2]);
  expect(orderedLayers([])).toEqual([0]);
});
