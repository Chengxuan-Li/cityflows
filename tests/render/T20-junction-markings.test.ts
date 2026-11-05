import { expect, test } from 'vitest';
import type { Graphics } from 'pixi.js';
import { junctions } from '../../src/fixtures/junctions';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { drawNode, nodeColor } from '../../src/render/layers/nodes';
import { drawRoad, crossingStripes } from '../../src/render/layers/roads';
import { createGrade, pickThroughNode } from '../../src/render/scene';
import { createPicker } from '../../src/render/picking';
import { roadStyle, style } from '../../src/render/style';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { scenario, trips } from '../sim/fixtures';
import { defaultLayers } from '../../src/render/types';
import { insideOutline } from '../network/junction-audit';
import { headingAtDistance, pointAtDistance, pointInPolygon } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';

function recorder() {
  const polygons: Vec2[][] = [];
  const fills: number[] = [];
  const segments: Vec2[][] = [];
  let previous = { x: 0, y: 0 };
  const graphics = {
    poly(points: Vec2[]) {
      polygons.push(points);
      return this;
    },
    fill(color: number) {
      fills.push(color);
      return this;
    },
    stroke() {
      return this;
    },
    moveTo(x: number, y: number) {
      previous = { x, y };
      return this;
    },
    lineTo(x: number, y: number) {
      segments.push([previous, { x, y }]);
      previous = { x, y };
      return this;
    },
    circle() {
      throw new Error('Node geometry must not use discs');
    },
  };
  return { graphics: graphics as unknown as Graphics, polygons, fills, segments };
}

test('T20: a through-node handle stays behind an overpassing bridge', () => {
  const { city, node, road } = buildCity('Through under bridge', 1);
  const middle = node(0, 0);
  road(node(0, -100), middle);
  road(middle, node(0, 100));
  road(node(-100, 0, 1), node(100, 0, 1));
  const result = compile(city);
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  const nodeGrades = net.nodes.map((n) => city.nodes[n.id]!.layer);
  const roadGrades = net.roads.map((r) => nodeGrades[r.from]!);
  const hit = createPicker(net, [], roadGrades)(middle.pos);
  expect(hit?.kind).toBe('lane');
  if (hit?.kind !== 'lane') throw new Error('expected bridge');
  expect(roadGrades[hit.road]).toBe(1);
  expect(pickThroughNode(net, middle.pos, 1, nodeGrades, roadGrades[hit.road]!)).toBeUndefined();
  expect(pickThroughNode(net, middle.pos, 1, nodeGrades, 0)?.id).toBe(middle.id);
});

test('T20: renderer draws the compiled outline and no area at a through node', () => {
  const result = compile(signalApproach());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  const n = net.nodes.find((n) => n.signal)!;
  const record = recorder();
  drawNode(record.graphics, n);
  expect(record.polygons).toEqual([n.outline]);
  const { city, node, road } = buildCity('Through', 1);
  const middle = node(0, 0);
  road(node(-100, 0), middle);
  road(middle, node(100, 0));
  const through = compile(city);
  if (!through.ok) throw new Error('fixture');
  const empty = recorder();
  const center = through.compiled.nodes[through.compiled.index.node.get(middle.id)!]!;
  drawNode(empty.graphics, center);
  expect(empty.polygons).toEqual([]);
});

test.each(['signal', 'yield'] as const)('T20: %s marking meets the stop position', (control) => {
  const result = compile(signalApproach());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  const node = net.nodes.find((n) => n.signal)!;
  const road = net.roads.find((r) => r.to === node.idx)!;
  if (control === 'yield') {
    node.signal = null;
    node.control = 'yield';
    for (const lane of net.lanes) lane.stopM = lane.lengthM;
    node.movements.forEach((i) => {
      net.movements[i]!.priority = 2;
    });
  }
  const marks = recorder();
  drawRoad(recorder().graphics, marks.graphics, net, road);
  for (const i of road.lanes) {
    const lane = net.lanes[i]!;
    const end = pointAtDistance(lane.polyline, lane.cumulative, lane.stopM),
      prev = lane.polyline.at(-2)!;
    const length = Math.hypot(end.x - prev.x, end.y - prev.y);
    const dx = (end.x - prev.x) / length,
      dy = (end.y - prev.y) / length;
    const atEnd = marks.polygons.filter((points) =>
      points.every(
        (p) =>
          Math.abs((p.x - end.x) * dx + (p.y - end.y) * dy) < (control === 'signal' ? 0.01 : 1.01),
      ),
    );
    expect(
      atEnd.some((points) =>
        points.some((p) => Math.abs((p.x - end.x) * dx + (p.y - end.y) * dy) < 0.01),
      ),
    ).toBe(true);
  }
});

test('T20: signal crossings lie on the road between stop position and junction', () => {
  const result = compile(signalApproach());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  const node = net.nodes.find((n) => n.signal)!;
  for (const road of net.roads.filter((r) => r.to === node.idx)) {
    const stripes = crossingStripes(net, road, true);
    expect(stripes.length).toBeGreaterThan(0);
    const lane = net.lanes[road.lanes[0]!]!;
    const end = lane.polyline.at(-1)!;
    const h = headingAtDistance(lane.polyline, lane.cumulative, lane.lengthM);
    for (const stripe of stripes) {
      expect(stripe.every((p) => pointInPolygon(p, [...road.surface, road.surface[0]!]))).toBe(
        true,
      );
      expect(stripe.some((p) => pointInPolygon(p, node.outline))).toBe(false);
      const along = stripe.map((p) => (p.x - end.x) * Math.cos(h) + (p.y - end.y) * Math.sin(h));
      expect(Math.min(...along)).toBeCloseTo(-2.75);
      expect(Math.max(...along)).toBeCloseTo(-0.25);
    }
  }
});

test('T20: one asphalt by default, optional class tones include the highest-class junction', () => {
  const result = compile(signalApproach());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  const node = net.nodes.find((n) => n.signal)!;
  const incident = net.roads.filter((r) => r.from === node.idx || r.to === node.idx);
  incident[0]!.roadClass = 'motorway';
  incident[0]!.classRank = 100;
  expect(defaultLayers.roadClasses).toBe(false);
  for (const road of net.roads) expect(roadStyle(road).color).toBe(style.asphalt);
  expect(nodeColor(net, node)).toBe(style.asphalt);
  expect(nodeColor(net, node, true)).toBe(roadStyle(incident[0]!, true).color);
  expect(nodeColor(net, node, true)).not.toBe(style.asphalt);
});

test('T20: an actual red-light queue stops behind both the stop line and zebra', () => {
  const city = signalApproach();
  const result = compile(city);
  if (!result.ok) throw new Error('fixture');
  const compiled = result.compiled;
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: { ...scenario(), startS: 29 },
    trips: trips(city, 4, 0.5).map((t) => ({ ...t, departS: t.departS - 71 })),
  });
  engine.step(600);
  const stopped = [...engine.snapshot().id]
    .map((id) => engine.inspect(id)!)
    .filter((v) => v.speedMps < 0.1);
  expect(stopped.length).toBeGreaterThan(0);
  for (const car of stopped) {
    const lane = compiled.lanes[car.lane]!;
    const road = compiled.roads[lane.road]!;
    expect(car.positionM).toBeLessThanOrEqual(lane.stopM - DEFAULT_SIM_PARAMS.idm.minGapM + 1e-6);
    expect(crossingStripes(compiled, road, true).length).toBeGreaterThan(0);
  }
});

test('T20: the gore covers road markings, with crossings above the node area', () => {
  const grade = createGrade(0);
  expect(grade.terrain.children.indexOf(grade.nodes)).toBeGreaterThan(
    grade.terrain.children.indexOf(grade.markings),
  );
  expect(grade.terrain.children.indexOf(grade.crossings)).toBeGreaterThan(
    grade.terrain.children.indexOf(grade.nodes),
  );
  const result = compile(junctions());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  const node = net.nodes[net.index.node.get('n:1')!]!;
  for (const road of net.roads.filter((r) => r.from === node.idx || r.to === node.idx)) {
    const marks = recorder();
    drawRoad(recorder().graphics, marks.graphics, net, road);
    for (const line of [...marks.polygons, ...marks.segments])
      for (const p of line)
        expect(
          insideOutline(p, road.surface.concat([road.surface[0]!])) ||
            insideOutline(p, node.outline),
        ).toBe(true);
  }
  grade.group.destroy({ children: true });
});

test('T20: draw calls use the selected asphalt tone', () => {
  const result = compile(signalApproach());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  for (const roadClasses of [false, true]) {
    for (const road of net.roads) {
      const surface = recorder();
      drawRoad(surface.graphics, recorder().graphics, net, road, roadClasses);
      expect(surface.fills).toEqual([roadStyle(road, roadClasses).color]);
    }
    for (const node of net.nodes) {
      const record = recorder();
      drawNode(record.graphics, node, nodeColor(net, node, roadClasses));
      expect(record.fills).toEqual(node.outline.length ? [nodeColor(net, node, roadClasses)] : []);
    }
  }
});

test('T20: a served outer lane keeps the full-width crossing when lane zero is unserved', () => {
  const result = compile(signalApproach());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled,
    node = net.nodes.find((n) => n.signal)!;
  for (const road of net.roads.filter((r) => r.from === node.idx || r.to === node.idx)) {
    const atEnd = road.to === node.idx;
    for (const i of atEnd ? net.lanes[road.lanes[0]!]!.out : net.lanes[road.lanes[0]!]!.in)
      net.movements[i]!.neverGreen = true;
    expect(crossingStripes(net, road, atEnd).length).toBeGreaterThan(0);
  }
});

test('T26: exit crossings occupy the first 0.25 to 2.75 m of the exit road', () => {
  const result = compile(signalApproach());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  const node = net.nodes.find((n) => n.signal)!;
  for (const road of net.roads.filter((r) => r.from === node.idx)) {
    const lane = net.lanes[road.lanes[0]!]!;
    const start = lane.polyline[0]!;
    const h = headingAtDistance(lane.polyline, lane.cumulative, 0);
    const stripes = crossingStripes(net, road, false);
    expect(stripes.length).toBeGreaterThan(0);
    for (const stripe of stripes) {
      expect(stripe.every((p) => pointInPolygon(p, [...road.surface, road.surface[0]!]))).toBe(
        true,
      );
      expect(stripe.some((p) => pointInPolygon(p, node.outline))).toBe(false);
      const along = stripe.map(
        (p) => (p.x - start.x) * Math.cos(h) + (p.y - start.y) * Math.sin(h),
      );
      expect(Math.min(...along)).toBeCloseTo(0.25);
      expect(Math.max(...along)).toBeCloseTo(2.75);
    }
  }
});

test('T26: short signal roads have neither approach nor exit crossings', () => {
  const city = signalApproach();
  city.places = {};
  for (const node of Object.values(city.nodes))
    node.pos = { x: node.pos.x / 10, y: node.pos.y / 10 };
  for (const road of Object.values(city.roads))
    road.centerline = road.centerline.map((p) => ({ x: p.x / 10, y: p.y / 10 }));
  const result = compile(city);
  if (!result.ok) throw new Error('fixture');
  for (const lane of result.compiled.lanes) {
    expect(lane.lengthM).toBeLessThan(10);
    expect(lane.stopM).toBe(lane.lengthM);
  }
  for (const road of result.compiled.roads) {
    expect(crossingStripes(result.compiled, road, true)).toEqual([]);
    expect(crossingStripes(result.compiled, road, false)).toEqual([]);
  }
});
