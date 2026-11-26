import { nearestOnPolyline, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { gradeHeightM, laneHeightAt } from '../network/heights';
import type { DebugOverlay } from './debug-settings';
import {
  arrow,
  dot,
  elevated,
  ink,
  label,
  line,
  type DebugPoint,
  type DebugPrimitive,
} from './debug-geometry-primitives';
import { signalLight, movementLight } from './layers/signals';
import type { Pick, VehicleSnapshot } from './types';

function section(points: Vec2[], lengths: Float64Array, from: number, to: number) {
  return [
    pointAtDistance(points, lengths, from),
    ...points.filter((_, i) => lengths[i]! > from && lengths[i]! < to),
    pointAtDistance(points, lengths, to),
  ];
}

function signals(city: CompiledCity, snapshot: VehicleSnapshot | null, selection: Pick | null) {
  const out: DebugPrimitive[] = [];
  for (const n of city.nodes) {
    if (!n.signal) continue;
    const light = signalLight(n.signal, n.idx, snapshot?.timeS ?? 0, snapshot?.signals);
    const z = n.grade * gradeHeightM;
    const approach = new Set<number>();
    for (const idx of n.movements) {
      const m = city.movements[idx]!,
        lane = city.lanes[m.fromLane]!;
      const color =
        ink[
          ({ green: 'green', amber: 'amber', red: 'red' } as const)[
            movementLight(n.signal, light, idx)
          ]
        ];
      out.push(
        line(z ? m.polyline.map((p) => elevated(p, z)) : m.polyline, color, m.id, {
          kind: 'node',
          node: n.idx,
        }),
      );
      if (!approach.has(lane.road)) {
        approach.add(lane.road);
        const p = pointAtDistance(lane.polyline, lane.cumulative, lane.stopM);
        out.push(label(elevated(p, z), 'P' + (light.phase + 1) + ' ' + light.state, ink.dark));
      }
    }
    if (selection?.kind !== 'node' || selection.node !== n.idx || !n.movements.length) continue;
    // Each row names its movement. Columns use the same order as the rows.
    const rows = n.movements.map((idx, i) => {
      const m = city.movements[idx]!;
      const conflicts = new Set(m.conflicts);
      const cells = n.movements
        .map((other) => (other === idx ? '–' : conflicts.has(other) ? '×' : '·'))
        .join(' ');
      return i + 1 + '  ' + cells + '   ' + m.id;
    });
    const at = { x: n.pos.x + n.radiusM + 7, y: n.pos.y - n.radiusM - 5 };
    out.push(
      label(
        elevated(at, z),
        ['Conflicts · columns 1–' + rows.length, ...rows].join('\n'),
        ink.dark,
      ),
    );
  }
  return out;
}

function carPositions(city: CompiledCity, snapshot: VehicleSnapshot) {
  const points = new Map<number, DebugPoint>();
  for (let i = 0; i < snapshot.count; i++) {
    const at = { x: snapshot.x[i]!, y: snapshot.y[i]! };
    const lane = (snapshot.poseLane?.[i] ?? -1) >= 0 ? snapshot.poseLane![i]! : snapshot.lane[i]!;
    const m = lane < 0 ? city.movements[-lane - 1] : undefined;
    const z =
      lane >= 0
        ? laneHeightAt(city, city.lanes[lane]!, at)
        : m
          ? city.nodes[m.node]!.grade * gradeHeightM
          : 0;
    points.set(snapshot.id[i]!, elevated(at, z));
  }
  return points;
}

function vehicles(city: CompiledCity, snapshot: VehicleSnapshot, selection: Pick | null) {
  const out: DebugPrimitive[] = [];
  const points = carPositions(city, snapshot);
  const details = new Map(snapshot.debug?.vehicles?.map((v) => [v.id, v]));
  // Shared parts of routes need only one stroke even at a congested junction.
  const seenLanes = new Set<number>(),
    seenMoves = new Set<number>();
  for (let i = 0; i < snapshot.count; i++) {
    const id = snapshot.id[i]!,
      at = points.get(id)!;
    const detail = details.get(id),
      pick: Pick = { kind: 'vehicle', id };
    const color =
      snapshot.state[i] === 2 ? ink.red : snapshot.speed[i]! < 0.1 ? ink.amber : ink.green;
    out.push(dot(at, color, String(id), pick), label(at, String(id), color));
    if (!detail) continue;
    const current = snapshot.lane[i]!;
    const selected = selection?.kind === 'vehicle' && selection.id === id;
    if (selection?.kind !== 'vehicle' || selected) {
      for (const [j, idx] of detail.routeLanes.entries()) {
        const lane = city.lanes[idx]!;
        const partial = j === 0 && idx === current;
        if (!partial && seenLanes.has(idx)) continue;
        if (!partial) seenLanes.add(idx);
        const path = partial
          ? section(lane.polyline, lane.cumulative, detail.positionM, lane.lengthM)
          : lane.polyline;
        const grades = city.roads[lane.road]!,
          flat = !grades.grade && !city.nodes[grades.from]!.grade && !city.nodes[grades.to]!.grade;
        out.push(
          line(flat ? path : path.map((p) => elevated(p, laneHeightAt(city, lane, p))), ink.blue),
        );
      }
      for (const [j, idx] of detail.routeMovements.entries()) {
        const m = city.movements[idx]!,
          partial = j === 0 && current === -idx - 1;
        if (!partial && seenMoves.has(idx)) continue;
        if (!partial) seenMoves.add(idx);
        const path = partial
          ? section(m.polyline, m.cumulative, detail.positionM, m.lengthM)
          : m.polyline;
        const z = city.nodes[m.node]!.grade * gradeHeightM;
        out.push(line(z ? path.map((p) => elevated(p, z)) : path, ink.blue));
      }
    }
    if (detail.leaderId !== null) {
      const leader = points.get(detail.leaderId);
      if (leader) {
        out.push(line([at, leader], ink.amber));
        if (detail.gapM !== null)
          out.push(
            label(
              elevated(
                { x: (at.x + leader.x) / 2, y: (at.y + leader.y) / 2 },
                ((at.z ?? 0) + (leader.z ?? 0)) / 2,
              ),
              detail.gapM.toFixed(1) + ' m',
              ink.amber,
            ),
          );
      }
    }
    if (detail.intentLane !== null) {
      const target = city.lanes[detail.intentLane]!;
      const station = nearestOnPolyline(target.polyline, at).along;
      const next = pointAtDistance(
        target.polyline,
        target.cumulative,
        Math.min(target.lengthM, station + 5),
      );
      const path = [at, elevated(next, laneHeightAt(city, target, next))];
      out.push(line(path, ink.pink), arrow(path, ink.pink, 2, 0.92));
    }
  }
  return out;
}

function waitLinks(
  points: Map<number, DebugPoint>,
  waits: { from: number; to: number; cycle: boolean; stuck?: boolean }[],
  stuckOnly: boolean,
) {
  const out: DebugPrimitive[] = [];
  for (const wait of waits) {
    if (stuckOnly && !wait.stuck && !wait.cycle) continue;
    const a = points.get(wait.from),
      b = points.get(wait.to);
    if (!a || !b) continue;
    const color = wait.cycle ? ink.red : ink.amber;
    const path = [a, b];
    out.push(line(path, color), arrow(path, color, 4, 0.72), dot(a, color), dot(b, color));
  }
  return out;
}

function aircraft(city: CompiledCity, snapshot: VehicleSnapshot, gridlock: boolean) {
  const out: DebugPrimitive[] = [];
  const points = new Map(snapshot.aircraft?.map((a) => [a.id, elevated(a, a.heightM)]));
  if (!gridlock) {
    for (const craft of snapshot.debug?.aircraft ?? []) {
      const p = points.get(craft.id);
      if (!p) continue;
      const pick: Pick = { kind: 'aircraft', id: craft.id };
      const circle = Array.from({ length: 49 }, (_, i) =>
        elevated(
          {
            x: p.x + craft.radiusM * Math.cos((i * Math.PI) / 24),
            y: p.y + craft.radiusM * Math.sin((i * Math.PI) / 24),
          },
          p.z ?? 0,
        ),
      );
      out.push(
        line(circle, ink.cyan, String(craft.id), pick),
        dot(p, ink.blue, String(craft.id), pick),
      );
      for (const r of craft.reservations) {
        const edge = city.airside!.edges[r.edge]!;
        out.push(
          line(
            section(edge.line, edge.cumulative, Math.min(r.fromM, r.toM), Math.max(r.fromM, r.toM)),
            ink.pink,
            edge.id,
            { kind: 'taxiway', edge: edge.idx },
          ),
        );
      }
    }
  }
  out.push(...waitLinks(points, snapshot.debug?.aircraftWaits ?? [], gridlock));
  return out;
}

export function dynamicDebugGeometry(
  overlay: DebugOverlay,
  city: CompiledCity,
  snapshot: VehicleSnapshot | null,
  selection: Pick | null,
): DebugPrimitive[] {
  if (overlay === 'signals') return signals(city, snapshot, selection);
  if (!snapshot) return [];
  if (overlay === 'vehicles') return vehicles(city, snapshot, selection);
  if (overlay === 'aircraft') return aircraft(city, snapshot, false);
  if (overlay === 'gridlock')
    return [
      ...aircraft(city, snapshot, true),
      ...waitLinks(carPositions(city, snapshot), snapshot.debug?.vehicleWaits ?? [], false),
    ];
  return [];
}
