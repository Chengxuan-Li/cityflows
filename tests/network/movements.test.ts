import { expect, it } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { ramp } from '../../src/fixtures/ramp';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { compile, type CompiledCity, type CRoad } from '../../src/network';
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

it('keeps turn lanes on the same side under both driving sides and moves only the U-turn lane', () => {
  const { city, node, incoming, reverse } = junction();
  node.turnRules.push({
    from: incoming.id,
    to: reverse.id,
    allowed: true,
    provenance: node.provenance,
  });
  expect(turns(city, incoming, 0)).toEqual(['left', 'through', 'uturn']);
  expect(turns(city, incoming, 1)).toEqual(['right', 'through']);
  city.drivingSide = 'left';
  for (const road of Object.values(city.roads)) road.lateralOffsetM *= -1;
  expect(turns(city, incoming, 0)).toEqual(['left', 'through']);
  expect(turns(city, incoming, 1)).toEqual(['right', 'through', 'uturn']);
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

it('fans a single-lane merge into every lane and aligns multi-lane diverges from the curb', () => {
  const net = compiled(ramp());
  const out = (road: CRoad) =>
    road.lanes.flatMap((l) => net.lanes[l]!.out).map((i) => net.movements[i]!);
  const describe = (m: (typeof net.movements)[number]) =>
    `${net.lanes[m.fromLane]!.lane}>${net.roads[net.lanes[m.toLane]!.road]!.roadClass}#${net.lanes[m.toLane]!.lane}:${m.turn}`;
  const [on, off] = net.roads
    .filter((r) => r.roadClass === 'ramp')
    .sort((a, b) => out(b).length - out(a).length);
  expect(out(on!).map(describe)).toEqual(['0>motorway#0:merge', '0>motorway#1:merge']);
  const offIn = off!.lanes.flatMap((l) => net.lanes[l]!.in).map((i) => net.movements[i]!);
  expect(offIn.map(describe)).toEqual(['1>ramp#0:diverge']);
  const mainline = net.roads.find(
    (r) => r.roadClass === 'motorway' && out(r).some((m) => m.turn === 'diverge'),
  )!;
  expect(out(mainline).map(describe).sort()).toEqual([
    '0>motorway#0:diverge',
    '1>motorway#1:diverge',
    '1>ramp#0:diverge',
  ]);
});

it('gives a lane with no default movement the turns of its nearest served lane', () => {
  const { city, incoming, through, left } = junction();
  city.places = {};
  for (const road of Object.values(city.roads)) {
    if (road.streetGroupId === through.streetGroupId || road.streetGroupId === left.streetGroupId)
      delete city.roads[road.id];
  }
  // From the west the only exit is now the south arm, a right turn: both lanes may take it.
  expect(turns(city, incoming, 0)).toEqual(['right']);
  expect(turns(city, incoming, 1)).toEqual(['right']);
  const net = compiled(city);
  const toLanes = [0, 1].map((lane) =>
    net.lanes[net.index.lane.get(`${incoming.id}#${lane}`)!]!.out.map(
      (i) => net.lanes[net.movements[i]!.toLane]!.lane,
    ),
  );
  expect(toLanes).toEqual([[0], [1]]);
});

it('inherits a non-U-turn continuation past a nearer lane that only permits a U-turn', () => {
  const { city, node, road } = buildCity('Consolidated turns', 1);
  const start = node(-100, 0),
    junction = node(0, 0);
  const from = road(start, junction, { lanes: 3, streetGroupId: 'approach' });
  const reverse = road(junction, start, { lanes: 3, streetGroupId: 'approach' });
  const left = road(junction, node(0, -100), { lanes: 3 });
  junction.turnRules.push({
    from: from.id,
    to: reverse.id,
    fromLane: 1,
    toLane: 1,
    allowed: true,
    provenance: junction.provenance,
  });
  const net = compiled(city);
  expect(
    net.lanes[net.index.lane.get(`${from.id}#2`)!]!.out.map((idx) => net.movements[idx]!.id),
  ).toContain(`${from.id}#2>${left.id}#2`);
});

it('deduplicates fallback movements that clamp several receiving lanes to one', () => {
  const { city, node, road } = buildCity('Clamped fallback', 1);
  const junction = node(0, 0);
  const from = road(node(-100, 0), junction, { lanes: 3 });
  const to = road(junction, node(0, -100), { lanes: 2 });
  junction.turnRules.push({
    from: from.id,
    to: to.id,
    fromLane: 0,
    toLane: 1,
    allowed: true,
    provenance: junction.provenance,
  });
  const net = compiled(city);
  const ids = net.movements.map((m) => m.id);
  expect(ids.length).toBe(new Set(ids).size);
});
