import { expect } from 'vitest';
import type { Airport, AirsideEdge } from '../src/schema/airport';

export function airsideReachable(
  airport: Airport,
  start: string,
  allows: (edge: AirsideEdge) => boolean = () => true,
  direction: 'forward' | 'reverse' | 'either' = 'forward',
) {
  const next = new Map<string, string[]>();
  function link(from: string, to: string) {
    const neighbors = next.get(from) ?? [];
    neighbors.push(to);
    next.set(from, neighbors);
  }
  for (const edge of Object.values(airport.edges).filter(allows)) {
    if (!edge.oneway || direction !== 'reverse') link(edge.from, edge.to);
    if (!edge.oneway || direction !== 'forward') link(edge.to, edge.from);
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length)
    for (const node of next.get(queue.pop()!) ?? [])
      if (!seen.has(node)) {
        seen.add(node);
        queue.push(node);
      }
  return seen;
}

export function expectAirsideTopology(airport: Airport) {
  const [runway] = Object.values(airport.runways);
  expect(runway).toBeDefined();
  const component = airsideReachable(airport, runway!.ends[0].node, undefined, 'either');
  expect(component, 'airside must be one component').toEqual(new Set(Object.keys(airport.nodes)));

  const toRunway = runway!.ends.map((end) => ({
    designator: end.designator,
    nodes: airsideReachable(airport, end.node, undefined, 'reverse'),
  }));
  for (const stand of Object.values(airport.stands)) {
    const label = `stand ${stand.ref ?? stand.id}`;
    expect(stand.leadIn, label).not.toHaveLength(0);
    const edges = stand.leadIn.map((id) => airport.edges[id]!);
    let at = edges[0]!.from;
    for (const edge of edges) {
      expect(edge, label).toMatchObject({
        from: at,
        stand: stand.id,
        kind: 'lead_in',
        maxCode: stand.maxCode,
      });
      at = edge.to;
    }
    expect(airport.nodes[at]!.pos, label).toEqual(stand.pos);
    for (const end of toRunway)
      expect(end.nodes.has(at), `${label} reaches ${end.designator}`).toBe(true);
  }

  for (const hold of Object.values(airport.holdingPositions)) {
    const { pos } = airport.nodes[hold.node]!;
    const label = `hold ${hold.ref ?? hold.id}`;
    if (hold.kind === 'intermediate') {
      expect(hold, label).toMatchObject({ runway: null, side: null, toward: null });
      continue;
    }
    const protectedRunway = airport.runways[hold.runway!]!;
    const [a, b] = protectedRunway.ends.map((end) => end.pos);
    const side = (b!.x - a!.x) * (pos.y - a!.y) - (b!.y - a!.y) * (pos.x - a!.x);
    expect(side, label).not.toBe(0);
    expect(hold.side, label).toBe(side > 0 ? 'right' : 'left');

    const edge = airport.edges[hold.toward!]!;
    expect([edge.from, edge.to], label).toContain(hold.node);
    const next = edge.from === hold.node ? edge.to : edge.from;
    expect(edge.to === hold.node && edge.oneway, label).toBeFalsy();
    const ahead = airsideReachable(
      airport,
      next,
      (edge) => edge.kind !== 'lead_in' && edge.from !== hold.node && edge.to !== hold.node,
    );
    expect(
      protectedRunway.ends.some((end) => ahead.has(end.node)),
      label,
    ).toBe(true);
  }
}
