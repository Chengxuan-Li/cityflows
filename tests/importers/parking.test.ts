import { expect, test } from 'vitest';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { pointAtDistance } from '../../src/geo/polyline';
import { lonLatToLocal } from '../../src/geo/projection';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import { openProject } from '../../src/project/open';
import { saveProject, saveProjectJson } from '../../src/project/save';
import { scenarioSchema } from '../../src/schema';

const road = `<node id="1" lat="0" lon="-0.001"/><node id="2" lat="0" lon="0.002"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>`;

function rectangle(id: number, x: number, y: number, width: number, height: number, tags = '') {
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
    context: false,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.city;
}

function explicit(city: ReturnType<typeof load>) {
  return Object.values(city.parking ?? {}).filter((p) => p.provenance.source === 'osm');
}

test('T48 imports garage ways and nodes with mapped access, capacity and capped inference', () => {
  const city = load(
    rectangle(
      20,
      0,
      0.0001,
      0.0002,
      0.0001,
      '<tag k="amenity" v="parking"/><tag k="parking" v="underground"/><tag k="capacity" v="42"/>',
    ) +
      rectangle(
        30,
        0.0003,
        0.0001,
        0.0002,
        0.0001,
        '<tag k="building" v="parking"/><tag k="parking:levels" v="3"/><tag k="access" v="customers"/>',
      ) +
      rectangle(
        40,
        0.0006,
        0.0001,
        0.0002,
        0.0001,
        '<tag k="building" v="garages"/><tag k="building:levels" v="10000"/>',
      ) +
      '<node id="50" lat="0.0001" lon="0.001"><tag k="building" v="garage"/><tag k="capacity" v="2"/><tag k="access" v="permissive"/></node>' +
      rectangle(
        60,
        0,
        0.0005,
        0.0002,
        0.0001,
        '<tag k="amenity" v="parking"/><tag k="parking" v="surface"/>',
      ),
  );
  const garages = explicit(city);
  expect(garages).toHaveLength(4);
  expect(garages.map((p) => p.kind)).toEqual(['garage', 'garage', 'garage', 'garage']);
  const bySource = (id: number) => garages.find((p) => p.provenance.osmIds?.includes(id))!;
  expect(bySource(20)).toMatchObject({ capacity: 42, access: 'public' });
  expect(bySource(20).provenance.inferred).not.toContain('capacity');
  expect(bySource(30)).toMatchObject({ capacity: 30, access: 'customers' });
  expect(bySource(30).provenance.inferred).toContain('capacity');
  expect(bySource(40)).toMatchObject({ capacity: 198, access: 'private' });
  expect(bySource(40).provenance.inferred).toContain('building:levels');
  expect(bySource(50)).toMatchObject({ capacity: 2, access: 'public', shape: { kind: 'point' } });
  expect(garages.every((p) => p.connectors.length > 0)).toBe(true);
});

test('T48 reuses multipolygon assembly, subtracts courtyards and avoids duplicate members', () => {
  const city = load(
    rectangle(20, 0, 0.0001, 0.0004, 0.0002, '<tag k="building" v="parking"/>') +
      rectangle(30, 0.0001, 0.00015, 0.0002, 0.0001) +
      `<relation id="40"><member type="way" ref="20" role="outer"/><member type="way" ref="30" role="inner"/>
      <tag k="type" v="multipolygon"/><tag k="amenity" v="parking"/><tag k="parking" v="multi-storey"/>
      <tag k="building:levels" v="2"/></relation>`,
  );
  expect(explicit(city)).toHaveLength(1);
  expect(explicit(city)[0]).toMatchObject({ capacity: 59, provenance: { osmIds: [40] } });
});

test('T48 a garage relation with separate wings keeps one tagged capacity', () => {
  const city = load(
    rectangle(20, 0, 0.0001, 0.0002, 0.0001) +
      rectangle(30, 0.0003, 0.0001, 0.0002, 0.0001) +
      `<relation id="40"><member type="way" ref="20" role="outer"/><member type="way" ref="30" role="outer"/>
      <tag k="type" v="multipolygon"/><tag k="building" v="parking"/><tag k="capacity" v="80"/></relation>`,
  );
  expect(explicit(city)).toHaveLength(1);
  expect(explicit(city)[0]!.capacity).toBe(80);
});

test('T48 invalid capacities infer a small node garage or a capped footprint capacity', () => {
  const city = load(
    '<node id="20" lat="0.0001" lon="0"><tag k="building" v="garage"/><tag k="capacity" v="unknown"/></node>' +
      rectangle(
        30,
        -0.0005,
        0.0002,
        0.002,
        0.001,
        '<tag k="amenity" v="parking"/><tag k="parking" v="multi-storey"/><tag k="capacity" v="-2"/><tag k="parking:levels" v="20"/>',
      ),
  );
  expect(
    explicit(city)
      .map((p) => p.capacity)
      .sort((a, b) => a - b),
  ).toEqual([1, 10000]);
  expect(explicit(city).every((p) => p.provenance.inferred?.includes('capacity'))).toBe(true);
});

test('T48 assigns a touching garage to its building and snaps the mapped entrance to car lanes', () => {
  const home = rectangle(20, 0.0001, 0.0001, 0.0003, 0.0004, '<tag k="building" v="apartments"/>');
  const garage = rectangle(
    30,
    0.0004,
    0.0001,
    0.0002,
    0.0004,
    '<tag k="building" v="garage"/><tag k="capacity" v="30"/>',
  );
  const entrance = '<node id="40" lat="0.0001" lon="0.00059"><tag k="entrance" v="garage"/></node>';
  const city = load(home + garage + entrance);
  const facility = explicit(city)[0]!;
  const place = Object.values(city.places).find((p) => p.kind === 'residential')!;
  expect(facility.placeId).toBe(place.id);
  expect(Object.values(city.parking!).filter((p) => p.placeId === place.id)).toHaveLength(1);
  expect(place.population).toBe(
    Object.values(load(home).places).find((p) => p.kind === 'residential')!.population,
  );
  const compiled = compile(city);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const entry = facility.connectors[0]!;
  const road = city.roads[entry.roadId]!;
  expect(road.lanes[entry.lane]!.allowed).toContain('car');
  expect(road.access?.car ?? road.access?.all ?? 'yes').not.toBe('no');
  // The entrance is near the east end, well away from the footprint's centre.
  const lane = compiled.compiled.lanes.find((l) => l.id === `${entry.roadId}#${entry.lane}`)!;
  const position = pointAtDistance(lane.polyline, lane.cumulative, entry.positionM);
  const entrancePoint = lonLatToLocal(city.geo!, { lon: 0.00059, lat: 0.0001 });
  expect(position.x).toBeCloseTo(entrancePoint.x, 3);
});

test('T48 garage entries bypass bus lanes and roads closed to ordinary cars', () => {
  const city = load(
    '<node id="11" lat="0.00008" lon="-0.001"/><node id="12" lat="0.00008" lon="0.002"/>' +
      '<way id="11"><nd ref="11"/><nd ref="12"/><tag k="highway" v="service"/><tag k="motorcar" v="no"/></way>' +
      '<node id="13" lat="0.00009" lon="-0.001"/><node id="14" lat="0.00009" lon="0.002"/>' +
      '<way id="13"><nd ref="13"/><nd ref="14"/><tag k="highway" v="service"/><tag k="oneway" v="yes"/><tag k="bus:lanes" v="designated"/></way>' +
      rectangle(20, 0, 0.0001, 0.0002, 0.0001, '<tag k="building" v="garage"/>'),
  );
  const entry = explicit(city)[0]!.connectors[0]!;
  expect(city.roads[entry.roadId]!.provenance.osmIds).toEqual([10]);
});

test('T48 a small mapped garage preserves implicit parking for the other aggregated buildings', () => {
  const buildings =
    rectangle(20, 0, 0.0001, 0.0002, 0.0001, '<tag k="building" v="office"/>') +
    rectangle(40, 0.0004, 0.0001, 0.0002, 0.0001, '<tag k="building" v="office"/>');
  const city = load(
    buildings +
      rectangle(
        60,
        0.0002,
        0.0001,
        0.0001,
        0.0001,
        '<tag k="building" v="garage"/><tag k="capacity" v="2"/>',
      ),
  );
  const work = Object.values(city.places).find((p) => p.kind === 'work')!;
  const facilities = Object.values(city.parking!).filter((p) => p.placeId === work.id);
  expect(work.provenance.osmIds).toEqual([20, 40]);
  expect(work.jobs).toBe(
    Object.values(load(buildings).places).find((p) => p.kind === 'work')!.jobs,
  );
  expect(facilities).toHaveLength(2);
  expect(explicit(city)[0]!.capacity).toBe(2);
  expect(facilities.reduce((sum, p) => sum + p.capacity, 0)).toBe(work.jobs);
});

test.each([saveProject, saveProjectJson])(
  'T48 imported garages survive save/open',
  async (save) => {
    const city = load(rectangle(20, 0, 0.0001, 0.0002, 0.0001, '<tag k="building" v="garage"/>'));
    expect(explicit(city)).toHaveLength(1);
    const project = { city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
    expect(await openProject(await save(project))).toEqual({ ok: true, project });
  },
);
