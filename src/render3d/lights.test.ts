import type { ShaderMaterial } from 'three';
import { expect, test } from 'vitest';
import { buildHalos } from './lights';

// TASK-336: three defines USE_INSTANCING_COLOR (and declares `instanceColor`) only for an
// instanced mesh whose `instanceColor` is set. A city without lamps or signals built its halos
// without one, and the halo shader failed to compile when night came on.
test('TASK-336 halos carry an instance colour even with no lights, and the shader guards it', () => {
  for (const points of [[], [{ x: 1, z: 2, y: 3, radiusM: 0.5, color: 0xff0000 }]]) {
    const halos = buildHalos(points);
    expect(halos.instanceColor).not.toBeNull();
    expect(halos.count).toBe(points.length);
    expect((halos.material as ShaderMaterial).vertexShader).toMatch(
      /#ifdef USE_INSTANCING_COLOR\s+vTint = instanceColor;/,
    );
  }
  const red = buildHalos([{ x: 0, z: 0, y: 0, radiusM: 1, color: 0xff0000 }]);
  expect([...red.instanceColor!.array.slice(0, 3)]).toEqual([1, 0, 0]);
});
