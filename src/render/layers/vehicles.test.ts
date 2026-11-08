import { expect, it, vi } from 'vitest';
import { buildCity } from '../../fixtures/build-city';
import { compile } from '../../network';
import { style } from '../style';
import type { PresentationSnapshot } from '../vehicle-pose';
import { cumulativeLengths } from '../../geo/polyline';
import type { CMovement } from '../../network';
import {
  advanceAlong,
  createVehicleLayer,
  distanceAlong,
  laneChangePose,
  Vehicles,
} from './vehicles';

it('advances around a polyline corner and stops at the segment end', () => {
  const polyline = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  const segment = { polyline, cumulative: cumulativeLengths(polyline), lengthM: 20 } as CMovement;
  const distance = distanceAlong(segment, 8, 0);
  expect(distance).toBe(8);
  expect(advanceAlong(segment, distance, 10, 0.5)).toEqual({ x: 10, y: 3, heading: Math.PI / 2 });
  expect(advanceAlong(segment, distance, 10, 100)).toEqual({ x: 10, y: 10, heading: Math.PI / 2 });
  expect(advanceAlong(segment, distance, 0, 100)).toEqual({ x: 8, y: 0, heading: 0 });
  // A fresh snapshot replaces the old estimate, including braking back along the segment.
  expect(advanceAlong(segment, distanceAlong(segment, 9, 0), 2, 0.25).x).toBe(9.5);
});

it('eases either direction over the configured duration with a small heading change', () => {
  expect(laneChangePose(3.5, 3.5, 2, 0)).toEqual({ lateral: 3.5, yaw: -0 });
  expect(laneChangePose(3.5, 3.5, 2, 0.5).lateral).toBeCloseTo(3.5 * 0.84375);
  expect(laneChangePose(3.5, 3.5, 2, 1)).toEqual({ lateral: 1.75, yaw: -0.12 });
  expect(laneChangePose(-3.5, 3.5, 2, 1)).toEqual({ lateral: -1.75, yaw: 0.12 });
  expect(laneChangePose(3.5, 3.5, 2, 3).lateral).toBe(0);
  expect(laneChangePose(0, 0, 2, 1)).toEqual({ lateral: 0, yaw: 0 });
  expect(laneChangePose(3.5, 3.5, 0, 1)).toEqual({ lateral: 0, yaw: 0 });
  // A later linear-offset snapshot produces the same point in the eased animation.
  expect(laneChangePose(1.75, 3.5, 2, 0.25)).toEqual(laneChangePose(3.5, 3.5, 2, 1.25));
});

it('shares an atlas across class shapes, sizes reused particles and restores destination colours', () => {
  class Canvas {
    width = 0;
    height = 0;
    getContext() {
      return { beginPath() {}, roundRect() {}, fill() {}, arc() {}, fillStyle: '' };
    }
  }
  vi.stubGlobal('HTMLCanvasElement', Canvas);
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  try {
    const b = buildCity('2D class sizes', 100);
    b.road(b.node(0, 0), b.node(240, 0));
    const result = compile(b.city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const vehicles = new Vehicles();
    const layer = createVehicleLayer();
    vehicles.setGeometry(result.compiled);
    vehicles.setLayers(
      [layer],
      result.compiled.lanes.map(() => layer),
      [],
    );
    vehicles.setZoom(2);
    const snapshot: PresentationSnapshot = {
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
      fade: new Float32Array(4).fill(1),
      vehicleHues: new Uint32Array(4).fill(0x78b397),
    };
    vehicles.update(snapshot);
    const particles = [...layer.pool];
    expect(new Set(particles.map((particle) => particle.texture.source)).size).toBe(1);
    expect(new Set(particles.map((particle) => particle.texture.frame.y)).size).toBe(4);
    const dimensions = Object.values(style.vehicleClasses);
    for (let i = 0; i < 4; i++) {
      const particle = particles[i]!;
      expect(particle.scaleX * particle.texture.width).toBeCloseTo(dimensions[i]!.lengthM);
      expect(particle.scaleY * particle.texture.height).toBeCloseTo(dimensions[i]!.widthM);
      expect(particle.anchorX).toBe(1);
      expect(particle.x).toBe(snapshot.x[i]);
      expect(particle.tint).toBe(0x78b397);
    }
    const carRear = particles[0]!.x - particles[0]!.scaleX * particles[0]!.texture.width;
    expect(carRear - particles[2]!.x).toBeCloseTo(2);
    const bodyPoint = (index: number, longitudinal: number, lateral = 0) => {
      const particle = particles[index]!;
      return {
        x:
          particle.x +
          Math.cos(particle.rotation) * longitudinal -
          Math.sin(particle.rotation) * lateral,
        y:
          particle.y +
          Math.sin(particle.rotation) * longitudinal +
          Math.cos(particle.rotation) * lateral,
      };
    };
    for (let i = 0; i < 4; i++) {
      expect(vehicles.pickBody(bodyPoint(i, -dimensions[i]!.lengthM / 2))).toBe(i + 1);
    }
    // Rendered yaw can differ from the snapshot heading during a lane change.
    particles[2]!.rotation = Math.PI / 3;
    particles[3]!.rotation = -Math.PI / 4;
    for (const index of [2, 3]) {
      expect(vehicles.pickBody(bodyPoint(index, -11))).toBe(index + 1);
      expect(vehicles.pickBody(bodyPoint(index, -12.1))).toBeNull();
      expect(
        vehicles.pickBody(bodyPoint(index, -6, dimensions[index]!.widthM / 2 + 0.1)),
      ).toBeNull();
    }
    vehicles.setColourByClass(true);
    expect(particles.map((particle) => particle.tint)).toEqual(
      dimensions.map((value) => value.color),
    );
    vehicles.setColourByClass(false);
    expect(particles.every((particle) => particle.tint === 0x78b397)).toBe(true);
    vehicles.setZoom(0.5);
    expect(vehicles.pickBody(bodyPoint(2, -11))).toBeNull();
    for (const particle of particles) {
      expect(particle.anchorX).toBe(0.5);
      expect(particle.scaleX * particle.texture.width * 0.5).toBeCloseTo(
        2 * style.vehicleDotRadiusPx,
      );
      expect(particle.scaleX).toBe(particle.scaleY);
    }
    vehicles.setZoom(2);
    snapshot.vclass.reverse();
    vehicles.update(snapshot);
    expect(layer.pool).toEqual(particles);
    expect(particles[0]!.scaleX * particles[0]!.texture.width).toBe(12);
    expect(particles[3]!.scaleX * particles[3]!.texture.width).toBe(4.5);
    vehicles.destroy();
    layer.container.destroy();
  } finally {
    vi.unstubAllGlobals();
  }
});
