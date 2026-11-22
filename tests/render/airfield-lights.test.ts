import { expect, test } from 'vitest';
import { syntheticAirport } from '../../src/fixtures/synthetic-airport';
import {
  aircraftLights,
  airfieldColors,
  airfieldLightColors,
  papiAngles,
  placeAirfieldLights,
  type AirfieldLight,
  type AirfieldLightKind,
} from '../../src/render/airfield-lights';
import type { AircraftPose, AirfieldState } from '../../src/render/types';
import { createAircraftFleet, type AircraftPoseSnapshot } from '../../src/sim/aircraft';
import { setup } from '../sim/fixtures';

// TASK-301: airfield and aircraft lights by rule on the synthetic airport (runway 09/27 along
// y = 0 from x = 0 to 2,800 m, 45 m wide; four runway holds A1 to A4 100 m south of it).

const compiled = setup(syntheticAirport(1));
const graph = compiled.airside!;
const lights = placeAirfieldLights(graph);
const state = (
  arrival: number,
  departure = arrival,
  clearedHolds: number[] = [],
): AirfieldState => ({
  arrivalEnds: [arrival],
  departureEnds: [departure],
  clearedHolds,
  glideSlopeDeg: 3,
});
const lit = (colors: number[], kind: AirfieldLightKind) =>
  lights.map((l, i) => ({ ...l, color: colors[i]! })).filter((l) => l.kind === kind && l.color);
const byColor = (list: (AirfieldLight & { color: number })[]) => {
  const counts: Record<string, number> = {};
  const names = Object.fromEntries(Object.entries(airfieldColors).map(([k, v]) => [v, k]));
  for (const l of list) counts[names[l.color]!] = (counts[names[l.color]!] ?? 0) + 1;
  return counts;
};

test('runway lights by rule for each end in use: edge, centreline, threshold, end, approach, PAPI', () => {
  // Landing and taking off on 27 (westward): green across the 27 threshold, red across the 09
  // end, approach lights east of the threshold, PAPI on the left (south), coding towards x = 0.
  const on27 = airfieldLightColors(graph, lights, state(1), new Map());
  expect(byColor(lit(on27, 'threshold'))).toEqual({ green: 16 });
  expect(lit(on27, 'threshold').every((l) => l.x === 2800)).toBe(true);
  expect(byColor(lit(on27, 'runway-end'))).toEqual({ red: 8 });
  expect(lit(on27, 'runway-end').every((l) => l.x === 0)).toBe(true);
  const approach = lit(on27, 'approach');
  // 900 m on a 2,800 m runway: a centre barrette every 30 m and the crossbar at 300 m.
  expect(approach).toHaveLength(29 * 3 + 11);
  expect(Math.min(...approach.map((l) => l.x))).toBeCloseTo(2830);
  expect(Math.max(...approach.map((l) => l.x))).toBeCloseTo(3700);
  const papi = lit(on27, 'papi');
  expect(papi.map((l) => l.unit)).toEqual([0, 1, 2, 3]);
  expect(papi.every((l) => Math.abs(l.x - 2500) < 1e-6 && l.y > 22.5 + 14)).toBe(true);
  // On the glide path (no aircraft approaching): two red next to the runway, two white outside.
  expect(papi.map((l) => l.color)).toEqual([
    airfieldColors.red,
    airfieldColors.red,
    airfieldColors.white,
    airfieldColors.white,
  ]);
  const edge = lit(on27, 'runway-edge');
  expect(edge).toHaveLength(2 * 48);
  expect(edge.filter((l) => l.color === airfieldColors.amber).every((l) => l.x < 600)).toBe(true);
  expect(byColor(edge)).toEqual({ white: 2 * 37, amber: 2 * 11 });
  const centre = lit(on27, 'runway-centreline');
  expect(centre).toHaveLength(93);
  expect(centre.filter((l) => l.x < 300).every((l) => l.color === airfieldColors.red)).toBe(true);
  expect(centre.filter((l) => l.x > 900).every((l) => l.color === airfieldColors.white)).toBe(true);
  expect(byColor(centre.filter((l) => l.x > 300 && l.x < 900))).toEqual({ red: 10, white: 10 });

  // The configuration turns round to 09: the sets move to the other ends.
  const on09 = airfieldLightColors(graph, lights, state(0), new Map());
  expect(lit(on09, 'threshold').every((l) => l.x === 0)).toBe(true);
  expect(lit(on09, 'runway-end').every((l) => l.x === 2800)).toBe(true);
  expect(lit(on09, 'approach').every((l) => l.x < 0)).toBe(true);
  expect(lit(on09, 'papi').every((l) => l.x === 300 && l.y < -22.5 - 14)).toBe(true);
  expect(
    lit(on09, 'runway-edge')
      .filter((l) => l.color === airfieldColors.amber)
      .every((l) => l.x > 2200),
  ).toBe(true);
  // Landing 27 and departing 09: end lights at both ends, threshold and approach at 27 only.
  const mixed = airfieldLightColors(graph, lights, state(1, 0), new Map());
  expect(byColor(lit(mixed, 'runway-end'))).toEqual({ red: 16 });
  expect(lit(mixed, 'threshold').every((l) => l.x === 2800)).toBe(true);
  // No end in use: the runway is dark, the taxiways stay lit.
  const none = airfieldLightColors(graph, lights, state(-1), new Map());
  for (const kind of [
    'runway-edge',
    'runway-centreline',
    'threshold',
    'runway-end',
    'approach',
    'papi',
  ] as const)
    expect(lit(none, kind), kind).toEqual([]);
  expect(lit(none, 'taxiway-centreline').length).toBeGreaterThan(0);
});

test('taxiway, stop-bar and apron lights by rule', () => {
  const colors = airfieldLightColors(graph, lights, state(1), new Map());
  const centre = lit(colors, 'taxiway-centreline');
  expect(byColor(centre)).toEqual({ green: centre.length });
  // Never on the runway's pavement.
  expect(centre.every((l) => Math.abs(l.y) > 22.5 + 5)).toBe(true);
  const edge = lit(colors, 'taxiway-edge');
  expect(edge.length).toBeGreaterThan(0);
  expect(byColor(edge)).toEqual({ blue: edge.length });
  // Off every taxiway's pavement: at least half its width from each edge's centreline.
  for (const l of edge)
    for (const e of graph.edges)
      for (let i = 1; i < e.line.length; i++) {
        const a = e.line[i - 1]!,
          b = e.line[i]!;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((l.x - a.x) * (b.x - a.x) + (l.y - a.y) * (b.y - a.y)) /
              ((b.x - a.x) ** 2 + (b.y - a.y) ** 2),
          ),
        );
        const d = Math.hypot(l.x - a.x - t * (b.x - a.x), l.y - a.y - t * (b.y - a.y));
        expect(d).toBeGreaterThanOrEqual(e.widthM / 2 - 1e-6);
      }
  // A red stop bar across the taxiway at every runway holding position: 8 lights 3 m apart on
  // the 23 m code E taxiways, centred on the hold.
  const runwayHolds = graph.holds.filter((h) => h.runway >= 0);
  expect(runwayHolds).toHaveLength(4);
  for (const hold of runwayHolds) {
    const bar = lit(colors, 'stop-bar').filter((l) => l.hold === hold.idx);
    expect(byColor(bar)).toEqual({ red: 8 });
    const node = graph.nodes[hold.node]!.pos;
    const cx = bar.reduce((s, l) => s + l.x, 0) / bar.length,
      cy = bar.reduce((s, l) => s + l.y, 0) / bar.length;
    expect(Math.hypot(cx - node.x, cy - node.y)).toBeLessThan(1e-6);
    expect(Math.hypot(bar[1]!.x - bar[0]!.x, bar[1]!.y - bar[0]!.y)).toBeCloseTo(3, 0);
  }
  // A clearance switches its hold's bar off and leaves the others on.
  const cleared = airfieldLightColors(graph, lights, state(1, 1, [runwayHolds[0]!.idx]), new Map());
  expect(lit(cleared, 'stop-bar').some((l) => l.hold === runwayHolds[0]!.idx)).toBe(false);
  expect(lit(cleared, 'stop-bar')).toHaveLength(3 * 8);
  expect(lit(colors, 'apron-flood')).toHaveLength(graph.stands.length);
});

const approachPose = (distanceM: number, heightM: number): AircraftPose => ({
  id: 1,
  registration: 'G-TEST',
  typeId: 'E190',
  // East of the 27 PAPI (x = 2,500), approaching westward.
  x: 2500 + distanceM,
  y: 0,
  heightM,
  heading: Math.PI,
  speedMps: 70,
  state: 'approach',
  enginesRunning: true,
  onRunway: false,
  airborne: true,
  gearDown: true,
  stand: null,
  runwayEnd: '27',
  route: [],
});

test('PAPI shows red and white by the approaching aircraft height against the glide path', () => {
  const papiColors = (pose: AircraftPose, glideSlopeDeg = 3) =>
    lit(
      airfieldLightColors(
        graph,
        lights,
        { ...state(1), glideSlopeDeg },
        papiAngles(graph, lights, [pose]),
      ),
      'papi',
    ).map((l) => (l.color === airfieldColors.white ? 'W' : 'R'));
  const at = (distanceM: number, deg: number) =>
    approachPose(distanceM, distanceM * Math.tan((deg * Math.PI) / 180));
  // Scripted heights 3 km out (from the units next to the runway outward).
  expect(papiColors(at(3000, 3))).toEqual(['R', 'R', 'W', 'W']);
  expect(papiColors(at(3000, 3.3))).toEqual(['R', 'W', 'W', 'W']);
  expect(papiColors(at(3000, 4))).toEqual(['W', 'W', 'W', 'W']);
  expect(papiColors(at(3000, 2.7))).toEqual(['R', 'R', 'R', 'W']);
  expect(papiColors(at(3000, 2))).toEqual(['R', 'R', 'R', 'R']);
  // London City's 5.5-degree slope: on it at 5.5, low at 3.
  expect(papiColors(at(3000, 5.5), 5.5)).toEqual(['R', 'R', 'W', 'W']);
  expect(papiColors(at(3000, 3), 5.5)).toEqual(['R', 'R', 'R', 'R']);
  // The nearest approaching aircraft counts; one past the units does not.
  const high = at(6000, 4),
    low = { ...at(2000, 2), id: 2 },
    past = { ...at(-500, 1), id: 3 };
  expect(papiAngles(graph, lights, [high, low, past]).get(1)).toBeCloseTo(2, 1);
  expect(papiAngles(graph, lights, [past]).size).toBe(0);
});

test('aircraft light states follow the sim states', () => {
  const base = {
    enginesRunning: true,
    speedMps: 5,
    onRunway: false,
    airborne: false,
    gearDown: true,
  };
  const on = (state: string, extra: Partial<typeof base> = {}) =>
    Object.entries(aircraftLights({ ...base, ...extra, state }))
      .filter(([, v]) => v)
      .map(([k]) => k);
  expect(on('parked', { enginesRunning: false, speedMps: 0 })).toEqual(['nav']);
  expect(on('tow', { enginesRunning: false, speedMps: 2 })).toEqual(['nav', 'beacon']);
  expect(on('pushback')).toEqual(['nav', 'beacon']);
  expect(on('taxi')).toEqual(['nav', 'beacon', 'taxi']);
  expect(on('holding', { speedMps: 0 })).toEqual(['nav', 'beacon']);
  expect(on('line-up', { onRunway: true })).toEqual(['nav', 'beacon', 'strobes', 'taxi']);
  expect(on('takeoff-roll', { onRunway: true })).toEqual(['nav', 'beacon', 'strobes', 'landing']);
  expect(on('climb', { airborne: true })).toEqual(['nav', 'beacon', 'strobes', 'landing']);
  expect(on('climb', { airborne: true, gearDown: false })).toEqual(['nav', 'beacon', 'strobes']);
  expect(on('approach', { airborne: true })).toEqual(['nav', 'beacon', 'strobes', 'landing']);
  expect(on('landing-roll', { onRunway: true })).toEqual(['nav', 'beacon', 'strobes', 'landing']);
  expect(on('hover-taxi', { airborne: true })).toEqual(['nav', 'beacon', 'strobes', 'taxi']);
});

test('from the sim: ends in use, stop bars switched by clearance, PAPI on slope, lights by state', () => {
  const fleet = createAircraftFleet(graph, 1);
  expect(fleet.airfield()).toMatchObject({
    arrivalEnds: [-1],
    departureEnds: [-1],
    clearedHolds: [],
  });
  fleet.setActiveEnds({ arrivalEnds: ['27'], departureEnds: ['09'] });
  expect(fleet.airfield()).toMatchObject({ arrivalEnds: [1], departureEnds: [0] });
  const stand = (ref: string) => graph.stands.find((s) => s.ref === ref)!.id;
  const departure = fleet.spawnParked({ typeId: 'E190', stand: stand('1') });
  if (!departure.ok) throw new Error(departure.reason);
  // A departure on 27 while an arrival lands on 27: the departure holds at its stop bar.
  expect(fleet.requestDeparture(departure.id, '27').ok).toBe(true);
  let arrivalRequested = false;
  const seen = new Set<string>();
  const lightsByState = new Map<string, string>();
  let holdingBarOn = false,
    clearedWhileLiningUp = false,
    onSlope = 0,
    approachSamples = 0;
  let clearedHold = -1;
  for (let step = 0; step * 0.1 <= 1500; step++) {
    fleet.step(step * 0.1);
    if (step % 5) continue;
    const poses: AircraftPoseSnapshot[] = fleet.snapshot();
    // Once it taxis east along the parallel taxiway, an arrival on 27 makes it hold.
    if (
      !arrivalRequested &&
      poses.some((p) => p.id === departure.id && p.state === 'taxi' && p.x > 1900)
    ) {
      arrivalRequested = true;
      expect(fleet.requestArrival({ typeId: 'E175', runwayEnd: '27', stand: stand('4') }).ok).toBe(
        true,
      );
      expect(fleet.airfield()).toMatchObject({ arrivalEnds: [1], departureEnds: [1] });
    }
    const airfield = fleet.airfield();
    const mine = poses.find((p) => p.id === departure.id);
    if (mine) {
      seen.add(mine.state);
      const key = Object.entries(aircraftLights(mine))
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(' ');
      if (!lightsByState.has(mine.state)) lightsByState.set(mine.state, key);
      const nearest = graph.holds
        .filter((h) => h.runway >= 0)
        .map((h) => ({
          h,
          d: Math.hypot(graph.nodes[h.node]!.pos.x - mine.x, graph.nodes[h.node]!.pos.y - mine.y),
        }))
        .sort((a, b) => a.d - b.d)[0]!;
      if (
        mine.state === 'holding' &&
        nearest.d < 40 &&
        !airfield.clearedHolds.includes(nearest.h.idx)
      )
        holdingBarOn = true;
      if (airfield.clearedHolds.length) {
        clearedHold = airfield.clearedHolds[0]!;
        if (mine.state === 'taxi' || mine.state === 'line-up') clearedWhileLiningUp = true;
      }
    }
    for (const p of poses)
      if (p.state === 'approach' && p.heightM > 50) {
        approachSamples++;
        const colors = lit(
          airfieldLightColors(graph, lights, airfield, papiAngles(graph, lights, [p])),
          'papi',
        ).map((l) => (l.color === airfieldColors.white ? 'W' : 'R'));
        if (colors.join('') === 'RRWW') onSlope++;
      }
    if (fleet.metrics().departed === 1 && fleet.metrics().landed === 1 && !mine) break;
  }
  expect(fleet.metrics()).toMatchObject({ departed: 1, landed: 1, stuck: 0 });
  expect(seen.has('holding')).toBe(true);
  expect(holdingBarOn).toBe(true);
  expect(clearedWhileLiningUp).toBe(true);
  expect(clearedHold).toBeGreaterThanOrEqual(0);
  // After the take-off every stop bar is back on.
  expect(fleet.airfield().clearedHolds).toEqual([]);
  // The arrival flies the glide path: the PAPI shows two red and two white nearly throughout.
  expect(approachSamples).toBeGreaterThan(100);
  expect(onSlope / approachSamples).toBeGreaterThan(0.9);
  expect(Object.fromEntries(lightsByState)).toMatchObject({
    pushback: 'nav beacon',
    taxi: 'nav beacon taxi',
    holding: 'nav beacon',
    'takeoff-roll': 'nav beacon strobes landing',
    climb: 'nav beacon strobes landing',
  });
});
