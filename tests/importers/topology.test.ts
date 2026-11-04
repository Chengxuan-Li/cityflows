import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';

test('joins equal short sections at a degree-two way boundary', () => {
  const result = importOsm(
    `<osm>
    <node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="0.0001"/>
    <node id="3" lat="0" lon="0.001"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
    <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/></way>
  </osm>`,
    { importerVersion: 'test' },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(Object.values(result.city.roads)).toHaveLength(2);
  expect(Object.values(result.city.nodes)).toHaveLength(2);
  expect(result.diagnostics.some((d) => d.code === 'road_too_short')).toBe(false);
  for (const road of Object.values(result.city.roads)) {
    expect(road.provenance.osmIds).toEqual([10, 11]);
    expect(road.centerline).toHaveLength(3);
  }
});

test('a one-lane approach can turn into every lane in the matching direction', () => {
  const result = importOsm(
    `<osm>
    <node id="1" lat="-0.001" lon="0"/><node id="2" lat="0" lon="0"/>
    <node id="3" lat="0" lon="0.001"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
    <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/>
      <tag k="oneway" v="yes"/><tag k="lanes" v="3"/></way>
  </osm>`,
    { importerVersion: 'test' },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compiled = compile(result.city);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const turns = compiled.compiled.movements.filter((m) => m.turn === 'right');
  expect(turns.map((m) => compiled.compiled.lanes[m.toLane]!.lane)).toEqual([0, 1, 2]);
});

test('a feeder reaches both directions across a divided surface street', () => {
  const result = importOsm(
    `<osm>
    <node id="1" lat="0" lon="-0.001"/><node id="2" lat="0" lon="0"/>
    <node id="3" lat="0" lon="0.001"/><node id="4" lat="0.00012" lon="-0.001"/>
    <node id="5" lat="0.00012" lon="0.001"/><node id="6" lat="-0.001" lon="0"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/>
      <tag k="name" v="Main"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="lanes" v="3"/></way>
    <way id="11"><nd ref="5"/><nd ref="4"/>
      <tag k="name" v="Main"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="lanes" v="3"/></way>
    <way id="12"><nd ref="6"/><nd ref="2"/><tag k="highway" v="residential"/></way>
  </osm>`,
    { importerVersion: 'test' },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compilation = compile(result.city);
  if (!compilation.ok) throw new Error(JSON.stringify(compilation.diagnostics));
  const c = compilation.compiled;
  for (const way of [10, 11]) {
    const targets = c.movements.filter((m) => {
      const from = result.city.roads[c.roads[c.lanes[m.fromLane]!.road]!.id]!;
      const to = result.city.roads[c.roads[c.lanes[m.toLane]!.road]!.id]!;
      return from.provenance.osmIds?.includes(12) && to.provenance.osmIds?.includes(way);
    });
    expect(new Set(targets.map((m) => c.lanes[m.toLane]!.lane))).toEqual(new Set([0, 1, 2]));
  }
});

test('local cul-de-sacs get an inferred turnaround, motorway ends do not', () => {
  for (const highway of ['residential', 'motorway']) {
    const result = importOsm(
      `<osm>
      <node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="0.001"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="${highway}"/></way>
    </osm>`,
      { importerVersion: 'test' },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const rules = Object.values(result.city.nodes).flatMap((n) => n.turnRules);
    expect(rules.some((r) => r.provenance.inferred?.includes('localTurnaround'))).toBe(
      highway === 'residential',
    );
  }
});

test('through arrows align within their lane group after dedicated left-turn lanes', () => {
  const result = importOsm(
    `<osm>
    <node id="1" lat="0" lon="-0.001"/><node id="2" lat="0" lon="0"><tag k="highway" v="traffic_signals"/></node>
    <node id="3" lat="0" lon="0.001"/><node id="4" lat="0.001" lon="0"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/>
      <tag k="lanes" v="4"/><tag k="turn:lanes" v="left|left|through|through"/></way>
    <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="lanes" v="2"/></way>
    <way id="12"><nd ref="2"/><nd ref="4"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="lanes" v="2"/></way>
  </osm>`,
    { importerVersion: 'test' },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const compilation = compile(result.city);
  if (!compilation.ok) throw new Error(JSON.stringify(compilation.diagnostics));
  const c = compilation.compiled;
  expect(
    c.movements
      .filter((m) => m.turn === 'through')
      .map((m) => [c.lanes[m.fromLane]!.lane, c.lanes[m.toLane]!.lane, m.neverGreen]),
  ).toEqual([
    [2, 0, false],
    [3, 1, false],
  ]);
});

test('short-section consolidation retains mapped stop and yield controls', () => {
  for (const highway of ['stop', 'give_way']) {
    const result = importOsm(
      `<osm>
      <node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="0.0001"><tag k="highway" v="${highway}"/></node>
      <node id="3" lat="0" lon="0.001"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/></way>
    </osm>`,
      { importerVersion: 'test' },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(
      Object.values(result.city.nodes).find((n) => n.provenance.osmIds?.includes(2))?.control,
    ).toBe(highway === 'stop' ? 'stop' : 'yield');
  }
});
