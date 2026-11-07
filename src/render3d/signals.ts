import { headingAtDistance, pointAtDistance } from '../geo/polyline';
import type { CompiledCity } from '../network';
import { signalHeads } from '../render/layers/signals';
import { heightAt, roadStation, type cityHeights } from './heights';

export const signalMountM = 5.5;
export const signalRotationY = (heading: number) => -heading - Math.PI / 2;

export function signalLayout(city: CompiledCity, heights: ReturnType<typeof cityHeights>) {
  const heads = city.nodes.flatMap((node) =>
    node.signal
      ? signalHeads(city, node).map((head) => {
          const lane = city.lanes[head.lane]!;
          const road = city.roads[lane.road]!;
          return {
            ...head,
            node: node.idx,
            heading: headingAtDistance(lane.polyline, lane.cumulative, lane.stopM),
            height: heightAt(heights.roads[road.idx]!, roadStation(road, head)),
          };
        })
      : [],
  );
  const supports = [...new Set(heads.map((head) => city.lanes[head.lane]!.road))].map((index) => {
    const road = city.roads[index]!;
    const right = city.drivingSide === 'right';
    const lane = city.lanes[right ? road.lanes.at(-1)! : road.lanes[0]!]!;
    const p = pointAtDistance(lane.polyline, lane.cumulative, lane.stopM);
    const h = headingAtDistance(lane.polyline, lane.cumulative, lane.stopM);
    const side = (right ? 1 : -1) * (lane.widthM / 2 + 0.75);
    const x = p.x - Math.cos(h) * 0.93 - Math.sin(h) * side;
    const y = p.y - Math.sin(h) * 0.93 + Math.cos(h) * side;
    const height = heightAt(heights.roads[index]!, roadStation(road, { x, y }));
    const approach = heads.filter((head) => city.lanes[head.lane]!.road === index);
    const end = approach.reduce((a, b) =>
      Math.hypot(a.x - x, a.y - y) > Math.hypot(b.x - x, b.y - y) ? a : b,
    );
    return { road: index, x, y, height, clearanceM: 6, end };
  });
  return { heads, supports };
}
