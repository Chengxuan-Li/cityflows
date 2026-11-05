import { segmentsIntersect } from '../../src/geo/polyline';
import type { CompiledCity } from '../../src/network';
import {
  SETBACK_CAP_M,
  containMovements,
  escapingSamples,
  junctionOutline,
} from '../../src/network/junctions';
import type { Vec2 } from '../../src/geo/vec2';

// Canonical road-body defects, outside TASK-061's junction geometry surface.
// Keys name lane pairs so a new crossing at another junction cannot disappear into a count.
// Crossings beyond a capped setback (`capped`) are not listed: the Sindelfingen pair
// r:140#0>r:476#0 (curved service ways, 47 m beyond the junction) became one with the cap.
export const importedRoadBodyOverlaps: Record<string, Record<string, string>> = {
  'munich-donnersberger': {
    'r:196#0>r:416#2':
      'The source ramp crosses the trunk lane body at n:194; TASK-071 removes the capped-setback classification at this continuation.',
    'r:1024#0>r:899#0':
      'The opposite coincident service-way lane pair shares the same realigned physical arm at n:894 and n:898.',
    'r:1027#0>r:900#0':
      'Coincident service-way directions are realigned together; shorter cuts expose their duplicate lane bodies at n:894 and n:898.',
    'r:1354#0>r:447#0':
      'Opposing Arnulfstraße source carriageways cross along the body; n:446 is no longer capped after realignment.',
    'r:565#0>r:589#0':
      'The other coincident service-way lane pair is exposed by the shorter neighboring setback; both source centerlines are unchanged.',
    'r:1277#0>r:1362#0': 'Separate zero-offset Landsberger carriageways cross along the road body.',
    'r:368#0>r:480#1':
      'Marsstraße source carriageways have reversed identical centerlines and zero offsets.',
    // TASK-074: r:566#0>r:588#0 no longer crosses: of two coincident ends the shadowed one keeps
    // its own floor setback. The pairs below are no longer behind a capped setback at their
    // node, so they are listed here.
    'r:368#1>r:480#0':
      'Marsstraße source carriageways have reversed identical centerlines and zero offsets.',
    'r:1372#0>r:845#0':
      'Separate Marsstraße carriageways cross 30 m from n:823 after the realigned one bends back.',
    'r:325#0>r:941#0':
      'Separate Landsberger Straße carriageways cross 117 to 126 m from n:322, near their far ends.',
  },
  'sindelfingen-a81': {
    'r:650#0>r:80#0':
      'The existing source carriageway crossing at n:620 is exposed when its neighboring setback no longer reaches the cap.',
    'r:1029#0>r:1178#0': 'Separate source streets cross 114/124 m from their shared endpoints.',
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

/** Movements with a centre-line point outside their node's outline. TASK-074: a point on the
 * movement's own approach or exit road (a hairpin behind its stop line) is on the road. */
export function movementsOutside(net: CompiledCity) {
  return net.movements
    .filter((m) => {
      const outline = net.nodes[m.node]!.outline;
      const own = [m.fromLane, m.toLane].map((lane) => {
        const surface = net.roads[net.lanes[lane]!.road]!.surface;
        return [...surface, surface[0]!];
      });
      return (
        outline.length > 0 &&
        m.polyline.some(
          (p) => !insideOutline(p, outline) && !own.some((ring) => insideOutline(p, ring)),
        )
      );
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
        // TASK-074: 5 degrees, as T27 (a curb meets a slanted or curved road end at its tangent
        // over the end's first half meter, not its first chord).
        if (cosine < Math.cos((5 * Math.PI) / 180) - 1e-6)
          tangents.push(`${node.id}:${join.radius}`);
      }
    }
    if (!node.outline.length) continue;
    // TASK-074: widths across the curve's own tangent (the lanes' directions at both ends, not
    // the first chord's), and a hairpin sweeping back over its own road counts as on the road.
    const roads = net.roads.filter((r) => r.from === node.idx || r.to === node.idx);
    escapingSamples(node, net.movements, net.lanes, roads, node.outline).forEach((samples, i) => {
      if (samples.length) widthsOutside.push(net.movements[node.movements[i]!]!.id);
    });
  }
  return { widthsOutside, oversized, tangents, classes };
}
