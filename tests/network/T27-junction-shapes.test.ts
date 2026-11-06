import { readFileSync } from 'node:fs';
import type { Graphics } from 'pixi.js';
import { expect, test } from 'vitest';
import { probeMorning } from '../../bench/import-probe';
import {
  auditCities,
  auditJunctions,
  compileAuditCity,
  loadAuditCity,
  markingLengths,
  summarize,
  type AuditCity,
  type NodeAudit,
} from '../../bench/junction-audit';
import { deepInside } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import type { CompiledCity } from '../../src/network';
import { drawRoad, markingClips } from '../../src/render/layers/roads';
import { style } from '../../src/render/style';

// bed19c1 (main before TASK-074) measured with bench/junction-audit.ts: overlap of road ends
// connected to their cuts, outside the outline, at nodes with an outline.
const baselineOverlapM2 = { sindelfingen: 55.69, munich: 256.56 };
// Munich at --scale 0.15, trips completed by 10:00 on bed19c1 (npm run import-probe).
const mainCompletedMunich = 2008;

type Measure =
  'selfIntersections' | 'movementsEscaping' | 'edgesOff' | 'curbKinks' | 'sharpCorners';

// Residual defects after TASK-074, node by node, each with its class (bench/junction-audit.ts):
// coincident = two source carriageways on top of each other at the node (an importer defect,
// architecture 5.1); stub = a road end shorter than its setbacks; crossing = a road body
// crossing its neighbour away from the node; other = none of these (listed in the report);
// separated = a coincident pair TASK-084 separated into a divided pair, which the junction still
// treats as two arms (corridor-aware junctions are TASK-083): the u-turn between its carriageways
// leaves the outline, and the wider arm kinks a curb.
// TASK-082 (lanes and surfaces offset from corridor reference lines) moved road-end edges by a
// few centimetres, which moves `junctionOutline`'s and the audit's 0.05 to 0.1 m thresholds:
// nodes marked TASK-082 joined a list, and those named in the comments left one.
const residual: Record<AuditCity, Partial<Record<Measure, string[]>>> = {
  grid: {
    // other: a left turn from the one-lane west arm of an edge T, 1.1 cm past the tolerance.
    movementsEscaping: ['n:3'],
  },
  town: {},
  sindelfingen: {
    movementsEscaping: [
      // TASK-082 resolved n:294, n:78 and n:81.
      'n:14', // coincident (TASK-080: side by side into an absorbing merge, 2.5 m setbacks)
      'n:276', // coincident
      'n:371', // other
      'n:375', // other
      'n:493', // other
      'n:594', // separated (r:595/r:880)
      'n:620', // coincident
      'n:792', // separated (r:746/r:803)
    ],
    edgesOff: [
      'n:1161', // TASK-082
      'n:1162', // coincident
      'n:139', // coincident
      'n:434', // crossing
      'n:436', // coincident
      'n:68', // crossing
      'n:78', // coincident
      'n:792', // coincident
      'n:915', // stub
    ],
    // TASK-082 resolved n:294 and n:501.
    curbKinks: [
      'n:139', // coincident
      'n:355', // other
      'n:490', // other
      'n:498', // separated (r:595/r:880)
      'n:594', // coincident
      'n:620', // coincident
      'n:628', // coincident
      'n:78', // coincident
      'n:792', // coincident
    ],
    sharpCorners: [
      'n:434', // crossing
      'n:68', // crossing
    ],
  },
  munich: {
    // TASK-080 resolved n:305 and n:726 (branches side by side, B36) and n:774 (r:1368's
    // shorter transition at n:936); TASK-082 n:516 and n:970.
    movementsEscaping: [
      'n:1123', // coincident
      'n:1375', // other
      'n:138', // other
      'n:182', // stub
      'n:266', // other
      'n:324', // coincident
      'n:391', // separated (Arnulfstraße r:395/r:450, r:451/r:1342)
      'n:40', // other
      'n:400', // separated (Arnulfstraße r:392/r:402, r:451/r:1342)
      'n:405', // separated (Arnulfstraße r:388/r:408, r:406/r:1346)
      'n:446', // separated (Arnulfstraße r:395/r:450)
      'n:55', // other
      'n:721', // separated (Landsberger Straße r:1280/r:1334)
      'n:974', // stub
      'n:975', // stub
      'n:989', // other
    ],
    // TASK-080 resolved n:305 (B36) and n:774 (see movementsEscaping); TASK-084 n:823
    // (Marsstraße separated).
    edgesOff: [
      'n:1123', // coincident
      'n:1375', // other
      'n:322', // coincident
      'n:324', // coincident
      'n:719', // coincident
      'n:949', // coincident
    ],
    // TASK-080 resolved n:305 (B36) and n:774 (see movementsEscaping); TASK-084 n:823
    // (Marsstraße separated); TASK-082 n:104, n:235 and n:516.
    curbKinks: [
      'n:1123', // coincident
      'n:180', // TASK-082
      'n:33', // other
      'n:344', // stub
      'n:387', // coincident
      'n:391', // separated (Arnulfstraße r:395/r:450, r:451/r:1342)
      'n:407', // separated (Arnulfstraße r:388/r:408)
      'n:440', // coincident
      'n:446', // coincident
      'n:536', // TASK-082
      'n:621', // other
      'n:719', // coincident
      'n:721', // separated (Landsberger Straße r:1280/r:1334)
    ],
  },
};

// Coincident source carriageways (architecture 5.1 does not repair them, T20 lists them): of two
// road ends on top of each other the shared mouth now clears both neighbours, not one each.
// TASK-084 separates opposite one-way pairs on one centerline into divided pairs (r:368/r:480
// left this list): the street they form is 14.5 m wide instead of 7 m, so the setbacks of the
// lanes that meet it grow by about 3.75 m, as at any two-way street of that width.
const meetsSeparated = (pair: string, node: string) =>
  `Meets the separated ${pair} at ${node}: the divided street is 14.5 m wide, not 7 m.`;
const storageExceptions: Record<string, string> = {
  'r:1049#0': meetsSeparated('Landsberger Straße r:1280/r:1334', 'n:719'),
  'r:343#0': meetsSeparated('Landsberger Straße r:1280/r:1334', 'n:719'),
  'r:342#0': meetsSeparated('Landsberger Straße r:1280/r:1334', 'n:719 (lane start)'),
  'r:761#0': meetsSeparated('Landsberger Straße r:1280/r:1334', 'n:721 (lane start)'),
  'r:1202#0': meetsSeparated('Arnulfstraße r:392/r:402, r:406/r:1346', 'n:387'),
  'r:753#0': meetsSeparated('Arnulfstraße r:392/r:402, r:406/r:1346', 'n:387'),
  'r:1203#0': meetsSeparated('Arnulfstraße r:392/r:402, r:406/r:1346', 'n:387 (lane start)'),
  'r:752#0': meetsSeparated('Arnulfstraße r:392/r:402, r:406/r:1346', 'n:387 (lane start)'),
  'r:159#0': meetsSeparated('Arnulfstraße r:388/r:408', 'n:407'),
  'r:160#0': meetsSeparated('Arnulfstraße r:388/r:408', 'n:407 (lane start)'),
  'r:807#0': meetsSeparated('Arnulfstraße r:388/r:408', 'n:407 (lane start)'),
  'r:802#0': meetsSeparated('Arnulfstraße r:392/r:402, r:451/r:1342', 'n:400'),
  'r:803#0': meetsSeparated('Arnulfstraße r:392/r:402, r:451/r:1342', 'n:400 (lane start)'),
  'r:804#0': meetsSeparated('Arnulfstraße r:388/r:408, r:406/r:1346', 'n:405'),
  'r:805#0': meetsSeparated('Arnulfstraße r:388/r:408, r:406/r:1346', 'n:405 (lane start)'),
  'r:1212#0': meetsSeparated('Arnulfstraße r:395/r:450, r:451/r:1342', 'n:391 (lane start)'),
  'r:538#0': meetsSeparated('Arnulfstraße r:395/r:450', 'n:446'),
  'r:537#0': meetsSeparated('Arnulfstraße r:395/r:450', 'n:446 (lane start)'),
  'r:1354#1': meetsSeparated('Arnulfstraße r:395/r:450', 'n:446 (lane start)'),
  'r:934#0': meetsSeparated('Marsstraße r:368/r:480', 'n:823 (lane start)'),
  'r:934#1': meetsSeparated('Marsstraße r:368/r:480', 'n:823 (lane start)'),
  'r:480#0': meetsSeparated('Marsstraße pair, its own lane,', 'n:949 (the signal)'),
  'r:565#0': 'Service ways r:565/r:589 share one centerline.',
  'r:566#0': 'Service ways r:566/r:588: identical direction, centerline and offset.',
  'r:1024#0': 'Service ways r:1024/r:899 share one realigned arm.',
  // TASK-082: bends too tight for these service and residential streets' lanes are eased to a
  // radius their inside edge can take (each a `reference_eased` note); the arc is shorter than
  // the source's corner.
  'r:1026#0': 'Eased corner of r:1025/r:1026 (2.2 m off its centerline).',
  'r:1075#0': 'Eased corner of r:1075/r:1076 (1.4 m off its centerline).',
  'r:839#0': 'Eased corner of r:839/r:840 (3.2 m off its centerline).',
  'r:840#0': 'Eased corner of r:839/r:840 (3.2 m off its centerline).',
  'r:867#0': 'Eased corner of r:866/r:867 (2.0 m off its centerline).',
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
    expect(nodes(audits, 'sharpCorners')).toEqual([...(residual[name].sharpCorners ?? [])].sort());
  },
  120_000,
);

/** Records the divider and centre lines drawn (strokes of the divider width); arrows, stop and
 * give-way marks are never clipped (lead review of 142b4d8) and are not recorded. */
function recorder() {
  const lines: Vec2[][] = [];
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
  };
  return { graphics: graphics as unknown as Graphics, lines };
}

test.each(auditCities)(
  'T27: %s draws no lane marking in another road’s junction mouth or under an outline',
  (name) => {
    const { net } = audit(name);
    const offending: string[] = [];
    for (const road of net.roads) {
      const marks = recorder();
      // Stop and give-way lines go to the controls layer and stay at the stop position.
      drawRoad(recorder().graphics, marks.graphics, net, road, false, recorder().graphics);
      // Its nodes' outlines, and other roads' surfaces within their junction mouths; roads
      // running the same way at the node (the street's other direction, a coincident or
      // overlapping carriageway) never clip each other (lead review of 142b4d8).
      const rings = markingClips(net, road);
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

// 5024a83 measured with bench/junction-audit.ts: metres of dividers and centre lines drawRoad
// strokes outside its nodes' outlines. TASK-079 draws turn arrows only where a road's lanes
// differ (B34), so all strokes together fall by design; the clip never acted on arrows.
const mainLineOutsideM = { grid: 9880, town: 101643, sindelfingen: 46174, munich: 38684 };

test.each(auditCities)(
  'T27: %s keeps at least 98 % of main’s lane lines outside outlines',
  (name) => {
    const lengths = markingLengths(audit(name).net);
    console.info('T27 markings', name, lengths, 'main lines outside', mainLineOutsideM[name]);
    expect(lengths.lineOutsideM).toBeGreaterThanOrEqual(0.98 * mainLineOutsideM[name]);
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
  // The only failures are trips stuck at a jam head again after their last respawn (TASK-077).
  expect(morning.failed).toBe(morning.failedByReason.gridlocked);
  expect(morning.completed).toBeGreaterThanOrEqual(mainCompletedMunich);
}, 600_000);
