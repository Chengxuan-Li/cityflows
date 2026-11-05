import { expect, test } from 'vitest';
import { continuity } from '../../src/fixtures/continuity';
import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  pointAtDistance,
  segmentsIntersect,
} from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { buildCity } from '../../src/fixtures/build-city';
import { laneEdges } from '../../src/network/lanes';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { importOsm } from '../../src/importers/osm';

function fixture() {
  const result = compile(continuity());
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

test('T25: split and merge keep every lane on its trunk slice with no junction pinch', () => {
  const net = fixture();
  for (const y of [0, 160]) {
    const node = net.nodes.find((n) => n.pos.x === 0 && n.pos.y === y)!;
    expect(node.setbacks.every((s) => s === 0)).toBe(true);
    expect(node.outline).toEqual([]);
    expect(node.movements).toHaveLength(5);
    for (const index of node.movements) {
      const m = net.movements[index]!;
      expect(
        distance(net.lanes[m.fromLane]!.polyline.at(-1)!, net.lanes[m.toLane]!.polyline[0]!),
      ).toBeLessThan(0.01);
    }
    const roads = net.roads.filter((r) => r.from === node.idx || r.to === node.idx);
    for (let x = -10; x <= 10; x += 0.5) {
      const hits: number[] = [];
      for (const road of roads) {
        const ring = road.surface;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!,
            b = ring[(i + 1) % ring.length]!;
          if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x))
            hits.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
        }
      }
      expect(Math.max(...hits) - Math.min(...hits)).toBeGreaterThanOrEqual(14.99);
    }
  }
});

test('T25: lane geometry has no self intersections and tapers identify the dropped and added lane', () => {
  const net = fixture();
  for (const lane of net.lanes) {
    for (let i = 1; i < lane.polyline.length; i++)
      for (let j = i + 2; j < lane.polyline.length; j++)
        expect(
          segmentsIntersect(
            lane.polyline[i - 1]!,
            lane.polyline[i]!,
            lane.polyline[j - 1]!,
            lane.polyline[j]!,
          ),
        ).toBe(false);
  }
  const dropped = net.lanes.filter((l) => l.taperEndM > 0);
  const added = net.lanes.filter((l) => l.taperStartM > 0);
  expect(dropped.map((l) => [l.lane, l.taperEndM])).toEqual([[2, 60]]);
  expect(added.map((l) => [l.lane, l.taperStartM])).toEqual([[2, 60]]);
});

test('T25: branch offsets finish at 60 m with a continuous heading', () => {
  const source = continuity();
  const net = fixture();
  for (const road of net.roads.filter((r) => r.startOffsetM || r.endOffsetM)) {
    const canonical = source.roads[road.id]!;
    const cumulative = cumulativeLengths(canonical.centerline);
    const atEnd = road.endOffsetM !== 0;
    const s = atEnd ? road.lengthM - 60 : 60;
    const p = pointAtDistance(canonical.centerline, cumulative, s);
    const h = headingAtDistance(canonical.centerline, cumulative, s);
    let lateral = -canonical.lanes.reduce((sum, l) => sum + l.widthM, 0) / 2;
    for (const i of road.lanes) {
      const lane = net.lanes[i]!;
      const offset = lateral + lane.widthM / 2;
      const expected = { x: p.x - Math.sin(h) * offset, y: p.y + Math.cos(h) * offset };
      const vertex = lane.polyline.findIndex((q) => distance(q, expected) < 0.01);
      expect(vertex).toBeGreaterThan(0);
      expect(vertex).toBeLessThan(lane.polyline.length - 1);
      const before = lane.polyline[vertex - 1]!,
        here = lane.polyline[vertex]!,
        after = lane.polyline[vertex + 1]!;
      const a = Math.atan2(here.y - before.y, here.x - before.x),
        b = Math.atan2(after.y - here.y, after.x - here.x);
      expect(Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))).toBeLessThan(Math.PI / 180);
      lateral += lane.widthM;
    }
  }
});

test('T25: explicit crossing lane assignments retain their junction surface', () => {
  const source = continuity();
  const split = Object.values(source.nodes).find((n) => n.pos.x === 0 && n.pos.y === 0)!;
  for (const rule of split.turnRules) {
    if (rule.fromLane === undefined) continue;
    const branch = source.roads[rule.to]!;
    rule.fromLane = branch.lanes.length === 3 ? rule.fromLane + 2 : rule.fromLane - 3;
  }
  const result = compile(source);
  if (!result.ok) throw new Error('crossing fixture');
  const node = result.compiled.nodes[result.compiled.index.node.get(split.id)!]!;
  expect(node.outline.length).toBeGreaterThan(0);
  expect(node.setbacks.every((s) => s > 0)).toBe(true);
});

test('T25: removing a short branch setback preserves the ordinary junction at its far end', () => {
  const { city, node, road } = buildCity('Short continuation', 1);
  const split = node(0, 0),
    junction = node(12, 0);
  junction.control = 'yield';
  road(node(-180, 0), split, { lanes: 5 });
  const branch = road(split, junction, { lanes: 3 });
  road(split, node(180, 35), { lanes: 2 });
  road(node(12, -180), junction, { lanes: 8 });
  road(junction, node(12, 180), { lanes: 8 });
  const result = compile(city);
  split.control = 'yield';
  const baseline = compile(city);
  if (!result.ok || !baseline.ok) throw new Error('short branch fixture');
  for (const i of [0, 1, 2]) {
    const id = `${branch.id}#${i}` as const;
    expect(result.compiled.lanes[result.compiled.index.lane.get(id)!]!.polyline.at(-1)).toEqual(
      baseline.compiled.lanes[baseline.compiled.index.lane.get(id)!]!.polyline.at(-1),
    );
  }
  const actual = result.compiled.nodes[result.compiled.index.node.get(junction.id)!]!;
  const expected = baseline.compiled.nodes[baseline.compiled.index.node.get(junction.id)!]!;
  expect(actual.setbacks).toEqual(expected.setbacks);
  // TASK-074: the outline follows the road ends' actual edges, and the continuation's taper
  // reshapes this 12 m branch up to the junction, so only the curbs beside the branch may
  // differ: the junction keeps every other road end's mouth, corner for corner.
  expect(actual.outline.length).toBeGreaterThan(0);
  for (const road of result.compiled.roads.filter(
    (r) => r.id !== branch.id && (r.from === actual.idx || r.to === actual.idx),
  )) {
    const atEnd = road.to === actual.idx;
    for (const index of [road.lanes[0]!, road.lanes.at(-1)!]) {
      const lane = result.compiled.lanes[index]!;
      const end = atEnd ? lane.polyline.at(-1)! : lane.polyline[0]!;
      const near = (outline: typeof actual.outline) =>
        Math.min(...outline.map((p) => distance(p, end)));
      expect(near(actual.outline)).toBeCloseTo(near(expected.outline), 6);
    }
  }
});

test('T25: lane edges retain shared miter corners away from a taper', () => {
  const { city, node, road } = buildCity('Curved narrowing', 1);
  const seam = node(0, 0);
  const from = road(node(-200, -200), seam, {
    lanes: 3,
    via: [
      { x: -200, y: -100 },
      { x: -100, y: -100 },
      { x: -100, y: 0 },
    ],
  });
  road(seam, node(180, 0), { lanes: 2 });
  const result = compile(city);
  if (!result.ok) throw new Error('curved narrowing');
  const net = result.compiled;
  const lanes = net.roads[net.index.road.get(from.id)!]!.lanes.map((i) => net.lanes[i]!);
  const left = laneEdges(lanes[0]!, lanes),
    right = laneEdges(lanes[1]!, lanes);
  expect(distance(left.right[1]!, right.left[1]!)).toBeLessThan(0.001);
});

test.each([
  // TASK-074 moved these on purpose: ordinary junctions take the SUMO-style setbacks and
  // outlines (architecture 5.1); the continuation nodes (the count) are unchanged.
  // Before TASK-074: c1b2bf4d… (grid) and 1ee92a0e… (Munich).
  ['grid', 0, '082eb0366297a4daf673c250674ccbf6c94b52f424fdca70263b5acc38885b9e'],
  // 66 before the lead's merge fix; three merges that absorb a lane stay ordinary junctions.
  ['Munich', 63, '73152dc799045fd757ee2f781ec6bc8e77eb96a00164c7996b89c8d3bd62639e'],
] as const)(
  'T25: %s preserves the exact baseline setbacks and outlines of ordinary junctions',
  (name, count, baseline) => {
    const imported =
      name === 'Munich'
        ? importOsm(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
            importerVersion: 'test',
            bbox: [11.525, 48.135, 11.545, 48.148],
          })
        : null;
    if (imported && !imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const result = compile(imported?.ok ? imported.city : grid5x5());
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const net = result.compiled;
    const ordinary = net.nodes
      .filter(
        (n) =>
          n.control !== 'uncontrolled' ||
          n.movements.some(
            (i) => !['through', 'merge', 'diverge'].includes(net.movements[i]!.turn),
          ),
      )
      .map(({ id, setbacks, outline }) => ({ id, setbacks, outline }));
    // Captured independently from b2131fe (again for TASK-074); exact preservation, no tolerance.
    expect(createHash('sha256').update(JSON.stringify(ordinary)).digest('hex')).toBe(baseline);
    expect(net.nodes.filter((n) => n.movements.length && !n.outline.length)).toHaveLength(count);
  },
);

test('T25: default balanced split and merge use disjoint trunk slices', () => {
  const source = continuity();
  for (const n of Object.values(source.nodes)) if (n.pos.y <= 160) n.turnRules = [];
  const result = compile(source);
  if (!result.ok) throw new Error('default continuations');
  const net = result.compiled;
  for (const y of [0, 160]) {
    const n = net.nodes.find((n) => n.pos.x === 0 && n.pos.y === y)!;
    expect(n.movements).toHaveLength(5);
    for (const i of n.movements) expect(net.movements[i]!.lengthM).toBeLessThan(0.01);
  }
});
