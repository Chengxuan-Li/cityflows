import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { fixture } from './fixtures';

test('reimporting the same extract preserves the complete city and its ids', () => {
  const { xml, options } = fixture('downtown');
  const first = importOsm(xml, options);
  expect(first.ok).toBe(true);
  expect(importOsm(xml, options)).toEqual(first);
});
