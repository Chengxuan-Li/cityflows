import type { Graphics } from 'pixi.js';
import { distance as distanceOf, headingAtDistance } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CMovement, CNode, CompiledCity, CRoad } from '../../network';
import { roadStyle, style } from '../style';

export function roadEndEdges(city: CompiledCity, road: CRoad, atEnd: boolean) {
  return [road.lanes[0]!, road.lanes.at(-1)!].map((index, side) => {
    const lane = city.lanes[index]!;
    const point = atEnd ? lane.polyline.at(-1)! : lane.polyline[0]!;
    const heading = headingAtDistance(lane.polyline, lane.cumulative, atEnd ? lane.lengthM : 0);
    const offset = ((side === 0 ? -1 : 1) * lane.widthM) / 2;
    return { x: point.x - Math.sin(heading) * offset, y: point.y + Math.cos(heading) * offset };
  });
}

export function nodeColor(city: CompiledCity, node: CNode, roadClasses = false): number {
  if (!roadClasses) return style.asphalt;
  const highest = city.roads
    .filter((r) => r.from === node.idx || r.to === node.idx)
    .reduce<CRoad | undefined>(
      (best, road) => (!best || road.classRank > best.classRank ? road : best),
      undefined,
    );
  return highest ? roadStyle(highest, true).color : style.asphalt;
}

/** The junction surface and its curb aprons (TASK-078), in one fill. */
export function drawNode(graphics: Graphics, node: CNode, color: number = style.asphalt): void {
  if (!node.outline.length) return;
  graphics.poly(node.outline);
  for (const curb of node.curbs) graphics.poly(curb);
  graphics.fill(color);
}

export function drawRoadJoins(
  graphics: Graphics,
  city: CompiledCity,
  road: CRoad,
  roadClasses = false,
): void {
  const { color, vergeM } = roadStyle(road, roadClasses);
  for (const atEnd of [false, true]) {
    const node = city.nodes[atEnd ? road.to : road.from]!;
    if (!node.outline.length) continue;
    const edges = roadEndEdges(city, road, atEnd);
    graphics.poly(edges, false).stroke({ color, width: vergeM * 2, cap: 'round' });
    // The road's verge runs on along the curb to its middle, so the curb has no step where the
    // junction surface takes over from the road (TASK-074).
    for (const curb of curbHalves(city, node, edges))
      graphics.poly(curb, false).stroke({ color, width: vergeM * 2, cap: 'round', join: 'round' });
  }
}

/** From each of a road end's corners on the outline, the first half of the curb toward the
 * next road end's corner. */
export function curbHalves(city: CompiledCity, node: CNode, corners: Vec2[]): Vec2[][] {
  const ring = node.outline.slice(0, -1);
  const n = ring.length;
  const others = city.roads
    .filter((r) => r.from === node.idx || r.to === node.idx)
    .flatMap((r) => [
      ...(r.from === node.idx ? roadEndEdges(city, r, false) : []),
      ...(r.to === node.idx ? roadEndEdges(city, r, true) : []),
    ]);
  const near = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y) <= 0.15;
  return corners.flatMap((corner, side) => {
    const k = ring.findIndex((p) => near(p, corner));
    if (k < 0) return [];
    const other = corners[1 - side]!;
    const along = (step: number) => {
      const p = ring[(k + step + n) % n]!;
      return (p.x - corner.x) * (other.x - corner.x) + (p.y - corner.y) * (other.y - corner.y);
    };
    const step = along(1) < along(-1) ? 1 : -1;
    const curb = [corner];
    for (let i = 1; i < n; i++) {
      const p = ring[(k + step * i + n * n) % n]!;
      curb.push(p);
      if (others.some((q) => near(p, q))) break;
    }
    let total = 0;
    for (let i = 1; i < curb.length; i++) total += distanceOf(curb[i - 1]!, curb[i]!);
    const half: Vec2[] = [curb[0]!];
    let run = 0;
    for (let i = 1; i < curb.length; i++) {
      const segment = distanceOf(curb[i - 1]!, curb[i]!);
      if (run + segment >= total / 2) {
        const t = (total / 2 - run) / segment;
        const a = curb[i - 1]!,
          b = curb[i]!;
        half.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        break;
      }
      half.push(curb[i]!);
      run += segment;
    }
    return half.length > 1 ? [half] : [];
  });
}

export function drawMovementSurface(
  graphics: Graphics,
  city: CompiledCity,
  movement: CMovement,
  roadClasses = false,
): void {
  if (!city.nodes[movement.node]!.outline.length) return;
  const width = Math.min(
    city.lanes[movement.fromLane]!.widthM,
    city.lanes[movement.toLane]!.widthM,
  );
  graphics.poly(movement.polyline, false).stroke({
    width,
    color: nodeColor(city, city.nodes[movement.node]!, roadClasses),
    cap: 'butt',
  });
}
