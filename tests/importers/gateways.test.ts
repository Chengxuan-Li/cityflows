import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';

test.each([
  ['motorway', 800],
  ['trunk', 600],
  ['primary', 400],
  ['secondary', 240],
] as const)('%s pairs clipped carriageways and scales demand by lane count', (highway, demand) => {
  const result = importOsm(
    `<osm>
      <node id="1" lat="0" lon="-0.002"/><node id="2" lat="0" lon="0.002"/>
      <node id="3" lat="0.0001" lon="-0.002"/><node id="4" lat="0.0001" lon="0.002"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="${highway}"/>
        <tag k="oneway" v="yes"/><tag k="name" v="Main"/><tag k="lanes" v="2"/></way>
      <way id="11"><nd ref="4"/><nd ref="3"/><tag k="highway" v="${highway}"/>
        <tag k="oneway" v="yes"/><tag k="name" v="Main"/><tag k="lanes" v="2"/></way>
    </osm>`,
    { importerVersion: 'test', bbox: [-0.001, -0.001, 0.001, 0.001] },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const gateways = Object.values(result.city.places);
  expect(gateways).toHaveLength(2);
  for (const place of gateways) {
    expect(place.population).toBe(demand);
    expect(place.jobs).toBe(demand);
    expect(place.connectors.map((c) => c.direction).sort()).toEqual(['in', 'out']);
  }
});

test('a clipped ramp shares its parent gateway without adding commuter demand', () => {
  const result = importOsm(
    `<osm>
    <node id="1" lat="0" lon="-0.002"/><node id="2" lat="0" lon="0"/><node id="3" lat="0" lon="0.002"/>
    <node id="4" lat="0.0001" lon="-0.002"/><node id="5" lat="0.0001" lon="0.002"/>
    <node id="6" lat="-0.0001" lon="-0.002"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="trunk"/>
      <tag k="oneway" v="yes"/><tag k="name" v="Ring"/><tag k="lanes" v="2"/></way>
    <way id="11"><nd ref="5"/><nd ref="4"/><tag k="highway" v="trunk"/>
      <tag k="oneway" v="yes"/><tag k="name" v="Ring"/><tag k="lanes" v="2"/></way>
    <way id="12"><nd ref="6"/><nd ref="2"/><tag k="highway" v="trunk_link"/><tag k="oneway" v="yes"/></way>
  </osm>`,
    { importerVersion: 'test', bbox: [-0.001, -0.001, 0.001, 0.001] },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const gateways = Object.values(result.city.places);
  expect(gateways).toHaveLength(2);
  expect(gateways.reduce((sum, p) => sum + p.population, 0)).toBe(1200);
  expect(
    gateways
      .flatMap((p) => p.connectors)
      .some((c) => result.city.roads[c.roadId]!.roadClass === 'ramp'),
  ).toBe(true);
});
