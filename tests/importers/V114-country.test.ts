import { importOsmCached } from '../../bench/city-cache';
import { geographicMarkingTheme } from '../../src/schema/marking-theme';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';

test('V114: downtown and suburb import with US markings', () => {
  for (const name of ['downtown', 'suburb']) {
    const result = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: '1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.city.markingTheme).toBe('us');
  }
});

test.each([
  ['GB', 'uk'],
  ['DE', 'de'],
  ['CA', 'us'],
  ['IE', 'uk'],
] as const)('V114: explicit country %s overrides geographic bounds', (country, theme) => {
  const xml = `<osm version="0.6"><node id="1" lat="39.945" lon="-75.171"/><node id="2" lat="39.947" lon="-75.168"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way></osm>`;
  const tagged = xml.replace(
    '</osm>',
    `<relation id="999999999"><tag k="addr:country" v="${country}"/></relation></osm>`,
  );
  const result = importOsm(tagged, { importerVersion: '1' });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.city.markingTheme).toBe(theme);
});

test('V114: offline bounds cover Canada including Newfoundland and the high Arctic', () => {
  for (const bbox of [
    [-53, 47, -52, 48],
    [-86, 79, -85, 80],
  ] as [number, number, number, number][]) {
    const geo = {
      origin: { lon: bbox[0], lat: bbox[1] },
      scale: 1,
      bbox,
      source: {
        kind: 'osm' as const,
        snapshotDate: null,
        attribution: 'OSM',
        importerVersion: '1',
        inferredCount: 0,
      },
    };
    expect(geographicMarkingTheme(geo)).toBe('us');
  }
});
