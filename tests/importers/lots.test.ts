import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';

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
