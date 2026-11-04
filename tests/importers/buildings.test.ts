import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';

const road = `<node id="1" lat="0" lon="-0.001"/><node id="2" lat="0" lon="0.002"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>`;

function rectangle(id: number, x: number, y: number, width: number, height: number, tags: string) {
  return (
    [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ]
      .map(([lon, lat], i) => `<node id="${id + i}" lon="${lon}" lat="${lat}"/>`)
      .join('') +
    `<way id="${id}">${[0, 1, 2, 3, 0].map((i) => `<nd ref="${id + i}"/>`).join('')}${tags}</way>`
  );
}

function load(features: string) {
  const result = importOsm(`<osm>${road}${features}</osm>`, {
    importerVersion: 'test',
    bbox: [-0.001, -0.001, 0.002, 0.002],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return Object.values(result.city.places);
}

test('aggregates neighboring footprints using tagged levels and a four-floor apartment default', () => {
  const places = load(
    rectangle(20, 0, 0.00005, 0.0008, 0.0003, '<tag k="landuse" v="residential"/>') +
      rectangle(
        30,
        0.0001,
        0.0001,
        0.0002,
        0.0001,
        '<tag k="building" v="apartments"/><tag k="building:levels" v="2"/>',
      ) +
      rectangle(40, 0.0004, 0.0001, 0.0002, 0.0001, '<tag k="building" v="apartments"/>'),
  );
  const homes = places.filter((p) => p.kind === 'residential');
  expect(homes).toHaveLength(1);
  // Each footprint is 247.84 m²: six floors in total / 45 m² per resident.
  expect(homes[0]!.population).toBe(33);
  expect(homes[0]!.jobs).toBe(0);
  expect(homes[0]!.provenance.osmIds).toEqual([30, 40]);
  expect(homes[0]!.provenance.inferred).toContain('building:levels');
  expect(homes[0]!.connectors).toHaveLength(1);
});

test('unbuilt commercial land use uses 35% coverage, four floors and 35 m² per job', () => {
  const places = load(
    rectangle(20, 0.0001, 0.0001, 0.0004, 0.0002, '<tag k="landuse" v="commercial"/>'),
  );
  const work = places.filter((p) => p.kind === 'work');
  expect(work).toHaveLength(1);
  expect(work[0]!.jobs).toBe(40);
  expect(work[0]!.population).toBe(0);
});

test('multipolygon courtyards are excluded from floor area and member ways are not counted twice', () => {
  const places = load(
    rectangle(20, 0.0001, 0.0001, 0.0004, 0.0002, '') +
      rectangle(30, 0.0002, 0.00015, 0.0002, 0.0001, '') +
      `<relation id="40"><member type="way" ref="20" role="outer"/><member type="way" ref="30" role="inner"/>
      <tag k="type" v="multipolygon"/><tag k="building" v="apartments"/></relation>`,
  );
  const homes = places.filter((p) => p.kind === 'residential');
  expect(homes).toHaveLength(1);
  expect(homes[0]!.population).toBe(66);
  expect(homes[0]!.provenance.osmIds).toEqual([40]);
});
