import { expect, test } from 'vitest';
import { createGrade, orderedLayers } from '../../src/render/scene';

test('T62 street tram paint sits above road and junction surfaces', () => {
  const grade = createGrade(0);
  expect(grade.terrain.children.indexOf(grade.tram)).toBeGreaterThan(
    grade.terrain.children.indexOf(grade.surfaces),
  );
  expect(grade.terrain.children.indexOf(grade.tram)).toBeGreaterThan(
    grade.terrain.children.indexOf(grade.nodes),
  );
  expect(grade.terrain.children.indexOf(grade.rail)).toBeLessThan(
    grade.terrain.children.indexOf(grade.surfaces),
  );
  grade.group.destroy({ children: true });
});

test('place tints sit under rail, paving and road surfaces', () => {
  const grade = createGrade(0);
  const order = grade.terrain.children;
  for (const above of [grade.rail, grade.sidewalks, grade.surfaces, grade.nodes])
    expect(order.indexOf(grade.placeFills)).toBeLessThan(order.indexOf(above));
  grade.group.destroy({ children: true });
});

test('stacks unique grades from lowest to highest even when encountered out of order', () => {
  expect(orderedLayers([0, 1, -1, 1, -10, 2])).toEqual([-10, -1, 0, 1, 2]);
});

test('keeps a base grade available for ground-level overlays', () => {
  expect(orderedLayers([2])).toEqual([0, 2]);
});
