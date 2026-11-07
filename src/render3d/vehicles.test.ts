import { Color, Group, Matrix4, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { buildCity } from '../fixtures/build-city';
import { pointAtDistance, headingAtDistance } from '../geo/polyline';
import { compile } from '../network';
import { VehiclePoses, type PresentationSnapshot } from '../render/vehicle-pose';
import { cityHeights, heightAt, roadStation } from './heights';
import { Vehicles3D } from './vehicles';
import { style } from '../render/style';

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
    vclass: new Uint8Array([0, 1, 2]),
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

it('keeps vehicle pitch through an inclined, outline-free road join', () => {
  const b = buildCity('Inclined through join', 98);
  const a = b.node(-120, 0, -1),
    middle = b.node(0, 0, 0),
    deck = b.node(140, 0, 2);
  b.road(a, middle).layer = -1;
  b.road(middle, deck).layer = 2;
  const result = compile(b.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const city = result.compiled,
    heights = cityHeights(city, b.city);
  const movement = city.movements.find((m) => city.nodes[m.node]!.id === middle.id)!;
  expect(city.nodes[movement.node]!.outline).toHaveLength(0);
  const vehicles = new Vehicles3D();
  vehicles.setGeometry(city, 2);
  vehicles.setSnapshot({
    timeS: 0,
    count: 1,
    id: new Uint32Array([1]),
    x: new Float32Array([0]),
    y: new Float32Array([0]),
    heading: new Float32Array([0]),
    speed: new Float32Array([0]),
    lateralM: new Float32Array([0]),
    lane: new Int32Array([-movement.idx - 1]),
    state: new Uint8Array([1]),
    vclass: new Uint8Array([0]),
    fade: new Float32Array([1]),
  });
  vehicles.animate(0, city, heights);
  const matrix = new Matrix4();
  vehicles.mesh.getMatrixAt(0, matrix);
  expect(matrix.elements[1]).toBeGreaterThan(0.01);
  expect(new Vector3().setFromMatrixPosition(matrix).y).toBe(0);
  vehicles.destroy();
});

it('sizes each class, preserves destination colours and recolours a paused snapshot immediately', () => {
  const b = buildCity('Class sizes', 100);
  b.road(b.node(0, 0), b.node(240, 0));
  const result = compile(b.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const city = result.compiled;
  const vehicles = new Vehicles3D();
  vehicles.setGeometry(city);
  vehicles.setSnapshot({
    timeS: 0,
    count: 4,
    id: new Uint32Array([1, 2, 3, 4]),
    vclass: new Uint8Array([0, 1, 2, 3]),
    x: new Float32Array([20, 40, 13.5, 80]),
    y: new Float32Array(4),
    heading: new Float32Array(4),
    speed: new Float32Array(4),
    lateralM: new Float32Array(4),
    lane: new Int32Array(4),
    state: new Uint8Array(4).fill(1),
    fade: new Float32Array([1, 1, 1, 0.5]),
    vehicleHues: new Uint32Array(4).fill(0x78b397),
  });
  vehicles.animate(0, city, cityHeights(city, b.city));
  const lengths = [4.5, 5.5, 12, 12];
  const heights = [1.5, 2.2, 3.5, 3.2];
  const widths = [1.8, 2, 2.5, 2.55];
  vehicles.mesh.geometry.computeBoundingBox();
  const queueBounds = [];
  for (let i = 0; i < 4; i++) {
    const matrix = new Matrix4();
    vehicles.mesh.getMatrixAt(i, matrix);
    const bounds = vehicles.mesh.geometry.boundingBox!.clone().applyMatrix4(matrix);
    queueBounds.push(bounds);
    const size = bounds.getSize(new Vector3());
    const fade = i === 3 ? 0.5 : 1;
    expect(size.x).toBeCloseTo(lengths[i]! * fade);
    expect(size.y).toBeCloseTo(heights[i]! * fade);
    expect(size.z).toBeCloseTo(widths[i]! * fade);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.x).toBeCloseTo(vehicles.poses.snapshot!.x[i]!);
    const color = new Color();
    vehicles.mesh.getColorAt(i, color);
    expect(color.getHex()).toBe(0x78b397);
  }
  expect(queueBounds[0]!.min.x - queueBounds[2]!.max.x).toBeCloseTo(2);
  vehicles.setColourByClass(true);
  for (let i = 0; i < 4; i++) {
    const color = new Color();
    vehicles.mesh.getColorAt(i, color);
    expect(color.getHex()).toBe(Object.values(style.vehicleClasses)[i]!.color);
  }
  vehicles.setColourByClass(false);
  const restored = new Color();
  vehicles.mesh.getColorAt(2, restored);
  expect(restored.getHex()).toBe(0x78b397);
  vehicles.destroy();
});
