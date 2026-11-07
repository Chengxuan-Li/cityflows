import { Group, Matrix4, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildCity } from '../fixtures/build-city';
import { pointAtDistance, headingAtDistance } from '../geo/polyline';
import { compile } from '../network';
import { VehiclePoses, type PresentationSnapshot } from '../render/vehicle-pose';
import { cityHeights, heightAt, roadStation } from './heights';
import { Vehicles3D } from './vehicles';

it('places instances at the shared 2D poses, with ramp height, pitch, hue and movement height', () => {
  const b = buildCity('3D poses', 98);
  const a = b.node(0, 0),
    middle = b.node(240, 0, 1),
    end = b.node(240, 240, 1);
  b.road(a, middle, { lanes: 2 }).layer = 1;
  b.road(middle, end, { lanes: 2 }).layer = 1;
  const result = compile(b.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const city = result.compiled,
    heights = cityHeights(city, b.city);
  const segments = [city.lanes[0]!, city.lanes[1]!, city.movements[0]!];
  const positions = segments.map((segment) =>
    pointAtDistance(segment.polyline, segment.cumulative, segment.lengthM * 0.1),
  );
  const snapshot: PresentationSnapshot = {
    timeS: 10,
    count: 3,
    id: new Uint32Array([1, 2, 3]),
    x: Float32Array.from(positions, (p) => p.x),
    y: Float32Array.from(positions, (p) => p.y),
    heading: Float32Array.from(segments, (s) =>
      headingAtDistance(s.polyline, s.cumulative, s.lengthM * 0.1),
    ),
    speed: new Float32Array([12, 8, 6]),
    lateralM: new Float32Array([1.5, 0, 0]),
    lane: new Int32Array([0, 1, -1]),
    state: new Uint8Array([1, 1, 1]),
    fade: new Float32Array([1, 1, 1]),
    vehicleHues: new Uint32Array([0x78b397, 0xd48a7e, 0x849fd3]),
  };
  const poses2D = new VehiclePoses();
  const vehicles = new Vehicles3D();
  new Group().add(vehicles.mesh);
  poses2D.setGeometry(city, 2);
  vehicles.setGeometry(city, 2);
  poses2D.update(snapshot);
  vehicles.setSnapshot(snapshot);
  for (const elapsed of [0, 0.1, 0.5]) {
    vehicles.animate(elapsed, city, heights);
    for (let i = 0; i < snapshot.count; i++) {
      const pose = poses2D.at(i, elapsed),
        matrix = new Matrix4();
      vehicles.mesh.getMatrixAt(i, matrix);
      const position = new Vector3().setFromMatrixPosition(matrix);
      expect(Math.abs(position.x - pose.x)).toBeLessThan(0.01);
      expect(Math.abs(position.z - pose.y)).toBeLessThan(0.01);
      const road = city.roads[0]!;
      const height =
        i === 2
          ? heights.nodes[city.movements[0]!.node]!
          : heightAt(heights.roads[0]!, roadStation(road, pose));
      expect(Math.abs(position.y - height)).toBeLessThan(0.05);
      if (i === 0) expect(matrix.elements[1]).toBeGreaterThan(0);
    }
  }
  expect(vehicles.mesh.instanceColor!.array.slice(0, 3)).not.toEqual(
    vehicles.mesh.instanceColor!.array.slice(3, 6),
  );
  vehicles.destroy();
});
