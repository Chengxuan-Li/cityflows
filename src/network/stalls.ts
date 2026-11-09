import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import {
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  prepareRing,
  nearestOnPolyline,
  pointInPolygon,
  type PreparedRing,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { City } from '../schema';
import type { CLot, CStall, CompiledCity } from './types';

const closed = (ring: Vec2[]) => [...ring, ring[0]!];

function overlaps(a: PreparedRing, b: PreparedRing): boolean {
  if (
    a.box.maxX <= b.box.minX ||
    b.box.maxX <= a.box.minX ||
    a.box.maxY <= b.box.minY ||
    b.box.maxY <= a.box.minY
  )
    return false;
  // Coincident footprints have no boundary strictly inside the other polygon.
  return (
    booleanOpD(ClipType.Intersection, [a.ring], [b.ring], FillRule.EvenOdd, 4).reduce(
      (sum, ring) => sum + Math.abs(areaD(ring)),
      0,
    ) > 0.001
  );
}

/** Derived bays; lots without mapped aisles use a regular layout without inventing roads. */
export function generateStalls(city: City, compiled: CompiledCity): CLot[] {
  const occupied: PreparedRing[] = [];
  const obstacles = [
    ...compiled.roads.map((road) => road.surface),
    ...compiled.nodes.map((node) => node.outline),
  ]
    .filter((ring) => ring.length >= 3)
    .map((ring) => prepareRing(closed(ring)));
  return Object.values(city.parking ?? {})
    .filter((lot) => lot.kind === 'lot')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((lot) => {
      const stalls: CStall[] = [];
      const result: CLot = {
        id: lot.id,
        entries: lot.entries ?? [],
        aisles: lot.aisles ?? [],
        stalls,
        stallCount: 0,
      };
      if (lot.shape?.kind !== 'polygon') return result;
      const shape = lot.shape.ring;
      const boundary = prepareRing(closed(shape));
      const local = [
        ...obstacles,
        ...(lot.exclusions ?? []).map((ring) => prepareRing(closed(ring))),
      ].filter(
        ({ box }) =>
          box.minX <= boundary.box.maxX &&
          box.maxX >= boundary.box.minX &&
          box.minY <= boundary.box.maxY &&
          box.maxY >= boundary.box.minY,
      );
      const junctions = compiled.nodes.filter(
        (node) =>
          (lot.entries ?? []).includes(node.id) ||
          new Set(
            (lot.aisles ?? [])
              .filter((r) => city.roads[r]?.from === node.id || city.roads[r]?.to === node.id)
              .map((r) => city.roads[r]!.streetGroupId ?? r),
          ).size > 1,
      );
      const seen = new Set<string>();
      for (const id of [...(lot.aisles ?? [])].sort()) {
        const road = city.roads[id];
        if (!road) continue;
        const key = road.streetGroupId ?? id;
        if (seen.has(key)) continue;
        seen.add(key);
        const paired = (lot.aisles ?? [])
          .map((r) => city.roads[r]!)
          .filter(
            (r) => r && r.id !== id && road.streetGroupId && r.streetGroupId === road.streetGroupId,
          );
        const width = road.lanes.reduce((sum, lane) => sum + lane.widthM, 0);
        const reverse = paired[0];
        const reverseWidth = reverse?.lanes.reduce((sum, lane) => sum + lane.widthM, 0) ?? 0;
        const left = Math.min(
          road.lateralOffsetM - width / 2,
          reverse ? -reverse.lateralOffsetM - reverseWidth / 2 : Infinity,
        );
        const right = Math.max(
          road.lateralOffsetM + width / 2,
          reverse ? -reverse.lateralOffsetM + reverseWidth / 2 : -Infinity,
        );
        const angle = !paired.length && width <= 4 ? Math.PI / 3 : Math.PI / 2;
        const pitch = 2.5 / Math.sin(angle);
        const cumulative = cumulativeLengths(road.centerline);
        const length = cumulative.at(-1)!;
        for (const side of [-1, 1]) {
          for (let s = 6 + pitch / 2; s <= length - 6 - pitch / 2; s += pitch) {
            const p = pointAtDistance(road.centerline, cumulative, s);
            const tangent = headingAtDistance(road.centerline, cumulative, s);
            const heading = tangent + side * angle;
            const along = { x: Math.cos(heading), y: Math.sin(heading) };
            const across = { x: -along.y, y: along.x };
            const normal = { x: -Math.sin(tangent), y: Math.cos(tangent) };
            const offset =
              (side < 0 ? left : right) +
              side * (2.5 * Math.sin(angle) + 1.25 * Math.abs(Math.cos(angle)) + 0.2);
            const position = { x: p.x + normal.x * offset, y: p.y + normal.y * offset };
            const corners = [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ].map(([l, w]) => ({
              x: position.x + l! * 2.5 * along.x + w! * 1.25 * across.x,
              y: position.y + l! * 2.5 * along.y + w! * 1.25 * across.y,
            }));
            const outside = booleanOpD(
              ClipType.Difference,
              [corners],
              [shape],
              FillRule.EvenOdd,
              4,
            );
            if (outside.reduce((sum, ring) => sum + Math.abs(areaD(ring)), 0) > 0.001) continue;
            const candidate = prepareRing(closed(corners));
            if (
              local.some((obstacle) => overlaps(candidate, obstacle)) ||
              occupied.some((other) => overlaps(candidate, other))
            )
              continue;
            // Keep the entire bay, rather than just its centre, six metres from junctions.
            if (
              junctions.some(
                (node) =>
                  pointInPolygon(node.pos, closed(corners)) ||
                  nearestOnPolyline(closed(corners), node.pos).away < 6,
              )
            )
              continue;
            occupied.push(candidate);
            stalls.push({
              layout: angle < Math.PI / 2 ? 'angled' : 'perpendicular',
              access: p,
              position,
              heading,
              widthM: 2.5,
              lengthM: 5,
              aisleRoad: id,
              positionM: s,
              corners,
            });
          }
        }
      }
      if (!lot.aisles?.length) {
        const edges = shape.map((a, i) => ({ a, b: shape[(i + 1) % shape.length]! }));
        edges.sort(
          (a, b) =>
            Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y),
        );
        const edge = edges[0]!;
        const axis = Math.atan2(edge.b.y - edge.a.y, edge.b.x - edge.a.x);
        let best: CStall[] = [];
        let bestPaths: Vec2[][] = [];
        // Try both bay orientations: a shallow lot may only fit longitudinal parking.
        for (const heading of [axis, axis + Math.PI / 2]) {
          const attempt: CStall[] = [];
          const u = { x: Math.cos(heading), y: Math.sin(heading) },
            v = { x: -u.y, y: u.x };
          const us = shape.map((p) => p.x * u.x + p.y * u.y),
            vs = shape.map((p) => p.x * v.x + p.y * v.y);
          const minU = Math.min(...us),
            maxU = Math.max(...us),
            minV = Math.min(...vs),
            maxV = Math.max(...vs);
          const paths: Vec2[][] = [];
          const at = (x: number, y: number) => ({ x: x * u.x + y * v.x, y: x * u.y + y * v.y });
          const gaps = new Set<number>();
          const shallow = maxV - minV < 8 || maxU - minU < 12.5;
          for (
            let row = 0, y = minV + (shallow ? 2.5 : 8);
            y + 2.5 <= maxV + 1e-8;
            row++, y += row % 2 === 1 ? 5 : 11
          ) {
            const facing = row % 2 === 0 ? 1 : -1;
            const gap = y - facing * 5.5;
            for (
              let x = minU + (shallow ? 1.25 : 6.25);
              x + (shallow ? 1.25 : 6.25) <= maxU + 1e-8;
              x += 2.5
            ) {
              const position = { x: x * u.x + y * v.x, y: x * u.y + y * v.y };
              const corners = [
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1],
              ].map(([w, l]) => ({
                x: position.x + w! * 1.25 * u.x + l! * 2.5 * v.x,
                y: position.y + w! * 1.25 * u.y + l! * 2.5 * v.y,
              }));
              if (
                booleanOpD(ClipType.Difference, [corners], [shape], FillRule.EvenOdd, 4).reduce(
                  (sum, ring) => sum + Math.abs(areaD(ring)),
                  0,
                ) > 0.001
              )
                continue;
              const candidate = prepareRing(closed(corners));
              if (
                local.some((o) => overlaps(candidate, o)) ||
                occupied.some((o) => overlaps(candidate, o))
              )
                continue;
              attempt.push({
                access: at(x, gap),
                position,
                heading: heading + (facing * Math.PI) / 2,
                widthM: 2.5,
                lengthM: 5,
                aisleRoad: lot.connectors[0]?.roadId ?? '',
                positionM: lot.connectors[0]?.positionM ?? 0,
                corners,
              });
              gaps.add(gap);
            }
          }
          const ys = [...gaps].sort((a, b) => a - b);
          for (const y of ys) paths.push([at(minU + 3, y), at(maxU - 3, y)]);
          if (ys.length > 1)
            for (const x of [minU + 3, maxU - 3]) paths.push([at(x, ys[0]!), at(x, ys.at(-1)!)]);
          if (attempt.length > best.length) {
            best = attempt;
            bestPaths = paths;
          }
        }
        for (const stall of best) {
          stalls.push(stall);
          occupied.push(prepareRing(closed(stall.corners)));
        }
        result.aislePaths = bestPaths;
      }
      result.stallCount = stalls.length;
      return result;
    });
}
