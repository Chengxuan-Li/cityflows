import type { Graphics } from 'pixi.js';
import { headingAtDistance, offsetPolyline, pointAtDistance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CLane, CMovement, CompiledCity, CRoad } from '../../network';
import { roadStyle, style } from '../style';

function fadeAtZoom(graphics: Graphics, from: number, to: number) {
  graphics.onRender ??= () => {
    const zoom = graphics.parent!.worldTransform.a;
    graphics.alpha = Math.max(0, Math.min(1, (zoom - from) / (to - from)));
  };
}

export function drawRoad(
  surface: Graphics,
  markings: Graphics,
  city: CompiledCity,
  road: CRoad,
): void {
  const { color, vergeM } = roadStyle(road);
  surface
    .poly(road.surface)
    .fill(color)
    .stroke({ color, width: vergeM * 2, join: 'round' });
  fadeAtZoom(markings, 0.7, 2.2);
  const medianOnRight = city.drivingSide === 'left';
  for (const index of road.lanes) {
    const lane = city.lanes[index]!;
    if (lane.right >= 0) drawDashes(markings, offsetPolyline(lane.polyline, lane.widthM / 2));
    if (road.streetGroupId !== null && (medianOnRight ? lane.right : lane.left) < 0) {
      const offset = ((medianOnRight ? 1 : -1) * lane.widthM) / 2;
      markings
        .poly(offsetPolyline(lane.polyline, offset), false)
        .stroke({ color: style.marking, width: style.dividerWidthM, alpha: 0.85 });
    }
    drawApproachMarkings(markings, city, lane);
  }
}

export function approachMarkings(city: CompiledCity, lane: CLane) {
  const road = city.roads[lane.road]!;
  const node = city.nodes[road.to]!;
  const legal = lane.out.map((index) => city.movements[index]!).filter((m) => !m.neverGreen);
  const turns = new Set(legal.map((movement) => movement.turn));
  const minor = legal.some((movement) => movement.priority < 10);
  const controlled = legal.length > 0;
  const specific =
    turns.has('left') ||
    turns.has('right') ||
    turns.has('uturn') ||
    road.lanes.some((index) =>
      city.lanes[index]!.out.some((movement) => {
        const m = city.movements[movement]!;
        return !m.neverGreen && !turns.has(m.turn);
      }),
    );
  return {
    stop: controlled && (node.signal !== null || (node.control === 'stop' && minor)),
    yield: controlled && node.control === 'yield' && minor,
    crossingEnd: controlled && node.signal !== null,
    crossingStart:
      city.nodes[road.from]!.signal !== null &&
      lane.in.some((index) => !city.movements[index]!.neverGreen),
    turns:
      specific && !(turns.has('left') && turns.has('through') && turns.has('right'))
        ? [...turns]
        : [],
  };
}

function drawApproachMarkings(graphics: Graphics, city: CompiledCity, lane: CLane): void {
  const marks = approachMarkings(city, lane);
  const local = (distance: number, forward: number, side: number) => {
    const point = pointAtDistance(lane.polyline, lane.cumulative, distance);
    const heading = headingAtDistance(lane.polyline, lane.cumulative, distance);
    return {
      x: point.x + Math.cos(heading) * forward - Math.sin(heading) * side,
      y: point.y + Math.sin(heading) * forward + Math.cos(heading) * side,
    };
  };
  const half = lane.widthM * 0.44;
  if (marks.stop) {
    graphics
      .poly([local(lane.lengthM, -0.35, -half), local(lane.lengthM, -0.35, half)], false)
      .stroke({ color: style.marking, width: 0.28 });
  }
  if (marks.yield) {
    for (let side = -half + 0.4; side <= half - 0.2; side += 0.85) {
      graphics
        .poly([
          local(lane.lengthM, -0.35, side),
          local(lane.lengthM, -1.35, side - 0.3),
          local(lane.lengthM, -1.35, side + 0.3),
        ])
        .fill(style.marking);
    }
  }
  // Compress markings on short links so both approaches still fit inside the lane.
  const crossingInset = Math.min(3, lane.lengthM / 4);
  const crossingHalf = Math.min(1.2, lane.lengthM / 8);
  for (const [enabled, distance] of [
    [marks.crossingStart, crossingInset],
    [marks.crossingEnd, lane.lengthM - crossingInset],
  ] as const) {
    if (!enabled) continue;
    for (let side = -half + 0.3; side < half; side += 0.9) {
      graphics
        .poly([local(distance, -crossingHalf, side), local(distance, crossingHalf, side)], false)
        .stroke({ color: style.marking, width: 0.45 });
    }
  }
  const scale = Math.min(1, lane.lengthM / 18);
  const distance = lane.lengthM - Math.min(9, lane.lengthM / 2);
  const arrowPoint = (forward: number, side: number) =>
    local(distance, forward * scale, side * scale);
  for (const turn of marks.turns) {
    if (turn === 'merge' || turn === 'diverge') continue;
    const side =
      turn === 'left' ? -1 : turn === 'right' ? 1 : city.drivingSide === 'right' ? -1 : 1;
    const points: [number, number][] =
      turn === 'through'
        ? [
            [-2, 0],
            [2, 0],
          ]
        : turn === 'uturn'
          ? [
              [-2, 0],
              [1, 0],
              [1.4, side * 0.6],
              [1, side * 1.2],
              [-0.5, side * 1.2],
            ]
          : [
              [-2, 0],
              [0.5, 0],
              [0.5, side * 1.2],
            ];
    graphics
      .poly(
        points.map(([f, s]) => arrowPoint(f, s)),
        false,
      )
      .stroke({ color: style.marking, width: 0.22 * scale, join: 'round' });
    const tip = points.at(-1)!;
    const previous = points.at(-2)!;
    const heading = Math.atan2(tip[1] - previous[1], tip[0] - previous[0]);
    const back = 0.65;
    graphics
      .poly([
        arrowPoint(...tip),
        arrowPoint(
          tip[0] - Math.cos(heading) * back - Math.sin(heading) * 0.4,
          tip[1] - Math.sin(heading) * back + Math.cos(heading) * 0.4,
        ),
        arrowPoint(
          tip[0] - Math.cos(heading) * back + Math.sin(heading) * 0.4,
          tip[1] - Math.sin(heading) * back - Math.cos(heading) * 0.4,
        ),
      ])
      .fill(style.marking);
  }
}

function drawDashes(graphics: Graphics, line: Vec2[]): void {
  const dashM = 2.7;
  const gapM = 3.1;
  const period = dashM + gapM;
  let offset = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    for (let start = -offset; start < length; start += period) {
      const from = Math.max(0, start);
      const to = Math.min(length, start + dashM);
      if (to <= from) continue;
      graphics
        .moveTo(a.x + (dx * from) / length, a.y + (dy * from) / length)
        .lineTo(a.x + (dx * to) / length, a.y + (dy * to) / length);
    }
    offset = (offset + length) % period;
  }
  graphics.stroke({ color: style.marking, width: style.dividerWidthM, alpha: 0.78 });
}

export function drawMovementArrow(graphics: Graphics, movement: CMovement): void {
  fadeAtZoom(graphics, 2.2, 4.2);
  const { polyline, cumulative, lengthM } = movement;
  const start = lengthM * 0.13;
  const end = lengthM * 0.84;
  const tip = pointAtDistance(polyline, cumulative, end);
  const heading = headingAtDistance(polyline, cumulative, end);
  const root = pointAtDistance(polyline, cumulative, start);
  graphics.moveTo(root.x, root.y);
  for (let i = 1; i < polyline.length - 1; i++) {
    if (cumulative[i]! > start && cumulative[i]! < end)
      graphics.lineTo(polyline[i]!.x, polyline[i]!.y);
  }
  graphics.lineTo(tip.x, tip.y).stroke({ color: style.marking, width: 0.17, alpha: 0.56 });
  const size = Math.min(1.05, lengthM / 6);
  const dx = Math.cos(heading) * size;
  const dy = Math.sin(heading) * size;
  graphics
    .poly([
      tip.x,
      tip.y,
      tip.x - dx - dy * 0.55,
      tip.y - dy + dx * 0.55,
      tip.x - dx + dy * 0.55,
      tip.y - dy - dx * 0.55,
    ])
    .fill({ color: style.marking, alpha: 0.9 });
}
