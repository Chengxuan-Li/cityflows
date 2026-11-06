import type { Graphics } from 'pixi.js';
import { distance as distanceOf, headingAtDistance, nearestOnPolyline } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CMovement, CNode, CompiledCity, CRoad } from '../../network';
import { roadStyle, style } from '../style';

export function roadEndEdges(_city: CompiledCity, road: CRoad, atEnd: boolean) {
  // The surface's cut corners, left then right in travel direction: the junction polygon's
  // corners there (TASK-089: a lane curving with a converging shift is not square to its cut).
  const ring = road.surface;
  const half = ring.length / 2;
  return atEnd ? [ring[half - 1]!, ring[half]!] : [ring[0]!, ring.at(-1)!];
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

/** The junction polygon, curbs included (TASK-083). */
export function drawNode(graphics: Graphics, node: CNode, color: number = style.asphalt): void {
  if (!node.outline.length) return;
  graphics.poly(node.outline).fill(color);
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
    // junction surface takes over from the road (TASK-074). TASK-083: its width eases into the
    // next road's verge, so the two halves meet at the middle with one width and no cap.
    for (const band of curbBands(city, node, road, edges, roadClasses))
      graphics.poly(band).fill(color);
  }
}

/** TASK-080 (B36): at a split or merge whose branches run side by side wider than the trunk (an
 * absorbing merge, a lane added at an exit), the curb-side edge eases from the outermost branch
 * to the trunk as one smooth taper over the trunk's `taperM`, drawn under the junction surface.
 * The ring spans from the taper curve to 2 m inside the trunk's edge line. */
export function curbTaper(city: CompiledCity, node: CNode) {
  if (node.control !== 'uncontrolled') return null;
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

/** From each of a road end's corners on the outline, the first half of the curb toward the next
 * road end's corner, as a band around the curb whose half width eases (smoothstep along the whole
 * curb) from this road's verge at its corner to the other road's at that one: the other road's
 * band meets it at the middle with the same width and cross-section. */
export function curbBands(
  city: CompiledCity,
  node: CNode,
  road: CRoad,
  corners: Vec2[],
  roadClasses = false,
): Vec2[][] {
  const ring = node.outline.slice(0, -1);
  const n = ring.length;
  const others = city.roads
    .filter((r) => r.from === node.idx || r.to === node.idx)
    .flatMap((r) => [
      ...(r.from === node.idx ? roadEndEdges(city, r, false).map((p) => ({ p, r })) : []),
      ...(r.to === node.idx ? roadEndEdges(city, r, true).map((p) => ({ p, r })) : []),
    ]);
  const near = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y) <= 0.15;
  const own = roadStyle(road, roadClasses).vergeM;
  return corners.flatMap((corner, side) => {
    // The outline vertex nearest the corner, and the way along the outline away from the road's
    // other corner, judged a little way off (the outline can repeat a corner within millimetres).
    let k = -1;
    ring.forEach((p, i) => {
      if (near(p, corner) && (k < 0 || distanceOf(p, corner) < distanceOf(ring[k]!, corner))) k = i;
    });
    if (k < 0) return [];
    const other = corners[1 - side]!;
    const along = (step: number) => {
      let i = 1;
      while (i < n - 1 && distanceOf(ring[(k + step * i + n * n) % n]!, corner) < 0.3) i++;
      const p = ring[(k + step * i + n * n) % n]!;
      return (p.x - corner.x) * (other.x - corner.x) + (p.y - corner.y) * (other.y - corner.y);
    };
    const step = along(1) < along(-1) ? 1 : -1;
    const curb = [corner];
    let end: CRoad | undefined;
    for (let i = 1; i < n; i++) {
      const p = ring[(k + step * i + n * n) % n]!;
      curb.push(p);
      // The next road end's corner; the ring can repeat a corner within millimetres.
      end = others.find((q) => near(p, q.p) && !near(q.p, corner))?.r;
      if (end) break;
    }
    if (!end) return [];
    // A curb runs out along each road edge to its tangent point and turns back there along the
    // arc: the band covers the arc only, the roads' own verges drawing their edges.
    const alongEdge = (r: CRoad, p: Vec2) => {
      const h = r.surface.length / 2;
      return [r.surface.slice(0, h), r.surface.slice(h)].some(
        (edge) => nearestOnPolyline(edge, p).away < 0.05,
      );
    };
    const trim = (path: Vec2[], r: CRoad) => {
      let i = 0;
      while (i + 1 < path.length && alongEdge(r, path[i + 1]!)) i++;
      path.splice(0, i);
    };
    trim(curb, road);
    curb.reverse();
    trim(curb, end);
    curb.reverse();
    if (curb.length < 2) return [];
    const lengths = [0];
    for (let i = 1; i < curb.length; i++)
      lengths.push(lengths[i - 1]! + distanceOf(curb[i - 1]!, curb[i]!));
    const total = lengths.at(-1)!;
    if (total < 1e-6) return [];
    const theirs = roadStyle(end, roadClasses).vergeM;
    const width = (s: number) => {
      const t = Math.max(0, Math.min(1, s / total));
      return own + (theirs - own) * t * t * (3 - 2 * t);
    };
    // The curb's first half, cut at its middle point, and both sides of it at the width there.
    const half: { p: Vec2; s: number }[] = [{ p: curb[0]!, s: 0 }];
    for (let i = 1; i < curb.length; i++) {
      if (lengths[i]! >= total / 2) {
        const t = (total / 2 - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]!);
        const a = curb[i - 1]!,
          b = curb[i]!;
        half.push({ p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, s: total / 2 });
        break;
      }
      half.push({ p: curb[i]!, s: lengths[i]! });
    }
    // Cross-sections at the half's vertices, across the curb's direction there; at the middle,
    // across the segment holding it, which the other half shares.
    const direction = (i: number) => {
      const a = i === 0 ? half[0]!.p : half[i - 1]!.p;
      const b = i === half.length - 1 ? half[i]!.p : half[i + 1]!.p;
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    };
    const left: Vec2[] = [],
      right: Vec2[] = [];
    half.forEach(({ p, s }, i) => {
      const d = direction(i);
      const w = width(s);
      left.push({ x: p.x - d.y * w, y: p.y + d.x * w });
      right.push({ x: p.x + d.y * w, y: p.y - d.x * w });
    });
    return [[...left, ...right.reverse()]];
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
