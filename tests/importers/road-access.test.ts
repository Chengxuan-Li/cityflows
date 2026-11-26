import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { roadSpecs } from '../../src/importers/osm/roads';
import { roadSchema, vehicleClasses } from '../../src/schema';

function specs(tags: Record<string, string>) {
  return roadSpecs({ id: 1, nd: [1, 2], tag: { highway: 'service', ...tags } }, 'service', []);
}

test('access precedence, directional class overrides, limits and inference', () => {
  const [forward, backward] = specs({
    access: 'private',
    vehicle: 'destination',
    motor_vehicle: 'no',
    motorcar: 'yes',
    hgv: 'delivery',
    'hgv:backward': 'no',
    psv: 'no',
    bus: 'designated',
  });
  expect(forward!.access).toEqual({ all: 'yes', truck: 'delivery', bus: 'yes' });
  expect(backward!.access).toEqual({ all: 'yes', truck: 'no', bus: 'yes' });
  expect(specs({ access: 'employees' })[0]!.provenance.inferred).toContain('access');
  expect(specs({ access: 'employees' })[0]!.access).toEqual({ all: 'yes' });
  expect(specs({ access: 'customers' })[0]!.access).toEqual({ all: 'private' });
  expect(specs({ access: 'permissive' })[0]!.access).toEqual({ all: 'yes' });
  expect(specs({ maxweight: '3.4', bus: 'yes' })[0]!.access).toMatchObject({
    truck: 'no',
    bus: 'no',
  });
  expect(specs({ maxheight: '2.9' })[0]!.access).toMatchObject({ truck: 'no', bus: 'no' });
  expect(specs({ maxweight: '3.5', maxheight: '3.0' })[0]!.access).toBeUndefined();
  expect(specs({ maxheight: 'unknown' })[0]!.provenance.inferred).toContain('maxheight');
  expect(
    specs({ 'access:forward': 'no', 'access:backward': 'destination' }).map((s) => s.access),
  ).toEqual([{ all: 'no' }, { all: 'destination' }]);
});

// TASK-271 (TASK-259 D12): time-conditional access read into the one value a road carries, over
// the simulated day (07:00 to 19:00, a working day).
test.each([
  // York's footstreets: closed most of the day, with delivery windows.
  [
    { 'motor_vehicle:conditional': 'delivery @ (08:00-10:30, 17:00-18:00); no @ (10:30-17:00)' },
    'delivery',
  ],
  [
    {
      motor_vehicle: 'no',
      'motor_vehicle:conditional': 'yes @ (18:00-08:00; 10:00-16:00 AND loading)',
    },
    'delivery',
  ],
  [
    {
      motor_vehicle: 'yes',
      'motor_vehicle:conditional': 'yes @ (18:00-08:00; 10:00-16:00 AND loading)',
    },
    'yes',
  ],
  [{ 'motor_vehicle:conditional': 'destination @ (10:30-18:00)' }, 'destination'],
  [{ 'vehicle:conditional': 'destination @ (Mo-Sa 08:00-18:00)' }, 'destination'],
  [{ 'vehicle:conditional': 'destination @ (Sa 08:00-18:00)' }, undefined],
  [
    { vehicle: 'no', 'vehicle:conditional': 'destination @ delivery AND (05:00-10:30; 19:00-22)' },
    'delivery',
  ],
  // Cambridge's school street closes for less than half the day.
  [
    { 'motor_vehicle:conditional': 'destination @ (Mo-Fr 08:30-09:30,14:45-15:30; SH off)' },
    undefined,
  ],
  // Not read: dates, occupancy, nights.
  [{ 'motor_vehicle:conditional': 'no @ (2026 Jan 05-2026 Apr 30)' }, undefined],
  [{ 'vehicle:conditional': 'destination @ (occupancy > 16)' }, undefined],
  [{ 'motor_vehicle:conditional': 'no @ (20:00-07:00)' }, undefined],
])('conditional access %j reads as %s', (tags, all) => {
  expect(specs(tags)[0]!.access?.all).toBe(all);
});

test('directional and class conditional access', () => {
  const [forward, backward] = specs({
    'motor_vehicle:backward:conditional': 'no @ (Mo-Sa 08:00-18:00)',
    'hgv:conditional': 'no @ (07:00-19:00)',
    psv: 'yes',
  });
  expect(forward!.access).toEqual({ truck: 'no', bus: 'yes' });
  expect(backward!.access).toEqual({ all: 'no', bus: 'yes' });
  expect(specs({ 'hgv:conditional': 'no @ (20:00-07:00)' })[0]!.access).toBeUndefined();
});

// TASK-271 (TASK-259 D18, D12): `faux` is no one-way; `alternating` is one lane both ways share.
test.each([
  ['faux', 2, false],
  ['alternating', 2, true],
  ['reversible', 2, false],
])('oneway=%s', (oneway, directions, shared) => {
  const diagnostics: Parameters<typeof roadSpecs>[2] = [];
  const read = roadSpecs(
    { id: 1, nd: [1, 2], tag: { highway: 'tertiary', oneway, lanes: '2' } },
    'tertiary',
    diagnostics,
  );
  expect(read).toHaveLength(directions);
  expect(read.map((s) => s.provenance.inferred.includes('sharedLane'))).toEqual([shared, shared]);
  expect(diagnostics.length).toBe(oneway === 'reversible' ? 1 : 0);
});

function imported(tags: Record<string, string>, drivingSide: 'right' | 'left' = 'right') {
  const result = importOsm(
    `<osm version="0.6"><node id="1" lat="48" lon="9"/><node id="2" lat="48" lon="9.01"/><way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/>${Object.entries(
      tags,
    )
      .map(([k, v]) => `<tag k="${k}" v="${v}"/>`)
      .join('')}</way></osm>`,
    { importerVersion: 'test', drivingSide },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return Object.values(result.city.roads);
}

test.each([
  [{ lanes: '4', 'lanes:bus:forward': '1' }, [1, 0]],
  [{ lanes: '4', 'lanes:psv:backward': '1' }, [0, 1]],
  [{ lanes: '4', 'lanes:bus': '1', 'busway:backward': 'lane' }, [0, 1]],
  [{ lanes: '4', 'lanes:bus': '1', 'busway:forward': 'no' }, [0, 1]],
  [{ lanes: '4', 'lanes:bus': '2', 'busway:forward': 'lane', 'busway:backward': 'lane' }, [1, 1]],
  [{ lanes: '4', 'lanes:bus': '2', 'busway:left': 'lane', 'busway:right': 'lane' }, [1, 1]],
  [{ lanes: '4', 'lanes:bus': '1', 'busway:forward': 'no', 'busway:backward': 'lane' }, [0, 1]],
  [{ lanes: '4', 'lanes:bus:right': '1' }, [1, 0]],
  [{ lanes: '4', 'lanes:psv:left': '1' }, [0, 1]],
  [{ lanes: '4', 'busway:right': 'lane' }, [1, 0]],
  [{ lanes: '4', 'busway:left': 'lane' }, [0, 1]],
  [{ lanes: '4', 'busway:forward': 'lane' }, [1, 0]],
  [{ lanes: '4', 'busway:backward': 'lane' }, [0, 1]],
  [{ lanes: '4', busway: 'lane' }, [1, 1]],
  [{ lanes: '4', 'lanes:bus': '2' }, [1, 1]],
  [{ lanes: '2', oneway: 'yes', 'bus:lanes': 'no|designated' }, [1]],
  [{ lanes: '2', oneway: 'yes', 'bus:lanes': 'yes|designated' }, [1]],
  [{ lanes: '4', 'psv:lanes:backward': 'no|designated' }, [0, 1]],
] as const)('imports curb bus reservations %j', (tags, expected) => {
  for (const side of ['right', 'left'] as const) {
    const roads = imported(tags, side);
    const counts =
      side === 'left' && Object.keys(tags).some((key) => /:(left|right)$/.test(key))
        ? [...expected].reverse()
        : expected;
    expect(roads.map((r) => r.lanes.filter((l) => l.allowed.length === 1).length)).toEqual(counts);
    roads.forEach((road, index) => {
      if (!counts[index]) return;
      // Exact :lanes patterns are left to right in travel direction, regardless of driving side.
      const exact = Object.keys(tags).some((k) => /^(bus|psv):lanes/.test(k));
      const lane = exact || side === 'right' ? road.lanes.at(-1)! : road.lanes[0]!;
      expect(lane.allowed).toEqual(['bus']);
    });
  }
});

test('private service roads persist and access validation retains only known classes', () => {
  const road = imported({ access: 'private' })[0]!;
  expect(road.access).toEqual({ all: 'private' });
  expect(roadSchema.parse(road)).toEqual(road);
  expect(roadSchema.safeParse({ ...road, access: { all: 'permit' } }).success).toBe(false);
  expect(roadSchema.safeParse({ ...road, access: { spaceship: 'no' } }).success).toBe(false);
  for (const kind of vehicleClasses)
    expect(roadSchema.parse({ ...road, access: { [kind]: 'delivery' } }).access).toEqual({
      [kind]: 'delivery',
    });
});

test('per-lane bus yes keeps general traffic while no forbids buses', () => {
  const shared = imported({ lanes: '2', oneway: 'yes', 'bus:lanes': 'yes|designated' })[0]!;
  expect(shared.lanes[0]!.allowed).toEqual([...vehicleClasses]);
  const forbidden = imported({ lanes: '2', oneway: 'yes', 'psv:lanes': 'no|designated' })[0]!;
  expect(forbidden.lanes[0]!.allowed).not.toContain('bus');
  expect(forbidden.lanes[0]!.allowed).toContain('car');
});

test('junction consolidation preserves a short closed segment between open roads', () => {
  const result = importOsm(
    `<osm version="0.6">
    <node id="1" lat="48" lon="9"/><node id="2" lat="48" lon="9.002"/>
    <node id="3" lat="48" lon="9.0021"/><node id="4" lat="48" lon="9.0041"/>
    <way id="1"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
    <way id="2"><nd ref="2"/><nd ref="3"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/><tag k="access" v="no"/></way>
    <way id="3"><nd ref="3"/><nd ref="4"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way>
  </osm>`,
    { importerVersion: 'test' },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(
    Object.values(result.city.roads).some(
      (road) => road.access?.all === 'no' && road.provenance.osmIds?.includes(2),
    ),
  ).toBe(true);
});
