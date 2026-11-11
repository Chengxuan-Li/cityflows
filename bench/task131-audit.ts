import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  cumulativeLengths,
  nearestOnPolyline,
  parallelOffset,
  pointAtDistance,
  polylineLength,
} from '../src/geo/polyline';
import { lonLatToLocal } from '../src/geo/projection';
import type { Vec2 } from '../src/geo/vec2';
import { parseOsm } from '../src/importers/osm/parse';
import { compile, type CompiledCity } from '../src/network';
import type { OsmRoad } from '../src/importers/osm/roads';
import type { ImportOptions, ImportResult } from '../src/importers/types';
import type { City } from '../src/schema';
import { importOsmCached } from './city-cache';
import { frame, rayCrossings } from './geometry-audit';

// TASK-131 Phase 0 audit (read only): runs main's OSM import with a snapshot of every road line
// and node after each geometry pass, and reports (1) the junction clusters consolidateJunctions
// merges, (2) how far each pass moves road lines from their OSM position, (3) the gap between
// the lane blocks of each paired carriageway at OSM positions, and (6) the junction groups a
// link threshold would form. The pipeline is src/importers/osm/index.ts itself, copied to a
// temporary directory with snapshot calls inserted after each pass (src/ is not changed); the
// copy's final city must equal the cached import. Usage:
// node --experimental-strip-types --import ./bench/register.ts ./bench/task131-audit.ts <out-dir>
// then npx prettier --write <out-dir>, so the JSON dumps pass format:check.
// (then npx prettier --write <out-dir>, so the JSON dumps pass format:check)

type Hooks = {
  snap?: (name: string, city: City, roads: OsmRoad[], extra?: unknown) => void;
  members?: (members: Map<string, string[]>) => void;
  candidate?: (road: City['roads'][string]) => void;
  T?: number;
};
const hooks: Hooks = {};
(globalThis as { __task131?: Hooks }).__task131 = hooks;

const work = join(tmpdir(), 'cityflows-task131');
mkdirSync(work, { recursive: true });

function moduleUrl(dir: string, specifier: string): string {
  const base = resolve(dir, specifier);
  for (const file of [base, `${base}.ts`, join(base, 'index.ts')])
    if (existsSync(file) && statSync(file).isFile()) return pathToFileURL(file).href;
  throw new Error(`cannot resolve ${specifier} from ${dir}`);
}

/** A copy of `file` with each anchor replaced (each must occur exactly once) and its relative
 * imports pointing at the original modules. */
function instrument(file: string, edits: [string, string][]): string {
  let source = readFileSync(file, 'utf8');
  for (const [anchor, replacement] of edits) {
    const count = source.split(anchor).length - 1;
    if (count !== 1) throw new Error(`${file}: anchor found ${count} times: ${anchor}`);
    source = source.replace(anchor, () => replacement);
  }
  source = source.replace(
    /(from\s+|import\s+)'(\.[^']+)'/g,
    (_, lead: string, specifier: string) => `${lead}'${moduleUrl(dirname(file), specifier)}'`,
  );
  const out = join(work, file.replaceAll(/[\\/:]/g, '_'));
  writeFileSync(out, `const __hook = (globalThis as any).__task131;\n${source}`);
  return pathToFileURL(out).href;
}

const snap = (name: string, extra = '') => `__hook.snap?.('${name}', city, roads${extra});`;
const indexUrl = instrument('src/importers/osm/index.ts', [
  [
    "if (!roads.length) return fail('osm_no_drivable_ways', 'No drivable highways intersect the bbox');",
    `if (!roads.length) return fail('osm_no_drivable_ways', 'No drivable highways intersect the bbox');\n  ${snap('osm')}`,
  ],
  [
    '  mergeShortRoads(city, roads, protectedNodes);\n  joinDividedFeeders(city, roads, protectedNodes);\n',
    `  mergeShortRoads(city, roads, protectedNodes);\n  ${snap('mergeShortRoads')}\n  joinDividedFeeders(city, roads, protectedNodes);\n  ${snap('joinDividedFeeders')}\n`,
  ],
  [
    '  const signalIds = consolidateJunctions(',
    `  ${snap('preConsolidation', ', { signals: signals.map((n) => n.id) }')}\n  const signalIds = consolidateJunctions(`,
  ],
  [
    '  const coincident = assignCorridors(city, roads);\n',
    `  ${snap('consolidateJunctions')}\n  const coincident = assignCorridors(city, roads);\n`,
  ],
  ['  realignRoads(\n', `  ${snap('smoothRoads')}\n  realignRoads(\n`],
  [
    '  separateCoincident(city, coincident);\n',
    `  ${snap('realignRoads')}\n  separateCoincident(city, coincident);\n  ${snap('separateCoincident')}\n`,
  ],
  ['  separateDual(city, roads);\n', `  separateDual(city, roads);\n  ${snap('separateDual')}\n`],
  [
    '  attachCarriageways(city, roads);\n',
    `  attachCarriageways(city, roads);\n  ${snap('attachCarriageways')}\n`,
  ],
  [
    '  relaxRoads(city, roads, options.relaxMaxM ?? DEFAULT_RELAX_MAX_M);\n',
    `  relaxRoads(city, roads, options.relaxMaxM ?? DEFAULT_RELAX_MAX_M);\n  ${snap('relaxRoads')}\n`,
  ],
  [
    '  sampleSameDirection(sameDirection);\n',
    `  sampleSameDirection(sameDirection);\n  ${snap('sampleSameDirection')}\n`,
  ],
]);
// consolidateJunctions with the link threshold `__hook.T` (at most T; today's rule, under 30 m,
// when unset), reporting its clusters and the links it considers.
const splitUrl = instrument('src/importers/osm/split.ts', [
  [
    '    if (polylineLength(road.centerline) >= 30) continue;',
    '    __hook.candidate?.(road);\n    if (__hook.T === undefined ? polylineLength(road.centerline) >= 30 : polylineLength(road.centerline) > __hook.T) continue;',
  ],
  [
    '          (polylineLength(road.centerline) >= 30 ||',
    '          ((__hook.T === undefined ? polylineLength(road.centerline) >= 30 : polylineLength(road.centerline) > __hook.T) ||',
  ],
  [
    '  const representatives = new Map<string, string>();',
    '  __hook.members?.(members);\n  const representatives = new Map<string, string>();',
  ],
]);
const { importOsm } = (await import(indexUrl)) as {
  importOsm: (xml: string, options: ImportOptions) => ImportResult;
};
const { consolidateJunctions } = (await import(splitUrl)) as {
  consolidateJunctions: (
    city: City,
    roads: OsmRoad[],
    compiled: CompiledCity,
    signals: string[],
  ) => string[];
};

// ---------------------------------------------------------------------------------------------
// Snapshots

interface SRoad {
  id: string;
  from: string;
  to: string;
  line: Vec2[];
  offset: number;
  half: number;
  ways: number[];
  inferred: string[];
  corridorId: string | null;
  streetGroupId: string | null;
  roadClass: string;
  name: string | null;
  layer: number;
  wayId: number;
  roundabout: boolean;
  bridge: boolean;
  lanes: number;
}
interface SNode {
  id: string;
  pos: Vec2;
  osmIds: number[];
  inferred: string[];
  control: string;
}
interface Snap {
  name: string;
  roads: Map<string, SRoad>;
  nodes: Map<string, SNode>;
}

function takeSnap(name: string, city: City, roads: OsmRoad[]): Snap {
  const out: Snap = { name, roads: new Map(), nodes: new Map() };
  for (const source of roads) {
    const { road } = source;
    const tags = JSON.parse(source.attributes) as [string, string][];
    out.roads.set(road.id, {
      id: road.id,
      from: road.from,
      to: road.to,
      line: road.centerline.map((p) => ({ x: p.x, y: p.y })),
      offset: road.lateralOffsetM,
      half: road.lanes.reduce((w, lane) => w + lane.widthM, 0) / 2,
      ways: [...road.provenance.osmIds!],
      inferred: [...(road.provenance.inferred ?? [])],
      corridorId: road.corridorId ?? null,
      streetGroupId: road.streetGroupId,
      roadClass: road.roadClass,
      name: road.name,
      layer: source.layer,
      wayId: source.wayId,
      roundabout: tags.some(([k, v]) => k === 'junction' && v === 'roundabout'),
      bridge: tags.some(([k, v]) => k === 'bridge' && v !== 'no'),
      lanes: road.lanes.length,
    });
  }
  for (const node of Object.values(city.nodes))
    out.nodes.set(node.id, {
      id: node.id,
      pos: { ...node.pos },
      osmIds: [...node.provenance.osmIds!],
      inferred: [...(node.provenance.inferred ?? [])],
      control: node.control,
    });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

/** `line` offset by `offset` along each segment's right-hand normal (y south: heading (dx, dy)
 * has normal (-dy, dx)), as the polyline of the offset segments' ends (`pts`), and samples about
 * every `step` metres on those segments with their unit directions. Segments under 5 cm are
 * skipped: smoothed centerlines hold millimetre back-steps whose normals point the other way. */
function axis(line: readonly Vec2[], offset: number, step = 1) {
  const pts: Vec2[] = [];
  const samples: Vec2[] = [];
  const dirs: Vec2[] = [];
  const stations: number[] = [];
  /** The length each sample stands for. */
  const weights: number[] = [];
  let station = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 0.05) {
      station += l;
      continue;
    }
    const t = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    const A = { x: a.x - t.y * offset, y: a.y + t.x * offset };
    const B = { x: b.x - t.y * offset, y: b.y + t.x * offset };
    pts.push(A, B);
    const count = Math.max(1, Math.ceil(l / step));
    for (let k = samples.length ? 1 : 0; k <= count; k++) {
      const u = k / count;
      samples.push({ x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u });
      dirs.push(t);
      stations.push(station + l * u);
      weights.push(k === 0 ? 0 : l / count);
    }
    station += l;
  }
  return { pts, samples, dirs, stations, weights, total: station };
}

interface Ref {
  road: SRoad;
  pts: Vec2[];
  box: { minX: number; minY: number; maxX: number; maxY: number };
}
function refIndex(snap: Snap, withOffset: boolean): Map<number, Ref[]> {
  const out = new Map<number, Ref[]>();
  for (const road of snap.roads.values()) {
    if (road.inferred.includes('medianCrossing')) continue;
    const { pts } = withOffset ? axis(road.line, road.offset) : { pts: road.line };
    const ref: Ref = {
      road,
      pts,
      box: {
        minX: Math.min(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)),
        maxX: Math.max(...pts.map((p) => p.x)),
        maxY: Math.max(...pts.map((p) => p.y)),
      },
    };
    for (const way of road.ways) out.set(way, [...(out.get(way) ?? []), ref]);
  }
  return out;
}

/** Distance from `p` (heading `t`) to the nearest segment of `refs` running within 90 degrees
 * of `t`, and that nearest point with its unit direction. */
function nearestRef(p: Vec2, t: Vec2, refs: Ref[], sign = 1) {
  let best = { d: Infinity, q: p, dir: t };
  for (const { pts, box } of refs) {
    const outside = Math.max(box.minX - p.x, p.x - box.maxX, box.minY - p.y, p.y - box.maxY, 0);
    if (outside >= best.d) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!,
        b = pts[i]!;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0 || sign * (dx * t.x + dy * t.y) <= 0) continue;
      const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const q = { x: a.x + u * dx, y: a.y + u * dy };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best.d) {
        const l = Math.sqrt(l2);
        best = { d, q, dir: { x: dx / l, y: dy / l } };
      }
    }
  }
  return best;
}

/** Nearest-node lookup on a 50 m grid. */
function nodeGrid(nodes: { id: string; pos: Vec2 }[]) {
  const cell = 50;
  const grid = new Map<string, { id: string; pos: Vec2 }[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const n of nodes) {
    const k = key(n.pos.x, n.pos.y);
    grid.set(k, [...(grid.get(k) ?? []), n]);
  }
  return (p: Vec2) => {
    let best = { id: '', d: Infinity };
    const cx = Math.floor(p.x / cell),
      cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const n of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = Math.hypot(n.pos.x - p.x, n.pos.y - p.y);
          if (d < best.d) best = { id: n.id, d };
        }
    return best;
  };
}

function outwardHeading(line: readonly Vec2[], fromStart: boolean, length = 10): number {
  const pts = fromStart ? line : [...line].reverse();
  const lengths = cumulativeLengths(pts);
  const p = pointAtDistance(pts, lengths, Math.min(length, lengths.at(-1)!));
  return Math.atan2(p.y - pts[0]!.y, p.x - pts[0]!.x);
}

// ---------------------------------------------------------------------------------------------
// The audit of one city

const PASSES = [
  'mergeShortRoads',
  'joinDividedFeeders',
  'consolidateJunctions',
  'smoothRoads',
  'realignRoads',
  'separateCoincident',
  'separateDual',
  'attachCarriageways',
  'relaxRoads',
  'sampleSameDirection',
] as const;
const NEAR_M = 30;
const MOVED_M = 0.05;
const ZONE_M = 15;
/** joinDividedFeeders' median node (its osmIds are way ids), unless merged into a cluster. */
const synthetic = (n: SNode) =>
  n.inferred.includes('medianJunction') && !n.inferred.includes('junctionConsolidation');

interface Arm {
  road: string;
  node: string;
  street: string;
  oneWay: boolean;
  incoming: boolean;
  roadClass: string;
  name: string | null;
  heading: number;
}

/** A street: the road's name, else its carriageway pair (the final corridor), else its way. */
let corridorOf: (road: string) => string | null = () => null;

function armsOf(snap: Snap, members: Set<string>, inner: Set<string>): Arm[] {
  return [...snap.roads.values()].flatMap((road) => {
    if (inner.has(road.id)) return [];
    const ends = [members.has(road.from), members.has(road.to)];
    if (ends[0] === ends[1]) return [];
    const atStart = ends[0]!;
    return [
      {
        road: road.id,
        node: atStart ? road.from : road.to,
        street: road.name ?? corridorOf(road.id) ?? `way/${road.wayId}`,
        oneWay: road.streetGroupId === null,
        incoming: !atStart,
        roadClass: road.roadClass,
        name: road.name,
        heading: outwardHeading(road.line, atStart),
      },
    ];
  });
}

/** The arms of one street within 35 degrees of each other (a two-way street's two directions,
 * a dual carriageway's two carriageways on one side) as one arm with their mean heading. */
function streetArms(arms: { street: string; heading: number }[]): number[] {
  const merged: { street: string; x: number; y: number }[] = [];
  for (const arm of arms) {
    const same = merged.find(
      (m) =>
        m.street === arm.street &&
        Math.abs(wrap(Math.atan2(m.y, m.x) - arm.heading)) < (35 * Math.PI) / 180,
    );
    if (same) {
      same.x += Math.cos(arm.heading);
      same.y += Math.sin(arm.heading);
    } else merged.push({ street: arm.street, x: Math.cos(arm.heading), y: Math.sin(arm.heading) });
  }
  return merged.map((m) => Math.atan2(m.y, m.x));
}

function minGap(headings: number[]): number {
  if (headings.length < 2) return 360;
  const sorted = headings.map((h) => (h + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  return deg(
    Math.min(...sorted.map((h, i) => (i ? h - sorted[i - 1]! : h + 2 * Math.PI - sorted.at(-1)!))),
  );
}

const near35 = (a: number, b: number) => Math.abs(wrap(a - b)) < (35 * Math.PI) / 180;

function classify(snap: Snap, arms: Arm[], inner: string[]): string {
  const all = [
    ...arms.map((a) => snap.roads.get(a.road)!),
    ...inner.map((id) => snap.roads.get(id)!),
  ];
  if (all.some((r) => r.roundabout)) return 'roundabout';
  if (all.some((r) => r.roadClass === 'ramp' || r.roadClass === 'motorway')) return 'ramp';
  const streets = new Map<string, Arm[]>();
  for (const arm of arms) streets.set(arm.street, [...(streets.get(arm.street) ?? []), arm]);
  const kinds = [...streets.values()].map((list) => {
    // Two carriageways on one side: a one-way arm in and one out, within 35 degrees.
    const dual = list.some(
      (a) =>
        a.oneWay &&
        a.incoming &&
        list.some((b) => b.oneWay && !b.incoming && near35(a.heading, b.heading)),
    );
    const twoWay = list.some((a) => !a.oneWay);
    return dual && twoWay ? 'split' : dual ? 'dual' : 'single';
  });
  if (kinds.includes('split')) return 'carriageways merging or splitting';
  const duals = kinds.filter((k) => k === 'dual').length;
  if (duals >= 2) return 'dual x dual';
  if (duals === 1 && kinds.length >= 2) return 'dual x single';
  if (duals === 1) return 'carriageways merging or splitting';
  if (streetArms(arms).length <= 1) return 'other: dead end';
  return arms.every((a) => !a.oneWay) ? 'other: two-way streets' : 'other: with one-way streets';
}

function auditCity(name: string, file: string, bbox: [number, number, number, number]) {
  const snaps = new Map<string, Snap>();
  let pre: { city: City; roads: OsmRoad[]; signals: string[] } | undefined;
  hooks.snap = (step, city, roads, extra) => {
    snaps.set(step, takeSnap(step, city, roads));
    if (step === 'preConsolidation') {
      const { signals } = extra as { signals: string[] };
      pre = structuredClone({ city, roads, signals });
    }
  };
  const xml = readFileSync(file, 'utf8');
  const options: ImportOptions = { importerVersion: '1', drivingSide: 'right', bbox };
  const started = performance.now();
  const result = importOsm(xml, options);
  const importMs = performance.now() - started;
  hooks.snap = undefined;
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  // The copy must reproduce main's import exactly.
  const cached = importOsmCached(xml, options);
  if (!cached.ok) throw new Error('cached import failed');
  const strip = (c: City) =>
    JSON.stringify({
      nodes: Object.values(c.nodes).map((n) => [n.id, n.pos, n.provenance]),
      roads: Object.values(c.roads).map((r) => [
        r.id,
        r.from,
        r.to,
        r.centerline,
        r.lateralOffsetM,
      ]),
    });
  if (strip(result.city) !== strip(cached.city))
    throw new Error(`${name}: the instrumented import differs from the cached import`);
  const finalCity = result.city;
  const osm = snaps.get('osm')!;
  const preSnap = snaps.get('preConsolidation')!;
  const consolidated = snaps.get('consolidateJunctions')!;
  const last = snaps.get('sampleSameDirection')!;
  // Later import steps (signals, places, parking) must not move road lines.
  const laterMoves = [...last.roads.values()].filter((r) => {
    const f = finalCity.roads[r.id];
    return (
      !f || JSON.stringify(f.centerline) !== JSON.stringify(r.line) || f.lateralOffsetM !== r.offset
    );
  }).length;

  corridorOf = (id) => {
    const c = last.roads.get(id)?.corridorId;
    return c?.startsWith('corridor:') ? c.replace(/\/\d+$/, '') : null;
  };
  // Nodes at an OSM node's position (not bbox cuts, whose osmIds hold their way id).
  const data = parseOsm(xml);
  if (typeof data === 'string') throw new Error(data);
  const source = new Map(data.node.map((n) => [n.id, n]));
  const genuine = new Set<number>();
  for (const n of osm.nodes.values()) {
    const o = n.osmIds.length === 1 ? source.get(n.osmIds[0]!) : undefined;
    const q = o && lonLatToLocal(finalCity.geo!, o);
    if (q && Math.hypot(q.x - n.pos.x, q.y - n.pos.y) < 1e-6) genuine.add(n.osmIds[0]!);
  }
  // OSM junction nodes: the nodes before consolidation, at their OSM positions.
  const junctionNodes = [...preSnap.nodes.values()];
  const nearestJunction = nodeGrid(junctionNodes);
  const finalNodes = nodeGrid(Object.values(finalCity.nodes));

  // ---- 6. Junction groups at a link threshold ----------------------------------------------
  const runGroups = (T: number | undefined) => {
    const copy = structuredClone(pre!);
    let members = new Map<string, string[]>();
    const candidates: { road: string; from: string; to: string; lengthM: number }[] = [];
    hooks.T = T;
    hooks.members = (m) => (members = new Map([...m].map(([k, v]) => [k, [...v]])));
    hooks.candidate = (road) =>
      candidates.push({
        road: road.id,
        from: road.from,
        to: road.to,
        lengthM: polylineLength(road.centerline),
      });
    const compiled = compile(copy.city);
    if (!compiled.ok) throw new Error('pre-consolidation city must compile');
    consolidateJunctions(copy.city, copy.roads, compiled.compiled, copy.signals);
    hooks.T = undefined;
    hooks.members = hooks.candidate = undefined;
    const groups = [...members.values()].filter((g) => g.length > 1);
    return { groups, candidates };
  };
  const today = runGroups(undefined);
  // ---- 1. Clusters ----------------------------------------------------------------------
  const clusterNodes = [...consolidated.nodes.values()].filter((n) =>
    n.inferred.includes('junctionConsolidation'),
  );
  const subset = (a: number[], b: number[]) => a.every((x) => b.includes(x));
  const clusters = clusterNodes.map((node) => {
    const group = today.groups.find((g) => g.includes(node.id))!;
    if (
      !subset(
        group.flatMap((id) => preSnap.nodes.get(id)!.osmIds),
        node.osmIds,
      )
    )
      throw new Error(`${name}: cluster ${node.id} does not match its group`);
    const members = group.map((id) => preSnap.nodes.get(id)!);
    const memberIds = new Set(members.map((m) => m.id));
    const inner = [...preSnap.roads.values()].filter(
      (r) => memberIds.has(r.from) && memberIds.has(r.to) && !consolidated.roads.has(r.id),
    );
    const innerIds = new Set(inner.map((r) => r.id));
    const before = armsOf(preSnap, memberIds, innerIds);
    const finalSnap = last;
    const resolveArm = (arm: Arm, snap: Snap) => {
      const direct = snap.roads.get(arm.road);
      const road =
        direct && (direct.from === node.id || direct.to === node.id)
          ? direct
          : [...snap.roads.values()].find(
              (r) =>
                (arm.incoming ? r.to === node.id : r.from === node.id) &&
                r.ways.includes(preSnap.roads.get(arm.road)!.wayId),
            );
      if (!road) return null;
      return { road: road.id, heading: outwardHeading(road.line, !arm.incoming) };
    };
    const arms = before.map((arm) => {
      const after = resolveArm(arm, consolidated);
      const final = resolveArm(arm, finalSnap);
      return {
        road: arm.road,
        street: arm.street,
        incoming: arm.incoming,
        oneWay: arm.oneWay,
        osmNode: preSnap.nodes.get(arm.node)!.osmIds,
        headingBefore: round(deg(arm.heading), 1),
        headingAfterMerge: after ? round(deg(after.heading), 1) : null,
        headingFinal: final ? round(deg(final.heading), 1) : null,
        turnDeg: final ? round(Math.abs(deg(wrap(final.heading - arm.heading))), 1) : null,
      };
    });
    const finalArms = before.flatMap((arm) => {
      const r = resolveArm(arm, finalSnap);
      return r ? [{ street: arm.street, heading: r.heading }] : [];
    });
    const finalNode = finalCity.nodes[node.id]!;
    const moves = members.map((m) => ({
      node: m.id,
      osmIds: m.osmIds,
      kind: synthetic(m) ? 'median' : genuine.has(m.osmIds[0]!) ? 'osm' : 'clip',
      movedM: round(Math.hypot(m.pos.x - node.pos.x, m.pos.y - node.pos.y)),
      movedFinalM: round(Math.hypot(m.pos.x - finalNode.pos.x, m.pos.y - finalNode.pos.y)),
    }));
    const spread = Math.max(
      ...members.flatMap((a) =>
        members.map((b) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)),
      ),
    );
    return {
      node: node.id,
      cls: classify(
        preSnap,
        before,
        inner.map((r) => r.id),
      ),
      pos: { x: round(node.pos.x), y: round(node.pos.y) },
      control: finalNode.control,
      members: moves,
      spreadM: round(spread),
      innerRoads: inner.map((r) => ({
        road: r.id,
        from: r.from,
        to: r.to,
        ways: r.ways,
        name: r.name,
        roadClass: r.roadClass,
        lengthM: round(polylineLength(r.line)),
      })),
      streets: [...new Set(before.map((a) => a.street))],
      arms,
      minArmAngleBefore: round(minGap(streetArms(before)), 1),
      minArmAngleFinal: round(minGap(streetArms(finalArms)), 1),
      maxArmTurnDeg: Math.max(0, ...arms.map((a) => a.turnDeg ?? 0)),
      maxMoveM: Math.max(...moves.map((m) => m.movedM)),
    };
  });
  // Nodes mergeShortRoads removed (degree-2 joins; the geometry is kept), before and inside
  // consolidateJunctions, and joinDividedFeeders' median nodes and crossings.
  const mergedShort = [...osm.nodes.values()]
    .filter((n) => !snaps.get('mergeShortRoads')!.nodes.has(n.id))
    .map((n) => n.id);
  const clusterMembers = new Set(clusters.flatMap((c) => c.members.map((m) => m.node)));
  const mergedShortInConsolidation = [...preSnap.nodes.values()]
    .filter((n) => !consolidated.nodes.has(n.id) && !clusterMembers.has(n.id))
    .map((n) => n.id);
  const jdf = snaps.get('joinDividedFeeders')!;
  const medianNodes = [...jdf.nodes.values()]
    .filter((n) => n.inferred.includes('medianJunction'))
    .map((n) => ({ node: n.id, ways: n.osmIds, final: finalCity.nodes[n.id] ? n.id : 'merged' }));
  const medianCrossings = [...jdf.roads.values()]
    .filter((r) => r.inferred.includes('medianCrossing'))
    .map((r) => ({
      road: r.id,
      from: r.from,
      to: r.to,
      lengthM: round(polylineLength(r.line)),
      kept: !!finalCity.roads[r.id],
    }));

  // ---- 2. Displacement per pass ------------------------------------------------------------
  const clusterIds = new Set(clusters.map((c) => c.node));
  const osmRefs = refIndex(osm, true);
  /** Per pass, each road's largest displacement by that pass. */
  const roadMoves = new Map<string, Map<string, number>>();
  const displacement = PASSES.map((pass, k) => {
    const current = snaps.get(pass)!;
    const previous = snaps.get(k === 0 ? 'osm' : PASSES[k - 1]!)!;
    const prevRefs = refIndex(previous, true);
    const zones = {
      near: { inc: [] as [number, number][], cum: [] as [number, number][], total: 0 },
      away: { inc: [] as [number, number][], cum: [] as [number, number][], total: 0 },
    };
    const nearCluster = { incM: 0, incOtherM: 0 };
    const perRoad: {
      road: string;
      zone: string;
      incMaxM: number;
      cumMaxM: number;
      at: Vec2;
      node: string;
    }[] = [];
    for (const road of current.roads.values()) {
      if (road.inferred.includes('medianCrossing')) continue;
      const old = previous.roads.get(road.id);
      const unchanged =
        old &&
        old.offset === road.offset &&
        old.line.length === road.line.length &&
        old.line.every((p, i) => p.x === road.line[i]!.x && p.y === road.line[i]!.y);
      const { samples: pts, dirs, weights } = axis(road.line, road.offset);
      const refsPrev = road.ways.flatMap((w) => prevRefs.get(w) ?? []);
      const refsOsm = road.ways.flatMap((w) => osmRefs.get(w) ?? []);
      const worst: Record<string, { inc: number; cum: number; at: Vec2 }> = {};
      pts.forEach((p, i) => {
        const zone = nearestJunction(p).d <= NEAR_M ? 'near' : 'away';
        const z = zones[zone as 'near' | 'away'];
        const w = weights[i]!;
        z.total += w;
        const inc = unchanged ? 0 : nearestRef(p, dirs[i]!, refsPrev).d;
        const cum = nearestRef(p, dirs[i]!, refsOsm).d;
        if (inc > MOVED_M) {
          z.inc.push([inc, w]);
          if (zone === 'near') {
            const n = finalNodes(p);
            if (clusterIds.has(n.id) && n.d <= NEAR_M) nearCluster.incM += w;
            else nearCluster.incOtherM += w;
          }
        }
        if (cum > MOVED_M) z.cum.push([cum, w]);
        const most = (worst[zone] ??= { inc: 0, cum: 0, at: p });
        if (inc > most.inc) Object.assign(most, { inc, at: p });
        most.cum = Math.max(most.cum, cum);
      });
      const largest = Math.max(0, ...Object.values(worst).map((w) => w.inc));
      if (largest > MOVED_M)
        roadMoves.set(pass, (roadMoves.get(pass) ?? new Map()).set(road.id, round(largest)));
      for (const [zone, w] of Object.entries(worst))
        if (w.inc > MOVED_M || w.cum > MOVED_M)
          perRoad.push({
            road: road.id,
            zone,
            incMaxM: round(w.inc),
            cumMaxM: round(w.cum),
            at: { x: round(w.at.x, 1), y: round(w.at.y, 1) },
            node: finalNodes(w.at).id,
          });
    }
    // Moved lengths in metres; quantiles weighted by the length each sample stands for.
    const stats = (values: [number, number][]) => {
      const sorted = [...values].sort((a, b) => a[0] - b[0]);
      const total = sorted.reduce((sum, [, w]) => sum + w, 0);
      const at = (q: number) => {
        let sum = 0;
        for (const [v, w] of sorted) if ((sum += w) >= q * total) return v;
        return sorted.at(-1)?.[0] ?? 0;
      };
      return {
        movedM: Math.round(total),
        over05M: Math.round(sorted.reduce((sum, [v, w]) => sum + (v > 0.5 ? w : 0), 0)),
        medianM: round(at(0.5)),
        p90M: round(at(0.9)),
        maxM: round(sorted.at(-1)?.[0] ?? 0),
      };
    };
    // Node positions keyed by OSM node id.
    const nodeMoves: number[] = [];
    const prevPos = new Map<number, Vec2>();
    for (const n of previous.nodes.values())
      if (!synthetic(n)) for (const id of n.osmIds) if (genuine.has(id)) prevPos.set(id, n.pos);
    for (const n of current.nodes.values()) {
      if (synthetic(n)) continue;
      for (const id of n.osmIds) {
        const p = prevPos.get(id);
        if (p && Math.hypot(p.x - n.pos.x, p.y - n.pos.y) > 0.01)
          nodeMoves.push(Math.hypot(p.x - n.pos.x, p.y - n.pos.y));
      }
    }
    const top = (zone: string, key: 'incMaxM' | 'cumMaxM') =>
      perRoad
        .filter((r) => r.zone === zone && r[key] > MOVED_M)
        .sort((a, b) => b[key] - a[key])
        .slice(0, 10)
        .map((r) => ({ road: r.road, m: r[key], at: r.at, node: r.node }));
    return {
      pass,
      roadsMoved: new Set(perRoad.filter((r) => r.incMaxM > MOVED_M).map((r) => r.road)).size,
      osmNodesMoved: nodeMoves.length,
      osmNodeMoveMaxM: round(Math.max(0, ...nodeMoves)),
      sampledM: { near: Math.round(zones.near.total), away: Math.round(zones.away.total) },
      near: { pass: stats(zones.near.inc), cumulative: stats(zones.near.cum) },
      away: { pass: stats(zones.away.inc), cumulative: stats(zones.away.cum) },
      passNearClusterM: Math.round(nearCluster.incM),
      passNearOtherNodesM: Math.round(nearCluster.incOtherM),
      topNear: top('near', 'incMaxM'),
      topAway: top('away', 'incMaxM'),
      topNearCumulative: top('near', 'cumMaxM'),
      topAwayCumulative: top('away', 'cumMaxM'),
    };
  });
  // Every OSM node's final displacement.
  const finalNodeMoves = [...osm.nodes.values()].flatMap((n) => {
    if (!genuine.has(n.osmIds[0]!)) return [];
    const at = [...last.nodes.values()].find(
      (m) => !synthetic(m) && m.osmIds.includes(n.osmIds[0]!),
    );
    return at
      ? [
          {
            osm: n.osmIds[0]!,
            node: at.id,
            movedM: Math.hypot(at.pos.x - n.pos.x, at.pos.y - n.pos.y),
          },
        ]
      : [];
  });

  // ---- 3. Medians --------------------------------------------------------------------------
  const corridors = new Map<string, SRoad[]>();
  for (const road of last.roads.values())
    if (road.corridorId?.startsWith('corridor:'))
      corridors.set(road.corridorId, [...(corridors.get(road.corridorId) ?? []), road]);
  const osmPlain = refIndex(osm, false);
  const net = compile(finalCity);
  if (!net.ok) throw new Error('final city must compile');
  /** The median-side (leftmost) lane edge of a road as drawn (geometry-audit measure 2). */
  const medianEdge = (id: string) => {
    const road = net.compiled.roads[net.compiled.index.road.get(id)!]!;
    const lane = net.compiled.lanes[road.lanes[0]!]!;
    return parallelOffset(lane.polyline, -lane.widthM / 2);
  };
  const everywhere = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
  const medians = [...corridors.entries()].map(([id, members]) => {
    const samples: { gap: number; near: boolean; p: Vec2; road: string; s: number }[] = [];
    const drawnAway: number[] = [];
    for (const a of members) {
      const opposite = members.filter((b) => b !== a);
      const own = a.ways
        .flatMap((w) => osmPlain.get(w) ?? [])
        .filter((r) => r.road.streetGroupId === null);
      const partnerLines = opposite.map((b) => ({
        b,
        lines: b.ways
          .flatMap((w) => osmPlain.get(w) ?? [])
          .filter((r) => r.road.streetGroupId === null),
      }));
      const final = axis(a.line, a.offset);
      // a's OSM stretch: the stations of its final samples projected onto its own OSM lines.
      const ranges = new Map<Ref, { min: number; max: number }>();
      final.samples.forEach((p, i) => {
        const t = final.dirs[i]!;
        let best: { ref: Ref; along: number; away: number } | null = null;
        for (const ref of own) {
          const hit = nearestOnPolyline(ref.pts, p);
          if (hit.direction.x * t.x + hit.direction.y * t.y <= 0) continue;
          if (!best || hit.away < best.away) best = { ref, along: hit.along, away: hit.away };
        }
        if (!best || best.away > 40) return;
        const range = ranges.get(best.ref) ?? { min: Infinity, max: -Infinity };
        range.min = Math.min(range.min, best.along);
        range.max = Math.max(range.max, best.along);
        ranges.set(best.ref, range);
      });
      // The drawn gap: between the compiled median-side lane edges, away from nodes.
      const edge = medianEdge(a.id);
      const lengths = cumulativeLengths(edge);
      for (let s = 0.5; s < lengths.at(-1)!; s += 1) {
        const { p, n } = frame(edge, lengths, s);
        if (nearestJunction(p).d < ZONE_M) continue;
        let drawn: number | null = null;
        for (const b of opposite) {
          const line = medianEdge(b.id);
          if (
            nearestRef(p, { x: n.y, y: -n.x }, [{ road: b, pts: line, box: everywhere }], -1).d > 40
          )
            continue;
          for (const lambda of rayCrossings(p, n, line, 40))
            if (drawn === null || Math.abs(lambda) < Math.abs(drawn)) drawn = lambda;
        }
        if (drawn !== null) drawnAway.push(-drawn);
      }
      for (const [ref, { min, max }] of ranges) {
        const lengths = cumulativeLengths(ref.pts);
        const total = lengths.at(-1)!;
        for (let s = min; s <= max; s += 1) {
          const q = pointAtDistance(ref.pts, lengths, s);
          const ahead = pointAtDistance(ref.pts, lengths, Math.min(total, s + 0.5));
          const behind = pointAtDistance(ref.pts, lengths, Math.max(0, s - 0.5));
          const l = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1;
          const dir = { x: (ahead.x - behind.x) / l, y: (ahead.y - behind.y) / l };
          const n = { x: -dir.y, y: dir.x };
          let best: number | null = null;
          let half = 0;
          for (const { b, lines } of partnerLines) {
            // Only a partner running against a here (not a's own continuation, a third way).
            const closest = nearestRef(q, dir, lines, -1);
            if (closest.d > 40) continue;
            for (const line of lines)
              for (const lambda of rayCrossings(q, n, line.pts, 40))
                if (best === null || Math.abs(lambda) < Math.abs(best)) {
                  best = lambda;
                  half = b.half;
                }
            // A coincident partner (the same OSM nodes) lies on the ray, which never crosses it.
            if (best === null && closest.d < 1) {
              best = (closest.q.x - q.x) * n.x + (closest.q.y - q.y) * n.y;
              half = b.half;
            }
          }
          if (best === null) continue;
          // Right-hand traffic: the opposite carriageway lies to the left (negative normal side).
          samples.push({
            gap: -best - a.half - half,
            near: nearestJunction(q).d < ZONE_M,
            p: q,
            road: a.id,
            s,
          });
        }
      }
    }
    const away = samples.filter((s) => !s.near);
    const gaps = away.map((s) => s.gap);
    // Stretches (consecutive samples of one road) under 0.5 m, away from nodes and near them.
    const stretches: {
      road: string;
      fromM: number;
      toM: number;
      minGapM: number;
      at: Vec2;
      nearNode: boolean;
    }[] = [];
    let open: (typeof stretches)[number] | null = null;
    for (const s of samples) {
      if (s.gap < 0.5) {
        if (open && open.road === s.road && s.s - open.toM <= 1.5 && open.nearNode === s.near) {
          open.toM = round(s.s, 1);
          if (s.gap < open.minGapM)
            Object.assign(open, {
              minGapM: round(s.gap),
              at: { x: round(s.p.x, 1), y: round(s.p.y, 1) },
            });
        } else {
          open = {
            road: s.road,
            fromM: round(s.s, 1),
            toM: round(s.s, 1),
            minGapM: round(s.gap),
            at: { x: round(s.p.x, 1), y: round(s.p.y, 1) },
            nearNode: s.near,
          };
          stretches.push(open);
        }
      } else open = null;
    }
    return {
      corridor: id,
      roads: members.map((r) => r.id),
      name: members[0]!.name,
      sampledM: samples.length,
      awayM: away.length,
      gapMinM: round(Math.min(...gaps, Infinity)),
      gapP10M: round(quantile(gaps, 0.1)),
      gapMedianM: round(quantile(gaps, 0.5)),
      gapMaxM: round(Math.max(...gaps, -Infinity)),
      gapMinAllM: round(Math.min(...samples.map((s) => s.gap), Infinity)),
      negativeAwayM: away.filter((s) => s.gap < 0).length,
      under05AwayM: away.filter((s) => s.gap < 0.5).length,
      negativeNearM: samples.filter((s) => s.near && s.gap < 0).length,
      under05NearM: samples.filter((s) => s.near && s.gap < 0.5).length,
      movedBy: Object.fromEntries(
        PASSES.flatMap((pass) => {
          const m = Math.max(0, ...members.map((r) => roadMoves.get(pass)?.get(r.id) ?? 0));
          return m > 0 ? [[pass, m]] : [];
        }),
      ),
      drawnGapMedianM: round(quantile(drawnAway, 0.5)),
      drawnGapMinM: round(Math.min(...drawnAway, Infinity)),
      stretches: stretches.filter((s) => s.toM - s.fromM >= 1 || s.minGapM < 0),
    };
  });

  const key = (g: string[]) => [...g].sort().join(',');
  const todayKeys = new Set(today.groups.map(key));
  const clusterKeys = new Set(clusters.map((c) => key(c.members.map((m) => m.node))));
  const unmatched = [...clusterKeys].filter((k) => !todayKeys.has(k));
  const groupsAt = Object.fromEntries(
    [20, 30, 40].map((T) => {
      const { groups } = runGroups(T);
      const list = groups.map((g) => {
        const set = new Set(g);
        const inner = [...preSnap.roads.values()].filter((r) => set.has(r.from) && set.has(r.to));
        const arms = armsOf(preSnap, set, new Set(inner.map((r) => r.id)));
        const pts = g.map((id) => preSnap.nodes.get(id)!.pos);
        return {
          nodes: g,
          osmIds: g.flatMap((id) => preSnap.nodes.get(id)!.osmIds),
          cls: classify(
            preSnap,
            arms,
            inner.map((r) => r.id),
          ),
          innerLinks: [
            ...new Map(
              inner.map((r) => [[r.from, r.to].sort().join('-'), round(polylineLength(r.line))]),
            ).entries(),
          ].map(([link, lengthM]) => ({ link, lengthM })),
          centre: {
            x: round(pts.reduce((s, p) => s + p.x, 0) / pts.length),
            y: round(pts.reduce((s, p) => s + p.y, 0) / pts.length),
          },
          finalNode: finalNodes({
            x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
            y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
          }).id,
          mergedToday: clusterKeys.has(key(g)),
        };
      });
      const byClass: Record<string, number> = {};
      for (const g of list) byClass[g.cls] = (byClass[g.cls] ?? 0) + 1;
      return [
        T,
        {
          count: list.length,
          mergedToday: list.filter((g) => g.mergedToday).length,
          byClass,
          groups: list,
        },
      ];
    }),
  ) as Record<
    number,
    {
      count: number;
      mergedToday: number;
      byClass: Record<string, number>;
      groups: { nodes: string[]; cls: string; mergedToday: boolean }[];
    }
  >;
  const at30 = groupsAt[30]!.groups;
  const groupOf = new Map(at30.flatMap((g, i) => g.nodes.map((n) => [n, i])));
  const links = new Map<string, { from: string; to: string; lengthM: number; roads: string[] }>();
  for (const c of today.candidates) {
    const k = [c.from, c.to].sort().join('-');
    const entry = links.get(k) ?? { from: c.from, to: c.to, lengthM: c.lengthM, roads: [] };
    entry.roads.push(c.road);
    entry.lengthM = Math.min(entry.lengthM, c.lengthM);
    links.set(k, entry);
  }
  const borderline = [...links.values()]
    .filter((l) => l.lengthM >= 20 && l.lengthM <= 40)
    .sort((a, b) => a.lengthM - b.lengthM)
    .map((l) => {
      const road = preSnap.roads.get(l.roads[0]!)!;
      const a = groupOf.get(l.from),
        b = groupOf.get(l.to);
      const union = [
        ...(a === undefined ? [l.from] : at30[a]!.nodes),
        ...(b === undefined ? [l.to] : at30[b]!.nodes),
      ];
      const span = Math.max(
        ...union.flatMap((x) =>
          union.map((y) => {
            const p = preSnap.nodes.get(x)!.pos,
              q = preSnap.nodes.get(y)!.pos;
            return Math.hypot(p.x - q.x, p.y - q.y);
          }),
        ),
      );
      return {
        link: `${l.from}-${l.to}`,
        roads: l.roads,
        name: road.name,
        roadClass: road.roadClass,
        lengthM: round(l.lengthM),
        groupedAt30: a !== undefined && a === b,
        // Why a link up to 30 m stays between two groups: their union would span over 60 m, or
        // it holds a road of 30 m or more, or an access change (consolidateJunctions' rules).
        blockedAt30:
          l.lengthM > 30 || (a !== undefined && a === b)
            ? null
            : span > 60
              ? `span ${round(span)} m`
              : 'long inner road or access',
        osm: [preSnap.nodes.get(l.from)!.osmIds, preSnap.nodes.get(l.to)!.osmIds],
        nearFinal: [
          finalNodes(preSnap.nodes.get(l.from)!.pos).id,
          finalNodes(preSnap.nodes.get(l.to)!.pos).id,
        ],
      };
    });
  return {
    name,
    importMs: Math.round(importMs),
    laterMoves,
    validation: {
      clusters: clusters.length,
      todayGroups: today.groups.length,
      clustersNotReproduced: unmatched,
    },
    clusters,
    mergedShort: {
      beforeConsolidation: mergedShort,
      insideConsolidation: mergedShortInConsolidation,
    },
    medianNodes,
    medianCrossings,
    displacement,
    finalNodeMoves: {
      count: finalNodeMoves.length,
      moved001: finalNodeMoves.filter((m) => m.movedM > 0.01).length,
      moved1: finalNodeMoves.filter((m) => m.movedM > 1).length,
      max: round(Math.max(...finalNodeMoves.map((m) => m.movedM))),
    },
    medians,
    groups: {
      byThreshold: Object.fromEntries(
        Object.entries(groupsAt).map(([T, g]) => [
          T,
          { count: g.count, mergedToday: g.mergedToday, byClass: g.byClass },
        ]),
      ),
      at30: groupsAt[30]!.groups,
      at20: groupsAt[20]!.groups,
      at40: groupsAt[40]!.groups,
      borderline,
    },
  };
}

// ---------------------------------------------------------------------------------------------

const out = process.argv[2];
if (!out) throw new Error('Usage: task131-audit.ts <out-dir>');
mkdirSync(out, { recursive: true });
const cities = [
  auditCity('munich', 'fixtures/osm/munich-donnersberger.osm', [11.525, 48.135, 11.545, 48.148]),
  auditCity('sindelfingen', 'fixtures/osm/sindelfingen-a81.osm', [8.98, 48.69, 9.0, 48.702]),
];
for (const city of cities) {
  const { clusters, displacement, medians, groups, ...rest } = city;
  writeFileSync(join(out, `${city.name}-clusters.json`), JSON.stringify(clusters, null, 1));
  writeFileSync(join(out, `${city.name}-passes.json`), JSON.stringify(displacement, null, 1));
  writeFileSync(join(out, `${city.name}-medians.json`), JSON.stringify(medians, null, 1));
  writeFileSync(join(out, `${city.name}-groups.json`), JSON.stringify(groups, null, 1));
  writeFileSync(join(out, `${city.name}-summary.json`), JSON.stringify(rest, null, 1));
}
const csv = (rows: (string | number | boolean | null)[][]) =>
  rows
    .map((r) =>
      r
        .map((v) =>
          typeof v === 'string' && /[,"\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : String(v),
        )
        .join(','),
    )
    .join('\n') + '\n';
writeFileSync(
  join(out, 'clusters.csv'),
  csv([
    [
      'city',
      'node',
      'class',
      'control',
      'osm_nodes',
      'spread_m',
      'max_move_m',
      'inner_roads',
      'min_arm_angle_before',
      'min_arm_angle_final',
      'max_arm_turn_deg',
      'streets',
    ],
    ...cities.flatMap((c) =>
      c.clusters.map((k) => [
        c.name,
        k.node,
        k.cls,
        k.control,
        k.members
          .map((m) => `${m.kind === 'osm' ? '' : `${m.kind}:`}${m.osmIds.join('/')}@${m.movedM}`)
          .join(' '),
        k.spreadM,
        k.maxMoveM,
        k.innerRoads.map((r) => `${r.road}:${r.lengthM}`).join(' '),
        k.minArmAngleBefore,
        k.minArmAngleFinal,
        k.maxArmTurnDeg,
        k.streets.join(' | '),
      ]),
    ),
  ]),
);
writeFileSync(
  join(out, 'passes.csv'),
  csv([
    [
      'city',
      'pass',
      'zone',
      'roads_moved',
      'moved_m',
      'median_m',
      'p90_m',
      'max_m',
      'cum_moved_m',
      'cum_median_m',
      'cum_p90_m',
      'cum_max_m',
      'osm_nodes_moved',
      'osm_node_move_max_m',
    ],
    ...cities.flatMap((c) =>
      c.displacement.flatMap((d) =>
        (['near', 'away'] as const).map((zone) => [
          c.name,
          d.pass,
          zone,
          d.roadsMoved,
          d[zone].pass.movedM,
          d[zone].pass.medianM,
          d[zone].pass.p90M,
          d[zone].pass.maxM,
          d[zone].cumulative.movedM,
          d[zone].cumulative.medianM,
          d[zone].cumulative.p90M,
          d[zone].cumulative.maxM,
          d.osmNodesMoved,
          d.osmNodeMoveMaxM,
        ]),
      ),
    ),
  ]),
);
writeFileSync(
  join(out, 'medians.csv'),
  csv([
    [
      'city',
      'corridor',
      'name',
      'roads',
      'away_m',
      'gap_min',
      'gap_p10',
      'gap_median',
      'gap_max',
      'negative_away_m',
      'under05_away_m',
      'negative_near_m',
      'under05_near_m',
      'drawn_gap_median',
      'drawn_gap_min',
    ],
    ...cities.flatMap((c) =>
      c.medians.map((m) => [
        c.name,
        m.corridor,
        m.name,
        m.roads.join(' '),
        m.awayM,
        m.gapMinM,
        m.gapP10M,
        m.gapMedianM,
        m.gapMaxM,
        m.negativeAwayM,
        m.under05AwayM,
        m.negativeNearM,
        m.under05NearM,
        m.drawnGapMedianM,
        m.drawnGapMinM,
      ]),
    ),
  ]),
);
writeFileSync(
  join(out, 'borderline-links.csv'),
  csv([
    [
      'city',
      'link',
      'roads',
      'name',
      'class',
      'length_m',
      'grouped_at_30',
      'blocked_at_30',
      'osm_nodes',
      'near_final_nodes',
    ],
    ...cities.flatMap((c) =>
      c.groups.borderline.map((b) => [
        c.name,
        b.link,
        b.roads.join(' '),
        b.name,
        b.roadClass,
        b.lengthM,
        b.groupedAt30,
        b.blockedAt30,
        b.osm.map((o) => o.join('/')).join(' '),
        b.nearFinal.join(' '),
      ]),
    ),
  ]),
);
for (const c of cities)
  console.info(
    c.name,
    JSON.stringify({
      importMs: c.importMs,
      laterMoves: c.laterMoves,
      validation: c.validation,
      groups: c.groups.byThreshold,
    }),
  );
