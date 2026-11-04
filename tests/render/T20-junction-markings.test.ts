import { expect, test } from 'vitest';
import type { Graphics } from 'pixi.js';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { drawNode } from '../../src/render/layers/nodes';
import { drawRoad } from '../../src/render/layers/roads';
import { pickThroughNode } from '../../src/render/scene';
import { createPicker } from '../../src/render/picking';
import type { Vec2 } from '../../src/geo/vec2';

function recorder() {
  const polygons: Vec2[][] = [];
  const graphics = {
    poly(points: Vec2[]) {
      polygons.push(points);
      return this;
    },
    fill() {
      return this;
    },
    stroke() {
      return this;
    },
    moveTo() {
      return this;
    },
    lineTo() {
      return this;
    },
    circle() {
      throw new Error('Node geometry must not use discs');
    },
  };
  return { graphics: graphics as unknown as Graphics, polygons };
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

test.each(['signal', 'yield'] as const)('T20: %s marking meets the trimmed lane end', (control) => {
  const result = compile(signalApproach());
  if (!result.ok) throw new Error('fixture');
  const net = result.compiled;
  const node = net.nodes.find((n) => n.signal)!;
  const road = net.roads.find((r) => r.to === node.idx)!;
  if (control === 'yield') {
    node.signal = null;
    node.control = 'yield';
    node.movements.forEach((i) => {
      net.movements[i]!.priority = 2;
    });
  }
  const marks = recorder();
  drawRoad(recorder().graphics, marks.graphics, net, road);
  for (const i of road.lanes) {
    const lane = net.lanes[i]!;
    const end = lane.polyline.at(-1)!,
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
