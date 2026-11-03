import { describe, expect, it } from 'vitest';
import { dividedHighway } from '../fixtures/divided-highway';
import { grid5x5 } from '../fixtures/grid5x5';
import { compile } from '../network';
import { Camera } from './camera';
import { createPicker, pickVehicle } from './picking';

describe('renderer picking', () => {
  it('keeps the pointer anchored while zooming and picks each direction at several scales', () => {
    const result = compile(grid5x5());
    if (!result.ok) throw new Error('Fixture failed to compile');
    const city = result.compiled;
    const pick = createPicker(
      city,
      city.places.map(({ centroid }) => ({ kind: 'point', pos: centroid })),
      city.roads.map(() => 0),
    );
    const grouped = city.roads.find(({ streetGroupId }) => streetGroupId !== null)!;
    const directions = city.roads.filter(
      ({ streetGroupId }) => streetGroupId === grouped.streetGroupId,
    );
    expect(directions).toHaveLength(2);
    const camera = new Camera();
    camera.pan(100, 75);
    const pointer = { x: 23, y: 58 };
    const anchor = camera.screenToWorld(pointer);
    for (const factor of [0.2, 10, 5]) {
      camera.zoomAt(pointer, factor);
      expect(camera.worldToScreen(anchor).x).toBeCloseTo(pointer.x);
      expect(camera.worldToScreen(anchor).y).toBeCloseTo(pointer.y);
      for (const road of directions) {
        const lane = city.lanes[road.lanes[0]!]!;
        const [a, b] = lane.polyline;
        const center = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        const world = camera.screenToWorld(camera.worldToScreen(center));
        expect(pick(world)).toEqual({ kind: 'lane', lane: lane.idx, road: road.idx });
      }
    }
  });

  it('picks the visible bridge and tests the actual place ring', () => {
    const source = dividedHighway();
    const result = compile(source);
    if (!result.ok) throw new Error('Fixture failed to compile');
    const city = result.compiled;
    const pick = createPicker(
      city,
      [
        {
          kind: 'polygon',
          ring: [
            { x: -95, y: 30 },
            { x: -65, y: 30 },
            { x: -95, y: 55 },
          ],
        },
        { kind: 'point', pos: city.places[1]!.centroid },
      ],
      city.roads.map(({ id }) => source.nodes[source.roads[id]!.from]!.layer),
    );
    const hit = pick({ x: 1, y: 10 });
    expect(hit?.kind).toBe('lane');
    if (hit?.kind !== 'lane') throw new Error('Expected a lane');
    expect(source.nodes[source.roads[city.roads[hit.road]!.id]!.from]!.layer).toBe(1);
    expect(pick({ x: -91, y: 50 })).toEqual({ kind: 'place', place: 0 });
    expect(pick({ x: -69, y: 50 })).toBeNull();
  });

  it('returns the nearest vehicle within eight screen pixels across zoom levels', () => {
    const ids = Uint32Array.of(81, 42, 5);
    const x = Float32Array.of(7, 2, 0.5);
    const y = Float32Array.of(0, 0, 0);
    for (const zoom of [0.25, 1, 8]) {
      expect(pickVehicle({ x: 0, y: 0 }, zoom, ids, x, y, 3)).toEqual({ kind: 'vehicle', id: 5 });
      expect(pickVehicle({ x: 7 + 8 / zoom, y: 0 }, zoom, ids, x, y, 3)).toEqual({
        kind: 'vehicle',
        id: 81,
      });
      expect(pickVehicle({ x: 7 + 8.1 / zoom, y: 0 }, zoom, ids, x, y, 3)).toBeNull();
    }
  });
});
