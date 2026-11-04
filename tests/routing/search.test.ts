import { expect, test } from 'vitest';
import { createPathSearch } from '../../src/routing/search';

test('reused searches preserve cost/node ties and discard queued nodes between requests', () => {
  const search = createPathSearch();
  const expand = (node: number, relax: (to: number, cost: number, via?: number) => void) => {
    if (node === 0) {
      relax(3, 20);
      relax(2, 1, 2);
      relax(1, 1, 1);
    } else if (node === 1 || node === 2) relax(3, 1, node + 3);
  };
  const expected = { nodes: [0, 1, 3], via: [1, 4], costS: 2 };
  expect(search(4, 0, 3, 0, expand)).toEqual(expected);
  expect(search(4, 0, 1, 0, expand)?.nodes).toEqual([0, 1]);
  expect(search(2, 0, 1, 0, () => {})).toBeNull();
  expect(search(8, 0, 3, 0, expand)).toEqual(expected);
  expect(search(4, 0, 3, 0, expand)).toEqual(expected);
});
