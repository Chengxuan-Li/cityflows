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
// crossing its neighbour away from the node; other = none of these (listed in the report).
const residual: Record<AuditCity, Partial<Record<Measure, string[]>>> = {
  grid: {
    // other: a left turn from the one-lane west arm of an edge T, 1.1 cm past the tolerance.
    movementsEscaping: ['n:3'],
  },
  town: {},
  // TASK-082 (lanes and surfaces offset from corridor reference lines): the classes below are
  // as measured on main; the nodes marked TASK-082 joined a list because their road ends' edges
  // moved by a few centimetres (normals of the resampled reference instead of mitres of the
  // densely smoothed centerline), which moves `junctionOutline`'s and the audit's thresholds
  // (0.05 to 0.1 m), not because a junction got a new shape class. Stage 3 (TASK-083) replaces
  // the outline and the curbs.
  sindelfingen: {
    movementsEscaping: [
      'n:14', // coincident (TASK-080: side by side into an absorbing merge, 2.5 m setbacks)
      'n:161', // TASK-082
      'n:276', // coincident
      'n:371', // other
      'n:375', // other
      'n:493', // other
      'n:594', // TASK-082
      'n:81', // other
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
    curbKinks: [
      'n:1075', // TASK-082
      'n:1105', // TASK-082
      'n:1202', // TASK-082
      'n:139', // coincident
      'n:209', // TASK-082
      'n:21', // TASK-082
      'n:211', // TASK-082
      'n:267', // TASK-082
      'n:32', // TASK-082
      'n:355', // other
      'n:393', // TASK-082
      'n:490', // other
      'n:501', // coincident
      'n:512', // TASK-082
      'n:580', // TASK-082
      'n:584', // TASK-082
      'n:620', // coincident
      'n:628', // coincident
      'n:658', // TASK-082
      'n:696', // TASK-082
      'n:78', // coincident
      'n:784', // TASK-082
      'n:792', // coincident
      'n:8', // TASK-082
      'n:867', // TASK-082
      'n:875', // TASK-082
      'n:887', // TASK-082
      'n:893', // TASK-082
      'n:902', // TASK-082
      'n:99', // TASK-082
    ],
    sharpCorners: [
      'n:434', // crossing
      'n:68', // crossing
    ],
  },
  munich: {
    // TASK-080 resolved n:305 and n:726 (branches side by side, B36) and n:774 (r:1368's
    // shorter transition at n:936). TASK-082 resolved n:516 and n:970.
    movementsEscaping: [
      'n:1123', // coincident
      'n:1375', // other
      'n:138', // other
      'n:182', // stub
      'n:266', // other
      'n:324', // coincident
      'n:40', // other
      'n:431', // TASK-082
      'n:55', // other
      'n:974', // stub
      'n:975', // stub
      'n:989', // other
    ],
    // TASK-080 resolved n:305 (B36) and n:774 (see movementsEscaping).
    edgesOff: [
      'n:1123', // coincident
      'n:1303', // TASK-082
      'n:1375', // other
      'n:322', // coincident
      'n:324', // coincident
      'n:719', // coincident
      'n:823', // coincident
      'n:898', // TASK-082
      'n:949', // coincident
    ],
    // TASK-080 resolved n:305 (B36) and n:774 (see movementsEscaping). TASK-082 resolved n:235.
    curbKinks: [
      'n:104', // other
      'n:1123', // coincident
      'n:154', // TASK-082
      'n:180', // TASK-082
      'n:324', // TASK-082
      'n:33', // other
      'n:344', // stub
      'n:387', // coincident
      'n:425', // TASK-082
      'n:431', // TASK-082
      'n:440', // coincident
      'n:446', // coincident
      'n:510', // TASK-082
      'n:516', // other
      'n:548', // TASK-082
      'n:590', // TASK-082
      'n:621', // other
      'n:661', // TASK-082
      'n:719', // coincident
      'n:823', // coincident
      'n:894', // TASK-082
      'n:898', // TASK-082
      'n:949', // TASK-082
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
  // TASK-082: bends too tight for these service and residential streets' lanes are eased to a
  // radius their inside edge can take (each a `reference_eased` note); the arc is shorter than
  // the source's corner.
  'r:1026#0': 'Eased corner of r:1025/r:1026 (2.2 m off its centerline).',
  'r:1075#0': 'Eased corner of r:1075/r:1076 (1.4 m off its centerline).',
  'r:839#0': 'Eased corner of r:839/r:840 (3.2 m off its centerline).',
  'r:840#0': 'Eased corner of r:839/r:840 (3.2 m off its centerline).',
  'r:867#0': 'Eased corner of r:866/r:867 (2.0 m off its centerline).',
};

// TASK-082: dividers or centre lines that reach past the 0.1 m margin into another road's mouth
// or under an outline, at junctions whose outline moved with the new road edges (stage 3,
// TASK-083, replaces the outline): Sindelfingen r:624 by 0.13 m, Munich r:155 by 0.63 m.
const markingExceptions: Partial<Record<AuditCity, string[]>> = {
  sindelfingen: ['r:624'],
  munich: ['r:155'],
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
    expect(offending).toEqual(markingExceptions[name] ?? []);
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
