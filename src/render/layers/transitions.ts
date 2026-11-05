import type { Graphics } from 'pixi.js';
import {
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  trimPolyline,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { laneEdges } from '../../network/lanes';
import type { CompiledCity, CRoad } from '../../network';
import { roadStyle, style } from '../style';

export function transitionGeometry(city: CompiledCity, road: CRoad) {
  const roadLanes = road.lanes.map((i) => city.lanes[i]!);
  const lanes = roadLanes.map((lane) => {
    const edges = laneEdges(lane, roadLanes);
    const chevrons: Vec2[][] = [];
    if (lane.taperEndM) {
      const neighbor = roadLanes
        .filter((l) => !l.taperEndM)
        .reduce((a, b) => (Math.abs(a.lane - lane.lane) <= Math.abs(b.lane - lane.lane) ? a : b));
      const side = Math.sign(neighbor.lane - lane.lane);
      for (const fraction of [0.25, 0.55]) {
        const s = lane.lengthM - lane.taperEndM * (1 - fraction);
        const h = headingAtDistance(lane.polyline, lane.cumulative, s);
        const left = pointAtDistance(
          edges.left,
          cumulativeLengths(edges.left),
          (s / lane.lengthM) * cumulativeLengths(edges.left).at(-1)!,
        );
        const right = pointAtDistance(
          edges.right,
          cumulativeLengths(edges.right),
          (s / lane.lengthM) * cumulativeLengths(edges.right).at(-1)!,
        );
        const center = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
        const width = Math.hypot(right.x - left.x, right.y - left.y);
        chevrons.push(
          [
            [-1, -side * width * 0.2],
            [1, side * width * 0.25],
            [0, -side * width * 0.2],
          ].map(([along, lateral]) => ({
            x: center.x + Math.cos(h) * along! - Math.sin(h) * lateral!,
            y: center.y + Math.sin(h) * along! + Math.cos(h) * lateral!,
          })),
        );
      }
    }
    return { lane: lane.idx, ...edges, chevrons };
  });
  return { lanes, dividers: lanes.slice(0, -1).map((l) => l.right) };
}

export function drawTransitions(
  surface: Graphics,
  markings: Graphics,
  city: CompiledCity,
  road: CRoad,
  roadClasses = false,
): void {
  if (!road.lanes.some((i) => city.lanes[i]!.taperStartM || city.lanes[i]!.taperEndM)) return;
  const geometry = transitionGeometry(city, road);
  const { color } = roadStyle(road, roadClasses);
  for (const lane of geometry.lanes) {
    surface.poly([...lane.left, ...[...lane.right].reverse()]).fill(color);
    for (const chevron of lane.chevrons)
      markings.poly(chevron, false).stroke({ color: style.marking, width: 0.22, join: 'round' });
  }
  for (const divider of geometry.dividers) {
    const total = cumulativeLengths(divider).at(-1)!;
    for (let s = 0; s < total; s += 5.8)
      markings
        .poly(trimPolyline(divider, s, Math.max(0, total - s - 2.7)), false)
        .stroke({ color: style.marking, width: style.dividerWidthM, alpha: 0.78 });
  }
}
