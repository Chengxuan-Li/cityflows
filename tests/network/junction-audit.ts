import { segmentsIntersect } from '../../src/geo/polyline';
import type { CompiledCity } from '../../src/network';
import type { Vec2 } from '../../src/geo/vec2';

// Canonical road-body defects, outside TASK-061's junction geometry surface.
// Keys name lane pairs so a new crossing at another junction cannot disappear into a count.
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
    'r:140#0>r:476#0': 'Curved service ways cross 47 m beyond their common junction.',
    'r:499#0>r:876#0': 'Curved zero-offset source roads cross 25 m beyond their common junction.',
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

/** Count lane pairs of distinct incident roads with a proper crossing (shared ends excluded). */
export function junctionOverlaps(net: CompiledCity) {
  const overlaps: { node: string; lanes: string[] }[] = [];
  for (const node of net.nodes) {
    const lanes = net.roads
      .filter((r) => r.from === node.idx || r.to === node.idx)
      .flatMap((r) => r.lanes.map((i) => net.lanes[i]!));
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
        if (crosses) overlaps.push({ node: node.id, lanes: [a.id, b.id] });
      }
    }
  }
  return overlaps;
}
