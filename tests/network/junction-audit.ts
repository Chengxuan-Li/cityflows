import { segmentsIntersect, headingAtDistance } from '../../src/geo/polyline';
import type { CompiledCity } from '../../src/network';
import { SETBACK_CAP_M, junctionOutline, containMovements } from '../../src/network/junctions';
import type { Vec2 } from '../../src/geo/vec2';

// Canonical road-body defects, outside TASK-061's junction geometry surface.
// Keys name lane pairs so a new crossing at another junction cannot disappear into a count.
// Crossings beyond a capped setback (`capped`) are not listed: the Sindelfingen pair
// r:140#0>r:476#0 (curved service ways, 47 m beyond the junction) became one with the cap.
export const importedRoadBodyOverlaps: Record<string, Record<string, string>> = {
  'munich-donnersberger': {
    'r:566#0>r:588#0':
      'Distinct source service ways have identical direction, centerline and offset.',
    'r:1277#0>r:1362#0': 'Separate zero-offset Landsberger carriageways cross along the road body.',
    'r:368#0>r:480#1':
      'Marsstraße source carriageways have reversed identical centerlines and zero offsets.',
    'r:368#1>r:480#0':
      'Marsstraße source carriageways have reversed identical centerlines and zero offsets.',
  },
  'sindelfingen-a81': {
    'r:1029#0>r:1178#0': 'Separate source streets cross 114/124 m from their shared endpoints.',
    'r:499#0>r:876#0': 'Curved zero-offset source roads cross 25 m beyond their common junction.',
    'r:505#0>r:665#0':
      'Two short source ways leave n:501 on top of each other for their whole length.',
    'r:746#0>r:803#1': 'Opposing source carriageways have coincident centerlines and zero offsets.',
    'r:746#1>r:803#0': 'Opposing source carriageways have coincident centerlines and zero offsets.',
    'r:574#0>r:971#0': 'Separate zero-offset source carriageways cross along their road bodies.',
    'r:1155#0>r:574#0':
      'Service access crosses the separate source carriageway 57 m from the junction.',
    'r:1155#0>r:971#1':
      'Service access crosses the separate source carriageway 113 m from the junction.',
  },
};

export function insideOutline(point: Vec2, ring: Vec2[], tolerance = 0.1) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!,
      b = ring[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= tolerance) return true;
    if (a.y > point.y !== b.y > point.y && point.x < a.x + (dx * (point.y - a.y)) / dy)
      inside = !inside;
  }
  return inside;
}

export function movementsOutside(net: CompiledCity) {
  return net.movements
    .filter((m) => {
      const outline = net.nodes[m.node]!.outline;
      return outline.length > 0 && m.polyline.some((p) => !insideOutline(p, outline));
    })
    .map((m) => m.id);
}

export function outlineCrossings(net: CompiledCity) {
  return net.nodes.flatMap((node) => {
    const ring = node.outline;
    const crossings: string[] = [];
    for (let i = 1; i < ring.length; i++) {
      for (let j = i + 2; j < ring.length; j++) {
        if (i === 1 && j === ring.length - 1) continue;
        if (segmentsIntersect(ring[i - 1]!, ring[i]!, ring[j - 1]!, ring[j]!))
          crossings.push(`${node.id}:${i}/${j}`);
      }
    }
    return crossings;
  });
}

/** Lane pairs of distinct incident roads with a proper crossing (shared ends excluded).
 * `capped` marks a crossing at a node where a road end's setback hit `SETBACK_CAP_M`: an
 * acute approach the junction surface covers instead of a longer setback (architecture 5.1). */
export function junctionOverlaps(net: CompiledCity) {
  const overlaps: { node: string; lanes: string[]; capped: boolean }[] = [];
  for (const node of net.nodes) {
    const roads = net.roads.filter((r) => r.from === node.idx || r.to === node.idx);
    const capped = new Set(
      roads.filter((_, i) => node.setbacks[i]! >= SETBACK_CAP_M - 1e-9).map((r) => r.idx),
    );
    const lanes = roads.flatMap((r) => r.lanes.map((i) => net.lanes[i]!));
    for (let i = 0; i < lanes.length; i++) {
      const a = lanes[i]!;
      for (const b of lanes.slice(i + 1)) {
        if (a.road === b.road) continue;
        const crosses = a.polyline.slice(1).some((end, j) =>
          b.polyline.slice(1).some((other, k) => {
            const start = a.polyline[j]!,
              before = b.polyline[k]!;
            const shared = [start, end].some((p) =>
              [before, other].some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6),
            );
            return !shared && segmentsIntersect(start, end, before, other);
          }),
        );
        if (crosses)
          overlaps.push({
            node: node.id,
            lanes: [a.id, b.id],
            capped: capped.size > 0,
          });
      }
    }
  }
  return overlaps;
}

export function surfaceAudit(net: CompiledCity) {
  const widthsOutside: string[] = [],
    oversized: string[] = [],
    tangents: string[] = [];
  const classes = { fillet: 0, straight: 0, extended: 0, gore: 0, through: 0 };
  for (const original of net.nodes) {
    const node = { ...original };
    node.outline = junctionOutline(
      node,
      net.roads.filter((r) => r.from === node.idx || r.to === node.idx),
      net.lanes,
    );
    const { joins, limit } = containMovements(node, net.movements, net.lanes);
    const shape = !node.outline.length
      ? 'through'
      : joins.some((j) => j.kind === 'gore')
        ? 'gore'
        : joins.some((j) => j.kind === 'extended')
          ? 'extended'
          : joins.some((j) => j.kind === 'fillet')
            ? 'fillet'
            : 'straight';
    classes[shape]++;
    if (node.outline.some((p) => Math.hypot(p.x - node.pos.x, p.y - node.pos.y) > limit + 1e-6))
      oversized.push(node.id);
    for (const join of joins) {
      if (join.kind !== 'fillet') continue;
      const line = join.points.filter(
        (p, i) =>
          i === 0 || Math.hypot(p.x - join.points[i - 1]!.x, p.y - join.points[i - 1]!.y) > 1e-6,
      );
      for (const [point, direction, start] of [
        [join.first!, join.directions[0], true],
        [join.last!, join.directions[1], false],
      ] as const) {
        const i = line.findIndex((p) => Math.hypot(p.x - point.x, p.y - point.y) < 1e-5);
        const other = line[i + (start ? 1 : -1)];
        if (!other) {
          tangents.push(`${node.id}:missing tangent`);
          continue;
        }
        const dx = point.x - other.x;
        const dy = point.y - other.y;
        const cosine = (dx * direction.x + dy * direction.y) / Math.hypot(dx, dy);
        if (cosine < Math.cos((2 * Math.PI) / 180) - 1e-6)
          tangents.push(`${node.id}:${join.radius}`);
      }
    }
    if (!node.outline.length) continue;
    for (const index of node.movements) {
      const m = net.movements[index]!;
      const width = Math.min(net.lanes[m.fromLane]!.widthM, net.lanes[m.toLane]!.widthM) / 2;
      const escaped = m.polyline.some((p, i) => {
        const heading = headingAtDistance(m.polyline, m.cumulative, m.cumulative[i]!);
        return [-1, 1].some(
          (side) =>
            !insideOutline(
              {
                x: p.x - Math.sin(heading) * width * side,
                y: p.y + Math.cos(heading) * width * side,
              },
              node.outline,
            ),
        );
      });
      if (escaped) widthsOutside.push(m.id);
    }
  }
  return { widthsOutside, oversized, tangents, classes };
}
