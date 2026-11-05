import type { Graphics } from 'pixi.js';
import {
  headingAtDistance,
  offsetPolyline,
  pointAtDistance,
  pointInPolygon,
} from '../../geo/polyline';
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
  roadClasses = false,
  controls: Graphics = markings,
): void {
  const { color, vergeM } = roadStyle(road, roadClasses);
  surface
    .poly(road.surface)
    .fill(color)
    .stroke({ color, width: vergeM * 2, join: 'round' });
  fadeAtZoom(markings, 0.7, 2.2);
  const medianOnRight = city.drivingSide === 'left';
  for (const index of road.lanes) {
    const lane = city.lanes[index]!;
    if (
      lane.right >= 0 &&
      !road.lanes.some((i) => city.lanes[i]!.taperStartM || city.lanes[i]!.taperEndM)
    )
      drawDashes(markings, offsetPolyline(lane.polyline, lane.widthM / 2));
    if (road.streetGroupId !== null && (medianOnRight ? lane.right : lane.left) < 0) {
      const offset = ((medianOnRight ? 1 : -1) * lane.widthM) / 2;
      markings
        .poly(offsetPolyline(lane.polyline, offset), false)
        .stroke({ color: style.marking, width: style.dividerWidthM, alpha: 0.85 });
    }
    drawApproachMarkings(markings, city, lane, controls);
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

function drawApproachMarkings(
  graphics: Graphics,
  city: CompiledCity,
  lane: CLane,
  controls: Graphics,
): void {
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
    controls
      .poly([local(lane.stopM, 0, -half), local(lane.stopM, 0, half)], false)
      .stroke({ color: style.marking, width: 0.28 });
  }
  if (marks.yield) {
    for (let side = -half + 0.4; side <= half - 0.2; side += 0.85) {
      controls
        .poly([
          local(lane.stopM, 0, side),
          local(lane.stopM, -1, side - 0.3),
          local(lane.stopM, -1, side + 0.3),
        ])
        .fill(style.marking);
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

/** Zebra stripes follow the road surface between the stop line and junction. */
export function crossingStripes(city: CompiledCity, road: CRoad, atEnd: boolean): Vec2[][] {
  const node = city.nodes[atEnd ? road.to : road.from]!;
  if (!node.signal || !node.outline.length) return [];
  const lanes = road.lanes.map((index) => city.lanes[index]!);
  const served = lanes.some((lane) => {
    const marks = approachMarkings(city, lane);
    return atEnd ? marks.crossingEnd : marks.crossingStart;
  });
  if (!served) return [];
  const width = lanes.reduce((sum, lane) => sum + lane.widthM, 0);
  const local = (along: number, side: number): Vec2 => {
    let edge = 0;
    const lane = lanes.find((lane) => {
      if (side <= edge + lane.widthM) return true;
      edge += lane.widthM;
      return false;
    })!;
    const distance = atEnd ? lane.stopM + along : along;
    const point = pointAtDistance(lane.polyline, lane.cumulative, distance);
    const heading = headingAtDistance(lane.polyline, lane.cumulative, distance);
    const offset = side - edge - lane.widthM / 2;
    return { x: point.x - Math.sin(heading) * offset, y: point.y + Math.cos(heading) * offset };
  };
  const stripes: Vec2[][] = [];
  for (let side = 0.225; side + 0.45 <= width; side += 0.9) {
    let edge = 0;
    const short = lanes.some((lane) => {
      const overlaps = side < edge + lane.widthM && side + 0.45 > edge;
      edge += lane.widthM;
      return overlaps && lane.lengthM < 10;
    });
    if (short) continue;
    const stripe = [
      local(0.25, side),
      local(2.75, side),
      local(2.75, side + 0.45),
      local(0.25, side + 0.45),
    ];
    if (
      stripe.every(
        (p) =>
          pointInPolygon(p, [...road.surface, road.surface[0]!]) &&
          !pointInPolygon(p, node.outline),
      )
    )
      stripes.push(stripe);
  }
  return stripes;
}

export function drawCrossings(graphics: Graphics, city: CompiledCity, road: CRoad): void {
  fadeAtZoom(graphics, 0.7, 2.2);
  for (const atEnd of [false, true])
    for (const stripe of crossingStripes(city, road, atEnd))
      graphics.poly(stripe).fill(style.marking);
}
