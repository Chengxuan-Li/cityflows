import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { openProject } from '../../src/project/open';
import { saveProject } from '../../src/project/save';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { routingFixture } from '../routing/fixtures';

test('T47 setting and clearing access each undo once, persist and change routes', async () => {
  const city = grid5x5();
  const { compiled, request } = routingFixture(city);
  const provider = createRouteProvider();
  const before = provider.route(compiled, freeFlowLinkCosts(compiled), request);
  if (!before.ok) throw new Error(before.reason);
  const roadId = compiled.roads[before.route.roads[2]!]!.id;
  const editor = createEditor(city);
  expect(
    editor.apply({ kind: 'setRoadAccess', roadId, access: { all: 'destination', bus: 'yes' } }).ok,
  ).toBe(true);
  expect(editor.history).toHaveLength(1);
  expect(editor.city.version).toBe(city.version + 1);
  const changed = provider.route(editor.compiled, freeFlowLinkCosts(editor.compiled), request);
  expect(changed.ok && changed.route.roads).not.toContain(compiled.index.road.get(roadId));
  const opened = await openProject(
    await saveProject({
      city: editor.city,
      scenarios: [defaultScenario('grid5x5')],
      history: [...editor.history],
    }),
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.error);
  expect(opened.project.city).toEqual(editor.city);
  expect(opened.project.history).toEqual(editor.history);
  expect(editor.apply({ kind: 'setRoadAccess', roadId, access: null }).ok).toBe(true);
  expect(editor.history).toHaveLength(2);
  expect(editor.city.roads[roadId]).not.toHaveProperty('access');
  expect(editor.undo()?.ok).toBe(true);
  expect(editor.city.roads[roadId]!.access).toEqual({ all: 'destination', bus: 'yes' });
  expect(editor.undo()?.ok).toBe(true);
  expect(provider.route(editor.compiled, freeFlowLinkCosts(editor.compiled), request)).toEqual(
    before,
  );
});

test('merging roads cannot discard an access boundary', () => {
  const { city, node, road } = buildCity('Access boundary', 1);
  const a = node(0, 0),
    b = node(100, 0),
    c = node(200, 0);
  const first = road(a, b),
    second = road(b, c);
  second.access = { all: 'destination' };
  const editor = createEditor(city);
  expect(() =>
    editor.apply({ kind: 'mergeRoads', roadId: first.id, otherRoadId: second.id }),
  ).toThrow();
  expect(editor.city).toEqual(city);
});
