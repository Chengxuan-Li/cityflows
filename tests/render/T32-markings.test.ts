import type { Graphics } from 'pixi.js';
import { expect, test } from 'vitest';
import {
  auditCities,
  compileAuditCity,
  markingLengths,
  type AuditCity,
} from '../../bench/junction-audit';
import { hairpin } from '../../src/fixtures/hairpin';
import {
  offsetPolyline,
  parallelOffset,
  pointAtDistance,
  pointInPolygon,
  segmentDistance,
} from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CLane, type CompiledCity, type CRoad } from '../../src/network';
import { approachMarkings, drawRoad } from '../../src/render/layers/roads';
import { style } from '../../src/render/style';

const nets = new Map<string, CompiledCity>();
const net = (name: AuditCity) => {
  if (!nets.has(name)) nets.set(name, compileAuditCity(name));
  return nets.get(name)!;
};

/** Strokes `drawRoad` makes, by width: lane lines (the divider width) and arrow shafts. Both
 * layers (below and above the node area) go to the same recorder. */
function record(city: CompiledCity, road: CRoad) {
  const lines: Vec2[][] = [],
    arrows: Vec2[][] = [];
  let pending: Vec2[][] = [];
  let previous = { x: 0, y: 0 };
  const graphics = {
    poly(points: Vec2[]) {
      pending = [points];
      return this;
    },
    fill() {
      pending = [];
      return this;
    },
    stroke({ width }: { width: number }) {
      if (width === style.dividerWidthM) lines.push(...pending);
      else if (width < 0.25) arrows.push(...pending);
      pending = [];
      return this;
    },
    moveTo(x: number, y: number) {
      previous = { x, y };
      return this;
    },
    lineTo(x: number, y: number) {
      pending.push([previous, { x, y }]);
      previous = { x, y };
      return this;
    },
  } as unknown as Graphics;
  const ignored = { ...graphics, stroke: () => ignored } as unknown as Graphics;
  drawRoad(ignored, graphics, city, road, false, graphics);
  return { lines, arrows };
}

/** Arc length of the nearest point of `lane`, and the signed distance to it (right positive). */
function project(lane: CLane, p: Vec2) {
  let best = { s: 0, lateral: Infinity };
  for (let i = 1; i < lane.polyline.length; i++) {
    const a = lane.polyline[i - 1]!,
      b = lane.polyline[i]!;
    const d = segmentDistance(p, a, b);
    if (d >= Math.abs(best.lateral)) continue;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(length, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
    best = { s: lane.cumulative[i - 1]! + t, lateral: cross < 0 ? -d : d };
  }
  return best;
}

const hasTaper = (city: CompiledCity, road: CRoad) =>
  road.lanes.some((i) => city.lanes[i]!.taperStartM || city.lanes[i]!.taperEndM);

/** The lines a lane carries in right-hand traffic: the divider to its right neighbour and, on
 * the median lane of a two-way street, the centre line. */
const laneLines = (road: CRoad, lane: CLane) => [
  ...(lane.right >= 0 ? [lane.widthM / 2] : []),
  ...(road.streetGroupId !== null && lane.left < 0 ? [-lane.widthM / 2] : []),
];

test.each(['grid', 'munich'] as const)(
  'T32.1: on %s every approach’s dividers and centre line reach its stop position',
  (name) => {
    const city = net(name);
    const short: string[] = [];
    let checked = 0;
    for (const road of city.roads) {
      // Roads with a tapering lane get their dividers from drawTransitions (TASK-080's file).
      if (hasTaper(city, road)) continue;
      const { lines } = record(city, road);
      const others = city.roads
        .filter((o) => o !== road && (o.from === road.to || o.to === road.to))
        .map((o) => [...o.surface, o.surface[0]!]);
      for (const index of road.lanes) {
        const lane = city.lanes[index]!;
        for (const offset of laneLines(road, lane)) {
          checked++;
          let reach = 0;
          for (const line of lines)
            for (const p of line) {
              const { s, lateral } = project(lane, p);
              if (Math.abs(lateral - offset) < 0.1) reach = Math.max(reach, s);
            }
          if (reach >= lane.stopM - 0.5) continue;
          // Allowed only where the missing stretch lies on another road's surface.
          const covered = Array.from({ length: 9 }, (_, k) => {
            const s = reach + ((lane.stopM - reach) * (k + 0.5)) / 9;
            const point = pointAtDistance(lane.polyline, lane.cumulative, s);
            return others.some((ring) => pointInPolygon(point, ring, 0));
          }).every(Boolean);
          if (!covered) short.push(`${lane.id} ${offset > 0 ? 'divider' : 'centre'} ${reach}`);
        }
      }
    }
    console.info('T32.1', name, 'lines checked', checked);
    expect(short).toEqual([]);
  },
  120_000,
);

/** The turns an arrow may show, recomputed from the movements: no u-turns, no merges or
 * diverges, no turns into service roads, no never-green movements. */
function turnsOf(city: CompiledCity, lane: CLane): string {
  const turns = new Set<string>();
  for (const index of lane.out) {
    const m = city.movements[index]!;
    if (m.neverGreen || ['uturn', 'merge', 'diverge'].includes(m.turn)) continue;
    if (city.roads[city.lanes[m.toLane]!.road]!.roadClass === 'service') continue;
    turns.add(m.turn);
  }
  return [...turns].sort().join();
}

test.each(['grid', 'munich'] as const)(
  'T32.2: on %s arrows are drawn once per lane, 6 to 9 m before the stop position, where lanes differ',
  (name) => {
    const city = net(name);
    const wrong: string[] = [];
    let drawn = 0;
    for (const road of city.roads) {
      const { arrows } = record(city, road);
      const alike = new Set(road.lanes.map((i) => turnsOf(city, city.lanes[i]!))).size === 1;
      for (const index of road.lanes) {
        const lane = city.lanes[index]!;
        const points = arrows
          .flat()
          .map((p) => ({ p, ...project(lane, p) }))
          .filter(({ lateral }) => Math.abs(lateral) < lane.widthM / 2);
        if (!points.length) continue;
        drawn++;
        const along = points.map(({ s }) => s);
        const centre = (Math.min(...along) + Math.max(...along)) / 2;
        if (lane.lengthM < 12) wrong.push(`${lane.id}: lane under 12 m`);
        if (alike) wrong.push(`${lane.id}: all lanes of ${road.id} allow the same turns`);
        if (Math.max(...along) - Math.min(...along) > 4.5) wrong.push(`${lane.id}: more than once`);
        if (lane.stopM - centre < 6 || lane.stopM - centre > 9)
          wrong.push(`${lane.id}: centred ${(lane.stopM - centre).toFixed(2)} m before stop`);
      }
    }
    console.info('T32.2', name, 'lanes with arrows', drawn);
    expect(wrong).toEqual([]);
    expect(drawn).toBeGreaterThan(0);
  },
  120_000,
);

test('T32.2: the owner’s X-marked arrows on Munich’s Marsstraße below n:823 are gone', () => {
  // On 5024a83 the two one-way carriageways r:368 (n:949 to n:823) and r:480 (n:823 to n:949),
  // which the importer realigned onto one centreline, carried arrows of both directions on the
  // same two lanes: r:368#0 u-turn and left, r:368#1 right (at the Y-junction n:823); r:480#0
  // left, r:480#1 through (at the signal n:949). TASK-079 then drew none on either road. Since
  // TASK-084 the pair is a divided street, each block on its own side of a 0.5 m median, so each
  // lane carries its own direction's arrows (the u-turn is never drawn) and no lane of one road
  // lies under the other's.
  const city = net('munich');
  const expected: Record<string, string[]> = {
    'r:368#0': ['left'],
    'r:368#1': ['right'],
    'r:480#0': ['left'],
    'r:480#1': ['through'],
  };
  for (const id of ['r:368', 'r:480']) {
    const road = city.roads[city.index.road.get(id)!]!;
    const other = city.roads[city.index.road.get(id === 'r:368' ? 'r:480' : 'r:368')!]!;
    for (const index of road.lanes) {
      const lane = city.lanes[index]!;
      expect(approachMarkings(city, lane).turns).toEqual(expected[lane.id]);
      for (const p of lane.polyline)
        expect(pointInPolygon(p, [...other.surface, other.surface[0]!], 0)).toBe(false);
    }
    expect(record(city, road).arrows.length).toBeGreaterThan(0);
  }
});

/** Largest distance error of `line` from `offset` beside `lane`, at its vertices and midpoints,
 * skipping points nearest a corner of the lane (a turn over 25 degrees within a metre), where a
 * line takes the mitre as the lane edges and road surface do. */
function offsetError(lane: CLane, line: Vec2[], offset: number) {
  const at = (s: number) => pointAtDistance(lane.polyline, lane.cumulative, s);
  const corner = (s: number) => {
    const [a, b, c] = [at(s - 1), at(s), at(s + 1)];
    const turn = Math.atan2(
      (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x),
      (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y),
    );
    return Math.abs(turn) > (25 * Math.PI) / 180;
  };
  let error = 0;
  const points = line.flatMap((p, i) =>
    i ? [{ x: (p.x + line[i - 1]!.x) / 2, y: (p.y + line[i - 1]!.y) / 2 }, p] : [p],
  );
  for (const p of points) {
    const { s, lateral } = project(lane, p);
    if (corner(s)) continue;
    error = Math.max(error, Math.abs(Math.abs(lateral) - Math.abs(offset)));
  }
  return error;
}

test('T32.3: on the hairpin fixture every lane line and edge keeps its offset', () => {
  const result = compile(hairpin());
  if (!result.ok) throw new Error('hairpin fixture');
  const city = result.compiled;
  for (const lane of city.lanes) {
    for (const offset of [-lane.widthM / 2, lane.widthM / 2]) {
      expect(offsetError(lane, parallelOffset(lane.polyline, offset), offset)).toBeLessThan(0.05);
      // B35 drew per-vertex mitres thrown off at the fillets' millimetre steps (over 1 m off).
      // TASK-082 resamples the reference line the lanes are offset from, so the lane polylines
      // have no such steps left and even the mitre stays within 5 cm.
      expect(offsetError(lane, offsetPolyline(lane.polyline, offset), offset)).toBeLessThan(0.05);
    }
  }
  for (const road of city.roads) {
    const { lines } = record(city, road);
    const lane = city.lanes[road.lanes[0]!]!;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(offsetError(lane, line, lane.widthM / 2)).toBeLessThan(0.05);
  }
});

test('T32.3: every Munich divider and centre line keeps its offset outside tapers', () => {
  const city = net('munich');
  const off: string[] = [];
  for (const road of city.roads) {
    if (hasTaper(city, road)) continue;
    const lanes = road.lanes.map((i) => city.lanes[i]!);
    for (const line of record(city, road).lines) {
      // The lane the line belongs to: the one it lies half a lane width from.
      const lane = lanes.reduce((best, l) => {
        const gap = (x: CLane) => Math.abs(Math.abs(project(x, line[0]!).lateral) - x.widthM / 2);
        return gap(l) < gap(best) ? l : best;
      });
      const error = offsetError(lane, line, lane.widthM / 2);
      if (error >= 0.05) off.push(`${lane.id} ${error.toFixed(3)}`);
    }
  }
  expect(off).toEqual([]);
}, 120_000);

// 5024a83 measured with bench/junction-audit.ts: dividers and centre lines drawRoad strokes
// outside its nodes' outlines, and all its strokes (with arrow shafts and stop lines).
const main = {
  grid: { lineOutsideM: 9880, markingOutsideM: 10555 },
  town: { lineOutsideM: 101643, markingOutsideM: 108343 },
  sindelfingen: { lineOutsideM: 46174, markingOutsideM: 48923 },
  munich: { lineOutsideM: 38684, markingOutsideM: 41611 },
};

test.each(auditCities)(
  'T32.4: %s keeps at least 98 % of main’s lane lines outside outlines',
  (name) => {
    const lengths = markingLengths(net(name));
    // All strokes fall further: arrows are drawn only where lanes differ (T32.2), by design.
    console.info('T32.4', name, lengths, 'main', main[name]);
    expect(lengths.lineOutsideM).toBeGreaterThanOrEqual(0.98 * main[name].lineOutsideM);
  },
  120_000,
);
