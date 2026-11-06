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

export function drawNode(graphics: Graphics, node: CNode, color: number = style.asphalt): void {
  if (node.outline.length) graphics.poly(node.outline).fill(color);
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
    const taper = curbTaper(city, node);
    if (taper && taper.trunk === road) graphics.poly(taper.ring).fill(color);
    const edges = roadEndEdges(city, road, atEnd);
    graphics.poly(edges, false).stroke({ color, width: vergeM * 2, cap: 'round' });
    // The road's verge runs on along the curb to its middle, so the curb has no step where the
    // junction surface takes over from the road (TASK-074).
    for (const curb of curbHalves(city, node, edges))
      graphics.poly(curb, false).stroke({ color, width: vergeM * 2, cap: 'round', join: 'round' });
  }
}

/** TASK-080 (B36): at a split or merge whose branches run side by side wider than the trunk (an
 * absorbing merge, a lane added at an exit), the curb-side edge eases from the outermost branch
 * to the trunk as one smooth taper over the trunk's `taperM`, drawn under the junction surface.
 * The ring spans from the taper curve to 2 m inside the trunk's edge line. */
export function curbTaper(city: CompiledCity, node: CNode) {
  const incoming = city.roads.filter((r) => r.to === node.idx && r.from !== node.idx);
  const outgoing = city.roads.filter((r) => r.from === node.idx && r.to !== node.idx);
  const merge = outgoing.length === 1 && incoming.length > 1;
  if (!merge && !(incoming.length === 1 && outgoing.length > 1)) return null;
  const trunk = (merge ? outgoing : incoming)[0]!;
  const side = city.drivingSide === 'right' ? 1 : 0;
  const sign = side ? 1 : -1;
  const lane = city.lanes[trunk.lanes[side ? trunk.lanes.length - 1 : 0]!]!;
  const h = headingAtDistance(lane.polyline, lane.cumulative, merge ? 0 : lane.lengthM);
  const corner = roadEndEdges(city, trunk, !merge)[side]!;
  const frame = (p: Vec2) => ({
    u: (p.x - corner.x) * Math.cos(h) + (p.y - corner.y) * Math.sin(h),
    v: sign * (-(p.x - corner.x) * Math.sin(h) + (p.y - corner.y) * Math.cos(h)),
  });
  const world = (u: number, v: number) => ({
    x: corner.x + u * Math.cos(h) - sign * v * Math.sin(h),
    y: corner.y + u * Math.sin(h) + sign * v * Math.cos(h),
  });
  const branches = merge ? incoming : outgoing;
  const along = branches.every((b) => {
    const l = city.lanes[b.lanes[0]!]!;
    const heading = headingAtDistance(l.polyline, l.cumulative, merge ? l.lengthM : 0);
    return Math.cos(heading - h) > Math.cos(Math.PI / 6);
  });
  if (!along) return null;
  const outer = branches
    .map((b) => frame(roadEndEdges(city, b, merge)[side]!))
    .reduce((a, b) => (b.v > a.v ? b : a));
  if (outer.v < 0.3 || (merge ? outer.u > 0 : outer.u < 0)) return null;
  const taperM = Math.max(15, Math.min(40, 0.4 * trunk.speedLimitMps * 3.6));
  const direction = merge ? 1 : -1;
  const curve: Vec2[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    curve.push(world(outer.u + direction * taperM * t, outer.v * (1 - t * t * (3 - 2 * t))));
  }
  return {
    trunk,
    ring: [...curve, world(outer.u + direction * taperM, -2), world(outer.u, -2)],
  };
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
