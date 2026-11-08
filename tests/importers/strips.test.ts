import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';

function street(tags = '') {
  return `<osm version="0.6"><bounds minlat="0" minlon="0" maxlat="0.002" maxlon="0.004"/>
    <node id="1" lat="0.001" lon="0.0002"/><node id="2" lat="0.001" lon="0.0038"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/>${tags}</way></osm>`;
}

test.each([
  ['', ['parallel', 'parallel'], true],
  [
    '<tag k="parking:right" v="lane"/><tag k="parking:right:orientation" v="diagonal"/><tag k="parking:left" v="no"/>',
    ['angled'],
    false,
  ],
  [
    '<tag k="oneway" v="-1"/><tag k="parking:lane:left" v="perpendicular"/><tag k="parking:lane:right" v="no"/>',
    ['perpendicular'],
    false,
  ],
] as const)(
  'T52 imports curb sides in directed-road coordinates: %s',
  (tags, layouts, inferred) => {
    const imported = importOsm(street(tags), {
      importerVersion: 'test',
      context: false,
      terrain: false,
    });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const strips = Object.values(imported.city.parking ?? {}).filter((p) => p.kind === 'roadside');
    expect(strips.map((p) => p.strip!.layout).sort()).toEqual([...layouts].sort());
    expect(strips.every((p) => p.strip!.side === 'right')).toBe(true);
    expect(strips.every((p) => !!p.provenance.inferred?.includes('strip') === inferred)).toBe(true);
    expect(strips.every((p) => p.capacity > 0)).toBe(true);
    const result = compile(imported.city);
    if (!result.ok) throw new Error('compile');
    expect(result.compiled.parkingSpaces!.length).toBe(
      strips.reduce((sum, p) => sum + p.capacity, 0),
    );
  },
);

test.each([
  '<tag k="bridge" v="yes"/>',
  '<tag k="tunnel" v="yes"/>',
  '<tag k="covered" v="yes"/>',
  '<tag k="parking:both" v="no_stopping"/>',
  '<tag k="busway" v="lane"/>',
])('T52 no inferred parking on restricted streets: %s', (tags) => {
  const imported = importOsm(street(tags), {
    importerVersion: 'test',
    context: false,
    terrain: false,
  });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  expect(
    Object.values(imported.city.parking ?? {}).filter((p) => p.kind === 'roadside'),
  ).toHaveLength(0);
});
