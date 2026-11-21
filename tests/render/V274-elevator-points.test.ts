import { expect, test } from 'vitest';
import type { Vec2 } from '../../src/geo/vec2';
import { importContext } from '../../src/importers/osm/context';
import type { CWalkLink, WalkGraph } from '../../src/network';
import { emptyWalkGraph } from '../../src/network/walk';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { openProject } from '../../src/project/open';
import { saveProjectJson } from '../../src/project/save';
import { mapPalettes } from '../../src/render/style';
import { buildContext } from '../../src/render3d/context';
import { elevatorPoints, pointShaftM } from '../../src/render3d/elevators';
import { scenarioSchema, type ContextFeature } from '../../src/schema';

// TASK-274 (TASK-263's follow-up): an elevator mapped only as a `highway=elevator` node, as
// Munich's lifts up to the Donnersbergerbrücke, is a small glass shaft up to the level it serves.

const square = (x0: number, y0: number, side: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x0 + side, y: y0 },
  { x: x0 + side, y: y0 + side },
  { x: x0, y: y0 + side },
  { x: x0, y: y0 },
];

test('V274 the importer reads elevator nodes outdoors and in their tower, not indoors', () => {
  const ids = (from: number, ring: Vec2[]) => ring.map((_, i) => from + (i % (ring.length - 1)));
  const big = square(20, 0, 10),
    tower = square(40, 0, 2.5),
    shaft = square(60, 0, 3);
  const positions = new Map<number, Vec2>([
    [1, { x: 5, y: 5 }],
    [2, { x: 6, y: 6 }],
    [3, { x: 25, y: 5 }],
    [4, { x: 41, y: 1 }],
    [5, { x: 61, y: 1 }],
    [6, { x: 90, y: 5 }],
  ]);
  const ring = (from: number, points: Vec2[]) =>
    points.slice(0, -1).forEach((p, i) => positions.set(from + i, p));
  ring(100, big);
  ring(200, tower);
  ring(300, shaft);
  const features = importContext(
    {
      node: [
        { id: 1, lon: 0, lat: 0, tag: { highway: 'elevator', level: '0;1', height: '6' } },
        { id: 2, lon: 0, lat: 0, tag: { highway: 'elevator', indoor: 'yes', level: '0;1' } },
        { id: 3, lon: 0, lat: 0, tag: { highway: 'elevator' } },
        { id: 4, lon: 0, lat: 0, tag: { highway: 'elevator', level: '0;2' } },
        { id: 5, lon: 0, lat: 0, tag: { highway: 'elevator' } },
        { id: 6, lon: 0, lat: 0, tag: { highway: 'elevator' } },
      ],
      way: [
        { id: 10, nd: ids(100, big), tag: { building: 'yes' } },
        { id: 11, nd: ids(200, tower), tag: { building: 'yes', height: '15' } },
        { id: 12, nd: ids(300, shaft), tag: { building: 'elevator' } },
      ],
      relation: [],
    },
    positions,
    { min: { x: 0, y: 0 }, max: { x: 80, y: 20 } },
  );
  // Outdoors (with its height and levels), and in a 6.25 m² outline, its tower. Not indoors, not
  // in a 100 m² building, not in a `building=elevator` shaft (TASK-263 draws it), not outside the
  // bounds.
  expect(features.filter((f) => f.kind === 'point')).toEqual([
    { kind: 'point', class: 'elevator', pos: { x: 5, y: 5 }, heightM: 6, sub: '0;1' },
    { kind: 'point', class: 'elevator', pos: { x: 41, y: 1 }, sub: '0;2' },
  ]);
});

test('V274 a project saved before elevator points opens unchanged and draws no shaft', async () => {
  const city = grid5x5();
  city.context = {
    features: [
      { kind: 'point', class: 'tree', pos: { x: 40, y: 40 }, heightM: 9 },
      { kind: 'point', class: 'street_lamp', pos: { x: 45, y: 40 }, sub: 'pole' },
      { kind: 'area', class: 'building', rings: [square(60, 60, 10)], heightM: 7 },
    ],
  };
  const project = { city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
  const json = await saveProjectJson(project);
  expect(json).not.toContain('elevator');
  expect(await openProject(json)).toEqual({ ok: true, project });
  expect(elevatorPoints(city.context.features, emptyWalkGraph())).toEqual({
    towers: new Set(),
    shafts: [],
  });
});

/** Mapped walkways meeting at the elevator node at (0, 0): the bridge (layer 1) leaving east, the
 * street (layer 0) leaving west. */
function walk(layers: [number, number] = [1, 0]): WalkGraph {
  const graph = emptyWalkGraph();
  const link = (line: Vec2[], layer: number) =>
    graph.links.push({ line, layer, generated: false } as unknown as CWalkLink);
  link(
    [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
    ],
    layers[0],
  );
  link(
    [
      { x: -8, y: 0 },
      { x: 0, y: 0 },
    ],
    layers[1],
  );
  return graph;
}

const lift = (extra: Partial<Extract<ContextFeature, { kind: 'point' }>> = {}): ContextFeature => ({
  kind: 'point',
  class: 'elevator',
  pos: { x: 0, y: 0 },
  ...extra,
});

test('V274 an outdoor elevator node is a 1.6 m glass shaft turned to its walkways, 3 m above its top landing', () => {
  const { shafts } = elevatorPoints([lift({ sub: '0;1' })], walk());
  expect(shafts).toHaveLength(1);
  const [shaft] = shafts;
  expect(shaft!.landings.map((l) => l.heightM)).toEqual([0, 5]);
  expect(shaft!.topM).toBe(8);
  const xs = shaft!.rings[0]!.map((p) => p.x),
    ys = shaft!.rings[0]!.map((p) => p.y);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(pointShaftM, 5);
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(pointShaftM, 5);
  const context = buildContext([lift()], undefined, true, mapPalettes.light, walk());
  const position = context.detailedBuildings.getAttribute('position');
  const info = context.detailedBuildings.getAttribute('windowInfo');
  let windows = 0,
    glass = 0,
    bridgeDoor = false,
    streetDoor = false;
  for (let i = 0; i < position.count; i++) {
    if (info.getZ(i) > 0) windows++;
    if (info.getZ(i) < 0) glass++;
    // The doors stand proud of the east face at the deck and of the west face at the street.
    if (Math.abs(position.getX(i) - 0.89) < 1e-4 && position.getY(i) > 5.2) bridgeDoor = true;
    if (Math.abs(position.getX(i) + 0.89) < 1e-4 && position.getY(i) < 2.5) streetDoor = true;
  }
  expect([windows, glass, bridgeDoor, streetDoor]).toEqual([0, 4 * 6, true, true]);
  for (const mesh of [context.buildings, context.detailedBuildings]) {
    mesh.computeBoundingBox();
    expect(mesh.boundingBox!.max.y).toBeCloseTo(8, 5);
  }
  // A tagged height wins.
  expect(elevatorPoints([lift({ heightM: 12 })], walk()).shafts[0]!.topM).toBe(12);
  expect(context.buildingCount).toBe(0);
  for (const part of [context.buildings, context.detailedBuildings, context.ground]) part.dispose();
});

test('V274 underground lifts and those whose levels are not mapped draw nothing', () => {
  const none = { towers: new Set(), shafts: [] };
  // Walkways at the ground and below it: an underground lift.
  expect(elevatorPoints([lift()], walk([0, -1]))).toEqual(none);
  // Its `level` tag names no level above the ground.
  expect(elevatorPoints([lift({ sub: '-2;-1;0' })], walk())).toEqual(none);
  // Walkways of one layer: the levels it serves are not mapped.
  expect(elevatorPoints([lift()], walk([0, 0]))).toEqual(none);
  // No walkway reaches it.
  expect(elevatorPoints([lift()], emptyWalkGraph())).toEqual(none);
  const context = buildContext([lift()], undefined, true, mapPalettes.light, walk([0, -1]));
  expect(context.buildingTriangles).toEqual({ plain: 0, detailed: 0 });
});

test('V274 an elevator node in its small tower outline makes the tower its shaft', () => {
  // The tower, 2.4 m square around the node; its walkways end at doors on the outline.
  const tower: ContextFeature = {
    kind: 'area',
    class: 'building',
    sub: 'yes',
    material: 'glass',
    rings: [square(-1.2, -1.2, 2.4)],
  };
  const graph = emptyWalkGraph();
  for (const [line, layer] of [
    [
      [
        { x: 0, y: 0 },
        { x: 1.2, y: 0 },
      ],
      1,
    ],
    [
      [
        { x: 1.2, y: 0 },
        { x: 9, y: 0 },
      ],
      1,
    ],
    [
      [
        { x: -1.2, y: 0 },
        { x: 0, y: 0 },
      ],
      0,
    ],
  ] as const)
    graph.links.push({ line, layer, generated: false } as unknown as CWalkLink);
  const features = [tower, lift({ sub: '0;2' })];
  const { towers, shafts } = elevatorPoints(features, graph);
  expect([[...towers], shafts]).toEqual([[tower], []]);
  const context = buildContext(features, undefined, true, mapPalettes.light, graph);
  const info = context.detailedBuildings.getAttribute('windowInfo');
  const pitches = Array.from({ length: info.count }, (_, i) => info.getZ(i));
  // A shaft (glass glow, no window grid) up to 3 m above the deck at 5 m, not a 10 m block.
  expect(pitches.filter((z) => z > 0)).toHaveLength(0);
  expect(pitches.filter((z) => z < 0)).toHaveLength(4 * 6);
  context.detailedBuildings.computeBoundingBox();
  expect(context.detailedBuildings.boundingBox!.max.y).toBeCloseTo(8, 5);
  expect(context.roofStats.shapes).toEqual({ flat: 1 });
  for (const part of [context.buildings, context.detailedBuildings, context.ground]) part.dispose();
});
