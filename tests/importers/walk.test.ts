import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { buildQuery } from '../../src/importers/overpass';
import { citySchema } from '../../src/schema';

const xml = `<osm><bounds minlat="48" minlon="11" maxlat="48.01" maxlon="11.01"/>
<node id="1" lat="48.001" lon="11.001"/><node id="2" lat="48.009" lon="11.001"/>
<node id="3" lat="48.001" lon="11.002"><tag k="entrance" v="main"/></node>
<node id="4" lat="48.002" lon="11.002"/><node id="5" lat="48.002" lon="11.003"/>
<node id="6" lat="48.001" lon="11.003"/>
<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="sidewalk" v="left"/><tag k="sidewalk:right" v="separate"/></way>
<way id="11"><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/><nd ref="3"/><tag k="building" v="house"/></way>
${['footway', 'pedestrian', 'path', 'steps', 'living_street'].map((kind, i) => `<way id="${20 + i}"><nd ref="3"/><nd ref="4"/><tag k="highway" v="${kind}"/><tag k="width" v="1.8"/><tag k="layer" v="1"/></way>`).join('')}
<way id="30"><nd ref="1"/><nd ref="3"/><tag k="highway" v="footway"/><tag k="footway" v="crossing"/></way>
</osm>`;

test('imports pedestrian kinds, widths, grades, entrances and direction-relative sidewalk tags', () => {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { city } = result;
  expect(city.walk).toBeDefined();
  expect(
    Object.values(city.walk!.links)
      .map((link) => link.kind)
      .sort(),
  ).toEqual(['crossing', 'footway', 'living_street', 'path', 'pedestrian', 'steps']);
  expect(Object.values(city.walk!.links).find((link) => link.kind === 'steps')?.widthM).toBe(1.8);
  const entrances = Object.values(city.walk!.nodes).filter((node) => node.entrance);
  expect(entrances.length).toBeGreaterThan(0);
  expect(entrances.every((node) => node.entrance!.placeId !== null)).toBe(true);
  const roads = Object.values(city.roads).filter((road) => road.provenance.osmIds?.includes(10));
  expect(roads.map((road) => road.sidewalk)).toEqual([
    { left: 'yes', right: 'separate' },
    { left: 'separate', right: 'yes' },
  ]);
});

test('queries pedestrian ways and entrances independently of display surroundings', () => {
  const query = buildQuery([11, 48, 11.01, 48.01], false);
  expect(query).toContain('footway|pedestrian|path|steps');
  expect(query).toContain('node[entrance]');
});

test('project boundary rejects dangling walk links', () => {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error('import');
  const bad = structuredClone(result.city);
  Object.values(bad.walk!.links)[0]!.from = 'wn:999999';
  expect(citySchema.safeParse(bad).success).toBe(false);
});

test.each([false, true])(
  'an interior footbridge node retains its grade (entrance=%s)',
  (entrance) => {
    const bridge = xml.replace(
      '</osm>',
      `<node id="40" lat="48.004" lon="11.004"/><node id="41" lat="48.005" lon="11.004">${entrance ? '<tag k="entrance" v="main"/>' : ''}</node><node id="42" lat="48.006" lon="11.004"/><way id="40"><nd ref="40"/><nd ref="41"/><nd ref="42"/><tag k="highway" v="footway"/><tag k="bridge" v="yes"/></way></osm>`,
    );
    const result = importOsm(bridge, { importerVersion: 'test' });
    if (!result.ok) throw new Error('import');
    const middle = Object.values(result.city.walk!.nodes).find((n) =>
      n.provenance.osmIds?.includes(41),
    )!;
    expect(middle.layer).toBe(1);
  },
);

test('closed pedestrian ways and independently tagged crossing ways retain their walk links', () => {
  const extra = xml.replace(
    '</osm>',
    `<way id="50"><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/><nd ref="3"/><tag k="highway" v="pedestrian"/><tag k="area" v="yes"/></way><way id="51"><nd ref="1"/><nd ref="3"/><tag k="highway" v="cycleway"/><tag k="footway" v="crossing"/></way></osm>`,
  );
  const result = importOsm(extra, { importerVersion: 'test' });
  if (!result.ok) throw new Error('import');
  const links = Object.values(result.city.walk!.links);
  expect(links.filter((l) => l.provenance.osmIds?.includes(50))).toHaveLength(4);
  expect(links.find((l) => l.provenance.osmIds?.includes(51))?.kind).toBe('crossing');
});
