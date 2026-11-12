import { expect, test } from 'vitest';
import { compile } from '../../src/network';
import { importOsm } from '../../src/importers/osm';
import { openProject } from '../../src/project/open';
import { saveProject } from '../../src/project/save';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { scenarioSchema } from '../../src/schema';

export const lotXml = `<osm version="0.6">
  <bounds minlat="0" minlon="0" maxlat="0.002" maxlon="0.002"/>
  <node id="1" lat="0.001" lon="0.0001"/>
  <node id="2" lat="0.001" lon="0.0003"/>
  <node id="3" lat="0.001" lon="0.0017"/>
  <node id="4" lat="0.0008" lon="0.0003"/>
  <node id="5" lat="0.0008" lon="0.0018"/>
  <node id="6" lat="0.0012" lon="0.0018"/>
  <node id="7" lat="0.0012" lon="0.0003"/>
  <node id="8" lat="0.0018" lon="0.0001"/>
  <node id="9" lat="0.0018" lon="0.0018"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="service"/><tag k="service" v="parking_aisle"/><tag k="access" v="customers"/></way>
  <way id="12"><nd ref="4"/><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="4"/><tag k="amenity" v="parking"/><tag k="parking" v="surface"/><tag k="capacity" v="99"/><tag k="access" v="customers"/></way>
  <way id="13"><nd ref="8"/><nd ref="9"/><tag k="highway" v="service"/><tag k="service" v="parking_aisle"/></way>
  <way id="14"><nd ref="2"/><nd ref="8"/><tag k="highway" v="service"/><tag k="service" v="driveway"/></way>
</osm>`;

test('T49 imports surface facilities and only their aisles, retaining capacity, access and entries', () => {
  const result = importOsm(lotXml, { importerVersion: 'test', terrain: false });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const lots = Object.values(result.city.parking ?? {}).filter((p) => p.kind === 'lot');
  expect(lots).toHaveLength(1);
  const lot = lots[0]!;
  // TASK-124 materializes repaired aisle portals so their car exits survive save/open.
  expect(lot).toMatchObject({ kind: 'lot', capacity: 99, access: 'customers' });
  expect(lot.connectors).toHaveLength(3);
  expect(lot.connectors.map((c) => c.direction).sort()).toEqual(['both', 'in', 'out']);
  expect(lot.aisles).toHaveLength(2);
  expect(lot.entries).toHaveLength(1);
  for (const id of lot.aisles!)
    expect(result.city.roads[id]).toMatchObject({
      roadClass: 'service',
      speedLimitMps: 10 / 3.6,
      access: { all: 'private' },
    });
  expect(
    Object.values(result.city.roads).some(
      (r) => r.provenance.osmIds?.includes(13) || r.provenance.osmIds?.includes(14),
    ),
  ).toBe(false);
});

test.each(['<tag k="oneway" v="-1"/>', '<tag k="access" v="no"/>'])(
  'T52 gives an outbound-only or closed aisle a nearby inferred driveway: %s',
  (tag) => {
    const xml = lotXml.replace(
      '<tag k="service" v="parking_aisle"/><tag k="access" v="customers"/>',
      '<tag k="service" v="parking_aisle"/>' + tag,
    );
    const result = importOsm(xml, { importerVersion: 'test', terrain: false });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics.filter((d) => d.code === 'parking_unreachable')).toHaveLength(0);
    const lot = Object.values(result.city.parking ?? {}).find((p) => p.kind === 'lot')!;
    expect(lot.provenance.inferred).toContain('driveway');
    expect(lot.connectors).toHaveLength(1);
  },
);

// The public service road passes through the aisle's endpoint, rather than ending there.
const sharedInterior = lotXml
  .replace('<tag k="highway" v="residential"/>', '<tag k="highway" v="service"/>')
  .replace('<node id="1" lat="0.001" lon="0.0001"/>', '<node id="1" lat="0.0009" lon="0.0003"/>')
  .replace('<node id="9" lat="0.0018" lon="0.0018"/>', '<node id="9" lat="0.0015" lon="0.0003"/>')
  .replace(
    '<way id="10"><nd ref="1"/><nd ref="2"/>',
    '<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="9"/>',
  );

test.each([false, true])(
  'a mapped interior lot join connects the real service road (one-way aisle: %s)',
  (oneway) => {
    const xml = sharedInterior.replace(
      '<tag k="access" v="customers"/></way>',
      `${oneway ? '<tag k="oneway" v="yes"/>' : ''}<tag k="access" v="customers"/></way>`,
    );
    const imported = importOsm(xml, { importerVersion: 'test', terrain: false });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const { city } = imported;
    const join = Object.values(city.nodes).find((n) => n.provenance.osmIds?.includes(2))!;
    const publicRoads = Object.values(city.roads).filter((r) => r.provenance.osmIds?.includes(10));
    const aisles = Object.values(city.roads).filter((r) => r.provenance.osmIds?.includes(11));
    expect(publicRoads).toHaveLength(4);
    expect(publicRoads.every((r) => r.from === join.id || r.to === join.id)).toBe(true);
    expect(aisles).toHaveLength(oneway ? 1 : 2);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const { compiled } = result;
    const pairs = compiled.movements.map((m) => [
      compiled.roads[compiled.lanes[m.fromLane]!.road]!.id,
      compiled.roads[compiled.lanes[m.toLane]!.road]!.id,
    ]);
    expect(
      pairs.some(
        ([from, to]) => publicRoads.some((r) => r.id === from) && aisles.some((r) => r.id === to),
      ),
    ).toBe(true);
    if (!oneway)
      expect(
        pairs.some(
          ([from, to]) => aisles.some((r) => r.id === from) && publicRoads.some((r) => r.id === to),
        ),
      ).toBe(true);
  },
);

test('a grade-separated aisle does not gain an interior service-road join', () => {
  const xml = sharedInterior.replace(
    '<tag k="access" v="customers"/></way>',
    '<tag k="layer" v="1"/><tag k="access" v="customers"/></way>',
  );
  const imported = importOsm(xml, { importerVersion: 'test', terrain: false });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  expect(
    Object.values(imported.city.roads).filter((r) => r.provenance.osmIds?.includes(10)),
  ).toHaveLength(2);
});

test('a same-grade aisle cannot attach an overpass sibling through their shared node', () => {
  const xml = sharedInterior.replace(
    '</osm>',
    '<way id="16"><nd ref="2"/><nd ref="5"/><tag k="highway" v="service"/><tag k="service" v="parking_aisle"/><tag k="layer" v="1"/></way></osm>',
  );
  const imported = importOsm(xml, { importerVersion: 'test', terrain: false });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  expect(
    Object.values(imported.city.roads).filter((r) => r.provenance.osmIds?.includes(10)),
  ).toHaveLength(2);
});

test('a bus-only public lane cannot supply a car lot junction', () => {
  const xml = sharedInterior
    .replace(
      '<tag k="highway" v="service"/></way>',
      '<tag k="highway" v="service"/><tag k="bus:lanes:forward" v="designated"/><tag k="bus:lanes:backward" v="designated"/></way>',
    )
    .replace(
      '</osm>',
      '<way id="17"><nd ref="8"/><nd ref="9"/><tag k="highway" v="service"/></way></osm>',
    );
  const imported = importOsm(xml, { importerVersion: 'test', terrain: false });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const roads = Object.values(imported.city.roads).filter((r) => r.provenance.osmIds?.includes(10));
  expect(roads.every((r) => !r.lanes[0]!.allowed.includes('car'))).toBe(true);
  expect(roads).toHaveLength(2);
});

test('splitting a one-way service street does not create a reverse direction', () => {
  const xml = sharedInterior.replace(
    '<tag k="highway" v="service"/></way>',
    '<tag k="highway" v="service"/><tag k="oneway" v="yes"/></way>',
  );
  const imported = importOsm(xml, { importerVersion: 'test', terrain: false });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const publicRoads = Object.values(imported.city.roads).filter((r) =>
    r.provenance.osmIds?.includes(10),
  );
  expect(publicRoads).toHaveLength(2);
  const end = Object.values(imported.city.nodes).find((n) => n.provenance.osmIds?.includes(9))!;
  expect(publicRoads.some((r) => r.from === end.id)).toBe(false);
});

test('a restored lot junction leaves a real downstream restriction at its original endpoint', () => {
  const xml = sharedInterior.replace(
    '</osm>',
    `<way id="15"><nd ref="9"/><nd ref="8"/><tag k="highway" v="service"/></way>
    <relation id="20"><member type="way" ref="10" role="from"/><member type="node" ref="9" role="via"/><member type="way" ref="15" role="to"/><tag k="type" v="restriction"/><tag k="restriction" v="no_left_turn"/></relation></osm>`,
  );
  const imported = importOsm(xml, { importerVersion: 'test', terrain: false });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const node = Object.values(imported.city.nodes).find((n) => n.provenance.osmIds?.includes(9))!;
  const rule = node.turnRules.find((r) => r.provenance.osmIds?.includes(20))!;
  expect(rule).toBeDefined();
  expect(imported.city.roads[rule.from]!.to).toBe(node.id);
  expect(imported.city.roads[rule.to]!.from).toBe(node.id);
  expect(rule.allowed).toBe(false);
  const join = Object.values(imported.city.nodes).find((n) => n.provenance.osmIds?.includes(2))!;
  expect(join.turnRules.some((r) => r.provenance.osmIds?.includes(20))).toBe(false);
});

test('a shared source point inside a lot hole cannot join the public road', () => {
  const xml = sharedInterior
    .replaceAll('lon="0.0003"/>', 'lon="0.0002"/>')
    .replace('<node id="2" lat="0.001" lon="0.0002"/>', '<node id="2" lat="0.001" lon="0.0003"/>')
    .replace(
      '<tag k="amenity" v="parking"/><tag k="parking" v="surface"/><tag k="capacity" v="99"/><tag k="access" v="customers"/>',
      '',
    )
    .replace(
      '</osm>',
      `<node id="21" lat="0.00095" lon="0.00025"/><node id="22" lat="0.00095" lon="0.00035"/><node id="23" lat="0.00105" lon="0.00035"/><node id="24" lat="0.00105" lon="0.00025"/>
      <way id="18"><nd ref="21"/><nd ref="22"/><nd ref="23"/><nd ref="24"/><nd ref="21"/></way>
      <relation id="30"><member type="way" ref="12" role="outer"/><member type="way" ref="18" role="inner"/><tag k="type" v="multipolygon"/><tag k="amenity" v="parking"/><tag k="parking" v="surface"/></relation></osm>`,
    );
  const result = importOsm(xml, { importerVersion: 'test', terrain: false });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(
    Object.values(result.city.roads).filter((r) => r.provenance.osmIds?.includes(10)),
  ).toHaveLength(2);
});

test('late lot halves append to legacy ID order and survive save/open', async () => {
  const repaired = importOsm(sharedInterior, { importerVersion: 'test', terrain: false });
  const ordinary = importOsm(lotXml, { importerVersion: 'test', terrain: false });
  if (!repaired.ok || !ordinary.ok) throw new Error('Fixture import failed');
  const result = compile(repaired.city),
    legacy = compile(ordinary.city);
  if (!result.ok || !legacy.ok) throw new Error('Fixture compile failed');
  const { compiled } = result;
  expect(legacy.compiled.roads.map((r) => r.id)).toEqual(Object.keys(ordinary.city.roads).sort());
  const roads = Object.values(repaired.city.roads);
  const originalIds = roads
    .filter((r) => !r.provenance.inferred?.includes('lotJunction'))
    .map((r) => r.id)
    .sort();
  const addedIds = roads
    .filter((r) => r.provenance.inferred?.includes('lotJunction'))
    .map((r) => r.id)
    .sort();
  expect(addedIds).toHaveLength(2);
  expect(compiled.roads.map((r) => r.id)).toEqual([...originalIds, ...addedIds]);
  const opened = await openProject(
    await saveProject({
      city: repaired.city,
      scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))],
    }),
  );
  if (!opened.ok) throw new Error(opened.error);
  const reopened = compile(opened.project.city);
  if (!reopened.ok) throw new Error('Reopened fixture invalid');
  expect(reopened.compiled.roads.map((r) => r.id)).toEqual(compiled.roads.map((r) => r.id));
  expect(reopened.compiled.lanes.map((l) => l.id)).toEqual(compiled.lanes.map((l) => l.id));
});
test('refreshed directional aisle portals use car lanes without duplicate anchors', () => {
  const xml = sharedInterior.replace(
    '<tag k="service" v="parking_aisle"/><tag k="access" v="customers"/>',
    '<tag k="service" v="parking_aisle"/><tag k="lanes" v="3"/><tag k="lanes:forward" v="2"/><tag k="lanes:backward" v="1"/><tag k="bus:lanes:forward" v="designated|no"/><tag k="access" v="customers"/>',
  );
  const result = importOsm(xml, { importerVersion: 'test', terrain: false });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const lot = Object.values(result.city.parking!).find((f) => f.kind === 'lot')!;
  const anchors = lot.connectors.map((c) => `${c.roadId}#${c.lane}@${c.positionM.toFixed(6)}`);
  expect(new Set(anchors).size).toBe(anchors.length);
  for (const c of lot.connectors)
    expect(result.city.roads[c.roadId]!.lanes[c.lane]!.allowed).toContain('car');
  expect(lot.connectors.some((c) => c.lane === 1)).toBe(true);
  expect(lot.connectors.some((c) => c.direction !== 'out')).toBe(true);
  expect(lot.connectors.some((c) => c.direction !== 'in')).toBe(true);
});
