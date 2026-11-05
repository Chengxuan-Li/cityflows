import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Graphics } from 'pixi.js';
import { buildCity } from '../../src/fixtures/build-city';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { distance, segmentsIntersect } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity, type CNode } from '../../src/network';
import {
  drawJunctionMarkings,
  junctionGuides,
  majorThroughs,
} from '../../src/render/layers/junction-markings';
import type { City, Node } from '../../src/schema';
import { insideOutline } from '../network/junction-audit';

function compiled(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

/** A two-lane-per-direction secondary road from west to east; a residential side street
 * joins from the south (the eastbound curb side) and yields. */
function tJunction() {
  const { city, node, road, street } = buildCity('T-junction', 1);
  const centre = node(0, 0);
  const major = { lanes: 2, roadClass: 'secondary' as const };
  for (const end of [node(-150, 0), node(150, 0)]) {
    const streetGroupId = `major:${end.id}`;
    road(end, centre, { ...major, streetGroupId });
    road(centre, end, { ...major, streetGroupId });
  }
  street(centre, node(0, 150));
  centre.control = 'yield';
  return { city, centre };
}

/** A two-lane one-way secondary road bending 20 degrees left at a yield junction. */
function oneWayBend() {
  const { city, node, road, street } = buildCity('One-way bend', 1);
  const centre = node(0, 0);
  const bend = (-20 * Math.PI) / 180;
  road(node(-150, 0), centre, { lanes: 2, roadClass: 'secondary' });
  road(centre, node(150 * Math.cos(bend), 150 * Math.sin(bend)), {
    lanes: 2,
    roadClass: 'secondary',
  });
  street(centre, node(0, 150));
  centre.control = 'yield';
  return { city, centre };
}

function fourWay(control: Node['control']) {
  const { city, node, street } = buildCity('Four-way', 1);
  const centre = node(0, 0);
  for (const [x, y] of [
    [-150, 0],
    [150, 0],
    [0, -150],
    [0, 150],
  ] as const)
    street(centre, node(x, y), 2);
  centre.control = control;
  return { city, centre };
}

const at = (net: CompiledCity, node: Node) => net.nodes[net.index.node.get(node.id)!]!;

function contained(net: CompiledCity, node: CNode, point: Vec2) {
  return (
    insideOutline(point, node.outline) ||
    net.roads.some(
      (road) =>
        (road.from === node.idx || road.to === node.idx) &&
        insideOutline(point, [...road.surface, road.surface[0]!]),
    )
  );
}

function crossings(guides: ReturnType<typeof junctionGuides>) {
  let count = 0;
  for (let i = 0; i < guides.length; i++)
    for (let j = i + 1; j < guides.length; j++)
      for (let a = 1; a < guides[i]!.line.length; a++)
        for (let b = 1; b < guides[j]!.line.length; b++)
          if (
            segmentsIntersect(
              guides[i]!.line[a - 1]!,
              guides[i]!.line[a]!,
              guides[j]!.line[b - 1]!,
              guides[j]!.line[b]!,
            )
          )
            count++;
  return count;
}

test('T28.1: a priority road keeps its centre, dividers and mouth edge through a yield T', () => {
  const { city, centre } = tJunction();
  const net = compiled(city);
  const node = at(net, centre);
  const guides = junctionGuides(net, node);
  const kinds = (kind: string) => guides.filter((g) => g.kind === kind);
  expect(kinds('centre')).toHaveLength(1);
  expect(kinds('divider')).toHaveLength(2);
  expect(kinds('edge')).toHaveLength(1);
  // Centre on y = 0, dividers one lane either side, the edge on the side street's (south) side.
  expect(kinds('centre')[0]!.line.every((p) => Math.abs(p.y) < 0.01)).toBe(true);
  expect(
    kinds('divider')
      .map((g) => Math.round(g.line[0]!.y * 100) / 100)
      .sort(),
  ).toEqual([-3.5, 3.5]);
  expect(kinds('edge')[0]!.line.every((p) => Math.abs(p.y - 7) < 0.01)).toBe(true);
  // They span the junction from road end to road end.
  const span = majorThroughs(net, node)
    .flat()
    .flatMap((m) => [m.polyline[0]!.x, m.polyline.at(-1)!.x]);
  for (const guide of guides) {
    const xs = guide.line.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(Math.min(...span), 1);
    expect(Math.max(...xs)).toBeCloseTo(Math.max(...span), 1);
  }
  // Short dashes and gaps of 1.5 m; nothing enters the side street's mouth past the edge line.
  for (const guide of guides) {
    expect(guide.dashes.length).toBeGreaterThan(2);
    for (const [i, dash] of guide.dashes.entries()) {
      expect(distance(dash[0]!, dash.at(-1)!)).toBeCloseTo(1.5, 3);
      if (i) expect(distance(guide.dashes[i - 1]!.at(-1)!, dash[0]!)).toBeCloseTo(1.5, 3);
      expect(dash.every((p) => Math.abs(p.y) <= 7.01)).toBe(true);
    }
  }
  // The side street's movements have no guide: the major through groups are the east and
  // westbound approaches only.
  const groups = majorThroughs(net, node);
  expect(groups.map((g) => net.roads[net.lanes[g[0]!.fromLane]!.road]!.classRank)).toEqual([5, 5]);
  expect(groups.flat().every((m) => m.turn === 'through')).toBe(true);
  // Drawn into the layer as one stroke per node.
  const graphics = new Graphics();
  expect(drawJunctionMarkings(graphics, net, node)).toBe(
    guides.reduce((sum, g) => sum + g.dashes.length, 0),
  );
  graphics.destroy();
});

test('T28.2: no guides without a major road or at a signal', () => {
  for (const control of ['stop', 'uncontrolled'] as const) {
    const { city, centre } = fourWay(control);
    const net = compiled(city);
    expect(junctionGuides(net, at(net, centre))).toEqual([]);
  }
  const signal = compiled(signalApproach());
  const node = signal.nodes.find((n) => n.signal)!;
  expect(node.outline.length).toBeGreaterThan(0);
  expect(junctionGuides(signal, node)).toEqual([]);
  // The same crossing with the north-south street yielding does get them.
  const { city, centre } = fourWay('yield');
  centre.minorRoads = Object.values(city.roads)
    .filter((r) => r.to === centre.id && city.nodes[r.from]!.pos.x === 0)
    .map((r) => r.id);
  const net = compiled(city);
  expect(
    junctionGuides(net, at(net, centre))
      .map((g) => g.kind)
      .sort(),
  ).toEqual(['centre', 'divider', 'divider', 'edge', 'edge']);
});

test('T28.3: dashes stay on the junction and its roads and guides never cross', () => {
  const munich = importOsm(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
    importerVersion: 'test',
    bbox: [11.525, 48.135, 11.545, 48.148],
  });
  if (!munich.ok) throw new Error(JSON.stringify(munich.diagnostics));
  const cities = [tJunction().city, oneWayBend().city, grid5x5(), munich.city];
  const counts = cities.map((city) => {
    const net = compiled(city);
    let nodes = 0;
    let dashes = 0;
    for (const node of net.nodes) {
      const guides = junctionGuides(net, node);
      if (!guides.length) continue;
      nodes++;
      expect(crossings(guides), node.id).toBe(0);
      for (const guide of guides)
        for (const dash of guide.dashes) {
          dashes++;
          for (const point of dash) expect(contained(net, node, point), node.id).toBe(true);
        }
    }
    return { nodes, dashes };
  });
  expect(counts[0]!.nodes).toBe(1);
  expect(counts[1]!.nodes).toBe(1);
  // Every grid junction is an equal-priority residential crossing or the signal.
  expect(counts[2]!.nodes).toBe(0);
  expect(counts[3]!.nodes).toBeGreaterThanOrEqual(15);
}, 60_000);

test('T28.4: a two-lane one-way priority road gets one divider following its curve', () => {
  const { city, centre } = oneWayBend();
  const net = compiled(city);
  const node = at(net, centre);
  const guides = junctionGuides(net, node);
  const dividers = guides.filter((g) => g.kind === 'divider');
  expect(dividers).toHaveLength(1);
  expect(guides.some((g) => g.kind === 'centre')).toBe(false);
  const [a, b] = majorThroughs(net, node)[0]!;
  const gap = (line: Vec2[], p: Vec2) =>
    Math.min(
      ...line.slice(1).map((q, i) => {
        const o = line[i]!;
        const dx = q.x - o.x;
        const dy = q.y - o.y;
        const t = Math.max(
          0,
          Math.min(1, ((p.x - o.x) * dx + (p.y - o.y) * dy) / (dx * dx + dy * dy)),
        );
        return Math.hypot(p.x - o.x - t * dx, p.y - o.y - t * dy);
      }),
    );
  for (const p of dividers[0]!.line) {
    expect(gap(a!.polyline, p)).toBeCloseTo(1.75, 1);
    expect(gap(b!.polyline, p)).toBeCloseTo(1.75, 1);
  }
  const line = dividers[0]!.line;
  const heading = (i: number) =>
    Math.atan2(line[i + 1]!.y - line[i]!.y, line[i + 1]!.x - line[i]!.x);
  // The divider turns with the road (the bend is 20 degrees to the left).
  expect(heading(0) - heading(line.length - 2)).toBeGreaterThan((10 * Math.PI) / 180);
});
