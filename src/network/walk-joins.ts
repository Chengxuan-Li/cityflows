import {
  cumulativeLengths,
  distance,
  headingAtDistance,
  nearestOnPolyline,
  offsetPolyline,
  pointAtDistance,
  polylineLength,
  trimPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { WalkGraph } from './walk';
import type { City } from '../schema';

/** Cover a separate sidewalk only where a mapped parallel path actually exists. Four-metre
 * samples leave each generated run close enough for the ordinary endpoint join. */
export function uncoveredCurb(line: Vec2[], covered: (p: Vec2, heading: number) => boolean) {
  const lengths = cumulativeLengths(line),
    length = lengths.at(-1)!;
  const steps = Math.ceil(length / 4),
    runs: Vec2[][] = [];
  let start: number | undefined;
  for (let i = 0; i <= steps; i++) {
    const at = (i * length) / steps;
    const middle = ((i + 0.5) * length) / steps;
    const missing =
      i < steps &&
      ![at, middle, ((i + 1) * length) / steps].every((s) =>
        covered(pointAtDistance(line, lengths, s), headingAtDistance(line, lengths, s)),
      );
    if (missing && start === undefined) start = at;
    if (!missing && start !== undefined) {
      runs.push(trimPolyline(line, start, length - at));
      start = undefined;
    }
  }
  return runs;
}

/** Connectivity before access attachment, without allocating split link geometry. */
export function walkRoots(
  source: City,
  links: readonly {
    id: string;
    line: Vec2[];
    layer: number;
    cuts: number[];
    sourceEnds?: [string, string];
    endpointLayers?: [number, number];
  }[],
) {
  const indices = new Map(links.map((l, i) => [l.id, i]));
  const parent = links.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  type Representative = { pos: Vec2; link?: number };
  const buckets = new Map<string, Representative[]>();
  const nodeAt = (pos: Vec2, layer: number): Representative => {
    const x = Math.floor(pos.x * 20),
      y = Math.floor(pos.y * 20);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of buckets.get(`${x + dx}:${y + dy}:${layer}`) ?? [])
          if (distance(pos, other.pos) < 0.05) return other;
    const node = { pos },
      key = `${x}:${y}:${layer}`,
      list = buckets.get(key) ?? [];
    list.push(node);
    buckets.set(key, list);
    return node;
  };
  // Match materializeWalk: mapped nodes are allocated first, in source ID order.
  const sourceNodes = new Map(
    Object.values(source.walk?.nodes ?? {})
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => [n.id, nodeAt(n.pos, n.layer)]),
  );
  links.forEach((l, i) => {
    const lengths = cumulativeLengths(l.line),
      length = lengths.at(-1)!;
    const cuts = l.cuts
      .toSorted((a, b) => a - b)
      .filter((s, i, all) => i === 0 || s - all[i - 1]! > 0.05);
    for (const s of cuts) {
      const end = s < 0.05 ? 0 : length - s < 0.05 ? 1 : undefined;
      const node =
        end !== undefined && l.sourceEnds
          ? sourceNodes.get(l.sourceEnds[end]!)!
          : nodeAt(
              pointAtDistance(l.line, lengths, s),
              end === undefined ? l.layer : (l.endpointLayers?.[end] ?? l.layer),
            );
      if (node.link === undefined) node.link = i;
      else parent[find(i)] = find(node.link);
    }
  });
  const root = (id: string) => find(indices.get(id)!);
  return {
    root,
    unite: (a: string, b: string) => {
      parent[root(a)] = root(b);
    },
  };
}

export function walkComponents(graph: WalkGraph) {
  const labels = new Int32Array(graph.nodes.length).fill(-1),
    sizes: number[] = [];
  for (const node of graph.nodes) {
    if (labels[node.idx] !== -1) continue;
    const component = sizes.length,
      queue = [node.idx];
    labels[node.idx] = component;
    for (const n of queue)
      for (const i of graph.nodes[n]!.links) {
        const l = graph.links[i]!,
          next = l.from === n ? l.to : l.from;
        if (labels[next] !== -1) continue;
        labels[next] = component;
        queue.push(next);
      }
    sizes.push(queue.length);
  }
  return { labels, sizes, core: sizes.indexOf(Math.max(0, ...sizes)) };
}

/** Follow the outside of the existing junction curb, including driveway mouths and caps.
 * Reject the arc that crosses an ordinary street arm; that arm needs a real crossing. */
export function curbJoin(
  outline: Vec2[],
  from: Vec2,
  to: Vec2,
  clear: (a: Vec2, b: Vec2) => boolean,
): Vec2[] | undefined {
  if (distance(from, to) < 0.05) return;
  if (!outline.length) return clear(from, to) ? [from, to] : undefined;
  const ring = outline.slice(0, -1);
  const area = ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  const padded = [ring.at(-1)!, ...ring, ring[0]!, ring[1]!];
  const edge = offsetPolyline(padded, area > 0 ? -1 : 1).slice(1, -1);
  const lengths = cumulativeLengths(edge),
    length = lengths.at(-1)!;
  const a = nearestOnPolyline(edge, from),
    b = nearestOnPolyline(edge, to);
  const low = Math.min(a.along, b.along),
    high = Math.max(a.along, b.along);
  const direct = trimPolyline(edge, low, length - high);
  const around = [...trimPolyline(edge, high, 0), ...trimPolyline(edge, 0, length - low)];
  if (a.along > b.along) direct.reverse();
  else around.reverse();
  return [direct, around]
    .map((line) => [from, ...line, to])
    .filter(
      (line) => polylineLength(line) <= 40 && line.every((p, i) => !i || clear(line[i - 1]!, p)),
    )
    .sort((a, b) => polylineLength(a) - polylineLength(b))[0];
}
