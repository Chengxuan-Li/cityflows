import { withoutLotAisles } from '../without-lot-aisles';
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
import { separation } from '../../src/network/continuity';
import { readFileSync } from 'node:fs';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { importOsmCached } from '../../bench/city-cache';
import { tierCities, unitTest } from '../tier';

function fixture() {
  const result = compile(continuity());
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

unitTest('T25: split and merge keep every lane on its trunk slice with no junction pinch', () => {
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

unitTest(
  'T25: lane geometry has no self intersections and tapers identify the dropped and added lane',
  () => {
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
    // TASK-080 (B37): tapers take min(half the road, clamp(0.4 * km/h, 15, 40)), 20 m at the
    // fixture's 50 km/h (60 m under TASK-071).
    expect(dropped.map((l) => [l.lane, l.taperEndM])).toEqual([[2, expect.closeTo(20, 9)]]);
    expect(added.map((l) => [l.lane, l.taperStartM])).toEqual([[2, expect.closeTo(20, 9)]]);
  },
);

// TASK-080: a branch keeps its trunk slice until its own lane block parts from its neighbour's
// (`separation`), then eases over the 20 m taper (TASK-071: eased from the node over 60 m).
unitTest(
  'T25: branch offsets finish where the branches part plus the taper, heading continuous',
  () => {
    const source = continuity();
    const net = fixture();
    const at = (x: number, y: number) =>
      Object.values(source.roads).filter((r) =>
        [r.centerline[0]!, r.centerline.at(-1)!].some((p) => p.x === x && p.y === y),
      );
    const hold = (y: number, atEnd: boolean) => {
      const [left, right] = at(0, y)
        .filter((r) => (atEnd ? r.centerline.at(-1)! : r.centerline[0]!).y === y)
        .filter((r) => (atEnd ? r.centerline[0]! : r.centerline.at(-1)!).y !== y)
        .sort((a, b) => a.centerline[atEnd ? 0 : 1]!.y - b.centerline[atEnd ? 0 : 1]!.y);
      return separation({ source: left!, atEnd }, { source: right!, atEnd });
    };
    for (const road of net.roads.filter((r) => r.startOffsetM || r.endOffsetM)) {
      const canonical = source.roads[road.id]!;
      const cumulative = cumulativeLengths(canonical.centerline);
      const atEnd = road.endOffsetM !== 0;
      // The narrowing and the widening have one branch each: nothing to part from.
      const y = (atEnd ? canonical.centerline.at(-1)! : canonical.centerline[0]!).y;
      const window = (y === 0 || y === 160 ? hold(y, atEnd) : 0) + 20;
      const s = atEnd ? road.lengthM - window : window;
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
  },
);

unitTest('T25: explicit crossing lane assignments retain their junction surface', () => {
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

unitTest(
  'T25: removing a short branch setback preserves the ordinary junction at its far end',
  () => {
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
  },
);

unitTest('T25: lane edges retain shared miter corners away from a taper', () => {
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

// TASK-090: the setbacks of ordinary junctions against main 5568eed
// (tests/network/T25-setbacks.json) within a budget, not a hash of setbacks and outlines: every
// junction geometry task moved the hash and had to recapture it. Nodes whose setbacks moved by more than 0.5 m in the last three tasks:
// TASK-088 none, TASK-087 Munich 5, TASK-089 Munich 10 (the grid none; TASK-083's rework Munich
// 32 and the grid 2), so Munich may move 12 and the grid none. Outlines are T38's.
// TASK-101: Munich's reference is main 56ffccd compiled on the same retained-access City;
// comparing with the old collapsed topology would count removed and re-rooted junctions.
const recordedSetbacks = JSON.parse(
  readFileSync('tests/network/T25-setbacks.json', 'utf8'),
) as Record<string, Record<string, number[]>>;

test.each(
  tierCities([
    ['grid', 0, 0],
    // 66 before the lead's merge fix; three merges that absorb a lane stay ordinary junctions.
    ['Munich', 65, 12], // TASK-101 retains two additional continuation nodes; budget unchanged.
  ] as const),
)(
  'T25: %s keeps the baseline setbacks of ordinary junctions within 0.5 m',
  (name, count, moved) => {
    const imported =
      name === 'Munich'
        ? importOsmCached(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
            importerVersion: 'test',
            bbox: [11.525, 48.135, 11.545, 48.148],
          })
        : null;
    if (imported && !imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const result = compile(imported?.ok ? withoutLotAisles(imported.city) : grid5x5());
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const net = result.compiled;
    const ordinary = new Map<string, number[]>(
      net.nodes
        .filter(
          (n) =>
            n.control !== 'uncontrolled' ||
            n.movements.some(
              (i) => !['through', 'merge', 'diverge'].includes(net.movements[i]!.turn),
            ),
        )
        .map(({ id, setbacks }) => [id, setbacks]),
    );
    const recorded = recordedSetbacks[name]!;
    const changed = [...new Set([...ordinary.keys(), ...Object.keys(recorded)])].filter((id) => {
      const [now, before] = [ordinary.get(id), recorded[id]];
      return (
        !now ||
        !before ||
        now.length !== before.length ||
        now.some((s, i) => Math.abs(s - before[i]!) > 0.5)
      );
    });
    console.info('T25', name, 'ordinary junctions with a setback moved over 0.5 m:', changed);
    expect(changed.length).toBeLessThanOrEqual(moved);
    expect(net.nodes.filter((n) => n.movements.length && !n.outline.length)).toHaveLength(count);
  },
);

unitTest('T25: default balanced split and merge use disjoint trunk slices', () => {
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
