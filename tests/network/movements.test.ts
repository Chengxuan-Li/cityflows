import { expect, it } from 'vitest';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { compile, type CompiledCity } from '../../src/network';
import type { City, Road, TurnRule } from '../../src/schema';

function junction() {
  const city = signalApproach();
  const node = Object.values(city.nodes).find((node) => node.control === 'signal')!;
  node.control = 'uncontrolled';
  node.signal = null;
  const incoming = Object.values(city.roads).find(
    (road) => road.to === node.id && road.centerline[0]!.x < node.pos.x,
  )!;
  const outgoing = Object.values(city.roads).filter((road) => road.from === node.id);
  return {
    city,
    node,
    incoming,
    left: outgoing.find((r) => r.centerline.at(-1)!.y < node.pos.y)!,
    through: outgoing.find((r) => r.centerline.at(-1)!.x > node.pos.x)!,
    reverse: outgoing.find((r) => r.streetGroupId === incoming.streetGroupId)!,
  };
}

function compiled(city: City): CompiledCity {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.compiled;
}

function turns(city: City, road: Road, lane: number) {
  const network = compiled(city);
  return network.lanes[network.index.lane.get(road.id + '#' + lane)!]!.out.map(
    (idx) => network.movements[idx]!.turn,
  ).sort();
}

function pairs(city: City, from: Road, to: Road) {
  return compiled(city)
    .movements.filter((m) => m.id.startsWith(from.id + '#') && m.id.includes('>' + to.id + '#'))
    .map((m) => m.id);
}

it('assigns through lanes and mirrors turn lanes for left-hand traffic', () => {
  const { city, incoming } = junction();
  expect(turns(city, incoming, 0)).toEqual(['left', 'through']);
  expect(turns(city, incoming, 1)).toEqual(['right', 'through']);
  city.drivingSide = 'left';
  for (const road of Object.values(city.roads)) road.lateralOffsetM *= -1;
  expect(turns(city, incoming, 0)).toEqual(['right', 'through']);
  expect(turns(city, incoming, 1)).toEqual(['left', 'through']);
});

it('applies rules in order of specificity and requires explicit permission for U-turns', () => {
  const { city, node, incoming, through, reverse } = junction();
  const ban: TurnRule = {
    from: incoming.id,
    to: through.id,
    allowed: false,
    provenance: node.provenance,
  };
  node.turnRules.push(ban);
  expect(pairs(city, incoming, through)).toEqual([]);
  node.turnRules.push({ ...ban, fromLane: 1, toLane: 0, allowed: true });
  expect(pairs(city, incoming, through)).toEqual([`${incoming.id}#1>${through.id}#0`]);
  expect(pairs(city, incoming, reverse)).toEqual([]);
  node.turnRules.push({ ...ban, to: reverse.id, allowed: true });
  expect(turns(city, incoming, 0)).toContain('uturn');
});

it('requires a shared vehicle class across the lane pair', () => {
  const { city, incoming, left } = junction();
  incoming.lanes[0]!.allowed = ['truck'];
  left.lanes[0]!.allowed = ['bus'];
  expect(pairs(city, incoming, left)).toEqual([]);
  left.lanes[0]!.allowed.push('truck');
  expect(pairs(city, incoming, left)).toHaveLength(1);
});
