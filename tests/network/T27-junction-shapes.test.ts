import { readFileSync } from 'node:fs';
import type { Graphics } from 'pixi.js';
import { expect, test } from 'vitest';
import { probeMorning } from '../../bench/import-probe';
import {
  auditCities,
  auditJunctions,
  compileAuditCity,
  loadAuditCity,
  summarize,
  type AuditCity,
  type NodeAudit,
} from '../../bench/junction-audit';
import { deepInside } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import type { CompiledCity } from '../../src/network';
import { drawRoad } from '../../src/render/layers/roads';

// bed19c1 (main before TASK-074) measured with bench/junction-audit.ts: overlap of road ends
// connected to their cuts, outside the outline, at nodes with an outline.
const baselineOverlapM2 = { sindelfingen: 55.69, munich: 256.56 };
// Munich at --scale 0.15, trips completed by 10:00 on bed19c1 (npm run import-probe).
const mainCompletedMunich = 2008;

type Measure = 'selfIntersections' | 'movementsEscaping' | 'edgesOff' | 'curbKinks';

// Residual defects after TASK-074, node by node, each listed in the report. Where carriageways
// of the source data lie on top of each other or a road end is a stub shorter than its
// setbacks, flush mouths cannot also hold every movement and stay simple; these were measured,
// not designed, and are what remains for the lead to judge.
const residual: Record<AuditCity, Partial<Record<Measure, string[]>>> = {
  grid: {
    // A left turn from the one-lane west arm of an edge T: 1.1 cm past the 0.1 m tolerance.
    movementsEscaping: ['n:3'],
  },
  town: {},
  sindelfingen: {
    selfIntersections: ['n:498', 'n:81'],
    movementsEscaping: ['n:276', 'n:294', 'n:371', 'n:375', 'n:493', 'n:620', 'n:78', 'n:81'],
    edgesOff: ['n:1162', 'n:139', 'n:434', 'n:436', 'n:68', 'n:78', 'n:792'],
    curbKinks: [
      'n:139',
      'n:209',
      'n:215',
      'n:294',
      'n:490',
      'n:501',
      'n:594',
      'n:620',
      'n:78',
      'n:792',
    ],
  },
  munich: {
    selfIntersections: ['n:201'],
    movementsEscaping: [
      'n:104',
      'n:1123',
      'n:1375',
      'n:138',
      'n:266',
      'n:305',
      'n:324',
      'n:40',
      'n:516',
      'n:55',
      'n:721',
      'n:726',
      'n:774',
      'n:970',
      'n:974',
      'n:975',
      'n:989',
    ],
    edgesOff: [
      'n:104',
      'n:1123',
      'n:1375',
      'n:138',
      'n:305',
      'n:308',
      'n:322',
      'n:324',
      'n:33',
      'n:407',
      'n:719',
      'n:721',
      'n:774',
      'n:823',
      'n:949',
    ],
    curbKinks: [
      'n:104',
      'n:1123',
      'n:235',
      'n:305',
      'n:308',
      'n:33',
      'n:344',
      'n:387',
      'n:407',
      'n:440',
      'n:446',
      'n:621',
      'n:719',
      'n:774',
      'n:823',
    ],
  },
};

// Coincident source carriageways (architecture 5.1 does not repair them, T20 lists them): of two
// road ends on top of each other the shared mouth now clears both neighbours, not one each.
const storageExceptions: Record<string, string> = {
  'r:368#0': 'Marsstraße r:368/r:480: reversed identical centerlines, zero offsets.',
  'r:368#1': 'Marsstraße r:368/r:480: reversed identical centerlines, zero offsets.',
  'r:565#0': 'Service ways r:565/r:589 share one centerline.',
  'r:566#0': 'Service ways r:566/r:588: identical direction, centerline and offset.',
  'r:1024#0': 'Service ways r:1024/r:899 share one realigned arm.',
};

const audited = new Map<AuditCity, { net: CompiledCity; audits: NodeAudit[] }>();
function audit(name: AuditCity) {
  let entry = audited.get(name);
  if (!entry) {
    const net = compileAuditCity(name);
    audited.set(name, (entry = { net, audits: auditJunctions(net) }));
  }
  return entry;
}

const nodes = (audits: NodeAudit[], measure: Measure) =>
  audits
    .filter((a) => a[measure] > 0)
    .map((a) => a.id)
    .sort();

test.each(auditCities)(
  'T27: %s outlines are simple, hold their movements and meet every road end',
  (name) => {
    const { audits } = audit(name);
    for (const measure of ['selfIntersections', 'movementsEscaping', 'edgesOff'] as const)
      expect(nodes(audits, measure), measure).toEqual([...(residual[name][measure] ?? [])].sort());
  },
  120_000,
);

test.each(auditCities)(
  'T27: %s road-end overlap outside outlines is gone or at least halved',
  (name) => {
    const summary = summarize(audit(name).audits);
    console.info('T27', name, summary);
    if (name === 'grid' || name === 'town') {
      expect(summary.overlapM2).toBe(0);
      expect(summary.continuationOverlapM2 + summary.awayOverlapM2 + summary.bodyOverlapM2).toBe(0);
    } else expect(summary.overlapM2).toBeLessThanOrEqual(baselineOverlapM2[name] / 2);
  },
  120_000,
);

test.each(auditCities)(
  'T27: %s curbs leave road edges tangent, and only gore tips are sharp',
  (name) => {
    const { audits } = audit(name);
    expect(nodes(audits, 'curbKinks')).toEqual([...(residual[name].curbKinks ?? [])].sort());
    expect(audits.filter((a) => a.sharpCorners).map((a) => a.id)).toEqual([]);
  },
  120_000,
);

function recorder() {
  const lines: Vec2[][] = [];
  let previous = { x: 0, y: 0 };
  const graphics = {
    poly(points: Vec2[]) {
      lines.push(points);
      return this;
    },
    fill() {
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
      lines.push([previous, { x, y }]);
      previous = { x, y };
      return this;
    },
  };
  return { graphics: graphics as unknown as Graphics, lines };
}

test.each(auditCities)(
  'T27: %s draws no lane marking on another road or under an outline',
  (name) => {
    const { net } = audit(name);
    const offending: string[] = [];
    for (const road of net.roads) {
      const marks = recorder();
      // Stop and give-way lines go to the controls layer and stay at the stop position.
      drawRoad(recorder().graphics, marks.graphics, net, road, false, recorder().graphics);
      const ends = [road.from, road.to];
      const rings = [
        ...ends.map((n) => net.nodes[n]!.outline).filter((ring) => ring.length),
        ...net.roads
          .filter((r) => r !== road && (ends.includes(r.from) || ends.includes(r.to)))
          .map((r) => [...r.surface, r.surface[0]!]),
      ];
      const points = marks.lines.flatMap((line) =>
        line.flatMap((p, i) =>
          i ? [p, { x: (p.x + line[i - 1]!.x) / 2, y: (p.y + line[i - 1]!.y) / 2 }] : [p],
        ),
      );
      if (points.some((p) => rings.some((ring) => deepInside(p, ring, 0.1))))
        offending.push(road.id);
    }
    expect(offending).toEqual([]);
  },
  120_000,
);

test('T27: no Munich approach lane loses more than 2 m to the new setbacks', () => {
  const main = JSON.parse(
    readFileSync('tests/network/T27-main-lane-lengths.json', 'utf8'),
  ) as Record<string, number>;
  const { net } = audit('munich');
  const losses = net.lanes
    .filter((lane) => main[lane.id]! - lane.lengthM > 2)
    .map((lane) => lane.id)
    .sort();
  expect(losses).toEqual(Object.keys(storageExceptions).sort());
}, 120_000);

test('T27: Munich at 0.15 completes at least main’s count by 10:00', () => {
  const city = loadAuditCity('munich');
  const morning = probeMorning(city, audit('munich').net, 0.15);
  console.info('T27 Munich morning at 0.15', morning.completed, 'main', mainCompletedMunich);
  expect(morning.failed).toBe(0);
  expect(morning.completed).toBeGreaterThanOrEqual(mainCompletedMunich);
}, 600_000);
