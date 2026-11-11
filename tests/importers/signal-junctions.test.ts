import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';

function load(body: string) {
  const result = importOsm(`<osm>${body}</osm>`, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.city;
}

test('two nearby mid-way signals leave no consolidated split behind', () => {
  const city = load(`
    <node id="1" lat="0" lon="-0.002"/>
    <node id="2" lat="0" lon="0"><tag k="highway" v="traffic_signals"/></node>
    <node id="3" lat="0" lon="0.0001"><tag k="highway" v="traffic_signals"/></node>
    <node id="4" lat="0" lon="0.002"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><tag k="highway" v="residential"/></way>`);
  expect(Object.values(city.nodes)).toHaveLength(2);
  expect(Object.values(city.roads)).toHaveLength(2);
  expect(Object.values(city.nodes).some((n) => n.signal)).toBe(false);
});

test('a signal moves to the junction within 60 m along the original roads', () => {
  const city = load(`
    <node id="1" lat="0" lon="-0.002"/>
    <node id="2" lat="0" lon="-0.0004"><tag k="highway" v="traffic_signals"/></node>
    <node id="3" lat="0" lon="0"/><node id="4" lat="0.0001" lon="0"/>
    <node id="5" lat="0" lon="0.00045"/><node id="6" lat="0" lon="0.002"/>
    <node id="7" lat="0.002" lon="0.00045"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="5"/><nd ref="6"/>
      <tag k="highway" v="residential"/><tag k="name" v="Main"/></way>
    <way id="11"><nd ref="3"/><nd ref="4"/><tag k="highway" v="residential"/></way>
    <way id="12"><nd ref="5"/><nd ref="7"/><tag k="highway" v="residential"/></way>`);
  // TASK-131: the 11 m stub to node 4 no longer merges node 3 away, so the T at 3, 44 m from the
  // signal, keeps it; the merge used to leave no junction within 60 m.
  const signals = Object.values(city.nodes).filter((n) => n.signal);
  expect(signals.map((n) => n.provenance.osmIds)).toEqual([[3]]);
  expect(city.junctionGroups).toBeUndefined();
});

test('a demoted control retains a split needed by a speed-limit change', () => {
  const city = load(`
    <node id="1" lat="0" lon="-0.002"/>
    <node id="2" lat="0" lon="0"><tag k="highway" v="stop"/></node>
    <node id="3" lat="0" lon="0.0002"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="name" v="Main"/><tag k="maxspeed" v="30"/></way>
    <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Main"/><tag k="maxspeed" v="50"/></way>`);
  expect(Object.values(city.nodes)).toHaveLength(3);
  expect(
    Object.values(city.roads)
      .map((r) => r.speedLimitMps)
      .sort(),
  ).toEqual([30 / 3.6, 30 / 3.6, 50 / 3.6, 50 / 3.6].sort());
  expect(Object.values(city.nodes).every((n) => n.control === 'uncontrolled')).toBe(true);
});

test.each(['traffic_signals', 'stop', 'give_way'])(
  '%s in the middle of a street does not create a junction',
  (control) => {
    const city = load(`
      <node id="1" lat="0" lon="-0.001"/>
      <node id="2" lat="0" lon="0"><tag k="highway" v="${control}"/></node>
      <node id="3" lat="0" lon="0.001"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/>
        <tag k="highway" v="residential"/><tag k="name" v="Main"/></way>`);
    expect(Object.values(city.nodes)).toHaveLength(2);
    expect(Object.values(city.nodes).every((n) => n.control === 'uncontrolled' && !n.signal)).toBe(
      true,
    );
    expect(Object.values(city.roads).every((r) => r.centerline.length === 3)).toBe(true);
  },
);

test.each(['traffic_signals', 'stop', 'give_way'])(
  '%s approaches hand control to their crossing and merge away',
  (control) => {
    const city = load(`
      <node id="1" lat="0" lon="-0.002"/>
      <node id="2" lat="0" lon="-0.0004"><tag k="highway" v="${control}"/></node>
      <node id="3" lat="0" lon="0"/>
      <node id="4" lat="0" lon="0.0004"><tag k="highway" v="${control}"/></node>
      <node id="5" lat="0" lon="0.002"/>
      <node id="6" lat="-0.002" lon="0"/><node id="7" lat="0.002" lon="0"/>
      <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/>
        <tag k="highway" v="residential"/><tag k="oneway" v="yes"/><tag k="name" v="Main"/></way>
      <way id="11"><nd ref="5"/><nd ref="4"/><nd ref="3"/>
        <tag k="highway" v="residential"/><tag k="oneway" v="yes"/><tag k="name" v="Main"/></way>
      <way id="12"><nd ref="6"/><nd ref="3"/><nd ref="7"/>
        <tag k="highway" v="residential"/><tag k="name" v="Cross"/></way>`);
    const nodes = Object.values(city.nodes);
    const junction = nodes.find((n) => n.provenance.osmIds?.includes(3))!;
    expect(nodes).toHaveLength(5);
    expect(junction.control).toBe(
      control === 'traffic_signals' ? 'signal' : control === 'stop' ? 'stop' : 'yield',
    );
    expect(junction.provenance.inferred).toEqual(
      expect.arrayContaining([
        `controlTransferred:${control}:node/2`,
        `controlTransferred:${control}:node/4`,
      ]),
    );
    expect(nodes.filter((n) => n.signal)).toHaveLength(control === 'traffic_signals' ? 1 : 0);
    if (control !== 'traffic_signals') {
      const approaches = Object.values(city.roads).filter(
        (r) => r.to === junction.id && r.name === 'Main',
      );
      expect(junction.minorRoads.sort()).toEqual(approaches.map((r) => r.id).sort());
    }
  },
);

test('a signal beyond 60 m along the road does not control a nearby crossing', () => {
  const city = load(`
    <node id="1" lat="0" lon="-0.002"/>
    <node id="2" lat="0" lon="-0.0002"><tag k="highway" v="traffic_signals"/></node>
    <node id="8" lat="0.0005" lon="-0.0002"/>
    <node id="3" lat="0" lon="0"/><node id="4" lat="0" lon="0.002"/>
    <node id="5" lat="-0.002" lon="0"/><node id="6" lat="0.002" lon="0"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="8"/><nd ref="3"/><nd ref="4"/>
      <tag k="highway" v="residential"/></way>
    <way id="11"><nd ref="5"/><nd ref="3"/><nd ref="6"/><tag k="highway" v="residential"/></way>`);
  expect(Object.values(city.nodes).filter((n) => n.signal)).toEqual([]);
});

test.each([false, true])(
  'two road sections need different streets to retain a signal (%s)',
  (different) => {
    const city = load(`
    <node id="1" lat="0" lon="-0.001"/>
    <node id="2" lat="0" lon="0"><tag k="highway" v="traffic_signals"/></node>
    <node id="3" lat="0.001" lon="0"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="name" v="Main"/></way>
    <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="${different ? 'Cross' : 'Main'}"/></way>`);
    expect(Object.values(city.nodes).filter((n) => n.signal)).toHaveLength(different ? 1 : 0);
    expect(Object.values(city.nodes)).toHaveLength(different ? 3 : 2);
  },
);

test('a reverse one-way approach transfers downstream, never to the closer upstream junction', () => {
  const city = load(`
    <node id="1" lat="0" lon="-0.002"/><node id="2" lat="0" lon="-0.0004"/>
    <node id="3" lat="0" lon="0"><tag k="highway" v="traffic_signals"/></node>
    <node id="4" lat="0" lon="0.0003"/><node id="5" lat="0" lon="0.002"/>
    <node id="6" lat="0.002" lon="-0.0004"/><node id="7" lat="-0.002" lon="0.0003"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="5"/>
      <tag k="highway" v="residential"/><tag k="oneway" v="-1"/><tag k="name" v="Main"/></way>
    <way id="11"><nd ref="2"/><nd ref="6"/><tag k="highway" v="residential"/></way>
    <way id="12"><nd ref="4"/><nd ref="7"/><tag k="highway" v="residential"/></way>`);
  const nodes = Object.values(city.nodes);
  expect(nodes.find((n) => n.provenance.osmIds?.includes(2))?.control).toBe('signal');
  expect(nodes.find((n) => n.provenance.osmIds?.includes(4))?.control).toBe('uncontrolled');
  expect(nodes.find((n) => n.provenance.osmIds?.includes(3))).toBeUndefined();
});

test('signals on both carriageway approaches make one junction group with one program', () => {
  const city = load(`
    <node id="1" lat="0" lon="-0.002"/><node id="2" lat="0" lon="-0.0001"><tag k="highway" v="traffic_signals"/></node>
    <node id="3" lat="0" lon="0"/><node id="4" lat="0" lon="0.002"/>
    <node id="5" lat="0.00015" lon="0.002"/><node id="6" lat="0.00015" lon="0.0001"><tag k="highway" v="traffic_signals"/></node>
    <node id="7" lat="0.00015" lon="0"/><node id="8" lat="0.00015" lon="-0.002"/>
    <node id="9" lat="-0.002" lon="0"/><node id="10" lat="0.002" lon="0"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><tag k="highway" v="primary"/><tag k="name" v="Main"/><tag k="oneway" v="yes"/></way>
    <way id="11"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><tag k="highway" v="primary"/><tag k="name" v="Main"/><tag k="oneway" v="yes"/></way>
    <way id="12"><nd ref="9"/><nd ref="3"/><nd ref="7"/><nd ref="10"/><tag k="highway" v="residential"/><tag k="name" v="Cross"/></way>`);
  // TASK-131: the two crossings stay nodes at their OSM positions, one signalised group.
  const groups = Object.values(city.junctionGroups ?? {});
  expect(groups).toHaveLength(1);
  expect(groups[0]!.signal).not.toBeNull();
  expect(Object.values(city.nodes).filter((n) => n.signal)).toEqual([]);
  expect(Object.values(city.nodes)).toHaveLength(8);
  const members = groups[0]!.nodes.map((id) => city.nodes[id]!);
  expect(members.map((n) => n.provenance.osmIds).sort()).toEqual([[3], [7]]);
  expect(members.every((n) => n.control === 'signal')).toBe(true);
  expect(members.flatMap((n) => n.provenance.inferred)).toEqual(
    expect.arrayContaining([
      'controlTransferred:traffic_signals:node/2',
      'controlTransferred:traffic_signals:node/6',
    ]),
  );
});
