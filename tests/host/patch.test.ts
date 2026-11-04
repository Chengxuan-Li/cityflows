import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { buildCity } from '../../src/fixtures/build-city';
import { createExportRecorder } from '../../src/host/export-data';
import { createEngine } from '../../src/sim/engine';
import { scenario, trips } from '../sim/fixtures';

test('patch preserves road observations without counting relocation as a road exit', () => {
  const { city, node, road, place } = buildCity('Recorder patch', 1);
  const junction = node(300, 0);
  const incoming = road(node(0, 0), junction);
  const outgoing = road(junction, node(600, 0));
  place('Home', 'residential', { x: 180, y: 10 }, [
    { road: incoming, direction: 'out', positionM: 180 },
  ]);
  place('Work', 'work', { x: 590, y: 10 }, [{ road: outgoing, direction: 'in', positionM: 250 }]);
  const editor = createEditor(city);
  const engine = createEngine();
  engine.load({ compiled: editor.compiled, trips: trips(city, 1), scenario: scenario() });
  const recorder = createExportRecorder(engine, editor.compiled);
  for (let i = 0; i < 10; i++) {
    engine.step();
    recorder.observe();
  }
  const before = recorder.roadStats().find((r) => r.id === incoming.id)!;
  expect(before.meanSpeedRatio).toBeLessThan(1);
  expect(editor.apply({ kind: 'splitRoad', roadId: incoming.id, atM: 100 }).ok).toBe(true);
  expect(engine.patch(editor.compiled).relocated).toBe(1);
  recorder.patch(editor.compiled);
  expect(recorder.roadStats().find((r) => r.id === incoming.id)).toEqual(before);
  for (let i = 0; i < 10; i++) {
    engine.step();
    recorder.observe();
  }
  expect(recorder.roadStats().find((r) => r.id === incoming.id)!.vehiclesPassed).toBe(0);
});
