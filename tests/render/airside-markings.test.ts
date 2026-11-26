import { describe, expect, test } from 'vitest';
import type { Graphics } from 'pixi.js';
import { airsideMarkings } from '../../src/render/airside-markings';
import { drawContext } from '../../src/render/layers/context';
import type { Vec2 } from '../../src/geo/vec2';
import type { AirsideEdge, Airport, RunwayEnd } from '../../src/schema/airport';

const generated = { source: 'generated' } as const;
const p = (x: number, y: number): Vec2 => ({ x, y });

function syntheticAirfield(widthM = 30): Airport {
  const ends: [RunwayEnd, RunwayEnd] = [
    {
      designator: '09',
      node: 'west',
      pos: p(0, 0),
      threshold: { node: 'threshold', pos: p(60, 0) },
      displacedM: 60,
      heading: 0,
    },
    {
      designator: '27',
      node: 'east',
      pos: p(1500, 0),
      threshold: { node: 'east', pos: p(1500, 0) },
      displacedM: 0,
      heading: Math.PI,
    },
  ];
  const nodes = Object.fromEntries(
    [
      ['west', p(0, 0)],
      ['threshold', p(60, 0)],
      ['exit', p(300, 0)],
      ['east', p(1500, 0)],
      ['hold', p(320, 45)],
      ['join', p(320, 80)],
      ['taxilane', p(400, 80)],
      ['stand', p(400, 125)],
    ].map(([key, pos]) => [key, { id: key, pos, layer: 0, provenance: generated }]),
  ) as Airport['nodes'];
  const edge = (
    id: string,
    from: string,
    to: string,
    kind: AirsideEdge['kind'],
    width: number,
  ): AirsideEdge => ({
    id,
    from,
    to,
    kind,
    widthM: width,
    line: [nodes[from]!.pos, nodes[to]!.pos],
    layer: 0,
    maxCode: 'C',
    provenance: generated,
  });
  return {
    name: 'Synthetic 09/27',
    nodes,
    edges: {
      west: edge('west', 'west', 'threshold', 'runway', widthM),
      mid: edge('mid', 'threshold', 'exit', 'runway', widthM),
      east: edge('east', 'exit', 'east', 'runway', widthM),
      // The runway-facing edge is deliberately stored in the opposite direction to travel.
      exit: edge('exit', 'exit', 'hold', 'taxiway', 15),
      approach: edge('approach', 'hold', 'join', 'taxiway', 15),
      parallel: edge('parallel', 'join', 'taxilane', 'taxilane', 15),
      stand: edge('stand', 'taxilane', 'stand', 'lead_in', 15),
    },
    runways: {
      runway: {
        id: 'runway',
        ref: '09/27',
        ends,
        edges: ['west', 'mid', 'east'],
        lengthM: 1500,
        widthM,
        stopways: [],
        maxCode: 'C',
        osmIds: [],
        provenance: generated,
      },
    },
    holdingPositions: {
      hold: {
        id: 'hold',
        node: 'hold',
        kind: 'runway',
        runway: 'runway',
        side: 'right',
        toward: 'exit',
        osmId: 1,
        provenance: generated,
      },
    },
    stands: {
      stand: {
        id: 'stand',
        ref: '2',
        kind: 'contact',
        pos: nodes.stand!.pos,
        heading: Math.PI / 2,
        leadIn: ['stand'],
        maxCode: 'C',
        gate: null,
        osmIds: [],
        provenance: generated,
      },
    },
    surfaces: [
      { kind: 'apron', rings: [[p(350, 75), p(450, 75), p(450, 155), p(350, 155)]], osmId: 2 },
    ],
    gates: {},
    terminals: {},
    hangars: [],
    helipads: {},
    windsocks: [],
    approachAids: [],
    turnPads: [{ pos: p(1460, 0), osmId: 3 }],
    roadCrossings: [],
  };
}

describe('airside paint', () => {
  test.each([
    [18, 4],
    [23, 6],
    [30, 8],
    [45, 12],
    [60, 16],
  ])('paints %i m runway thresholds with %i stripes each', (width, count) => {
    const paint = airsideMarkings(syntheticAirfield(width));
    for (const [start, end] of [
      [66, 96],
      [1464, 1494],
    ]) {
      const bars = paint.filter(
        ({ points, kind }) =>
          kind === 'polygon' && points.every(({ x }) => x >= start! && x <= end!),
      );
      expect(bars).toHaveLength(count);
      expect(bars.filter(({ points }) => points.every(({ y }) => y < 0))).toHaveLength(count / 2);
      expect(bars.filter(({ points }) => points.every(({ y }) => y > 0))).toHaveLength(count / 2);
    }
  });

  test('reads the designators from their respective approach ends', () => {
    const airport = syntheticAirfield();
    const paint = airsideMarkings(airport);
    const letters = paint.filter((s) => s.kind === 'line' && s.widthM === 1.5);
    expect(letters).toHaveLength(4);
    // From the east, the 2 is on the pilot's left (south), the 7 on the right.
    const [zero, nine, two, seven] = letters;
    expect(zero!.points.every(({ y }) => y < 0)).toBe(true);
    expect(nine!.points.every(({ y }) => y > 0)).toBe(true);
    expect(two!.points.every(({ y }) => y > 0)).toBe(true);
    expect(seven!.points.every(({ y }) => y < 0)).toBe(true);
    expect(seven!.points[0]!.x).toBeCloseTo(1448);
    expect(seven!.points.at(-1)!.x).toBeCloseTo(1457);
    expect(
      paint.filter(({ points, kind }) => kind === 'polygon' && points.length === 7),
    ).toHaveLength(2);

    airport.runways.runway!.ends[0].designator = '08L';
    const changed = airsideMarkings(structuredClone(airport)).filter(
      (s) => s.kind === 'line' && s.widthM === 1.5,
    );
    expect(changed).toHaveLength(6);
    expect(changed[3]!.points.every(({ x }) => x >= 115)).toBe(true);
  });

  test('spans the exit at the hold with the solid rows on the holding side', () => {
    const airport = syntheticAirfield();
    const paint = airsideMarkings(airport);
    const { x, y } = airport.nodes.hold!.pos;
    const length = Math.hypot(20, 45);
    const stations = paint.flatMap((s) => {
      if (s.kind !== 'line' || s.widthM !== 0.3 || s.points.length !== 2) return [];
      const [a, b] = s.points;
      const along = ({ x: u, y: v }: Vec2) => ((u - x) * -20 + (v - y) * -45) / length;
      const from = along(a!);
      return Math.abs(from) < 1 && Math.abs(from - along(b!)) < 1e-7
        ? [{ station: Number(from.toFixed(2)), span: Math.hypot(a!.x - b!.x, a!.y - b!.y) }]
        : [];
    });
    expect(stations.filter(({ span }) => span > 14).map(({ station }) => station)).toEqual([
      -0.9, -0.3,
    ]);
    expect([
      ...new Set(stations.filter(({ span }) => span < 2).map(({ station }) => station)),
    ]).toEqual([0.3, 0.9]);
  });

  test('joins taxi and stand centrelines and paints the stand number beside its stop', () => {
    const airport = syntheticAirfield();
    const { parallel, stand } = airport.edges;
    const paint = airsideMarkings(airport);
    expect(paint.filter((s) => s.kind === 'line' && s.widthM === 0.3).map((s) => s.points)).toEqual(
      expect.arrayContaining([parallel!.line, stand!.line]),
    );
    expect(paint.some((s) => s.kind === 'line' && s.widthM === 0.15)).toBe(true);
    const label = paint.filter((s) => s.kind === 'line' && s.widthM === 2.4 / 6);
    expect(label).toHaveLength(1);
    const { pos } = airport.stands.stand!;
    expect(label[0]!.points.every(({ x }) => x < pos.x)).toBe(true);
    expect(Math.min(...label[0]!.points.map(({ y }) => y))).toBeCloseTo(pos.y - 1.2);
    expect(Math.max(...label[0]!.points.map(({ y }) => y))).toBeCloseTo(pos.y + 1.2);
    expect(paint.some((s) => s.kind === 'line' && s.widthM === 0.3 && s.points.length > 25)).toBe(
      true,
    );
  });
});

test('draws the aerodrome tint over land and under water', () => {
  const land = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)];
  const water = [p(40, 40), p(80, 40), p(80, 80), p(40, 80)];
  const context = drawContext(
    [
      { kind: 'area', class: 'landuse', rings: [land] },
      { kind: 'area', class: 'water', rings: [water] },
    ],
    undefined,
    true,
  );
  const [ground, tint, features] = context.container.children as Graphics[];
  expect(tint).toBe(context.aerodromeTint);
  expect(ground!.containsPoint(p(10, 10))).toBe(true);
  expect(features!.containsPoint(p(60, 60))).toBe(true);
  expect(features!.containsPoint(p(10, 10))).toBe(false);
  context.setVisible(false);
  expect(features!.visible).toBe(false);
  expect(tint!.visible).toBe(true);
  context.container.destroy({ children: true, context: true });
});
