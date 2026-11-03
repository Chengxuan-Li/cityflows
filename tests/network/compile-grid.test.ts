import { bypass } from '../../src/fixtures/bypass';
import { disconnected } from '../../src/fixtures/disconnected';
import { dividedHighway } from '../../src/fixtures/divided-highway';
import { ramp } from '../../src/fixtures/ramp';
import { scenarios } from '../../src/fixtures/scenarios';
import { shortTurnLane } from '../../src/fixtures/short-turn-lane';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { citySchema } from '../../src/schema';
import { expect, it } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { compile } from '../../src/network';
import { pointAtDistance } from '../../src/geo/polyline';

it('lays out and trims lanes deterministically on the grid', () => {
  const city = grid5x5();
  const result = compile(city);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { compiled } = result;
  expect(compiled.lanes).toHaveLength(
    Object.values(city.roads).reduce((sum, road) => sum + road.lanes.length, 0),
  );
  const first = compiled.roads.find((road) => road.streetGroupId !== null)!;
  const second = compiled.roads.find(
    (road) => road.idx !== first.idx && road.streetGroupId === first.streetGroupId,
  )!;
  for (const i of first.lanes)
    for (const j of second.lanes) {
      const a = compiled.lanes[i]!;
      const b = compiled.lanes[j]!;
      const p = pointAtDistance(a.polyline, a.cumulative, a.lengthM / 2);
      const q = pointAtDistance(b.polyline, b.cumulative, b.lengthM / 2);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(
        (a.widthM + b.widthM) / 2 - 1e-8,
      );
    }
  const lane = compiled.lanes[first.lanes[0]!]!;
  const road = city.roads[first.id]!;
  const start = road.centerline[0]!;
  const end = road.centerline[1]!;
  const { x, y } = lane.polyline[0]!;
  expect(
    ((x - start.x) * (end.x - start.x) + (y - start.y) * (end.y - start.y)) / first.lengthM,
  ).toBeCloseTo(compiled.nodes[first.from]!.radiusM);
  expect(compiled.laneSpatial.search(x, y, x, y).length).toBeGreaterThan(0);
  const again = compile(city);
  expect(again).toEqual(result);
  if (!again.ok) throw new Error('Expected a compiled grid');
  expect(again.compiled.movements.map((m) => m.id)).toEqual(compiled.movements.map((m) => m.id));
});

const fixtures = {
  grid5x5,
  signalApproach,
  bypass,
  ramp,
  dividedHighway,
  shortTurnLane,
  disconnected,
};

it.each(Object.entries(fixtures))(
  '%s validates and compiles with its default scenario',
  (id, fixture) => {
    const matching = scenarios.filter((scenario) => scenario.id === id);
    expect(matching).toHaveLength(1);
    const city = fixture(matching[0]!.seed);
    expect(citySchema.parse(city)).toEqual(city);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.compiled.connectors.length).toBeGreaterThan(0);
    expect(result.compiled.movements.filter((movement) => movement.neverGreen)).toEqual([]);
    expect(fixture(matching[0]!.seed)).toEqual(city);
  },
);
