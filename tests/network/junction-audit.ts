import { segmentsIntersect } from '../../src/geo/polyline';
import type { CompiledCity } from '../../src/network';
import { SETBACK_CAP_M } from '../../src/network/junctions';
import type { Vec2 } from '../../src/geo/vec2';

// Canonical road-body defects, outside TASK-061's junction geometry surface, on main 5568eed.
// TASK-090: checked as a budget (`roadBodyCrossings`), no longer pair by pair: every geometry task
// added or removed pairs here.
// Crossings beyond a capped setback (`capped`) are not listed: the Sindelfingen pair
// r:140#0>r:476#0 (curved service ways, 47 m beyond the junction) became one with the cap.
export const importedRoadBodyOverlaps: Record<string, Record<string, string>> = {
  'munich-donnersberger': {
    // TASK-101 retains the access boundary at n:27. These same source crossings occur
    // with main's compiler on this canonical topology (T39's r:29/r:958 overlap).
    'r:29#0>r:958#2':
      'The source slip road crosses Arnulfstraße beside the retained truck-delivery boundary.',
    'r:29#0>r:958#3': 'The same source slip road crosses the adjacent Arnulfstraße lane.',
    'r:196#0>r:416#2':
      'The source ramp crosses the trunk lane body at n:194; TASK-071 removes the capped-setback classification at this continuation.',
    // TASK-083: r:565#0>r:589#0 and r:325#0>r:941#0 no longer cross (r:565/r:589 lie on each
    // other; r:325/r:941 part where they used to cross once the realignment leaves corridors whole).
    // TASK-074: r:566#0>r:588#0 no longer crosses: of two coincident ends the shadowed one keeps
    // its own floor setback. The pairs below are no longer behind a capped setback at their
    // node, so they are listed here. TASK-084 separated Marsstraße's coincident carriageways
    // (r:368#0>r:480#1, r:368#1>r:480#0 before) into a divided pair; they no longer cross.
    // TASK-082: the coincident service ways r:1024/r:899 and r:1027/r:900 (r:1024#0>r:899#0,
    // r:1027#0>r:900#0 before) share one reference line, so their lanes lie on each other with
    // the same vertices and no longer register as crossing.
    // TASK-087: r:1330#0>r:327#0 (n:324) and r:1279#0>r:724#0 (n:721) no longer cross: the
    // pairs meet at both their nodes and are pushed apart side by side (separateDual). TASK-089:
    // nor do the carriageways converging on a node from one side only, which the network sets side
    // by side there (r:644/r:964 at n:104, r:1276/r:1368 at n:774, r:636/r:950 and r:712/r:955 at
    // n:949, r:1372/r:845 at n:823), nor the pairs the importer now pushes because their
    // continuation is set side by side (r:1277/r:1362 at n:774, r:1354/r:447 at n:382; such an
    // unnamed pair joins its corridor only after the realignment, which leaves turns as on main).
  },
  'sindelfingen-a81': {
    'r:650#0>r:80#0':
      'The existing source carriageway crossing at n:620 is exposed when its neighboring setback no longer reaches the cap.',
    'r:1029#0>r:1178#0': 'Separate source streets cross 114/124 m from their shared endpoints.',
    'r:499#0>r:876#0': 'Curved zero-offset source roads cross 25 m beyond their common junction.',
    // TASK-084 separated the coincident pair r:746/r:803 (r:746#0>r:803#1, r:746#1>r:803#0
    // before) into a divided pair; it no longer crosses.
    'r:574#0>r:971#0': 'Separate zero-offset source carriageways cross along their road bodies.',
    'r:1155#0>r:574#0':
      'Service access crosses the separate source carriageway 57 m from the junction.',
    'r:1155#0>r:971#1':
      'Service access crosses the separate source carriageway 113 m from the junction.',
    // TASK-089: r:574/r:971 stay as drawn (main): pushing them changes n:78's realignment and
    // so its turns (the network must stay unchanged), and the network cannot split them at
    // n:792, where the service way r:1155 runs 1.7 degrees beside them.
  },
};

/** Lane pairs with a road-body crossing (not behind a capped setback) and the most a city may
 * have: the recorded pairs plus one. */
export function roadBodyCrossings(net: CompiledCity, city: string) {
  const pairs = new Set(
    junctionOverlaps(net)
      .filter((pair) => !pair.capped)
      .map((pair) => pair.lanes.join('>')),
  );
  return { pairs: [...pairs], budget: Object.keys(importedRoadBodyOverlaps[city]!).length + 1 };
}

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
