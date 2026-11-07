import { PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { groundBounds } from './basemap';

it('covers the finite visible ground even when the top of the view is sky', () => {
  for (const pitch of [10, 55, 85]) {
    const camera = new PerspectiveCamera(45, 1.6, 10, 10000);
    const angle = (pitch * Math.PI) / 180;
    camera.position.set(0, 1000 * Math.sin(angle), 1000 * Math.cos(angle));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const bounds = groundBounds(camera);
    expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
    for (const z of [-4000, -1000, 0, 500]) {
      const point = new Vector3(0, 0, z).project(camera);
      if (Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1) {
        expect(z).toBeGreaterThanOrEqual(bounds.minY);
        expect(z).toBeLessThanOrEqual(bounds.maxY);
      }
    }
  }
});
