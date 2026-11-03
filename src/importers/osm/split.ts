import type { OsmWay } from './parse';

export function junctions(ways: OsmWay[], controlled: number[]): Set<number> {
  const junctions = new Set(controlled);
  const seen = new Set<number>();
  for (const { nd } of ways) {
    junctions.add(nd[0]!);
    junctions.add(nd.at(-1)!);
    for (const id of nd) {
      if (seen.has(id)) junctions.add(id);
      seen.add(id);
    }
  }
  return junctions;
}

export function splitWay(ids: number[], junctions: Set<number>): number[][] {
  const parts: number[][] = [];
  let start = 0;
  for (let end = 1; end < ids.length; end++) {
    if (!junctions.has(ids[end]!)) continue;
    if (ids[start] === ids[end]) {
      // Canonical roads cannot be self-loops. Preserve the loop as two connected roads.
      const middle = start + Math.floor((end - start) / 2);
      if (middle > start) parts.push(ids.slice(start, middle + 1), ids.slice(middle, end + 1));
    } else {
      parts.push(ids.slice(start, end + 1));
    }
    start = end;
  }
  return parts;
}
