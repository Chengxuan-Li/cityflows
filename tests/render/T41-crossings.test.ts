import type { Graphics } from 'pixi.js';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  auditCities,
  compileAuditCity,
  loadAuditCity,
  type AuditCity,
} from '../../bench/junction-audit';
import { createEditor } from '../../src/editor';
import {
  deepInside,
  pointAtDistance,
  pointInPolygon,
  segmentDistance,
} from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { type CNode, type CompiledCity, type CRoad } from '../../src/network';
import { junctionCorners } from '../../src/network/junctions';
import { openProject } from '../../src/project/open';
import { saveProject } from '../../src/project/save';
import {
  crossingArms,
  crossingDefault,
  crossingPlacement,
  crossingStripes,
  drawRoad,
} from '../../src/render/layers/roads';
import { style } from '../../src/render/style';
import { tierCities, unitTest } from '../tier';
import type { City } from '../../src/schema';

const nets = new Map<AuditCity, CompiledCity>();
const net = (name: AuditCity) => {
  if (!nets.has(name)) nets.set(name, compileAuditCity(name));
  return nets.get(name)!;
};

/** Every road end of the city, at its node. */
function ends(city: CompiledCity) {
  return city.roads.flatMap((road) =>
    [false, true].map((atEnd) => ({
      road,
      atEnd,
      node: city.nodes[atEnd ? road.to : road.from]!,
    })),
  );
}

const expressway = (road: CRoad) => road.roadClass === 'motorway' || road.roadClass === 'ramp';

/** The arm of a road end has a signalized approach: the crossing keeps TASK-072's place. */
function signalArm(city: CompiledCity, node: CNode, road: CRoad, atEnd: boolean) {
  const arm = crossingArms(city, node).find((a) =>
    a.some((e) => e.road === road && e.atEnd === atEnd),
  )!;
  return arm.some(
    (e) => e.atEnd && e.road.lanes.some((i) => city.lanes[i]!.stopM < city.lanes[i]!.lengthM),
  );
}

/** The junction outline still covers the middle of the road where the crossing would lie at its
 * farthest (moved out 6 m; a signalized approach does not move): the end lies under the outline
 * of an irregular node (TASK-089's limit). */
function underOutline(city: CompiledCity, node: CNode, road: CRoad, atEnd: boolean, nearM: number) {
  const lane = city.lanes[road.lanes[Math.floor(road.lanes.length / 2)]!]!;
  const d = nearM + (signalArm(city, node, road, atEnd) && atEnd ? 0 : 6);
  return [d, d + 2.5].some((x) =>
    pointInPolygon(
      pointAtDistance(lane.polyline, lane.cumulative, atEnd ? lane.lengthM - x : x),
      node.outline,
    ),
  );
}

test.each(tierCities(['town', 'sindelfingen', 'munich'] as const))(
  'T41.1: on %s every road end at a junction of three or more arms has a crossing unless excluded',
  (name) => {
    const city = net(name);
    const counts = {
      ends: 0,
      drawn: 0,
      eligible: 0,
      excluded: 0,
      noOutline: 0,
      short: 0,
      underOutline: 0,
    };
    const missing: string[] = [];
    const wrong: string[] = [];
    for (const { road, atEnd, node } of ends(city)) {
      counts.ends++;
      const arms = crossingArms(city, node);
      const stripes = crossingStripes(city, road, atEnd);
      if (stripes.length) counts.drawn++;
      // Never on a motorway or ramp, nor at a merge or diverge of them.
      if (
        stripes.length &&
        (expressway(road) || arms.every((arm) => arm.every((e) => expressway(e.road))))
      )
        wrong.push(`${road.id} at ${node.id}`);
      if (arms.length < 3 && !node.signal) continue;
      if (!crossingDefault(city, road, atEnd)) {
        counts.excluded++;
        continue;
      }
      counts.eligible++;
      if (stripes.length) continue;
      const placement = crossingPlacement(city, road, atEnd);
      if (!node.outline.length) counts.noOutline++;
      else if (road.lanes.every((i) => city.lanes[i]!.lengthM < placement.nearM + 9.75))
        counts.short++;
      else if (underOutline(city, node, road, atEnd, placement.nearM)) counts.underOutline++;
      else missing.push(`${road.id} at ${node.id}`);
    }
    console.info('T41.1', name, counts);
    expect(wrong).toEqual([]);
    expect(missing).toEqual([]);
  },
  120_000,
);

test.each(tierCities(auditCities))(
  'T41.2: on %s no stripe lies in a junction polygon, a curb, or within 1 m of a curb return',
  (name) => {
    const city = net(name);
    const bad: string[] = [];
    const signal: string[] = [];
    let stripes = 0;
    for (const { road, atEnd, node } of ends(city)) {
      const curbs = junctionCorners(node).filter((c) => c.kind === 'curb' && c.curve);
      for (const stripe of crossingStripes(city, road, atEnd)) {
        stripes++;
        // Inside a curb arc: between the arc and its chord. The junction polygons of the road's two
        // nodes; another node's polygon over the road
        // (a junction on another grade, an unconnected road through it) is not this crossing's.
        const why = (p: Vec2) =>
          [road.from, road.to].some((n) => pointInPolygon(p, city.nodes[n]!.outline))
            ? 'polygon'
            : curbs.some((c) => pointInPolygon(p, [...c.curve!, c.curve![0]!]))
              ? 'curb'
              : curbs.some((c) =>
                    c.curve!.some(
                      (q, i) => i > 0 && segmentDistance(p, c.curve![i - 1]!, q) < 1 - 1e-9,
                    ),
                  )
                ? 'return'
                : null;
        const reason = stripe.map(why).find((r) => r !== null);
        if (!reason) continue;
        (signalArm(city, node, road, atEnd) ? signal : bad).push(
          `${road.id} at ${node.id}: ${reason}`,
        );
      }
    }
    console.info('T41.2', name, { stripes, bad: bad.length, signalArm: signal.length });
    expect(bad).toEqual([]);
  },
  120_000,
);

/** Centre lines `drawRoad` strokes (the divider width at alpha 0.85), both layers. */
function centreLines(city: CompiledCity, road: CRoad): Vec2[][] {
  const lines: Vec2[][] = [];
  let pending: Vec2[][] = [];
  let previous = { x: 0, y: 0 };
  const graphics = {
    poly() {
      pending = [];
      return this;
    },
    fill() {
      pending = [];
      return this;
    },
    stroke({ width, alpha }: { width: number; alpha?: number }) {
      if (width === style.dividerWidthM && alpha === 0.85) lines.push(...pending);
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
  drawRoad(graphics, graphics, city, road, false, graphics);
  return lines;
}

test.each(tierCities(auditCities))(
  'T41.4: on %s no centre-line segment lies inside its junction polygons (0.1 m)',
  (name) => {
    const city = net(name);
    const source = loadAuditCity(name);
    const nodeGrade = (n: CNode) => source.nodes[n.id]!.layer;
    const roadGrade = (r: CRoad) =>
      source.roads[r.id]!.layer ??
      Math.min(nodeGrade(city.nodes[r.from]!), nodeGrade(city.nodes[r.to]!));
    const box = (points: Vec2[]) => {
      const xs = points.map((p) => p.x),
        ys = points.map((p) => p.y);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
    };
    const boxes = city.nodes.map((n) => (n.outline.length ? box(n.outline) : null));
    const inside: string[] = [];
    // A road through the polygon of a node it does not reach (Sindelfingen r:424/r:451 through
    // n:125, coincident source ways): the node area, drawn above the markings, covers it.
    const under = new Set<string>();
    let segments = 0;
    for (const road of city.roads) {
      const [rx0, ry0, rx1, ry1] = box(road.surface);
      // Junction polygons of the road's grade near it; a junction on a bridge above (or a road
      // passing under one) is drawn on another grade.
      const near = city.nodes.filter((n, k) => {
        const b = boxes[k];
        return (
          b &&
          b[0] <= rx1 &&
          b[2] >= rx0 &&
          b[1] <= ry1 &&
          b[3] >= ry0 &&
          nodeGrade(n) === roadGrade(road)
        );
      });
      for (const [a, b] of centreLines(city, road)) {
        segments++;
        const steps = Math.max(1, Math.ceil(Math.hypot(b!.x - a!.x, b!.y - a!.y) / 0.25));
        const points = Array.from({ length: steps + 1 }, (_, i) => ({
          x: a!.x + ((b!.x - a!.x) * i) / steps,
          y: a!.y + ((b!.y - a!.y) * i) / steps,
        }));
        const hit = near.find((n) => points.some((p) => deepInside(p, n.outline, 0.1)));
        if (hit && (hit.idx === road.from || hit.idx === road.to))
          inside.push(`${road.id} in ${hit.id}`);
        else if (hit) under.add(`${road.id} in ${hit.id}`);
      }
    }
    console.info('T41.4', name, { segments, inside: inside.length, under: [...under] });
    expect([...new Set(inside)]).toEqual([]);
  },
  120_000,
);

unitTest(
  'T41.3: a crossing override redraws, undoes, redoes and survives save and open',
  async () => {
    const source = loadAuditCity('grid');
    const editor = createEditor(source);
    const compiled = editor.compiled;
    const node = compiled.nodes.find((n) => !n.signal && crossingArms(compiled, n).length === 4)!;
    const road = compiled.roads.find((r) => r.to === node.idx)!;
    const at = (result: { compiled: CompiledCity }) =>
      result.compiled.roads[result.compiled.index.road.get(road.id)!]!;
    expect(crossingStripes(compiled, road, true, editor.city).length).toBeGreaterThan(0);
    const off = editor.apply({ kind: 'setCrossing', roadId: road.id, end: 'end', crossing: false });
    if (!off.ok) throw new Error('edit');
    expect(off.city.roads[road.id]!.crossings).toEqual({ end: false });
    expect(crossingStripes(off.compiled, at(off), true, off.city)).toEqual([]);
    // The default needs no entry: clearing the override removes the field.
    const undone = editor.undo()!;
    if (!undone.ok) throw new Error('undo');
    expect(undone.city.roads[road.id]!.crossings).toBeUndefined();
    expect(crossingStripes(undone.compiled, at(undone), true, undone.city).length).toBeGreaterThan(
      0,
    );
    const redone = editor.redo()!;
    if (!redone.ok) throw new Error('redo');
    expect(redone.city.roads[road.id]!.crossings).toEqual({ end: false });
    expect(crossingStripes(redone.compiled, at(redone), true, redone.city)).toEqual([]);

    const scenario = JSON.parse(
      readFileSync('fixtures/projects/grid5x5.cityflows.json', 'utf8'),
    ) as {
      scenarios: unknown[];
      city: City;
    };
    const project = { city: redone.city, scenarios: scenario.scenarios } as never;
    const opened = await openProject(await saveProject(project));
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.project.city.roads[road.id]!.crossings).toEqual({ end: false });
    expect(opened.project.city).toEqual(redone.city);

    // A file saved on main (no `crossings` anywhere) opens with the defaults.
    const main = await openProject(
      readFileSync('fixtures/projects/grid5x5.cityflows.json', 'utf8'),
    );
    if (!main.ok) throw new Error(main.error);
    expect(Object.values(main.project.city.roads).some((r) => 'crossings' in r)).toBe(false);
  },
);
