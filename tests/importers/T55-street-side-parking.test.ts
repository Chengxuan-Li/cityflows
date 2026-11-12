import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { expect } from '../hash-probe';
import { importOsm } from '../../src/importers/osm';
import { importOsmCached } from '../../bench/city-cache';
import { compile, type CompiledCity } from '../../src/network';
import { parseOsm } from '../../src/importers/osm/parse';
import { polygonSources } from '../../src/importers/osm/buildings';
import { placeTrees } from '../../src/render/vegetation';
import { placeStreet, treeContext } from '../../src/render/street';
import { pointInPolygon } from '../../src/geo/polyline';
import { createGeoReference, localToLonLat } from '../../src/geo/projection';
import { openProject } from '../../src/project/open';
import { saveProject, saveProjectJson } from '../../src/project/save';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { scenarioSchema } from '../../src/schema';
import { cityTest, tierCities } from '../tier';
import { createParking } from '../../src/sim/parking';
import { createVehicles } from '../../src/sim/vehicle';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';

// Parking-place removal intentionally changes places/connectors and their dense indices.
// The vehicle network itself (including all aisle roads) must retain main's exact bytes.
function vehicleHash(net: CompiledCity) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        roads: net.roads,
        lanes: net.lanes.map(({ connectors, ...lane }) => {
          void connectors;
          return lane;
        }),
        movements: net.movements,
        nodes: net.nodes.map((n) =>
          n.signal
            ? {
                ...n,
                signal: {
                  ...n.signal,
                  phases: n.signal.phases.map((p) => ({
                    durationS: p.durationS,
                    movements: p.movements,
                  })),
                },
              }
            : n,
        ),
      }),
    )
    .digest('hex');
}

function fixture(
  y = 4,
  depth = 5,
  tags = '',
  roadTags = '',
  relation = false,
  segmented = false,
  options: { owner?: boolean; shortRoad?: boolean; hole?: boolean; taggedMember?: boolean } = {},
) {
  const geo = createGeoReference({ lon: 0, lat: 0 });
  const points = [
    [0, 0],
    [120, 0],
    [30, y],
    [70, y],
    [70, y + depth],
    [30, y + depth],
  ];
  if (options.shortRoad) {
    points[0] = [40, 0];
    points[1] = [60, 0];
    points[2] = [0, y];
    points[3] = [100, y];
    points[4] = [100, y + depth];
    points[5] = [0, y + depth];
  }
  if (segmented)
    points.push(
      ...Array.from({ length: 19 }, (_, i) => [32 + i * 2, y]),
      ...Array.from({ length: 19 }, (_, i) => [68 - i * 2, y + depth]),
    );
  const nodes = points
    .map(([x, y], i) => {
      const p = localToLonLat(geo, { x: x!, y: y! });
      return `<node id="${i + 1}" lat="${p.lat}" lon="${p.lon}"/>`;
    })
    .join('');
  const areaTags = `<tag k="amenity" v="parking"/><tag k="parking" v="street_side"/>${tags}`;
  const school = localToLonLat(geo, { x: 50, y: 15 });
  const holes = options.hole
    ? [
        [40, 35],
        [60, 35],
        [60, 45],
        [40, 45],
      ]
        .map(([x, y], i) => {
          const p = localToLonLat(geo, { x: x!, y: y! });
          return `<node id="${100 + i}" lat="${p.lat}" lon="${p.lon}"/>`;
        })
        .join('') +
      '<way id="22"><nd ref="100"/><nd ref="101"/><nd ref="102"/><nd ref="103"/><nd ref="100"/></way>'
    : '';
  const xml = `<osm>${nodes}${holes}${options.owner ? `<node id="200" lat="${school.lat}" lon="${school.lon}"><tag k="amenity" v="school"/></node>` : ''}<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/>${roadTags}</way>
    <way id="20"><nd ref="3"/>${segmented ? Array.from({ length: 19 }, (_, i) => `<nd ref="${i + 7}"/>`).join('') : ''}<nd ref="4"/><nd ref="5"/>${segmented ? Array.from({ length: 19 }, (_, i) => `<nd ref="${i + 26}"/>`).join('') : ''}<nd ref="6"/><nd ref="3"/>${relation && !options.taggedMember ? '' : areaTags}</way>
    ${relation ? `<relation id="21"><member type="way" ref="20" role="outer"/>${options.hole ? '<member type="way" ref="22" role="inner"/>' : ''}<tag k="type" v="multipolygon"/>${areaTags}</relation>` : ''}</osm>`;
  const result = importOsm(xml, {
    importerVersion: 'test',
    bbox: [-0.002, -0.002, 0.002, 0.002],
    context: false,
    terrain: false,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.city;
}

test.each([false, true, 'tagged'] as const)(
  'T55 mapped way/multipolygon (%s) owns the correct directed curb and polygon',
  (relation) => {
    const city = fixture(
      4,
      5,
      '<tag k="capacity" v="7"/><tag k="orientation" v="diagonal"/><tag k="access" v="customers"/>',
      '<tag k="parking:both" v="separate"/>',
      Boolean(relation),
      false,
      { taggedMember: relation === 'tagged' },
    );
    const mapped = Object.values(city.parking ?? {}).filter((p) =>
      p.provenance.osmIds?.includes(relation ? 21 : 20),
    );
    expect(mapped).toHaveLength(1);
    const facility = mapped[0]!;
    expect(facility).toMatchObject({
      kind: 'roadside',
      capacity: 7,
      access: 'customers',
      placeId: null,
      strip: { side: 'right', layout: 'angled' },
    });
    const road = city.roads[facility.strip!.roadId]!;
    expect(road.centerline[0]!.x).toBeLessThan(road.centerline.at(-1)!.x);
    expect(facility.strip!.fromM).toBeCloseTo(30);
    expect(facility.strip!.toM).toBeCloseTo(70);
    expect(Object.values(city.places).filter((p) => p.kind === 'parking')).toEqual([]);
    const result = compile(city);
    if (!result.ok) throw new Error('compile');
    const strip = result.compiled.strips!.find((s) => s.id === facility.id)!;
    expect(
      pointInPolygon(result.compiled.parking.find((p) => p.id === facility.id)!.centroid, [
        ...strip.polygon,
        strip.polygon[0]!,
      ]),
    ).toBe(true);
    expect(strip.polygon).toEqual(facility.strip!.ring);
    expect(strip.slots).toHaveLength(7);
    for (const index of strip.slots) {
      const space = result.compiled.parkingSpaces![index]!;
      expect(pointInPolygon(space.position, [...strip.polygon, strip.polygon[0]!])).toBe(true);
    }
  },
);

test.each([
  [2, 'parallel'],
  [5, 'angled'],
  [7, 'perpendicular'],
] as const)('T55 depth %s infers %s and suppresses only the covered stretch', (depth, layout) => {
  const city = fixture(4, depth);
  const facilities = Object.values(city.parking!);
  const mapped = facilities.find((p) => p.provenance.osmIds?.includes(20))!;
  expect(mapped.strip!.layout).toBe(layout);
  const sameSide = facilities.filter(
    (p) =>
      p.strip?.roadId === mapped.strip!.roadId &&
      p.strip.side === mapped.strip!.side &&
      p.id !== mapped.id,
  );
  expect(sameSide).toHaveLength(2);
  for (const [i, [from, to]] of [
    [7.5, 30],
    [70, 112.5],
  ].entries()) {
    expect(sameSide[i]!.strip!.fromM).toBeCloseTo(from!);
    expect(sameSide[i]!.strip!.toM).toBeCloseTo(to!);
  }
  expect(facilities.some((p) => p.strip?.roadId !== mapped.strip!.roadId)).toBe(true);
});

test('T55 unmatched street-side area becomes a lot with generated bays and inferred driveway', () => {
  const city = fixture(30, 10);
  const facility = Object.values(city.parking!).find((p) => p.provenance.osmIds?.includes(20))!;
  expect(facility.kind).toBe('lot');
  expect(facility.provenance.inferred).toContain('driveway');
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  expect(result.compiled.lots!.find((l) => l.id === facility.id)!.stallCount).toBeGreaterThan(0);
});

test('T55 subdivided long boundaries do not mistake a bay end for its long side', () => {
  const city = fixture(4, 5, '', '', false, true);
  const facility = Object.values(city.parking!).find((p) => p.provenance.osmIds?.includes(20))!;
  expect(facility.kind).toBe('roadside');
});

test('T55 the opposite physical curb belongs to the reverse travel direction', () => {
  const city = fixture(-9, 5);
  const facility = Object.values(city.parking!).find((p) => p.provenance.osmIds?.includes(20))!;
  const road = city.roads[facility.strip!.roadId]!;
  expect(road.centerline[0]!.x).toBeGreaterThan(road.centerline.at(-1)!.x);
  expect(facility.strip!.side).toBe('right');
  expect(facility.strip!.fromM).toBeCloseTo(50);
  expect(facility.strip!.toM).toBeCloseTo(90);
});

test.each(['private', 'customers'])(
  'T55 restricted %s strips admit their actual destination owner',
  (access) => {
    const city = fixture(4, 5, `<tag k="access" v="${access}"/>`, '', false, false, {
      owner: true,
    });
    const school = Object.values(city.places).find((p) => p.kind === 'school')!;
    const result = compile(city);
    if (!result.ok) throw new Error('compile');
    const net = result.compiled,
      facility = net.parking.find((p) => p.source.provenance.osmIds?.includes(20))!;
    const scenario = defaultScenario('grid5x5');
    const trip = {
      id: 'visit',
      personId: null,
      originPlaceId: school.id,
      destinationPlaceId: school.id,
      departS: scenario.startS,
      mode: 'car' as const,
      vehicleClass: 'car' as const,
      purpose: 'private' as const,
      legs: [],
    };
    const parking = createParking(
      net,
      [trip],
      scenario,
      DEFAULT_SIM_PARAMS,
      createVehicles(1, net.lanes.length, net.movements.length),
    );
    expect(parking.admits(0, facility.connectorsIn[0]!)).toBe(true);
    expect(
      parking.choose(0, scenario.startS, (c) => net.connectors[c]!.parking === facility.idx),
    ).toBe(true);
  },
);

test('T55 a long bay beside a short road clips its run without becoming a lot', () => {
  const city = fixture(4, 5, '', '', false, false, { shortRoad: true });
  const facility = Object.values(city.parking!).find((p) => p.provenance.osmIds?.includes(20))!;
  expect(facility.kind).toBe('roadside');
  expect(facility.strip!.fromM).toBeCloseTo(0);
  expect(facility.strip!.toM).toBeCloseTo(20);
});

test('T55 fallback multipolygon lots preserve islands as stall exclusions', () => {
  const city = fixture(30, 20, '', '', true, false, { hole: true });
  const facility = Object.values(city.parking!).find((p) => p.provenance.osmIds?.includes(21))!;
  expect(facility.kind).toBe('lot');
  const island = facility.exclusions?.find((r) => pointInPolygon({ x: 50, y: 40 }, [...r, r[0]!]));
  expect(island).toBeDefined();
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  const lot = result.compiled.lots!.find((l) => l.id === facility.id)!;
  expect(lot.stallCount).toBeGreaterThan(0);
  for (const stall of lot.stalls)
    expect(pointInPolygon(stall.position, [...island!, island![0]!])).toBe(false);
});

test('T55 mapped rings survive save/open; legacy files do not infer new parking', async () => {
  const city = fixture();
  const project = { city, scenarios: [scenarioSchema.parse(defaultScenario('grid5x5'))] };
  expect(await openProject(await saveProject(project))).toEqual({ ok: true, project });
  delete city.parking;
  expect(await openProject(await saveProject(project))).toEqual({ ok: true, project });
});

cityTest('T55 Munich parking places retain their own mapped lots and garage', () => {
  const result = importOsmCached(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
    importerVersion: '1',
    context: false,
    terrain: false,
  });
  if (!result.ok) throw new Error('import');
  for (const [osmId, kind] of [
    [84303381, 'lot'],
    [574700583, 'lot'],
    [59379087, 'garage'],
  ] as const) {
    const place = Object.values(result.city.places).find(
      (p) => p.kind === 'parking' && p.provenance.osmIds?.includes(osmId),
    )!;
    expect(
      Object.values(result.city.parking!).find((p) => p.provenance.osmIds?.includes(osmId)),
    ).toMatchObject({ kind, placeId: place.id });
  }
});

test.each(
  process.env.CITYFLOWS_BASELINE_ROOT
    ? ['munich-donnersberger', 'sindelfingen-a81']
    : tierCities(['munich-donnersberger', 'sindelfingen-a81'] as const),
)('T55 %s mapped areas, orphan places and main comparison', async (name) => {
  const xml = readFileSync(`fixtures/osm/${name}.osm`, 'utf8');
  const data = parseOsm(xml);
  if (typeof data === 'string') throw new Error(data);
  const areas = polygonSources(
    data,
    (t) =>
      t.amenity === 'parking' &&
      ['street_side', 'lane', 'layby', 'on_kerb', 'half_on_kerb'].includes(t.parking ?? ''),
  );
  const options = { importerVersion: '1', context: false, terrain: false };
  const imported = importOsmCached(xml, options);
  if (!imported.ok) throw new Error('import');
  const { city } = imported;
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  const net = result.compiled;
  const facilities = Object.values(city.parking!);
  const matches = areas.map((area) => ({
    id: area.id,
    facilities: facilities.filter((p) => p.provenance.osmIds?.includes(area.id)),
  }));
  const skipped = matches
    .filter((m) => !m.facilities.length)
    .map((m) => ({
      id: m.id,
      reasons: imported.diagnostics
        .filter((d) => d.refs.includes(String(m.id)))
        .map((d) => d.message),
    }));
  const mapped = facilities.filter((p) => p.strip?.ring);
  const orphans = Object.values(city.places)
    .filter((p) => p.kind === 'parking' && !facilities.some((f) => f.placeId === p.id))
    .map((p) => ({
      id: p.id,
      osmIds: p.provenance.osmIds,
      tags: data.way.find((w) => p.provenance.osmIds?.includes(w.id))?.tag,
    }));
  const counts = {
    found: areas.length,
    strips: matches.filter((m) => m.facilities.some((p) => p.kind === 'roadside')).length,
    lots: matches.filter((m) => m.facilities.some((p) => p.kind === 'lot')).length,
    skipped,
    slots: net.parking
      .filter((p) => mapped.some((m) => m.id === p.id))
      .reduce((sum, p) => sum + p.capacity, 0),
    removedStretches: imported.diagnostics.filter(
      (d) => d.code === 'parking_strip_covered' || d.code === 'parking_inferred_strip_covered',
    ).length,
    removedInferredStretches: imported.diagnostics.filter(
      (d) => d.code === 'parking_inferred_strip_covered',
    ).length,
    orphans,
    empty: net.parking
      .filter((p) => mapped.some((m) => m.id === p.id) && !p.capacity)
      .map((p) => p.source.provenance.osmIds),
    mismatchedCapacity: net.parking
      .filter((p) => mapped.some((m) => m.id === p.id) && p.capacity !== p.source.capacity)
      .map((p) => ({
        osmIds: p.source.provenance.osmIds,
        capacity: p.source.capacity,
        slots: p.capacity,
      })),
    vehicleHash: vehicleHash(net),
    generated: {
      mapped: facilities.filter((p) => p.strip && !p.provenance.inferred?.includes('strip')).length,
      inferred: facilities.filter((p) => p.provenance.inferred?.includes('strip')).length,
      stripSlots: net.strips?.reduce((n, s) => n + s.slots.length, 0),
      lots: net.lots?.length,
      lotSlots: net.lots?.reduce((n, l) => n + l.stallCount, 0),
      fallback: net.parking
        .filter((p) => p.source.provenance.inferred?.includes('streetSideLot'))
        .map((p) => ({
          osmIds: p.source.provenance.osmIds,
          capacity: p.capacity,
          entries: p.connectorsIn.length,
        })),
    },
  };
  console.info('T55 census', name, JSON.stringify(counts));
  // TASK-131 keeps OSM geometry (no node merges, junction groups): the vehicle network no longer
  // equals main's (main: Munich 51b6cf03…, Sindelfingen ac619150…).
  // Munich re-pinned for 06dae00 (median crossings offset by half their lane block)
  // and e4654d8 (merging lanes kept on a group's inner roads).
  expect(vehicleHash(net)).toBe(
    name.startsWith('munich')
      ? '3f65158e086a275d0be73bf9fa57b5a4165ca7809345eb119839f34c2379c83d'
      : '1b1a1ebb005d8f0e73cd565be40e4825a57e123cbbff292ac4394f3e060639ea',
  );
  writeFileSync(`node_modules/.cache/task119-${name}.json`, JSON.stringify(counts, null, 2));
  expect(skipped).toEqual([]);
  expect(counts.empty).toEqual([]);
  if (name.startsWith('munich')) expect(counts.strips + counts.lots).toBeGreaterThanOrEqual(55);
  for (const strip of net.strips ?? []) {
    const source = city.parking![strip.id]!.strip!;
    if (!source.ring) continue;
    expect(strip.polygon).toEqual(source.ring);
    for (const idx of strip.slots)
      expect(
        pointInPolygon(net.parkingSpaces![idx]!.position, [...strip.polygon, strip.polygon[0]!]),
      ).toBe(true);
  }
  const root = process.env.CITYFLOWS_BASELINE_ROOT;
  if (root) {
    const mainImporter = (await import(`${root}/src/importers/osm/index.ts`)) as {
      importOsm: typeof importOsm;
    };
    const mainNetwork = (await import(`${root}/src/network/index.ts`)) as {
      compile: typeof compile;
    };
    const phase = (importer: typeof importOsm, compiler: typeof compile) => {
      const start = performance.now();
      const r = importer(xml, options);
      const importMs = performance.now() - start;
      if (!r.ok) throw new Error('timing import');
      const begin = performance.now();
      const c = compiler(r.city);
      const compileMs = performance.now() - begin;
      if (!c.ok) throw new Error('timing compile');
      const treeStart = performance.now();
      const trees = placeTrees(c.compiled, treeContext(r.city));
      const treeMs = performance.now() - treeStart;
      const streetStart = performance.now();
      placeStreet(c.compiled, r.city, trees.trees);
      return {
        city: r.city,
        net: c.compiled,
        timing: { importMs, compileMs, treeMs, streetMs: performance.now() - streetStart },
      };
    };
    const samples = Number(process.env.CITYFLOWS_COMPARE_SAMPLES ?? 1);
    const mainRuns: ReturnType<typeof phase>[] = [],
      currentRuns: ReturnType<typeof phase>[] = [];
    for (let i = 0; i < samples; i++) {
      if (i % 2) {
        currentRuns.push(phase(importOsm, compile));
        mainRuns.push(phase(mainImporter.importOsm, mainNetwork.compile));
      } else {
        mainRuns.push(phase(mainImporter.importOsm, mainNetwork.compile));
        currentRuns.push(phase(importOsm, compile));
      }
    }
    const medianTiming = (runs: typeof mainRuns) =>
      Object.fromEntries(
        Object.keys(runs[0]!.timing).map((key) => [
          key,
          runs.map((r) => r.timing[key as keyof typeof r.timing]).sort((a, b) => a - b)[
            Math.floor(runs.length / 2)
          ]!,
        ]),
      );
    const main = { ...mainRuns[0]!, timing: medianTiming(mainRuns) };
    const current = { ...currentRuns[0]!, timing: medianTiming(currentRuns) };
    writeFileSync(
      `node_modules/.cache/task119-timings-${name}.json`,
      JSON.stringify(
        {
          main: main.timing,
          current: current.timing,
          mainHash: vehicleHash(main.net),
          currentHash: vehicleHash(current.net),
        },
        null,
        2,
      ),
    );
    console.info(
      'T55 main comparison',
      name,
      JSON.stringify({
        main: main.timing,
        current: current.timing,
        mainHash: vehicleHash(main.net),
        currentHash: vehicleHash(current.net),
        mainSlots: main.net.parkingSpaces?.length,
        currentSlots: current.net.parkingSpaces?.length,
      }),
    );
    expect(vehicleHash(current.net)).toBe(vehicleHash(main.net));
    expect(current.city.roads).toEqual(main.city.roads);
    const nonParkingPlaces = (source: typeof city) =>
      Object.fromEntries(Object.entries(source.places).filter(([, p]) => p.kind !== 'parking'));
    expect(nonParkingPlaces(current.city)).toEqual(nonParkingPlaces(main.city));
    if (name.startsWith('munich')) {
      const source = mainImporter.importOsm(xml, { importerVersion: '1' });
      if (!source.ok) throw new Error('main render import');
      source.city.terrain = JSON.parse(
        readFileSync('fixtures/terrain/munich-donnersberger.json', 'utf8'),
      );
      const scenario = scenarioSchema.parse(defaultScenario('grid5x5'));
      scenario.demand.personsPerResident = 0.15;
      writeFileSync(
        'node_modules/.cache/task119-main.city.json',
        await saveProjectJson({
          city: source.city,
          scenarios: [scenario],
        }),
      );
    }
  }
});
