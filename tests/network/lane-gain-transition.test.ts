import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile, type CompiledCity, type CRoad } from '../../src/network';
import { PLACEMENT_TRANSITION } from '../../src/network/lanes';
import { approachMarkings } from '../../src/render/layers/roads';
import { transitionLanes } from '../../src/render/road-paint';
import type { Road } from '../../src/schema';

// TASK-264 (TASK-216 D7): a lane gain or drop whose narrower road is mapped as the transition
// (`placement=transition`) tapers along that road: its surface widens to the wider road's block,
// whose lanes are drawn at full width from the node, and the gain's arrows stand on the widening.
// The compiled lanes still part from the lane that feeds them.

function compiled(transition: boolean) {
  const { city, node, road } = buildCity('Transition gains', 1);
  const mark = (r: Road) => {
    if (transition) r.provenance = { source: 'osm', inferred: [PLACEMENT_TRANSITION] };
    return r;
  };
  const opts = { roadClass: 'primary', speedKmh: 30 } as const;
  // A gain, 2 to 4 lanes after a 40 m transition, and a drop, 4 to 2 lanes before one.
  const [gainFrom, gainAt] = [node(-40, 0), node(0, 0)];
  road(node(-200, 0), gainFrom, { ...opts, lanes: 2 });
  const gainNarrow = mark(road(gainFrom, gainAt, { ...opts, lanes: 2 }));
  const gainWide = road(gainAt, node(120, 0), { ...opts, lanes: 4 });
  const [dropAt, dropTo] = [node(0, 100), node(40, 100)];
  const dropWide = road(node(-120, 100), dropAt, { ...opts, lanes: 4 });
  const dropNarrow = mark(road(dropAt, dropTo, { ...opts, lanes: 2 }));
  road(dropTo, node(200, 100), { ...opts, lanes: 2 });
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const net = result.compiled;
  const of = (r: Road) => net.roads[net.index.road.get(r.id)!]!;
  return {
    net,
    gain: { narrow: of(gainNarrow), wide: of(gainWide) },
    drop: { narrow: of(dropNarrow), wide: of(dropWide) },
  };
}

/** The surface's width at station `i` (left edge at the stations, then the right edge back). */
function width(road: CRoad, i: number): number {
  const half = road.surface.length / 2;
  const a = road.surface[i]!,
    b = road.surface[2 * half - 1 - i]!;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const lanesOf = (net: CompiledCity, road: CRoad) => road.lanes.map((i) => net.lanes[i]!);

test('a gain or drop tapers along the narrower road where it is the mapped transition', () => {
  const { net, gain, drop } = compiled(true);
  // The wider roads' lanes are drawn from and to the node at full width: no fan on them.
  const painted = transitionLanes(net);
  expect(lanesOf(painted, gain.wide).map((l) => l.taperStartM)).toEqual([0, 0, 0, 0]);
  expect(lanesOf(painted, drop.wide).map((l) => l.taperEndM)).toEqual([0, 0, 0, 0]);
  const start = lanesOf(painted, gain.wide).map((l) => l.polyline[0]!.y);
  expect(start.map((y) => y - start[0]!)).toEqual(
    [0, 3.5, 7, 10.5].map((d) => expect.closeTo(d, 2)),
  );
  // The compiled ones still part from the lane that feeds them.
  expect(lanesOf(net, gain.wide).map((l) => l.taperStartM > 0)).toEqual([false, false, true, true]);
  // The transitions widen from their own two lanes to the four-lane block over their length.
  const last = gain.narrow.surface.length / 2 - 1;
  expect(width(gain.narrow, 0)).toBeCloseTo(7, 1);
  expect(width(gain.narrow, last)).toBeCloseTo(14, 1);
  expect(width(drop.narrow, 0)).toBeCloseTo(14, 1);
  expect(width(drop.narrow, drop.narrow.surface.length / 2 - 1)).toBeCloseTo(7, 1);
  for (let i = 1; i <= last; i++)
    expect(width(gain.narrow, i)).toBeGreaterThanOrEqual(width(gain.narrow, i - 1) - 1e-6);
  // The gain's arrows stand on the widening where 90% of the added width has opened: 7.8 m
  // before the node on a 40 m transition (smoothstep).
  for (const lane of lanesOf(net, gain.wide))
    expect(approachMarkings(net, lane).arrowAt).toBeCloseTo(-7.8, 0);

  // Without the tag the wider roads take the taper, as before.
  const plain = compiled(false);
  expect(
    lanesOf(transitionLanes(plain.net), plain.gain.wide).map((l) => l.taperStartM > 0),
  ).toEqual([false, false, true, true]);
  expect(width(plain.gain.narrow, plain.gain.narrow.surface.length / 2 - 1)).toBeCloseTo(7, 1);
  for (const lane of lanesOf(plain.net, plain.gain.wide))
    expect(approachMarkings(plain.net, lane).arrowAt).toBeGreaterThan(0);
});
