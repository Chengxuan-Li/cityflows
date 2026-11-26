import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { style } from '../../src/render/style';
import { VehicleDetailView } from '../../src/render3d/vehicle-detail';
import {
  buildVehicleModel,
  vehicleModelIndex,
  vehicleModelNames,
} from '../../src/render3d/vehicle-models';

describe('TASK-335 road vehicle models', () => {
  it.each(vehicleModelNames.map((name, i) => ({ name, i })))(
    '$name fits its class and triangle budget',
    ({ i }) => {
      const dimensions =
        style.vehicleClasses[(['car', 'car', 'car', 'van', 'truck', 'bus'] as const)[i]!];
      const model = buildVehicleModel(i).scale(
        dimensions.lengthM,
        dimensions.heightM,
        dimensions.widthM,
      );
      model.computeBoundingBox();
      const bounds = model.boundingBox!;
      const size = bounds.getSize(new Vector3());
      for (const [actual, expected] of [
        [size.x, dimensions.lengthM],
        [size.y, dimensions.heightM],
        [size.z, dimensions.widthM],
      ] as const) {
        expect(Math.abs(actual / expected - 1)).toBeLessThanOrEqual(0.02);
      }
      expect(bounds.max.x).toBe(0);
      expect(bounds.min.y).toBe(0);
      const triangles = model.getAttribute('position').count / 3;
      expect(triangles).toBeGreaterThanOrEqual(150);
      expect(triangles).toBeLessThanOrEqual(400);
      const normals = model.getAttribute('normal');
      for (let j = 0; j < normals.count; j += 3)
        expect(Math.hypot(normals.getX(j), normals.getY(j), normals.getZ(j))).toBeCloseTo(1);
    },
  );

  it('selects the same car across presentation order and preserves the other classes', () => {
    const ids = Array.from({ length: 100 }, (_, i) => i + 1);
    const models = ids.map((id) => vehicleModelIndex(0, id));
    expect(new Set(models)).toEqual(new Set([0, 1, 2]));
    const reversed = ids.reverse().map((id) => vehicleModelIndex(0, id));
    expect(reversed).toEqual([...models].reverse());
    for (const id of [1, 42, 65537, 0xffff_ffff])
      expect([1, 2, 3].map((vclass) => vehicleModelIndex(vclass, id))).toEqual([3, 4, 5]);
  });

  it('gives the sedan a boot, the hatchback a steep short tail and the SUV upright pillars', () => {
    const rearGlass = (model: number) => {
      const geometry = buildVehicleModel(model).scale(4.5, 1.5, 1.8);
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      for (let i = 0; i < position.count; i += 3) {
        const ys = [position.getY(i), position.getY(i + 1), position.getY(i + 2)];
        if (normal.getX(i) < -0.4 && Math.max(...ys) === 1.5 && Math.min(...ys) < 1.4) {
          const xs = [position.getX(i), position.getX(i + 1), position.getX(i + 2)];
          geometry.dispose();
          return {
            angle: (Math.atan2(-normal.getX(i), Math.abs(normal.getY(i))) * 180) / Math.PI,
            deck: Math.min(...xs) + 4.5,
            roofSetback: Math.max(...xs) + 4.5,
          };
        }
      }
      throw new Error('Missing rear glass face');
    };
    const sedan = rearGlass(0);
    const hatchback = rearGlass(1);
    const suv = rearGlass(2);
    expect(sedan.deck).toBeGreaterThan(1.05);
    expect(hatchback.angle).toBeGreaterThan(57);
    expect(hatchback.angle).toBeLessThan(63);
    expect(hatchback.roofSetback).toBeGreaterThan(0.75);
    expect(suv.angle).toBeGreaterThan(78);
  });

  it('uses models at street depth, boxes farther away and culls off-camera bodies', () => {
    const camera = new PerspectiveCamera(45, 1, 0.2, 5000);
    const view = new VehicleDetailView();
    const pose = new Matrix4().makeScale(4.5, 1.5, 1.8);
    camera.updateMatrixWorld();
    view.update(camera, 2, 60);
    expect(view.active).toBe(false);
    expect(view.update(camera, 8, 60)).toBe(true);
    expect(view.level(pose.setPosition(0, 0, -60), false)).toBe(1);
    expect(view.level(pose.setPosition(0, 0, -100), true)).toBe(0);
    expect(view.level(pose.setPosition(500, 0, -60), false)).toBe(-1);
    expect(view.update(camera, 8, 60)).toBe(false);
  });
});
