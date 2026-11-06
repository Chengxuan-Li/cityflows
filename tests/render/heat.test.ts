import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { HeatLayer, heatColor } from '../../src/render/layers/heat';
import type { VehicleSnapshot } from '../../src/render/types';
import { setup } from '../sim/fixtures';

test('queue markers count stopped cars near lane ends, excluding moving cars and movements', () => {
  const city = setup(grid5x5());
  const layer = new HeatLayer();
  layer.setCity(city);
  const end = city.lanes[0]!.polyline.at(-1)!;
  const snapshot: VehicleSnapshot = {
    timeS: 0,
    count: 5,
    id: Uint32Array.from([1, 2, 3, 4, 5]),
    lane: Int32Array.from([0, 0, 0, -1, 0]),
    x: Float32Array.from([end.x, end.x - 5, end.x, end.x, end.x - 60]),
    y: new Float32Array(5).fill(end.y),
    speed: Float32Array.from([0, 0.4, 1, 0, 0]),
    heading: new Float32Array(5),
    lateralM: new Float32Array(5),
    state: new Uint8Array(5).fill(1),
    fade: new Float32Array(5).fill(1),
  };
  layer.setQueues(snapshot);
  expect(layer.queues.children[0]!.visible).toBe(true);
  expect(layer.queues.children[0]!.scale.x).toBeCloseTo(1.5 + Math.sqrt(2));
  expect(layer.queues.children.slice(1).every((shape) => !shape.visible)).toBe(true);
  snapshot.speed[1] = 2;
  layer.setQueues(snapshot);
  expect(layer.queues.children[0]!.visible).toBe(false);
  layer.setHeat(new Float32Array(city.roads.length).fill(0.5));
  expect(layer.roads.children[0]!.tint).toBe(heatColor(0.5));
  layer.setHeat(null);
  expect(layer.roads.children.every((shape) => !shape.visible)).toBe(true);
  layer.roads.destroy({ children: true, context: true });
  layer.queues.destroy({ children: true, context: true });
});
