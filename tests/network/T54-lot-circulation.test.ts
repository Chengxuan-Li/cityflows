import { expect, test } from 'vitest';
import { compile } from '../../src/network';
import { parkingWorld } from '../parking-world';
import { pointInPolygon } from '../../src/geo/polyline';
import { buildCity } from '../../src/fixtures/build-city';
import { allocateId } from '../../src/schema';

test('T54 a generated lot has circulation while vehicle geometry stays unchanged', () => {
  const w = parkingWorld(),
    result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const baseline = structuredClone(w.city);
  delete baseline.parking;
  const before = compile(baseline);
  if (!before.ok) throw new Error('compile');
  expect(result.compiled.roads).toEqual(before.compiled.roads);
  expect(result.compiled.movements).toEqual(before.compiled.movements);
  expect(result.compiled.nodes).toEqual(before.compiled.nodes);
  expect(result.compiled.lanes.map((l) => ({ ...l, connectors: [] }))).toEqual(
    before.compiled.lanes.map((l) => ({ ...l, connectors: [] })),
  );
  expect(Reflect.get(result.compiled.lots![0]!, 'circulation')).toBeDefined();
});

test('T54 circulation stays in the polygon and excluded disconnected stalls stay unused', () => {
  const w = parkingWorld();
  w.city.parking![w.id]!.exclusions = [
    [
      { x: 160, y: 8 },
      { x: 165, y: 8 },
      { x: 165, y: 50 },
      { x: 160, y: 50 },
    ],
  ];
  const result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const lot = result.compiled.lots![0]!,
    g = lot.circulation!;
  expect(g.unreachable.length).toBeGreaterThan(0);
  expect(result.diagnostics.some((d) => d.code === 'lot_stalls_unreachable')).toBe(true);
  const source = w.city.parking![w.id]!,
    polygon = source.shape!;
  if (polygon.kind !== 'polygon') throw new Error('polygon');
  for (const edge of g.edges) {
    if (g.entries.some((e) => e.node === edge.from || e.node === edge.to)) continue;
    const a = g.nodes[edge.from]!,
      b = g.nodes[edge.to]!;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(pointInPolygon(middle, [...polygon.ring, polygon.ring[0]!])).toBe(true);
    expect(pointInPolygon(middle, [...source.exclusions![0]!, source.exclusions![0]![0]!])).toBe(
      false,
    );
  }
  expect(result.compiled.parking[result.compiled.index.parking.get(w.id)!]!.capacity).toBe(
    lot.stallCount - g.unreachable.length,
  );
});

test('T54 stalls need both an inbound and an outbound path across directional portals', () => {
  const w = parkingWorld(),
    source = w.city.parking![w.id]!;
  source.exclusions = [
    [
      { x: 160, y: 8 },
      { x: 165, y: 8 },
      { x: 165, y: 50 },
      { x: 160, y: 50 },
    ],
  ];
  source.connectors[0]!.direction = 'in';
  source.connectors.push({
    ...source.connectors[0]!,
    id: 'c:999',
    positionM: 200,
    direction: 'out',
  });
  const result = compile(w.city);
  if (!result.ok) throw new Error('compile');
  const lot = result.compiled.lots![0]!;
  expect(lot.circulation!.unreachable).toHaveLength(lot.stallCount);
  expect(result.compiled.parking[result.compiled.index.parking.get(w.id)!]!.capacity).toBe(0);
});

test('T54 split sections of one mapped aisle retain access to its far branch', () => {
  const b = buildCity('Split lot aisle', 118),
    a = b.node(0, 0),
    middle = b.node(50, 0),
    end = b.node(100, 0),
    tip = b.node(100, 50);
  const first = b.road(a, middle, { roadClass: 'service', streetGroupId: 'spine' }),
    second = b.road(middle, end, { roadClass: 'service', streetGroupId: 'spine' }),
    branch = b.road(end, tip, { roadClass: 'service', streetGroupId: 'branch' });
  for (const road of [first, second, branch]) road.lanes[0]!.widthM = 6;
  const id = allocateId(b.city, 'pk');
  b.city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 0,
      access: 'public',
      placeId: null,
      connectors: [
        {
          id: allocateId(b.city, 'c'),
          roadId: first.id,
          lane: 0,
          positionM: 10,
          direction: 'both',
          throughputPerMin: 30,
        },
      ],
      shape: {
        kind: 'polygon',
        ring: [
          { x: 0, y: -10 },
          { x: 110, y: -10 },
          { x: 110, y: 60 },
          { x: 0, y: 60 },
        ],
      },
      aisles: [first.id, second.id, branch.id],
      provenance: { source: 'authored' },
    },
  };
  const result = compile(b.city);
  if (!result.ok) throw new Error('compile');
  const lot = result.compiled.lots![0]!,
    indices = lot.stalls.flatMap((s, i) => (s.aisleRoad === branch.id ? [i] : []));
  expect(indices.length).toBeGreaterThan(2);
  expect(lot.circulation!.unreachable.filter((i) => indices.includes(i))).toEqual([]);
});

test('T54 clear lot-end joins connect mapped aisles without connecting vehicle roads', () => {
  const b = buildCity('Local end aisle', 118);
  const first = b.road(b.node(0, 0), b.node(60, 0), { roadClass: 'service' }),
    second = b.road(b.node(0, 20), b.node(60, 20), { roadClass: 'service' });
  for (const road of [first, second]) road.lanes[0]!.widthM = 6;
  const id = allocateId(b.city, 'pk');
  b.city.parking = {
    [id]: {
      id,
      kind: 'lot',
      name: null,
      capacity: 0,
      access: 'public',
      placeId: null,
      connectors: [
        {
          id: allocateId(b.city, 'c'),
          roadId: first.id,
          lane: 0,
          positionM: 10,
          direction: 'both',
          throughputPerMin: 30,
        },
      ],
      shape: {
        kind: 'polygon',
        ring: [
          { x: -5, y: -10 },
          { x: 65, y: -10 },
          { x: 65, y: 30 },
          { x: -5, y: 30 },
        ],
      },
      aisles: [first.id, second.id],
      provenance: { source: 'authored' },
    },
  };
  const result = compile(b.city);
  if (!result.ok) throw new Error('compile');
  expect(result.compiled.movements).toHaveLength(0);
  expect(result.compiled.lanes).toHaveLength(2);
  expect(result.compiled.lots![0]!.circulation!.unreachable).toEqual([]);
});
