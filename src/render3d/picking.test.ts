import { Group, PerspectiveCamera, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Vehicles3D } from './vehicles';
import { pickVehicle3D, vehicleScreenPoint } from './picking';

it('picks a small elevated car within the same eight-pixel tolerance as 2D', () => {
  const vehicles = new Vehicles3D();
  const group = new Group();
  group.add(vehicles.mesh);
  const transform = new Group();
  transform.position.set(0, 10, 0);
  transform.updateMatrix();
  vehicles.mesh.count = 1;
  vehicles.mesh.setMatrixAt(0, transform.matrix);
  group.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(45, 1.6, 1, 5000);
  camera.position.set(100, 200, 300);
  camera.lookAt(new Vector3(0, 0, 0));
  camera.updateMatrixWorld();
  const point = vehicleScreenPoint(vehicles.mesh, 0, camera, 1280, 800);
  expect(pickVehicle3D(vehicles.mesh, camera, point.x + 5, point.y, 1280, 800)).toBe(0);
  expect(pickVehicle3D(vehicles.mesh, camera, point.x + 20, point.y, 1280, 800)).toBeNull();
  vehicles.destroy();
});
