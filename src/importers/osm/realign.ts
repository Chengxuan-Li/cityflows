import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  pointAtDistance,
  polylineLength,
  segmentIntersection,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { Diagnostic } from '../../network';
import { SETBACK_CAP_M } from '../../network/junctions';
import { roadWidth } from '../../network/lanes';
import type { City, Node, Road, RoadClass } from '../../schema';
import type { OsmRoad } from './roads';

const degree = Math.PI / 180;
const targetDegrees = 60 + 1e-6;
const rank: Record<RoadClass, number> = {
  motorway: 7,
  trunk: 6,
  primary: 5,
  secondary: 4,
  tertiary: 3,
  ramp: 2,
  residential: 1,
  service: 0,
};
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const along = (p: Vec2, heading: number, length: number): Vec2 => ({
  x: p.x + Math.cos(heading) * length,
  y: p.y + Math.sin(heading) * length,
});

function deviation(points: Vec2[], original: Vec2[]): number {
  return Math.max(
    ...points.map((p) =>
      Math.min(
        ...original.slice(1).map((b, i) => {
          const a = original[i]!;
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const t = Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
          );
          return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
        }),
      ),
    ),
  );
}

function outwardLine(road: Road, node: Pick<Node, 'id'>) {
  return road.from === node.id ? road.centerline : [...road.centerline].reverse();
}

/** The TASK-061 rule (straight edges from the node, farthest crossing plus 1 m), with which the
 * realignment sizes its straight mouth, so imported geometry stays as it was before the
 * compiler's junction rules changed (TASK-074, TASK-083). Setbacks follow `roads`' order. */
function straightSetbacks(node: Pick<Node, 'id' | 'pos' | 'control'>, roads: Road[]): number[] {
  const ends = roads.map((road, index) => {
    const line = outwardLine(road, node);
    const lengths = cumulativeLengths(line);
    const heading = headingAtDistance(line, lengths, 0);
    const width = roadWidth(road);
    const offset = road.lateralOffsetM * (road.from === node.id ? 1 : -1);
    return {
      road,
      index,
      line,
      lengths,
      heading,
      width,
      extent: Math.max(Math.abs(offset - width / 2), Math.abs(offset + width / 2)),
      edges: [-1, 1].map((side) => {
        const lateral = offset + (side * width) / 2;
        const start = {
          x: node.pos.x - Math.sin(heading) * lateral,
          y: node.pos.y + Math.cos(heading) * lateral,
        };
        return [
          start,
          {
            x: start.x + Math.cos(heading) * lengths.at(-1)!,
            y: start.y + Math.sin(heading) * lengths.at(-1)!,
          },
        ];
      }),
    };
  });
  // Opposite carriageways form one physical street end; splitting a two-way street
  // therefore still gives a through node with four directed roads.
  const groups = new Map<string, typeof ends>();
  for (const end of ends) {
    const other = end.road.from === node.id ? end.road.to : end.road.from;
    const key =
      end.road.streetGroupId === null ? end.road.id : `${end.road.streetGroupId}:${other}`;
    const group = groups.get(key) ?? [];
    group.push(end);
    groups.set(key, group);
  }
  const arms = [...groups.values()].sort((a, b) => a[0]!.heading - b[0]!.heading);
  if (arms.length === 2 && node.control === 'uncontrolled') {
    const a = arms[0]!,
      b = arms[1]!;
    if (
      a.length === b.length &&
      a.every((end) =>
        b.some(
          (other) =>
            (end.road.to === node.id) !== (other.road.to === node.id) &&
            end.road.name === other.road.name &&
            end.road.roadClass === other.road.roadClass &&
            end.road.lateralOffsetM === other.road.lateralOffsetM &&
            end.road.lanes.length === other.road.lanes.length &&
            end.road.lanes.every((lane, i) => lane.widthM === other.road.lanes[i]!.widthM) &&
            end.width === other.width &&
            Math.cos(end.heading - other.heading) < -Math.cos(Math.PI / 36),
        ),
      )
    )
      return roads.map(() => 0);
  }
  const setbacks = ends.map((end) => end.width / 2 + 1);
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i]!;
    const neighbors =
      arms.length > 1
        ? [arms[(i + 1) % arms.length]!, arms[(i + arms.length - 1) % arms.length]!]
        : [];
    for (const end of arm) {
      const cap = Math.max(
        end.width / 2 + 1,
        SETBACK_CAP_M,
        ...neighbors.flatMap((neighbor) => neighbor.map((other) => other.extent + 1)),
      );
      for (const neighbor of new Set(neighbors))
        for (const other of neighbor) {
          if (Math.abs(Math.sin(end.heading - other.heading)) < Math.sin(Math.PI / 36)) continue;
          for (const edge of end.edges) {
            for (const otherEdge of other.edges) {
              for (let j = 1; j < edge.length; j++)
                for (let k = 1; k < otherEdge.length; k++) {
                  const hit = segmentIntersection(
                    edge[j - 1]!,
                    edge[j]!,
                    otherEdge[k - 1]!,
                    otherEdge[k]!,
                  );
                  if (hit) {
                    let nearest = Infinity,
                      along = 0;
                    for (let s = 1; s < end.line.length; s++) {
                      const a = end.line[s - 1]!,
                        b = end.line[s]!;
                      const dx = b.x - a.x,
                        dy = b.y - a.y;
                      const segment = Math.hypot(dx, dy);
                      if (segment === 0) continue;
                      const t = Math.max(
                        0,
                        Math.min(1, ((hit.x - a.x) * dx + (hit.y - a.y) * dy) / segment ** 2),
                      );
                      const away = Math.hypot(hit.x - a.x - t * dx, hit.y - a.y - t * dy);
                      if (away < nearest) {
                        nearest = away;
                        along = end.lengths[s - 1]! + t * segment;
                      }
                    }
                    setbacks[end.index] = Math.min(cap, Math.max(setbacks[end.index]!, along + 1));
                  }
                }
            }
          }
        }
    }
  }
  return setbacks;
}

interface Arm {
  sources: OsmRoad[];
  line: Vec2[];
  heading: number;
}

/** Only import geometry changes; controls and topology remain the pipeline's responsibility. */
export function realignRoads(
  city: City,
  roads: OsmRoad[],
  protectedNodes: ReadonlySet<string>,
  roundaboutWays: ReadonlySet<number>,
  diagnostics: Diagnostic[],
): void {
  // Reserve disjoint halves before either end is bent: the first curve can lengthen a road.
  // The owner allows L < 15 m on short roads; the half-road and 8 m shift bounds still apply.
  const bendLengths = new Map(
    roads.map(({ road }) => [road.id, Math.min(25, polylineLength(road.centerline) / 2)]),
  );
  for (const node of Object.values(city.nodes)) {
    if (protectedNodes.has(node.id) || node.control !== 'uncontrolled') continue;
    const incident = roads.filter(({ road }) => road.from === node.id || road.to === node.id);
    if (incident.some(({ layer }) => layer !== node.layer)) continue;
    const grouped = new Map<string, OsmRoad[]>();
    for (const source of incident) {
      const r = source.road;
      const other = r.from === node.id ? r.to : r.from;
      // A corridor's carriageways approaching the node together (a two-way street, a divided
      // pair, a dual carriageway) are one arm: bending one away from the other only splays the
      // street into lobes beside a side road (G2, TASK-083).
      const key = r.corridorId
        ? `corridor:${r.corridorId}`
        : r.streetGroupId === null
          ? r.id
          : `${r.streetGroupId}:${other}`;
      const group = grouped.get(key) ?? [];
      group.push(source);
      grouped.set(key, group);
    }
    // Some extracts encode opposing directions as separate ways on the exact
    // same centerline. They are one physical arm, just like a street group.
    const groups = [...grouped.values()];
    const outward = (source: OsmRoad) =>
      source.road.from === node.id ? source.road.centerline : [...source.road.centerline].reverse();
    for (let i = groups.length - 1; i > 0; i--) {
      const line = outward(groups[i]![0]!);
      const previous = groups.slice(0, i).find((group) => {
        const other = outward(group[0]!);
        return line.length === other.length && line.every((p, k) => distance(p, other[k]!) < 1e-6);
      });
      if (previous) {
        previous.push(...groups[i]!);
        groups.splice(i, 1);
      }
    }
    const arms: Arm[] = groups
      .map((sources) => {
        const r = sources[0]!.road;
        const line = r.from === node.id ? r.centerline : [...r.centerline].reverse();
        return {
          sources,
          line,
          heading: Math.atan2(line[1]!.y - node.pos.y, line[1]!.x - node.pos.x),
        };
      })
      .sort((a, b) => a.heading - b.heading);
    if (arms.length < 2) continue;
    if (arms.length === 2) {
      const a = arms[0]!.sources[0]!.road,
        b = arms[1]!.sources[0]!.road;
      if (
        (a.name && a.name === b.name) ||
        a.provenance.osmIds!.some((id) => b.provenance.osmIds!.includes(id))
      )
        continue;
    }
    const fixed = new Set<Arm>();
    const changed = new Set<Arm>();
    const pairs = arms
      .flatMap((a, i) => {
        const b = arms[(i + 1) % arms.length]!;
        const gap = (b.heading - a.heading + 2 * Math.PI) % (2 * Math.PI);
        return gap < 45 * degree ? [{ a, b, gap }] : [];
      })
      .sort((a, b) => a.gap - b.gap);
    for (const { a, b } of pairs) {
      const sources = [...a.sources, ...b.sources];
      if (
        sources.some(
          ({ road }) =>
            ['motorway', 'trunk', 'ramp'].includes(road.roadClass) ||
            road.provenance.osmIds!.some((id) => roundaboutWays.has(id)),
        )
      )
        continue;
      if (
        sources.every(({ road }) => road.from === node.id) ||
        sources.every(({ road }) => road.to === node.id)
      )
        continue;

      const candidate = (arm: Arm, neighbor: Arm, sign: number) => {
        const lengths = cumulativeLengths(arm.line);
        const length = Math.min(...arm.sources.map(({ road }) => bendLengths.get(road.id)!));
        let best = { line: arm.line, heading: arm.heading, shift: 0 };
        if (fixed.has(arm) || changed.has(arm)) return best;
        const anchor = pointAtDistance(arm.line, lengths, length);
        const tangent = headingAtDistance(arm.line, lengths, length);
        const originalGap = angle(arm.heading, neighbor.heading);
        const extent = Math.max(
          ...arm.sources.map(
            ({ road }) =>
              Math.abs(road.lateralOffsetM) +
              road.lanes.reduce((w, lane) => w + lane.widthM, 0) / 2 +
              0.5,
          ),
        );
        // A numerical margin avoids treating a sixty-degree tangent as just below sixty.
        for (let step = 1; step <= Math.ceil(targetDegrees - originalGap / degree); step++) {
          const gap = Math.min(targetDegrees, originalGap / degree + step);
          const heading = neighbor.heading + sign * gap * degree;
          if (
            arms.some(
              (other) =>
                other !== arm &&
                other !== neighbor &&
                angle(heading, other.heading) + 1e-8 <
                  Math.min(60 * degree, angle(arm.heading, other.heading)),
            )
          )
            break;
          // The TASK-061 capped rule sizes the straight mouth.
          const setbacks = straightSetbacks(
            node,
            incident.map((source) => {
              if (!arm.sources.includes(source)) return source.road;
              const line = [node.pos, along(node.pos, heading, length)];
              return {
                ...source.road,
                centerline: source.road.from === node.id ? line : line.reverse(),
              };
            }),
          );
          const entryLength = Math.min(
            length / 2,
            Math.max(
              Math.min(7, length / 3),
              Math.max(...arm.sources.map((source) => setbacks[incident.indexOf(source)]!)) + 0.1,
            ),
          );
          const entry = along(node.pos, heading, entryLength);
          // A shorter handle can reduce displacement; retain the gentler cubic when
          // the short handle would fold the lane block. Angle takes priority over shift.
          let found = false;
          for (const handle of [length / 5, distance(entry, anchor) / 3]) {
            const controls = [
              entry,
              along(entry, heading, handle),
              along(anchor, tangent, -handle),
              anchor,
            ];
            // Include near-end samples so the compiler sees the curve's endpoint tangents.
            const steps = Math.ceil(length * 2);
            const curve = [
              node.pos,
              ...[
                0,
                0.001,
                ...Array.from({ length: steps - 1 }, (_, i) => (i + 1) / steps),
                0.999,
                1,
              ].map((t) => {
                const u = 1 - t,
                  weights = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
                return controls.reduce(
                  (p, c, i) => ({ x: p.x + c.x * weights[i]!, y: p.y + c.y * weights[i]! }),
                  { x: 0, y: 0 },
                );
              }),
            ];
            const shift = deviation(curve, arm.line);
            if (shift > 8) continue;
            // As in smoothing, a curve tighter than the lane block folds its inner edge.
            if (
              curve.slice(2).some((c, i) => {
                const a = curve[i]!,
                  b = curve[i + 1]!;
                const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
                return (
                  cross > 1e-10 &&
                  (distance(a, b) * distance(b, c) * distance(a, c)) / (2 * cross) < extent
                );
              })
            )
              continue;
            const actual = Math.atan2(curve[1]!.y - node.pos.y, curve[1]!.x - node.pos.x);
            if (found && shift >= best.shift) continue;
            found = true;
            best = {
              line: [...curve, ...arm.line.filter((_, i) => lengths[i]! > length + 1e-8)],
              heading: actual,
              shift,
            };
          }
          if (gap === targetDegrees) break;
        }
        return best;
      };
      const ca = candidate(a, b, -1),
        cb = candidate(b, a, 1);
      const ra = rank[a.sources[0]!.road.roadClass],
        rb = rank[b.sources[0]!.road.roadClass];
      const aReaches = angle(ca.heading, b.heading) >= 60 * degree - 1e-8;
      const bReaches = angle(cb.heading, a.heading) >= 60 * degree - 1e-8;
      const minor =
        ra < rb ||
        (ra === rb &&
          (aReaches !== bReaches
            ? aReaches
            : (ca.line === a.line ? Infinity : ca.shift) <=
              (cb.line === b.line ? Infinity : cb.shift)))
          ? a
          : b;
      const neighbor = minor === a ? b : a;
      const chosen = minor === a ? ca : cb;
      const achieved = angle(chosen.heading, neighbor.heading) / degree;
      if (chosen.line !== minor.line) {
        minor.line = chosen.line;
        minor.heading = chosen.heading;
        changed.add(minor);
        fixed.add(neighbor);
        for (const { road } of minor.sources) {
          road.centerline = road.from === node.id ? chosen.line : [...chosen.line].reverse();
          road.provenance.inferred!.push(`realigned:${achieved.toFixed(1)}`);
        }
      }
      if (achieved < 60 - 1e-8)
        diagnostics.push({
          severity: 'info',
          code: 'realign_limited',
          refs: [node.id, ...minor.sources.map(({ road }) => road.id)],
          message: `Approach at ${node.id} reaches ${achieved.toFixed(1)} degrees within the half-road/25 m bend, 8 m shift and lane-clearance bounds`,
        });
    }
  }
}
