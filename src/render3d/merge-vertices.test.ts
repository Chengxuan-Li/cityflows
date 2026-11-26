import { BufferGeometry, Float32BufferAttribute } from 'three';
import { mergeVertices as threeMergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, test } from 'vitest';
import { mergeVertices } from './merge-vertices';

// TASK-357: the 3D build's mergeVertices keeps three's result exactly.
describe('mergeVertices', () => {
  test('merges as three does: same kept vertices, attributes and index', () => {
    let seed = 7;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    // Corners on a coarse grid repeat, some within and some just beyond the tolerance.
    const corner = () => [
      Math.round(random() * 40) * 2.5 + (random() < 0.3 ? 3e-5 : random() < 0.1 ? 2e-4 : 0),
      Math.round(random() * 4) * 0.1,
      -Math.round(random() * 40) * 2.5,
    ];
    const positions: number[] = [],
      colors: number[] = [];
    for (let i = 0; i < 6000; i++) {
      positions.push(...corner());
      colors.push(...(random() < 0.5 ? [1, 1, 1] : [0.5, 0.25, 0]));
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const expected = threeMergeVertices(geometry),
      actual = mergeVertices(geometry);
    expect(expected.getIndex()!.count).toBe(6000);
    expect(expected.getAttribute('position').count).toBeLessThan(6000);
    expect(Array.from(actual.getIndex()!.array)).toEqual(Array.from(expected.getIndex()!.array));
    expect(actual.getIndex()!.array.constructor).toBe(expected.getIndex()!.array.constructor);
    for (const name of ['position', 'color', 'normal'])
      expect(Array.from(actual.getAttribute(name).array)).toEqual(
        Array.from(expected.getAttribute(name).array),
      );
  });
});
