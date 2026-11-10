import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { importRail } from '../../src/importers/osm/rail';
import { parseOsm } from '../../src/importers/osm/parse';
import { compile } from '../../src/network';
import { saveProject } from '../../src/project/save';
import { openProject } from '../../src/project/open';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { scenarioSchema } from '../../src/schema';

test('T62 a station with a mapped point platform and no door gets usable shape access', () => {
  const { city, node, road, place } = buildCity('Point platform', 1);
  road(node(-100, 30), node(100, 30));
  place('Central', 'station', { x: 0, y: 0 }, []);
  const data = parseOsm(
    '<osm><node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="0"/><node id="3" lat="0" lon="0"><tag k="public_transport" v="platform"/><tag k="train" v="yes"/><tag k="name" v="Central"/></node><way id="10"><nd ref="1"/><nd ref="2"/><tag k="railway" v="rail"/></way></osm>',
  );
  if (typeof data === 'string') throw Error(data);
  importRail(
    city,
    data,
    new Map([
      [1, { x: -50, y: 5 }],
      [2, { x: 50, y: 5 }],
      [3, { x: 0, y: 0 }],
    ]),
    { min: { x: -200, y: -200 }, max: { x: 200, y: 200 } },
    [],
  );
  const result = compile(city);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  const station = Object.values(city.places)[0]!;
  expect(result.compiled.walk.places.get(station.id)?.length ?? 0).toBeGreaterThan(0);
});

test('T62 degenerate railway sections do not leave orphan nodes or abort a road import', () => {
  const { city } = buildCity('Degenerate rail', 1);
  const data = parseOsm(
    '<osm><node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="0"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="railway" v="rail"/></way></osm>',
  );
  if (typeof data === 'string') throw Error(data);
  const diagnostics: import('../../src/network').Diagnostic[] = [];
  importRail(
    city,
    data,
    new Map([
      [1, { x: 0, y: 0 }],
      [2, { x: 0.001, y: 0 }],
    ]),
    { min: { x: -10, y: -10 }, max: { x: 10, y: 10 } },
    diagnostics,
  );
  expect(city.rail).toEqual({ nodes: {}, tracks: {}, platforms: {} });
  expect(diagnostics.some((d) => d.code === 'osm_rail_incomplete')).toBe(true);
});

test('T62 an untagged shared bridge endpoint meets its ground continuation', () => {
  const { city } = buildCity('Rail bridge', 1);
  const data = parseOsm(
    '<osm><node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="0"/><node id="3" lat="0" lon="0"/><way id="10"><nd ref="1"/><nd ref="2"/><tag k="railway" v="rail"/><tag k="bridge" v="yes"/><tag k="layer" v="1"/></way><way id="11"><nd ref="2"/><nd ref="3"/><tag k="railway" v="rail"/></way></osm>',
  );
  if (typeof data === 'string') throw Error(data);
  importRail(
    city,
    data,
    new Map([
      [1, { x: -100, y: 0 }],
      [2, { x: 0, y: 0 }],
      [3, { x: 100, y: 0 }],
    ]),
    { min: { x: -200, y: -200 }, max: { x: 200, y: 200 } },
    [],
  );
  expect(Object.values(city.rail!.nodes).find((n) => n.osmId === 2)!.layer).toBe(0);
  expect(Object.values(city.rail!.nodes).find((n) => n.osmId === 1)!.layer).toBe(1);
});

test.each([20, 100])(
  'T62 platform serves both adjacent tracks of extent %s, station excludes bus platforms and its doors reach the street',
  async (extent) => {
    const { city, node, road, place } = buildCity('Station rail', 1);
    road(node(-100, 30), node(100, 30));
    place('Central', 'station', { x: 0, y: 0 }, []);
    const station = Object.values(city.places)[0]!;
    const data = parseOsm(`<osm version="0.6">
    <node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="0"/>
    <node id="3" lat="0" lon="0"/><node id="4" lat="0" lon="0"/>
    <node id="5" lat="0" lon="0"/><node id="6" lat="0" lon="0"/>
    <node id="7" lat="0" lon="0"/><node id="8" lat="0" lon="0"/>
    <node id="9" lat="0" lon="0"><tag k="public_transport" v="entrance"/></node>
    <node id="14" lat="0" lon="0"><tag k="public_transport" v="platform"/><tag k="bus" v="yes"/></node>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="railway" v="rail"/></way>
    <way id="11"><nd ref="3"/><nd ref="4"/><tag k="railway" v="rail"/></way>
    <way id="12"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><nd ref="5"/><tag k="railway" v="platform"/><tag k="name" v="Central"/></way>
    <way id="13"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><nd ref="5"/><tag k="public_transport" v="platform"/><tag k="bus" v="yes"/><tag k="name" v="Central"/></way>
  </osm>`);
    if (typeof data === 'string') throw Error(data);
    const positions = new Map([
      [1, { x: -extent, y: -5 }],
      [2, { x: extent, y: -5 }],
      [3, { x: -extent, y: 5 }],
      [4, { x: extent, y: 5 }],
      [5, { x: -40, y: -3 }],
      [6, { x: 40, y: -3 }],
      [7, { x: 40, y: 3 }],
      [8, { x: -40, y: 3 }],
      [9, { x: 0, y: 20 }],
      [14, { x: 80, y: 25 }],
    ]);
    importRail(city, data, positions, { min: { x: -200, y: -200 }, max: { x: 200, y: 200 } }, []);
    const platforms = Object.values(city.rail!.platforms);
    expect(
      platforms.some((p) => p.shape.kind === 'point' && p.osmId === 14 && p.mode === 'bus'),
    ).toBe(true);
    expect(platforms.find((p) => p.mode === 'rail')!.tracks).toHaveLength(2);
    expect(platforms.find((p) => p.mode === 'bus')!.station).toBeNull();
    expect(station.station!.platforms).toHaveLength(1);
    expect(station.station!.entrances).toHaveLength(1);
    expect(station.shape.kind).toBe('polygon');
    const result = compile(city);
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    const door = result.compiled.walk.sourceNodes.get(station.station!.entrances[0]!)!;
    expect(result.compiled.walk.nodes[door]!.links.length).toBeGreaterThan(0);
    const opened = await openProject(
      await saveProject({ city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] }),
    );
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.project.city.rail).toEqual(city.rail);
  },
);
