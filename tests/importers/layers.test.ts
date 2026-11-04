import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { citySchema } from '../../src/schema';

function importWays(ways: string) {
  const result = importOsm(
    `<osm>
      <node id="1" lon="11.001" lat="48.002"/>
      <node id="2" lon="11.002" lat="48.002"/>
      <node id="3" lon="11.003" lat="48.002"/>
      <node id="4" lon="11.002" lat="48.001"/>
      <node id="5" lon="11.002" lat="48.003"/>
      ${ways}
    </osm>`,
    { importerVersion: 'test', bbox: [11, 48, 11.004, 48.004] },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.city;
}

function way(id: number, nodes: number[], tags: Record<string, string>) {
  return `<way id="${id}">
    ${nodes.map((ref) => `<nd ref="${ref}"/>`).join('')}
    <tag k="highway" v="secondary"/>
    ${Object.entries(tags)
      .map(([key, value]) => `<tag k="${key}" v="${value}"/>`)
      .join('')}
  </way>`;
}

test.each([
  [{ bridge: 'viaduct' }, 1],
  [{ tunnel: 'yes' }, -1],
  [{ covered: 'yes' }, -1],
  [{ layer: '2', tunnel: 'yes' }, 2],
  [{ layer: '0', bridge: 'yes' }, 0],
  [{ bridge: 'no', tunnel: 'no', covered: 'no' }, 0],
])('imports both directed road layers from %j', (tags, expected) => {
  const city = citySchema.parse(importWays(way(10, [1, 3], tags)));
  expect(Object.values(city.roads).map((road) => road.layer)).toEqual([expected, expected]);
});

test('a bridge deck keeps its layer over an independent ground street with a junction', () => {
  const city = importWays(
    way(10, [1, 3], { bridge: 'yes' }) + way(11, [4, 2], {}) + way(12, [2, 5], {}),
  );
  const roads = Object.values(city.roads);
  const bridge = roads.filter((road) => road.provenance.osmIds?.includes(10));
  const ground = roads.filter((road) => !bridge.includes(road));
  expect(bridge.map((road) => road.layer)).toEqual([1, 1]);
  expect(ground.map((road) => road.layer)).toEqual([0, 0, 0, 0]);
  expect(Object.values(city.nodes).map((node) => node.layer)).toEqual([0, 0, 0, 0, 0]);
  expect(
    ground.some((road) => bridge.some((deck) => [deck.from, deck.to].includes(road.from))),
  ).toBe(false);
});

test.each([false, true])('uses the through way layer at a shared node (reversed=%s)', (reverse) => {
  const ways = [way(10, [4, 2], {}), way(11, [1, 2, 3], { bridge: 'yes' })];
  const city = importWays((reverse ? ways.reverse() : ways).join(''));
  const shared = Object.values(city.nodes).find((node) => node.provenance.osmIds?.includes(2));
  expect(shared?.layer).toBe(1);
});

test('keeps the join between consecutive bridge sections on the deck', () => {
  const city = importWays(way(10, [1, 2], { bridge: 'yes' }) + way(11, [2, 3], { bridge: 'yes' }));
  const layers = Object.fromEntries(
    Object.values(city.nodes).map((node) => [node.provenance.osmIds![0], node.layer]),
  );
  expect(layers).toEqual({ 1: 0, 2: 1, 3: 0 });
});
