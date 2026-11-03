import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';

const options = { importerVersion: 'test' };
const road = `<osm>
  <node id="1" lat="0" lon="-0.002"/><node id="2" lat="0" lon="0.002"/>
  <way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/>
    <tag k="maxspeed" v="25 mph"/></way>
</osm>`;

test('T18 rejects malformed XML and extracts without drivable ways', () => {
  expect(importOsm('<osm><way></osm>', options)).toMatchObject({
    ok: false,
    diagnostics: [{ severity: 'error', code: 'osm_parse_error' }],
  });
  expect(importOsm(road + '<extra/>', options)).toMatchObject({
    ok: false,
    diagnostics: [{ severity: 'error', code: 'osm_parse_error' }],
  });
  expect(importOsm('<osm/>', options)).toMatchObject({
    ok: false,
    diagnostics: [{ severity: 'error', code: 'osm_no_drivable_ways' }],
  });
});

test('T18 reports inferred lane counts and maps both cut ends to directional gateways', () => {
  const result = importOsm(road, { ...options, bbox: [-0.001, -0.001, 0.001, 0.001] });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const roads = Object.values(result.city.roads);
  expect(roads).toHaveLength(2);
  for (const road of roads) {
    expect(road.provenance.inferred).toContain('lanes');
    expect(road.speedLimitMps).toBeCloseTo(11.176);
  }
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'inferred_attributes',
        refs: expect.arrayContaining(roads.map(({ id }) => id)),
      }),
      expect.objectContaining({
        code: 'osm_inferred_lanes',
        message: 'Inferred lane counts on 2 roads',
      }),
      expect.objectContaining({ code: 'osm_clipped' }),
    ]),
  );
  const gateways = Object.values(result.city.places);
  expect(gateways).toHaveLength(2);
  for (const gateway of gateways) {
    expect(gateway.kind).toBe('gateway');
    expect(gateway.shape.kind).toBe('point');
    if (gateway.shape.kind !== 'point') throw new Error('Expected point gateway');
    expect(gateway.connectors.map(({ direction }) => direction).sort()).toEqual(['in', 'out']);
    for (const connector of gateway.connectors) {
      const road = result.city.roads[connector.roadId]!;
      const end = connector.direction === 'out' ? road.from : road.to;
      expect(result.city.nodes[end]!.pos).toEqual(gateway.shape.pos);
      if (connector.direction === 'out') expect(connector.positionM).toBe(5);
    }
  }
});

test.each([false, true])(
  'T18 retains a gateway at an exact bbox junction (separate ways: %s)',
  (split) => {
    let xml = road
      .replace(
        '<way id="3">',
        '<node id="4" lat="0" lon="-0.001"><tag k="highway" v="give_way"/></node><way id="3">',
      )
      .replace('<nd ref="1"/>', '<nd ref="1"/><nd ref="4"/>');
    if (split) {
      xml = xml.replace('<nd ref="1"/><nd ref="4"/>', '<nd ref="4"/>').replace(
        '</osm>',
        `
      <way id="5"><nd ref="1"/><nd ref="4"/><tag k="highway" v="residential"/></way>
    </osm>`,
      );
    }
    const result = importOsm(xml, { ...options, bbox: [-0.001, -0.001, 0.003, 0.001] });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const [gateway] = Object.values(result.city.places);
    expect(gateway?.connectors.map(({ direction }) => direction).sort()).toEqual(['in', 'out']);
    expect(
      Object.values(result.city.nodes).find(({ provenance }) => provenance.osmIds?.includes(4))
        ?.control,
    ).toBe('yield');
  },
);

test('T18 warns about unsupported speeds and preserves disconnected roads', () => {
  const xml = road.replace('25 mph', 'walk').replace(
    '</osm>',
    `
    <node id="4" lat="0.001" lon="-0.002"/><node id="5" lat="0.001" lon="0.002"/>
    <way id="6"><nd ref="4"/><nd ref="5"/><tag k="highway" v="residential"/></way>
  </osm>`,
  );
  const result = importOsm(xml, options);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(Object.values(result.city.roads)).toHaveLength(4);
  expect(result.diagnostics.map(({ code }) => code)).toEqual(
    expect.arrayContaining([
      'osm_unsupported_tag',
      'osm_inferred_speeds',
      'disconnected_component',
    ]),
  );
  const count = result.city.geo!.source.inferredCount;
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'inferred_attributes',
        message: `Inferred ${count} attributes on imported entities`,
      }),
    ]),
  );
});
