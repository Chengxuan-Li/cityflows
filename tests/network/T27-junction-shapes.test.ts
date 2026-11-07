import type { Graphics } from 'pixi.js';
import { expect, test } from 'vitest';
import {
  auditCities,
  auditJunctions,
  compileAuditCity,
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

// T27 (TASK-074): what stays of it after TASK-083. Its outline measures (simple, movements held,
// road ends met, curbs tangent), its storage test and its Munich morning moved to T38.
// bed19c1 (main before TASK-074) measured with bench/junction-audit.ts: overlap of road ends
// connected to their cuts, outside the outline, at nodes with an outline.
const baselineOverlapM2 = { sindelfingen: 55.69, munich: 256.56 };
const audited = new Map<AuditCity, { net: CompiledCity; audits: NodeAudit[] }>();
function audit(name: AuditCity) {
  let entry = audited.get(name);
  if (!entry) {
    const net = compileAuditCity(name);
    audited.set(name, (entry = { net, audits: auditJunctions(net) }));
  }
  return entry;
}

test.each(auditCities)(
  'T27: %s road-end overlap outside outlines is gone or at least halved',
  (name) => {
    const summary = summarize(audit(name).audits);
    console.info('T27', name, summary);
    if (name === 'grid' || name === 'town') {
      expect(summary.overlapM2).toBe(0);
      expect(summary.continuationOverlapM2 + summary.awayOverlapM2 + summary.bodyOverlapM2).toBe(0);
    } else {
      // TASK-083: the two carriageways of one corridor converging on a node at under 20 degrees
      // are one approach and no longer cut each other to the cap; where the source draws them
      // closer than their lane blocks for more than 25 m the polygon does not follow them (it
      // would bulge), so their overlap stays road on road: Landsberger Straße at n:104, n:324
      // and n:721, Arnulfstraße at n:446.
      const converging = new Set(['n:104', 'n:324', 'n:721', 'n:446']);
      const rest = audit(name).audits.reduce(
        (sum, a) => sum + (converging.has(a.id) ? 0 : a.overlapM2),
        0,
      );
      expect(rest).toBeLessThanOrEqual(baselineOverlapM2[name] / 2);
    }
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
      // TASK-083: the polygon holds every movement surface, so where a street's two directions
      // are cut at different distances a turn leaving the nearer cut covers up to a metre
      // of the other direction's end, and its centre line runs under the polygon there.
      const outlines = [net.nodes[road.from]!.outline, net.nodes[road.to]!.outline];
      if (
        points.some((p) =>
          rings.some((ring) => deepInside(p, ring, outlines.includes(ring) ? 1 : 0.1)),
        )
      )
        offending.push(road.id);
    }
    expect(offending).toEqual([]);
  },
  120_000,
);

// 5024a83 measured with bench/junction-audit.ts: metres of dividers and centre lines drawRoad
// strokes outside its nodes' outlines. TASK-079 draws turn arrows only where a road's lanes
// differ (B34), so all strokes together fall by design; the clip never acted on arrows. TASK-091
// re-measured: lines end 0.5 m before every crossing, which moved out to the curb returns and
// onto every junction of three or more arms (5024a83: grid 9880, town 101643, sindelfingen
// 46174, munich 38684 m).
const mainLineOutsideM = { grid: 8453, town: 83776, sindelfingen: 41613, munich: 35400 };

test.each(auditCities)(
  'T27: %s keeps at least 98 % of main’s lane lines outside outlines',
  (name) => {
    const lengths = markingLengths(audit(name).net);
    console.info('T27 markings', name, lengths, 'main lines outside', mainLineOutsideM[name]);
    expect(lengths.lineOutsideM).toBeGreaterThanOrEqual(0.98 * mainLineOutsideM[name]);
  },
  120_000,
);
