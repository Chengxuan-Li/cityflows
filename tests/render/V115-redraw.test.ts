import { expect, test, vi } from 'vitest';
import { createGeoReference } from '../../src/geo/projection';
import { Camera } from '../../src/render/camera';
import { Tiles } from '../../src/render/layers/tiles';
import { FrameDemand } from '../../src/render/frame-demand';
import { Basemap3D } from '../../src/render3d/basemap';
import { PerspectiveCamera } from 'three';
import { Graphics } from 'pixi.js';
import { fadeAtZoom, updateZoomFade } from '../../src/render/layers/roads';

test('V115 coalesces visible changes and leaves idle frames undrawn', () => {
  const demand = new FrameDemand();
  expect(demand.consume()).toBe(true);
  expect(demand.consume()).toBe(false);
  demand.invalidate();
  demand.invalidate();
  expect(demand.consume()).toBe(true);
  expect(demand.consume()).toBe(false);
  // Changes made while drawing belong to the next frame.
  demand.invalidate();
  expect(demand.consume()).toBe(true);
  demand.invalidate();
  expect(demand.consume()).toBe(true);
  expect(demand.consume()).toBe(false);
});

test('V115 continuous measurement draws idle frames and resumes demand rendering', () => {
  const demand = new FrameDemand();
  expect(demand.consume(true)).toBe(true);
  expect(demand.consume(true)).toBe(true);
  expect(demand.consume()).toBe(false);
  demand.invalidate();
  expect(demand.consume()).toBe(true);
  expect(demand.consume()).toBe(false);
});

test('V115 prepares zoom opacity before a single draw, including rebuilt graphics', () => {
  for (const graphics of [new Graphics(), new Graphics()]) {
    fadeAtZoom(graphics, 0.7, 2.2);
    updateZoomFade(graphics, 0.7);
    expect(graphics.alpha).toBe(0);
    updateZoomFade(graphics, 1.45);
    expect(graphics.alpha).toBeCloseTo(0.5);
    updateZoomFade(graphics, 9);
    expect(graphics.alpha).toBe(1);
    expect(graphics.onRender).toBeFalsy();
    graphics.destroy();
  }
});

test.each(['2d', '3d'])(
  'V115 %s pending and failed tiles do not redraw an unchanged backdrop',
  (mode) => {
    const requests: { onerror: (() => void) | null }[] = [];
    class ImageRequest {
      onload = null;
      onerror: (() => void) | null = null;
      constructor() {
        requests.push(this);
      }
    }
    vi.stubGlobal('Image', ImageRequest);
    const geo = createGeoReference({ lon: 0, lat: 0 });
    const tiles = new Tiles(geo);
    const basemap = new Basemap3D(geo);
    try {
      const camera = new Camera();
      camera.fitToBounds({ minX: -100, minY: -100, maxX: 100, maxY: 100 }, 400, 400);
      const camera3D = new PerspectiveCamera(45, 1, 0.2, 5000);
      camera3D.position.set(0, 500, 500);
      camera3D.lookAt(0, 0, 0);
      camera3D.updateMatrixWorld();
      const update = () =>
        mode === '2d'
          ? tiles.update(camera, 400, 400, 16)
          : basemap.update(camera3D, 400, 400, 16, false);
      const layer = mode === '2d' ? tiles : basemap;
      expect(update()).toBe(false);
      expect(requests.length).toBeGreaterThan(0);
      expect(layer.needsUpdate).toBe(false);
      for (const request of requests) request.onerror!();
      expect(layer.needsUpdate).toBe(true);
      expect(update()).toBe(false);
      expect(layer.needsUpdate).toBe(false);
    } finally {
      tiles.destroy();
      basemap.destroy();
      vi.unstubAllGlobals();
    }
  },
);
