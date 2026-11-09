import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { compile, type CompiledCity } from '../../src/network';
import { tierCities } from '../tier';
import { areaD, booleanOpD, ClipType, FillRule } from 'clipper2-ts';
import { prepareRing } from '../../src/geo/polyline';
import { buildCity } from '../../src/fixtures/build-city';
import { allocateId } from '../../src/schema';
import { importOsm } from '../../src/importers/osm';

/** Lead (TASK-111 merge): a signal phase's walk list indexes walk links, which strips move. */
const vehicleNodes = (net: CompiledCity) =>
  net.nodes.map((n) =>
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
  );

test.each(['no', 'delivery'])('T52 closed lot access stays private: %s', (access) => {
  const result = importOsm(
    `<osm><node id="1" lat="0" lon="0"/><node id="2" lat="0" lon="0.001"/><node id="3" lat="0.0001" lon="0.0001"/><node id="4" lat="0.0001" lon="0.0005"/><node id="5" lat="0.0003" lon="0.0005"/><node id="6" lat="0.0003" lon="0.0001"/><way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way><way id="20"><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/><nd ref="3"/><tag k="amenity" v="parking"/><tag k="access" v="${access}"/></way></osm>`,
    {
      importerVersion: 'test',
      context: false,
      terrain: false,
      bbox: [-0.001, -0.001, 0.002, 0.002],
    },
  );
  if (!result.ok) throw new Error('import');
  expect(Object.values(result.city.parking!).find((p) => p.kind === 'lot')!.access).toBe('private');
});

test('T52 a shallow lot without aisles fits longitudinal bays', () => {
  const { city, node, road } = buildCity('Shallow lot', 103);
  const r = road(node(0, 0), node(80, 0)),
    id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      access: 'public',
      placeId: null,
      capacity: 0,
      shape: {
        kind: 'polygon',
        ring: [
          { x: 10, y: 8 },
          { x: 70, y: 8 },
          { x: 70, y: 11 },
          { x: 10, y: 11 },
        ],
      },
      connectors: [
        {
          id: allocateId(city, 'c'),
          roadId: r.id,
          lane: 0,
          positionM: 40,
          direction: 'both',
          throughputPerMin: 30,
        },
      ],
      provenance: { source: 'generated', inferred: ['driveway'] },
    },
  };
  const result = compile(city);
  if (!result.ok) throw new Error('compile');
  expect(result.compiled.lots![0]!.stallCount).toBeGreaterThan(5);
});

test('T52 invalid parking strip references and stations fail clearly', () => {
  const { city, node, road } = buildCity('Invalid parking', 103),
    r = road(node(0, 0), node(80, 0));
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind: 'roadside',
      name: null,
      access: 'public',
      placeId: null,
      capacity: 10,
      shape: null,
      connectors: [],
      strip: { roadId: r.id, side: 'right', fromM: 10, toM: 1000, layout: 'parallel' },
      provenance: { source: 'authored' },
    },
  };
  for (const strip of [
    { roadId: r.id, fromM: 10, toM: 1000 },
    { roadId: 'r:99999', fromM: 10, toM: 70 },
  ]) {
    Object.assign(city.parking[id]!.strip!, strip);
    const result = compile(city);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'parking_invalid')).toBe(true);
  }
});

test.each(tierCities(['munich-donnersberger', 'sindelfingen-a81'] as const))(
  'T52 %s materialized strips, inferred driveways and unchanged vehicle network',
  (name) => {
    const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: '1',
      context: false,
      terrain: false,
    });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const city = imported.city;
    const baseline = structuredClone(city);
    for (const facility of Object.values(baseline.parking ?? {})) {
      if (facility.kind === 'roadside') delete baseline.parking![facility.id];
      if (facility.kind === 'lot') {
        // Retain TASK-104's aisle metadata: it suppresses generated aisle crossings.
        facility.shape = null;
        facility.connectors = [];
      }
    }
    const before = compile(baseline),
      after = compile(city);
    if (!before.ok || !after.ok) throw new Error('compile');
    const originalConnectors = new Set(before.compiled.connectors.map((c) => c.id));
    const vehicleHash = (net: CompiledCity) =>
      createHash('sha256')
        .update(
          JSON.stringify({
            nodes: vehicleNodes(net),
            roads: net.roads,
            movements: net.movements,
            places: net.places,
            lanes: net.lanes.map((l) => ({
              ...l,
              connectors: l.connectors.filter((i) => originalConnectors.has(net.connectors[i]!.id)),
            })),
            connectors: net.connectors.filter((c) => originalConnectors.has(c.id)),
          }),
        )
        .digest('hex');
    expect(vehicleHash(after.compiled)).toBe(vehicleHash(before.compiled));
    const strips = Object.values(city.parking ?? {}).filter((p) => p.kind === 'roadside');
    const counts = {
      mapped: strips.filter((p) => !p.provenance.inferred?.includes('strip')).length,
      inferred: strips.filter((p) => p.provenance.inferred?.includes('strip')).length,
      slots: after.compiled.strips?.reduce((n, s) => n + s.slots.length, 0) ?? 0,
    };
    expect(counts.inferred).toBeGreaterThan(0);
    const expected =
      name === 'munich-donnersberger'
        ? { mapped: 79, inferred: 203, slots: 2419 }
        : { mapped: 17, inferred: 56, slots: 1122 };
    for (const key of ['mapped', 'inferred', 'slots'] as const)
      expect(Math.abs(counts[key] - expected[key])).toBeLessThanOrEqual(expected[key] * 0.1);
    expect(counts.slots).toBe(
      after.compiled.parking
        .filter((p) => p.kind === 'roadside')
        .reduce((n, p) => n + p.capacity, 0),
    );
    for (const strip of after.compiled.strips ?? []) {
      // Mapped areas retain their projected run and capacity; generated runs keep safety cuts.
      if (city.parking![strip.id]!.strip!.ring) continue;
      const road = after.compiled.roads[strip.road]!;
      expect(strip.fromM).toBeGreaterThanOrEqual(5);
      expect(strip.toM).toBeLessThanOrEqual(road.lengthM - 5 + 1e-6);
      for (const idx of strip.slots) {
        const space = after.compiled.parkingSpaces![idx]!;
        const lane = after.compiled.lanes[space.lane]!;
        for (const c of lane.connectors
          .map((i) => after.compiled.connectors[i]!)
          .filter((c) => originalConnectors.has(c.id)))
          expect(Math.abs(c.positionM - space.positionM)).toBeGreaterThanOrEqual(3);
      }
    }
    const lots = Object.values(city.parking ?? {}).filter((p) => p.kind === 'lot');
    const inferredDriveways = lots.filter((p) =>
      p.provenance.inferred?.includes('driveway'),
    ).length;
    const reachable = after.compiled.parking.filter(
      (p) => p.kind === 'lot' && p.connectorsIn.length,
    ).length;
    console.info(
      'T52',
      name,
      JSON.stringify({
        ...counts,
        lots: lots.length,
        inferredDriveways,
        reachable,
        stalls: after.compiled.lots!.reduce((n, l) => n + l.stallCount, 0),
        emptyLots: after.compiled
          .lots!.filter((l) => !l.stallCount)
          .map((l) => {
            const p = city.parking![l.id]!,
              ring = p.shape?.kind === 'polygon' ? p.shape.ring : [];
            return {
              id: l.id,
              osmIds: p.provenance.osmIds,
              aisles: l.aisles.length,
              dimensions: [
                Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x)),
                Math.max(...ring.map((p) => p.y)) - Math.min(...ring.map((p) => p.y)),
              ],
              areaM2: Math.abs(areaD(ring)),
              freeAreaM2: (() => {
                const box = prepareRing(ring).box;
                let free = [ring];
                for (const obstacle of [
                  ...after.compiled.roads.map((r) => r.surface),
                  ...after.compiled.nodes.map((n) => n.outline),
                  ...(p.exclusions ?? []),
                ]) {
                  if (obstacle.length < 3) continue;
                  const b = prepareRing(obstacle).box;
                  if (
                    b.minX >= box.maxX ||
                    b.maxX <= box.minX ||
                    b.minY >= box.maxY ||
                    b.maxY <= box.minY
                  )
                    continue;
                  free = booleanOpD(ClipType.Difference, free, [obstacle], FillRule.EvenOdd, 4);
                }
                return Math.abs(free.reduce((sum, r) => sum + areaD(r), 0));
              })(),
            };
          }),
        vehicleHash: vehicleHash(after.compiled),
      }),
    );
    const context = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
      importerVersion: '1',
      terrain: false,
    });
    if (!context.ok) throw new Error('context import');
    const buildings = context.city.context!.features.flatMap((f) =>
      f.kind === 'area' && f.class === 'building' ? [prepareRing(f.rings[0]!)] : [],
    );
    const overlaps = (after.compiled.strips ?? [])
      .filter((s) => !city.parking![s.id]!.strip!.ring)
      .filter((s) => {
        const box = prepareRing(s.polygon).box;
        return buildings.some(
          (b) =>
            b.box.minX < box.maxX &&
            b.box.maxX > box.minX &&
            b.box.minY < box.maxY &&
            b.box.maxY > box.minY &&
            booleanOpD(ClipType.Intersection, [s.polygon], [b.ring], FillRule.EvenOdd, 4).reduce(
              (n, r) => n + Math.abs(areaD(r)),
              0,
            ) > 0.05,
        );
      })
      .map((s) => s.id);
    expect(overlaps).toEqual([]);
  },
);
