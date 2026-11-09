import { withoutLotAisles } from '../without-lot-aisles';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { cumulativeLengths, distance, pointAtDistance } from '../../src/geo/polyline';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import type { City } from '../../src/schema';
import { tierCities, unitTest } from '../tier';

const observed = vi.hoisted(() => ({ before: undefined as City | undefined, skip: false }));
// Step 12 alone: the separations and the relaxation that follow it have their own contracts
// (TASK-084's T36, TASK-087's T39).
vi.mock(import('../../src/importers/osm/corridors'), async (load) => ({
  ...(await load()),
  separateCoincident() {},
  separateDual() {},
  sampleSameDirection() {},
}));
vi.mock(import('../../src/importers/osm/relax'), async (load) => ({
  ...(await load()),
  relaxRoads() {},
}));
vi.mock(import('../../src/importers/osm/realign'), async (load) => {
  const actual = await load();
  return {
    realignRoads(...args: Parameters<typeof actual.realignRoads>) {
      observed.before = structuredClone(args[0]);
      if (!observed.skip) actual.realignRoads(...args);
    },
  };
});

unitTest('T24: acute-Y minor arm meets the fixed major at sixty degrees', () => {
  const xml = readFileSync('fixtures/osm/acute-y.osm', 'utf8');
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const roads = Object.values(result.city.roads);
  result.city = withoutLotAisles(result.city);
  const before = observed.before!;
  const minor = roads.find((r) => r.name === 'Minor')!;
  const a = minor.centerline[0]!,
    b = minor.centerline[1]!;
  const angle = (Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) * 180) / Math.PI;
  expect(angle).toBeGreaterThanOrEqual(60 - 1e-8);
  expect(minor.centerline).toEqual(
    [...roads.find((r) => r.id !== minor.id && r.name === 'Minor')!.centerline].reverse(),
  );
  expect(minor.provenance.inferred?.some((s) => s.startsWith('realigned:'))).toBe(true);
  expect(result.city.nodes).toEqual(before.nodes);
  for (const road of roads.filter((r) => r.name === 'Major'))
    expect(road).toEqual(before.roads[road.id]);
  const original = before.roads[minor.id]!.centerline;
  const lengths = cumulativeLengths(original);
  const anchor = pointAtDistance(original, lengths, 25);
  expect(minor.centerline).toContainEqual(anchor);
  expect(minor.centerline.at(-1)).toEqual(original.at(-1));
  // The fixture's original minor arm is straight, so cross-track distance is exact.
  const end = original.at(-1)!,
    start = original[0]!;
  let maxShift = 0;
  for (const p of minor.centerline) {
    const shift =
      Math.abs((p.x - start.x) * (end.y - start.y) - (p.y - start.y) * (end.x - start.x)) /
      distance(start, end);
    expect(shift).toBeLessThanOrEqual(8);
    maxShift = Math.max(maxShift, shift);
  }
  console.info('T24 acute-Y', { angleDegrees: angle, maxShiftM: maxShift });
  const at = minor.centerline.findIndex((p) => distance(p, anchor) < 1e-8);
  const incoming = minor.centerline[at - 1]!;
  const tangent = Math.atan2(anchor.y - incoming.y, anchor.x - incoming.x);
  const originalHeading = Math.atan2(end.y - start.y, end.x - start.x);
  expect(Math.abs(tangent - originalHeading)).toBeLessThan(Math.PI / 180);
  expect(importOsm(xml, { importerVersion: 'test' })).toEqual(result);
});

unitTest('T24: a same-direction diverge stays exactly as imported', () => {
  const xml = readFileSync('fixtures/osm/acute-y.osm', 'utf8').replaceAll(
    '<tag k="highway"',
    '<tag k="oneway" v="yes"/><tag k="highway"',
  );
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  for (const road of Object.values(result.city.roads))
    expect(road.centerline).toEqual(observed.before!.roads[road.id]!.centerline);
});

unitTest('T24: short roads may bend within their original half-length', async () => {
  const result = importOsm(readFileSync('fixtures/osm/acute-y.osm', 'utf8'), {
    importerVersion: 'test',
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const city = observed.before!;
  const minor = Object.values(city.roads).find((r) => r.name === 'Minor')!;
  const original = [
    minor.centerline[0]!,
    pointAtDistance(minor.centerline, cumulativeLengths(minor.centerline), 24),
  ];
  city.nodes[minor.to]!.pos = original[1]!;
  for (const r of Object.values(city.roads).filter((r) => r.name === 'Minor'))
    r.centerline = r.from === minor.from ? original : [...original].reverse();
  const { realignRoads } = await vi.importActual<typeof import('../../src/importers/osm/realign')>(
    '../../src/importers/osm/realign',
  );
  const diagnostics: import('../../src/network').Diagnostic[] = [];
  realignRoads(
    city,
    Object.values(city.roads).map((road) => ({
      road,
      wayId: road.provenance.osmIds![0]!,
      turnLanes: undefined,
      cutStart: false,
      cutEnd: false,
      attributes: '',
      layer: 0,
    })),
    new Set(),
    new Set(),
    diagnostics,
  );
  expect(minor.provenance.inferred?.some((s) => s.startsWith('realigned:'))).toBe(true);
  expect(minor.centerline).toContainEqual(
    pointAtDistance(original, cumulativeLengths(original), 12),
  );
  expect(minor.centerline.at(-1)).toEqual(original.at(-1));
  expect(diagnostics.some((d) => d.code === 'realign_limited')).toBe(true);
});

unitTest('T24: a curvature-limited candidate does not hide a later feasible bend', () => {
  const xml = `<osm><node id="1" lat="0" lon="0"/>
    <node id="2" lat="0" lon="0.0009"/>
    <node id="3" lat="-0.000007854" lon="0.00045"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="name" v="Major"/></way>
    <way id="20"><nd ref="1"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="name" v="Minor"/></way></osm>`;
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const minor = Object.values(result.city.roads).find((r) => r.name === 'Minor')!;
  const [a, b] = minor.centerline;
  expect((Math.atan2(b!.y - a!.y, b!.x - a!.x) * 180) / Math.PI).toBeGreaterThan(40);
});

unitTest('T24: a class tie prefers a feasible full bend over a blocked partial bend', () => {
  const angles = [-61, 0, 30];
  const xml = `<osm><node id="1" lat="0" lon="0"/>
    ${angles.map((deg, i) => `<node id="${i + 2}" lat="${-Math.sin((deg * Math.PI) / 180) * 0.001}" lon="${Math.cos((deg * Math.PI) / 180) * 0.001}"/>`).join('')}
    ${angles.map((deg, i) => `<way id="${i + 10}"><nd ref="1"/><nd ref="${i + 2}"/><tag k="highway" v="residential"/><tag k="name" v="Arm ${deg}"/></way>`).join('')}
    </osm>`;
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const roads = Object.values(result.city.roads);
  const bent = roads.find((r) => r.name === 'Arm 30')!;
  const [a, b] = bent.centerline;
  expect((Math.atan2(b!.y - a!.y, b!.x - a!.x) * 180) / Math.PI).toBeGreaterThanOrEqual(60 - 1e-8);
  for (const road of roads.filter((r) => r.name !== 'Arm 30'))
    expect(road.centerline).toEqual(observed.before!.roads[road.id]!.centerline);
});

test.each(
  tierCities([
    ['munich-donnersberger', [11.525, 48.135, 11.545, 48.148]],
    ['sindelfingen-a81', [8.98, 48.69, 9.0, 48.702]],
  ] as const),
)(
  'T24: %s preserves motorway merges and diverges, nodes and determinism',
  (name, bbox) => {
    const xml = readFileSync(`fixtures/osm/${name}.osm`, 'utf8');
    const options = {
      importerVersion: 'test',
      bbox: [...bbox] as [number, number, number, number],
    };
    const result = importOsm(xml, options);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    result.city = withoutLotAisles(result.city);
    const before = observed.before!;
    for (const node of Object.values(result.city.nodes))
      expect(node.pos).toEqual(before.nodes[node.id]!.pos);
    const protectedRoads = Object.values(result.city.roads).filter((r) =>
      ['motorway', 'trunk', 'ramp'].includes(r.roadClass),
    );
    expect(protectedRoads.some((r) => r.roadClass === 'ramp')).toBe(true);
    for (const road of protectedRoads)
      expect(road.centerline).toEqual(before.roads[road.id]!.centerline);
    for (const road of Object.values(result.city.roads)) {
      const marks = road.provenance.inferred?.filter((s) => s.startsWith('realigned:')) ?? [];
      const original = before.roads[road.id]!.centerline;
      const lengths = cumulativeLengths(original);
      if (marks.length === 2 && lengths.at(-1)! < 50) {
        const midpoint = pointAtDistance(original, lengths, lengths.at(-1)! / 2);
        expect(Math.min(...road.centerline.map((p) => distance(p, midpoint)))).toBeLessThan(1e-6);
      }
      if (!road.streetGroupId || !road.provenance.inferred?.some((s) => s.startsWith('realigned:')))
        continue;
      const reverse = Object.values(result.city.roads).find(
        (other) => other.id !== road.id && other.streetGroupId === road.streetGroupId,
      )!;
      expect(road.centerline).toEqual([...reverse.centerline].reverse());
    }
    const repeated = importOsm(xml, options);
    if (!repeated.ok) throw new Error('Import failed');
    expect(withoutLotAisles(repeated.city)).toEqual(result.city);
    expect(
      result.diagnostics
        .filter((d) => d.code === 'realign_limited')
        .every((d) => d.refs.some((id) => id.startsWith('r:'))),
    ).toBe(true);
    if (name !== 'munich-donnersberger') return;
    observed.skip = true;
    let baseline;
    try {
      baseline = importOsm(xml, options);
    } finally {
      observed.skip = false;
    }
    if (!baseline.ok) throw new Error(JSON.stringify(baseline.diagnostics));
    const counts = (city: City) => {
      const result = compile(city);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      return {
        capped: result.compiled.nodes.flatMap((n) => n.setbacks).filter((s) => s >= 10 - 1e-9)
          .length,
        short: result.compiled.lanes.filter((l) => l.lengthM < 10).length,
      };
    };
    const old = counts(baseline.city),
      next = counts(result.city);
    console.info('T24 Munich setbacks/short lanes', { before: old, after: next });
    expect(next.capped).toBeLessThan(old.capped);
    // Owner-approved exception: these remaining lanes have no eligible acute pair.
    expect(next.short).toBeLessThanOrEqual(old.short);
  },
  // Three Munich imports: 23 s locally, 44 to 70 s on CI runners since TASK-103's strips.
  Number(process.env.CITYFLOWS_TEST_TIMEOUT_MS ?? 180_000),
);
