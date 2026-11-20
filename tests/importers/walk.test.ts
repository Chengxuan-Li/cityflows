import { expect, test } from 'vitest';
import type { Vec2 } from '../../src/geo/vec2';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import { crossingStripes } from '../../src/render/marking-geometry';
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

// TASK-239 (TASK-224 D1): crossings mapped only as a node of a road. An east-west street with
// sidewalks on both sides through node 7; `tags` are node 7's, `extra` more OSM elements.
const street = (tags: string, extra = '', crossingAt = 11.003) =>
  `<osm><bounds minlat="48" minlon="11" maxlat="48.01" maxlon="11.01"/>
<node id="1" lat="48.001" lon="11.001"/><node id="2" lat="48.001" lon="11.005"/>
<node id="7" lat="48.001" lon="${crossingAt}">${tags}</node>${extra}
<way id="10"><nd ref="1"/><nd ref="7"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="sidewalk" v="both"/></way>
</osm>`;
const tag = (k: string, v: string) => `<tag k="${k}" v="${v}"/>`;
const zebra =
  tag('highway', 'crossing') + tag('crossing', 'uncontrolled') + tag('crossing_ref', 'zebra');
const imported = (xml: string) => {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.city;
};
/** Walk links made from node 7. */
const nodeLinks = (city: ReturnType<typeof imported>) =>
  Object.values(city.walk!.links).filter(
    (l) => l.kind === 'crossing' && l.provenance.osmIds?.[0] === 7,
  );
const idNumber = (id: string) => Number(id.slice(id.indexOf(':') + 1));

test('TASK-239: a marked crossing node on no mapped way crosses the street, with the last ids', () => {
  const plain = imported(street(''));
  const city = imported(street(zebra));
  const [link, ...more] = nodeLinks(city);
  expect(more).toEqual([]);
  expect(link).toMatchObject({ kind: 'crossing', layer: 0, widthM: null });
  // Square to the street, through the node, 1.5 m beyond both outer lane edges.
  const [a, b] = link!.line as [Vec2, Vec2];
  const node = Object.values(city.nodes).find((n) => n.provenance.osmIds?.[0] === 7)?.pos ?? {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
  expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6);
  const width = Object.values(city.roads)
    .filter((r) => r.provenance.osmIds?.includes(10))
    .reduce((sum, r) => sum + r.lanes.reduce((s, lane) => s + lane.widthM, 0), 0);
  expect(Math.abs(b.y - a.y)).toBeCloseTo(width + 3, 6);
  expect(Math.abs(a.x - node.x)).toBeLessThan(0.5);
  // Allocated after every other id: the rest of the city is the import without the tags.
  const walk = city.walk!;
  for (const id of [link!.id, link!.from, link!.to])
    expect(idNumber(id)).toBeGreaterThanOrEqual(plain.nextId);
  const { [link!.id]: _link, ...links } = walk.links;
  const { [link!.from]: _from, [link!.to]: _to, ...nodes } = walk.nodes;
  expect({ ...city, nextId: 0, walk: { nodes, links } }).toEqual({ ...plain, nextId: 0 });
});

test('TASK-239: the compiled walk graph takes a node crossing as a zebra, joined to both sidewalks', () => {
  const city = imported(street(zebra));
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { walk, lanes, roads } = result.compiled;
  const link = walk.links.filter((l) => l.id.startsWith(`${nodeLinks(city)[0]!.id}/`));
  const crossing = link.find((l) => l.crossing)!.crossing!;
  expect(crossing.control).toBe('zebra');
  expect(crossing.end).toBe('midblock');
  // Over both lanes of the street, so cars yield to its walkers.
  expect(link.flatMap((l) => l.crossing!.spans.map((s) => lanes[s.lane]!.road)).sort()).toEqual(
    roads.map((r) => r.idx).sort(),
  );
  const ends = [link[0]!.from, link.at(-1)!.to];
  for (const end of ends) expect(walk.nodes[end]!.links.length).toBeGreaterThan(1);
  // And the renderer paints its stripes there (TASK-217's mapped midblock paint).
  const at = walk.nodes[ends[0]!]!.pos;
  const paint = roads.flatMap((r) =>
    [false, true].flatMap((atEnd) => crossingStripes(result.compiled, r, atEnd, city)),
  );
  expect(paint.filter((s) => Math.abs(s[0]!.x - at.x) < 3).length).toBeGreaterThanOrEqual(4);
});

test.each([
  ['unmarked', tag('highway', 'crossing') + tag('crossing', 'unmarked')],
  ['untagged', tag('highway', 'crossing')],
  ['no markings', tag('highway', 'crossing') + tag('crossing:markings', 'no')],
  ['not a crossing', tag('highway', 'traffic_signals') + tag('crossing', 'no')],
])('TASK-239: a %s crossing node gets no link', (_, tags) => {
  expect(nodeLinks(imported(street(tags)))).toEqual([]);
});

test.each([
  ['footway', 'footway'],
  ['cycle track', 'cycleway'],
])("TASK-239: a crossing node on a %s is that way's crossing, not a node crossing", (_, kind) => {
  const way = `<node id="3" lat="48.0005" lon="11.003"/><node id="4" lat="48.0015" lon="11.003"/><way id="20"><nd ref="3"/><nd ref="7"/><nd ref="4"/><tag k="highway" v="${kind}"/></way>`;
  const city = imported(street(zebra, way));
  expect(
    Object.values(city.walk!.links).filter(
      (l) => l.kind === 'crossing' && l.provenance.osmIds?.[0] === 7,
    ),
  ).toEqual([]);
});

test('TASK-239: a signalised crossing node needs a signal the import kept within 12 m', () => {
  // A side street north from node 9, a signalised junction; the crossing 7.4 m or 37 m east.
  const junction = `<node id="9" lat="48.001" lon="11.002">${tag('highway', 'traffic_signals')}</node><node id="3" lat="48.003" lon="11.002"/><way id="11"><nd ref="9"/><nd ref="3"/><tag k="highway" v="residential"/></way>`;
  const signalled = tag('highway', 'crossing') + tag('crossing', 'traffic_signals');
  const xml = (at: number) =>
    street(signalled, junction, at).replace(
      '<nd ref="1"/><nd ref="7"/>',
      '<nd ref="1"/><nd ref="9"/><nd ref="7"/>',
    );
  expect(nodeLinks(imported(xml(11.0021)))).toHaveLength(1);
  expect(nodeLinks(imported(xml(11.0025)))).toEqual([]);
  // A pedestrian signal the import keeps as the junction's: its default crossings stand for it.
  const kept = imported(
    xml(11.0025).replace(
      tag('highway', 'traffic_signals'),
      signalled.replace('crossing"', 'traffic_signals"'),
    ),
  );
  expect(Object.values(kept.walk!.links).filter((l) => l.provenance.osmIds?.[0] === 9)).toEqual([]);
});

test('TASK-239: a node crossing ends on a mapped footway within 8 m of the lane edge', () => {
  // A footway 7.8 m north of the street's centreline, along it.
  const footway = `<node id="3" lat="48.00107" lon="11.002"/><node id="4" lat="48.00107" lon="11.004"/><way id="20"><nd ref="3"/><nd ref="4"/><tag k="highway" v="footway"/></way>`;
  const city = imported(street(zebra, footway));
  const [link] = nodeLinks(city);
  const north = link!.line.reduce((a, b) => (b.y < a.y ? b : a));
  const way = Object.values(city.walk!.links).find((l) => l.provenance.osmIds?.[0] === 20)!;
  expect(Math.abs(north.y - way.line[0]!.y)).toBeLessThan(1e-6);
  // The other side has no footway: 1.5 m beyond the lane edge, as without one.
  const plain = nodeLinks(imported(street(zebra)))[0]!;
  const south = (line: Vec2[]) => line.reduce((a, b) => (b.y > a.y ? b : a));
  expect(south(link!.line)).toEqual(south(plain.line));
});
