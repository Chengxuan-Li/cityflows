import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';

// TASK-198: a polygon import clips at the ring. An entry road (tertiary or above) is cut where
// it crosses the ring; a minor road crossing it goes back to its junction; a piece the ring
// leaves apart from the network is dropped.
const osm = `<osm>
  <node id="1" lat="0" lon="-0.003"/><node id="2" lat="0" lon="0"/><node id="3" lat="0" lon="0.003"/>
  <node id="4" lat="0.0005" lon="0"/><node id="5" lat="0.0005" lon="0.0006"/>
  <node id="6" lat="0.003" lon="0.0006"/>
  <node id="7" lat="-0.0005" lon="0"/>
  <node id="8" lat="0.0009" lon="0.0004"/><node id="9" lat="0.0011" lon="0.0006"/>
  <node id="10" lat="0.0009" lon="0.0008"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="name" v="Main"/></way>
  <way id="11"><nd ref="7"/><nd ref="2"/><nd ref="4"/><tag k="highway" v="residential"/><tag k="name" v="Inner"/></way>
  <way id="12"><nd ref="4"/><nd ref="5"/><nd ref="6"/><tag k="highway" v="residential"/><tag k="name" v="Out"/></way>
  <way id="13"><nd ref="8"/><nd ref="9"/><nd ref="10"/><tag k="highway" v="primary"/><tag k="name" v="Corner"/></way>
</osm>`;
// A square whose top edge is notched: the Corner road leaves the ring and comes back.
const polygon: [number, number][] = [
  [-0.001, -0.001],
  [0.001, -0.001],
  [0.001, 0.001],
  [0.0006, 0.001],
  [0.0006, 0.0008],
  [0.0005, 0.001],
  [-0.001, 0.001],
];

test('a polygon import cuts entries at the ring, trims minor crossings and drops fragments', () => {
  const result = importOsm(osm, { importerVersion: 'test', polygon });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { city } = result;
  expect(city.geo!.bbox).toEqual([-0.001, -0.001, 0.001, 0.001]);
  expect(city.geo!.boundary).toEqual(polygon);
  const ways = (name: string) => Object.values(city.roads).filter((r) => r.name === name);
  // Main (two pieces, both ways) crosses the ring twice and keeps both entries; Out, a minor
  // road, is gone back to Inner, which still runs inside; Corner's two pieces beside the notch
  // are apart from the network and dropped.
  expect(ways('Main')).toHaveLength(4);
  expect(ways('Out')).toHaveLength(0);
  expect(ways('Corner')).toHaveLength(0);
  expect(ways('Inner').length).toBeGreaterThan(0);
  const xs = Object.values(city.roads).flatMap((r) => r.centerline.map((p) => p.x));
  expect(Math.min(...xs)).toBeCloseTo(-111.3, 0);
  expect(Math.max(...xs)).toBeCloseTo(111.3, 0);
  const gateways = Object.values(city.places).filter((p) => p.kind === 'gateway');
  expect(gateways).toHaveLength(2);
  const compiled = compile(city);
  expect(compiled.diagnostics.filter((d) => d.code === 'disconnected_component')).toEqual([]);
  expect(result.diagnostics.map((d) => d.code)).toContain('osm_polygon_pruned');
});

test('a polygon import rejects a ring of fewer than three points', () => {
  const result = importOsm(osm, {
    importerVersion: 'test',
    polygon: [
      [0, 0],
      [0.001, 0],
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.diagnostics.at(-1)!.code).toBe('osm_invalid_bbox');
});
