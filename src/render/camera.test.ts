import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createGeoReference, lonLatToLocal } from '../geo/projection';
import type { Vec2 } from '../geo/vec2';
import { boundsOf, Camera, frameView, type Bounds, type FramedView } from './camera';

// TASK-203: framing fits a city's boundary into the part of the map the panels leave visible.
// Freiburg's boundary ring (TASK-198), in metres.
const geo = createGeoReference({ lon: 7.8459, lat: 47.9952 });
const boundary = (
  [
    [7.834, 47.992],
    [7.8368, 47.9962],
    [7.841, 48.001],
    [7.8445, 48.001],
    [7.853, 47.9992],
    [7.8548, 47.9986],
    [7.8578, 47.9968],
    [7.8565, 47.9935],
    [7.856, 47.99],
    [7.85, 47.9895],
    [7.8458, 47.9894],
    [7.842, 47.9908],
    [7.8385, 47.9913],
  ] as const
).map(([lon, lat]) => lonLatToLocal(geo, { lon, lat }));

const margin = 24;
/** Canvas sizes and what covers them: a sidebar or an inspector floating over either side, a
 *  phone's inspector sheet over the lower half. */
const layouts: { name: string; width: number; height: number; covered: Bounds }[] = [
  { name: 'nothing', width: 888, height: 822, covered: { minX: 0, minY: 0, maxX: 888, maxY: 822 } },
  {
    name: 'a sidebar on the left',
    width: 800,
    height: 700,
    covered: { minX: 272, minY: 0, maxX: 800, maxY: 700 },
  },
  {
    name: 'an inspector on the right',
    width: 800,
    height: 700,
    covered: { minX: 0, minY: 0, maxX: 500, maxY: 700 },
  },
  {
    name: 'a phone sheet',
    width: 390,
    height: 760,
    covered: { minX: 0, minY: 0, maxX: 390, maxY: 380 },
  },
];

const inset = ({ minX, minY, maxX, maxY }: Bounds): Bounds => ({
  minX: minX + margin,
  minY: minY + margin,
  maxX: maxX - margin,
  maxY: maxY - margin,
});

/** Every point inside the area, and the points reaching its edges in one direction at least. */
function expectFramed(shown: Vec2[], area: Bounds) {
  const { minX, minY, maxX, maxY } = boundsOf(shown);
  expect(minX).toBeGreaterThanOrEqual(area.minX - 0.5);
  expect(minY).toBeGreaterThanOrEqual(area.minY - 0.5);
  expect(maxX).toBeLessThanOrEqual(area.maxX + 0.5);
  expect(maxY).toBeLessThanOrEqual(area.maxY + 0.5);
  const fills = [maxX - minX - (area.maxX - area.minX), maxY - minY - (area.maxY - area.minY)];
  expect(Math.min(...fills.map(Math.abs))).toBeLessThan(1);
  // Centred.
  expect(Math.abs(minX + maxX - area.minX - area.maxX)).toBeLessThan(1);
  expect(Math.abs(minY + maxY - area.minY - area.maxY)).toBeLessThan(1);
}

/** A perspective view placed as `Scene3D.setView` places its camera (45° vertical field, the
 *  zoom in pixels per metre at the ground target), panned as `Scene3D.panScreen` pans it. */
function perspective(width: number, height: number, pitch: number, bearing: number) {
  const camera = new PerspectiveCamera(45, width / height, 0.2, 50000);
  let centre = { x: 0, y: 0 };
  let zoom = 0.1;
  function place() {
    const distance = height / (2 * Math.tan((camera.fov * Math.PI) / 360) * zoom);
    const angle = (pitch * Math.PI) / 180,
      azimuth = (bearing * Math.PI) / 180;
    camera.position.set(
      centre.x + distance * Math.cos(angle) * Math.sin(azimuth),
      distance * Math.sin(angle),
      centre.y + distance * Math.cos(angle) * Math.cos(azimuth),
    );
    camera.lookAt(centre.x, 0, centre.y);
    camera.updateMatrixWorld();
  }
  place();
  const view: FramedView = {
    worldToScreen({ x, y }) {
      const p = new Vector3(x, 0, y).project(camera);
      return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2 };
    },
    zoomBy(factor) {
      zoom *= factor;
      place();
    },
    panBy(dx, dy) {
      const ray = new Vector3(
        ((width / 2 + dx) / width) * 2 - 1,
        1 - ((height / 2 + dy) / height) * 2,
        0.5,
      )
        .unproject(camera)
        .sub(camera.position);
      const reach = ray.multiplyScalar(-camera.position.y / ray.y).add(camera.position);
      centre = { x: 2 * centre.x - reach.x, y: 2 * centre.y - reach.z };
      place();
    },
  };
  return view;
}

describe('framing a boundary in the visible map', () => {
  it.each(layouts)('fits it in 2D beside $name', ({ width, height, covered }) => {
    const camera = new Camera();
    camera.fitToBounds(
      { minX: -5000, minY: 0, maxX: 0, maxY: 100 },
      { minX: 0, minY: 0, maxX: width, maxY: height },
    );
    const area = inset(covered);
    camera.fitToBounds(boundsOf(boundary), area);
    expectFramed(
      boundary.map((p) => camera.worldToScreen(p)),
      area,
    );
  });

  it.each(
    layouts.flatMap((layout) => [
      { ...layout, pitch: 55, bearing: 0 },
      { ...layout, pitch: 50, bearing: -60 },
      { ...layout, pitch: 25, bearing: 140 },
    ]),
  )(
    'fits it in 3D at pitch $pitch and bearing $bearing beside $name',
    ({ width, height, covered, pitch, bearing }) => {
      const view = perspective(width, height, pitch, bearing);
      const area = inset(covered);
      frameView(boundary, area, view);
      expectFramed(
        boundary.map((p) => view.worldToScreen(p)),
        area,
      );
    },
  );
});
