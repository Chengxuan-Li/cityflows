import { expect, test } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { compileRail } from '../../src/network/rail';
import { trainTimetable, trainsAt } from '../../src/network/trains';
import { Trains3D } from '../../src/render3d/trains';
import { cityHeights } from '../../src/render3d/heights';
import { pickTrain } from '../../src/render/layers/trains';

function fixture(tunnel = false) {
  const { city, node, road } = buildCity('Train grades', 1);
  road(node(-100, 30), node(1300, 30));
  city.rail = {
    nodes: {
      'rn:1': { id: 'rn:1', pos: { x: 0, y: 0 }, kind: 'plain', layer: 0 },
      'rn:2': { id: 'rn:2', pos: { x: 1200, y: 0 }, kind: 'plain', layer: 1 },
    },
    tracks: {
      'rt:1': {
        id: 'rt:1',
        from: 'rn:1',
        to: 'rn:2',
        line: [
          { x: 0, y: 0 },
          { x: 1200, y: 0 },
        ],
        kind: 'rail',
        layer: 1,
        preferredDirection: 'forward',
        ...(tunnel ? { tunnel: true } : {}),
      },
    },
    platforms: {},
  };
  const result = compile(city);
  if (!result.ok) throw Error('compile');
  return { city, compiled: result.compiled, rail: compileRail(city)! };
}

test('T64 3D train bodies pitch with the rail ramp and tunnel bodies follow below-ground visibility', () => {
  const { city, compiled, rail } = fixture(),
    table = trainTimetable(rail),
    trains = trainsAt(rail, table, table.departures[0]!.timeS + 15);
  const layer = new Trains3D(rail, cityHeights(compiled, city), table);
  layer.update(trains, false, null);
  const matrix = new Matrix4();
  layer.body.getMatrixAt(0, matrix);
  const direction = new Vector3(1, 0, 0).transformDirection(matrix);
  expect(direction.y).toBeGreaterThan(0.001);
  expect(layer.pick(0).id).toBe(trains[0]!.id);
  rail.tracks[0]!.tunnel = true;
  layer.update(trains, false, null);
  expect(layer.body.count).toBe(0);
  layer.update(trains, true, null);
  expect(layer.body.count).toBeGreaterThan(0);
});

test('T64 a train hidden below a bridge cannot intercept the bridge pick', () => {
  const { rail } = fixture(),
    table = trainTimetable(rail),
    trains = trainsAt(rail, table, table.departures[0]!.timeS + 15),
    p = trains[0]!.cars[0]!;
  expect(pickTrain(trains, p, 2, rail, 1)?.kind).toBe('train');
  expect(pickTrain(trains, p, 2, rail, 2)).toBeNull();
});

test('T64 instance capacity includes trains still in the city from earlier timetable cycles', () => {
  const { city, compiled } = fixture();
  city.rail = { nodes: {}, tracks: {}, platforms: {} };
  for (let i = 0; i <= 30; i++) {
    const id = `rn:${i}`;
    city.rail.nodes[id] = { id, pos: { x: i * 100, y: 0 }, kind: 'plain', layer: 0 };
    if (i) {
      const track = `rt:${i}`;
      city.rail.tracks[track] = {
        id: track,
        from: `rn:${i - 1}`,
        to: id,
        line: [
          { x: (i - 1) * 100, y: 0 },
          { x: i * 100, y: 0 },
        ],
        kind: 'rail',
        layer: 0,
        preferredDirection: 'forward',
        maxSpeedMps: 1,
      };
    }
  }
  const rail = compileRail(city)!,
    table = trainTimetable(rail),
    poses = trainsAt(rail, table, 3600),
    layer = new Trains3D(rail, cityHeights(compiled, city), table);
  layer.update(poses, false, null);
  expect(layer.body.count).toBeGreaterThan(32);
  expect(layer.body.count).toBeLessThanOrEqual(layer.body.instanceMatrix.count);
});
