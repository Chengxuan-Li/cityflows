import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { compile } from '../../src/network';
import {
  gradeProfiles,
  laneHeightAt,
  profileHeightAt,
  roadStation,
} from '../../src/network/heights';
import { cityGrades } from '../../src/render/grades';
import { cityHeights, heightAt } from '../../src/render3d/heights';
import { pickLane3D } from '../../src/render3d/picking';
import { allocateId, type TripRequest } from '../../src/schema';
import { createEngine } from '../../src/sim/engine';
import {
  bodyClearLane,
  bodyClearOf,
  holdProgress,
  laneCrossings,
  lotHold,
  manoeuvrePath,
  motionPath,
  pathPose,
} from '../../src/sim/manoeuvre';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';

const { lengthM: L, widthM: W } = DEFAULT_SIM_PARAMS.vehicleClasses.car;
const north = -Math.PI / 2;

/**
 * A two-way street along y = 0 and, crossing over it at x = 150, a layer-2 bridge from ground
 * node A (y = 150) up a 90 m ramp to its deck (B to C, y = 60 to -60) and down to ground node D.
 */
function bridgeWorld() {
  const { city, node, road, street } = buildCity('Road grade', 175);
  const [east, west] = street(node(0, 0), node(300, 0));
  const [a, b, c, d] = [node(150, 150), node(150, 60, 2), node(150, -60, 2), node(150, -150)];
  const parts = [road(a!, b!), road(b!, c!), road(c!, d!)];
  for (const part of parts) part.layer = 2;
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const net = result.compiled;
  const lane = (id: string) => net.lanes[net.roads[net.index.road.get(id)!]!.lanes[0]!]!;
  return {
    city,
    net,
    near: lane(east!.id),
    far: lane(west!.id),
    up: lane(parts[0]!.id),
    deck: lane(parts[1]!.id),
  };
}

test('compiled roads, lanes and nodes carry the grade the 3D heights are drawn at', () => {
  const { city, net, near, up, deck } = bridgeWorld();
  expect(net.nodes.map((n) => n.grade)).toEqual(net.nodes.map((n) => city.nodes[n.id]!.layer));
  const layers = net.roads.map((r) => city.roads[r.id]!.layer ?? 0);
  expect(net.roads.map((r) => r.grade)).toEqual(layers);
  expect([near.grade, up.grade, deck.grade]).toEqual([0, 2, 2]);
  expect(net.lanes.map((l) => l.grade)).toEqual(net.lanes.map((l) => net.roads[l.road]!.grade));
  expect(cityGrades(net).roadGrades).toEqual(layers);

  expect(laneHeightAt(net, near, { x: 150, y: 0 })).toBe(0);
  expect(laneHeightAt(net, deck, { x: 150, y: 0 })).toBeCloseTo(10, 6);
  // The ramp meets the ground at A and the deck at B.
  expect(laneHeightAt(net, up, { x: 150, y: 148 })).toBeLessThan(0.1);
  expect(laneHeightAt(net, up, { x: 150, y: 62 })).toBeGreaterThan(9.9);

  // Without terrain the 3D road profiles are the compiled ones.
  const heights = cityHeights(net, city);
  for (const road of net.roads)
    for (const p of road.reference) {
      const s = roadStation(road, p);
      expect(heightAt(heights.roads[road.idx]!, s)).toBe(
        profileHeightAt(gradeProfiles(net).roads[road.idx]!, s),
      );
    }
});

test('a lot exit holds clear of lanes at its level and ignores the bridge above it', () => {
  const { net, near, far, up, deck } = bridgeWorld();
  const level = { city: net, heightM: 0 };
  // A body under the deck: overlapping in plan, 10 m below.
  const under = { x: 148, y: 5, heading: north };
  expect(bodyClearLane(under, deck, L, W)).toBe(false);
  expect(bodyClearLane(under, deck, L, W, level)).toBe(true);
  // On the ramp's ground end the bridge's own lane is at the lot's level.
  expect(bodyClearOf({ x: 149, y: 146, heading: north }, up, L, W, level)).toBe(false);
  expect(bodyClearOf({ x: 149, y: 70, heading: north }, up, L, W, level)).toBe(true);

  // A drive-out north under the deck to the far (westbound) lane, across the near lane.
  const path = motionPath([
    { x: 148, y: 40 },
    { x: 148, y: 2 },
  ]);
  const street = [near, far, deck];
  const holdM = lotHold(path, far, street, L, W, level);
  const hold = pathPose(path, holdM);
  expect(bodyClearOf(hold, near, L, W)).toBe(true);
  expect(hold.y).toBeLessThan(near.widthM + 1);
  // Counting the deck as a lane at grade, no pose is clear and it keeps the exit-only hold.
  expect(lotHold(path, far, street, L, W)).toBe(holdProgress(path, far, L, W));

  const join = { x: hold.x - 8, y: -1.5, heading: Math.PI };
  const merge = manoeuvrePath(hold, join, false);
  expect(laneCrossings(merge, far, street, L, W, level).map((c) => c.lane)).toEqual([near.idx]);
  expect(laneCrossings(merge, far, street, L, W).map((c) => c.lane)).toEqual([near.idx, deck.idx]);
});

test('3D picking takes the highest grade where lanes overlap on screen', () => {
  const { net, near, deck } = bridgeWorld();
  // An oblique view: a point h metres up is drawn h pixels higher.
  const project = (p: { x: number; y: number }, h: number) => ({ x: p.x, y: p.y - h });
  // The deck over the street (150, 0) is drawn at (150, -10), where the street also lies.
  expect(pickLane3D(net, { x: 150, y: -10 }, project)).toEqual({
    kind: 'lane',
    lane: deck.idx,
    road: deck.road,
  });
  expect(pickLane3D(net, { x: 100, y: 1 }, project)).toEqual({
    kind: 'lane',
    lane: near.idx,
    road: near.road,
  });
  expect(pickLane3D(net, { x: 100, y: 40 }, project)).toBeNull();
});

/**
 * TASK-157's far-lane exit (a lot south of a two-way street, leaving across the near lane to the
 * far one) under a bridge at `layer` along x = 150, over the lot and the mouth, carrying a car
 * every 2 s from 100 s. Returns when the lot car was granted its merge and when it arrived.
 */
function exitUnderBridge(layer: number) {
  const { city, node, road, street, place } = buildCity('Exit under a bridge', 175);
  const [east, west] = street(node(0, 0), node(400, 0));
  const bridge = road(node(150, -150, layer), node(150, 150, layer));
  bridge.layer = layer;
  place('Shop', 'retail', { x: 160, y: 30 }, []);
  place('West end', 'gateway', { x: -10, y: -10 }, [
    { road: west!, positionM: 390, direction: 'in' },
  ]);
  place('North', 'gateway', { x: 150, y: -160 }, [
    { road: bridge, positionM: 5, direction: 'out' },
  ]);
  place('South', 'gateway', { x: 150, y: 160 }, [
    { road: bridge, positionM: 295, direction: 'in' },
  ]);
  const [shop, westEnd, northEnd, southEnd] = Object.values(city.places);
  for (const p of Object.values(city.places)) p.population = p.jobs = 0;
  const id = allocateId(city, 'pk');
  const connector = (roadId: string, positionM: number, direction: 'in' | 'out') => ({
    id: allocateId(city, 'c'),
    roadId,
    lane: 0,
    positionM,
    direction,
    throughputPerMin: 60,
  });
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 10,
      access: 'public',
      placeId: shop!.id,
      connectors: [connector(east!.id, 150, 'in'), connector(west!.id, 250, 'out')],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 80, y: 8 },
          { x: 240, y: 8 },
          { x: 240, y: 50 },
          { x: 80, y: 50 },
        ],
      },
      occupancyAtStart: 0.1,
      provenance: { source: 'authored', inferred: ['driveway'] },
    },
  };
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const trip = (name: string, origin: string, destination: string, departS: number) =>
    ({
      id: name,
      personId: null,
      originPlaceId: origin,
      destinationPlaceId: destination,
      departS,
      mode: 'car',
      vehicleClass: 'car',
      purpose: 'private',
      legs: [],
    }) satisfies TripRequest;
  const trips = [
    ...Array.from({ length: 60 }, (_, i) =>
      trip(`bridge:${i}`, northEnd!.id, southEnd!.id, 100 + 2 * i),
    ),
    trip('leaving', shop!.id, westEnd!.id, 110),
  ];
  const engine = createEngine();
  engine.load({
    compiled: result.compiled,
    trips,
    scenario: {
      ...defaultScenario('grid5x5', 175),
      startS: 100,
      endS: 1500,
      simParams: { streetParkingShare: 0 },
    },
  });
  let mergeS = NaN;
  for (let step = 0; step < 14000; step++) {
    engine.step();
    const detail = engine.inspect(trips.length);
    if (detail?.parkingPhase === 'merge' && Number.isNaN(mergeS)) mergeS = engine.timeS;
    if (detail?.state === 'completed' || detail?.state === 'failed') break;
  }
  return { mergeS, state: engine.inspect(trips.length)!.state, doneS: engine.timeS };
}

test('bridge traffic overhead does not hold a lot exit; the same road at grade does', () => {
  const above = exitUnderBridge(2),
    atGrade = exitUnderBridge(0);
  expect(above.state).toBe('completed');
  expect(atGrade.state).toBe('completed');
  console.info('exit under a bridge', { above, atGrade });
  expect(atGrade.mergeS).toBeGreaterThan(above.mergeS);
});
