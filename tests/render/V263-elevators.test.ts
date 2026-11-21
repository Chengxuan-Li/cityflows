import { expect, test } from 'vitest';
import { emptyWalkGraph } from '../../src/network/walk';
import type { CWalkLink, WalkGraph } from '../../src/network';
import { mapPalettes } from '../../src/render/style';
import { buildContext } from '../../src/render3d/context';
import { elevatorLandings, shaftOutline } from '../../src/render3d/elevators';
import type { ContextAreaFeature } from '../../src/schema';
import type { Vec2 } from '../../src/geo/vec2';

// TASK-263 (owner's bug 6): Freiburg's footbridge elevators drew as 10 m office towers with lit
// windows. An elevator is a glass shaft up to a cabin's height above the top level it serves.

const square: Vec2[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
  { x: 0, y: 0 },
];
const elevator: ContextAreaFeature = {
  kind: 'area',
  class: 'building',
  sub: 'elevator',
  rings: [square],
};

/** The elevator node at (2, 2): the bridge (layer 2) leaves north, the street (layer 0) south, a
 * passage below ground (layer -1) east; a platform edge only touches the shaft's corner. */
function walk(): WalkGraph {
  const graph = emptyWalkGraph();
  const link = (line: Vec2[], layer: number, generated = false) =>
    graph.links.push({ line, layer, generated } as unknown as CWalkLink);
  link(
    [
      { x: 2, y: 2 },
      { x: 2, y: -6 },
    ],
    2,
  );
  link(
    [
      { x: 2, y: 8 },
      { x: 2, y: 2 },
    ],
    0,
  );
  link(
    [
      { x: 2, y: 2 },
      { x: 9, y: 2 },
    ],
    -1,
  );
  link(
    [
      { x: -5, y: 0 },
      { x: 0, y: 0 },
    ],
    0,
  );
  link(
    [
      { x: 2, y: 2 },
      { x: -3, y: 2 },
    ],
    0,
    true,
  );
  return graph;
}

const edgeMiddle = (edge: number) => {
  const ring = shaftOutline([square]);
  const a = ring[edge]!,
    b = ring[(edge + 1) % ring.length]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

test('V263 an elevator serves the levels of the walkways that leave its node, with a door toward each', () => {
  const landings = elevatorLandings([square], walk());
  expect(landings.map((l) => l.heightM)).toEqual([0, 10]);
  // The street door faces south (y = 4), the bridge door north (y = 0).
  expect(edgeMiddle(landings[0]!.edge)).toEqual({ x: 2, y: 4 });
  expect(edgeMiddle(landings[1]!.edge)).toEqual({ x: 2, y: 0 });
  // Without a second layer at a point there is no elevator to enter: no landing.
  const platform = emptyWalkGraph();
  platform.links.push(...walk().links.filter((l) => l.layer === 0 && !l.generated));
  expect(elevatorLandings([square], platform)).toEqual([]);
});

test('V263 the shaft rises 3 m above its top landing, with no window grid and a glass glow at night', () => {
  const context = buildContext([elevator], undefined, true, mapPalettes.light, walk());
  const position = context.detailedBuildings.getAttribute('position');
  const info = context.detailedBuildings.getAttribute('windowInfo');
  let top = -Infinity,
    windows = 0,
    glass = 0;
  for (let i = 0; i < position.count; i++) {
    top = Math.max(top, position.getY(i));
    if (info.getZ(i) > 0) windows++;
    if (info.getZ(i) < 0) glass++;
  }
  expect(top).toBeCloseTo(13, 5);
  expect(windows).toBe(0);
  // Four walls of glass, two triangles each.
  expect(glass).toBe(4 * 6);
  // Doors stand proud of the street and bridge faces at their landings.
  const proud = (y: number, z0: number, z1: number) => {
    for (let i = 0; i < position.count; i++)
      if (
        Math.abs(position.getZ(i) - y) < 1e-4 &&
        position.getY(i) > z0 &&
        position.getY(i) < z1 &&
        position.getX(i) > 1 &&
        position.getX(i) < 3
      )
        return true;
    return false;
  };
  expect(proud(4.09, 0.2, 2.5)).toBe(true);
  expect(proud(-0.09, 10.2, 12.5)).toBe(true);
  expect(proud(-0.09, 0.2, 2.5)).toBe(false);
  // The plain blocks keep the same height.
  context.buildings.computeBoundingBox();
  expect(context.buildings.boundingBox!.max.y).toBeCloseTo(13, 5);
  expect(context.roofStats.shapes).toEqual({ flat: 1 });
  for (const part of [context.buildings, context.detailedBuildings, context.ground]) part.dispose();
});

test('V263 a tagged height wins; without a walkway the shaft is a head house; parts are shafts too', () => {
  const height = (feature: ContextAreaFeature, graph?: WalkGraph) => {
    const context = buildContext([feature], undefined, true, mapPalettes.light, graph);
    context.detailedBuildings.computeBoundingBox();
    const windows = Array.from(
      { length: context.detailedBuildings.getAttribute('windowInfo').count },
      (_, i) => context.detailedBuildings.getAttribute('windowInfo').getZ(i),
    ).filter((z) => z > 0).length;
    return { top: context.detailedBuildings.boundingBox!.max.y, windows };
  };
  expect(height({ ...elevator, heightM: 9 }, walk()).top).toBeCloseTo(9, 5);
  expect(height(elevator).top).toBeCloseTo(3, 5);
  const station: ContextAreaFeature = {
    kind: 'area',
    class: 'building',
    sub: 'train_station',
    rings: [
      [
        { x: -10, y: -10 },
        { x: 20, y: -10 },
        { x: 20, y: 20 },
        { x: -10, y: 20 },
        { x: -10, y: -10 },
      ],
    ],
    parts: [{ rings: [square], sub: 'elevator', heightM: 9 }],
  };
  expect(height(station)).toEqual({ top: expect.closeTo(9, 5) as number, windows: 0 });
});
