import { withoutLotAisles } from '../without-lot-aisles';
import { expect, test, vi } from 'vitest';
import { distance } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { importOsm } from '../../src/importers/osm';
import { parseOsm } from '../../src/importers/osm/parse';
import type { City } from '../../src/schema';
import { tierCities, unitTest } from '../tier';
import { fixture } from './fixtures';

const observed = vi.hoisted(() => ({
  before: undefined as City | undefined,
  fillets: [] as {
    a: Vec2;
    b: Vec2;
    c: Vec2;
    target: number;
    radius: number;
    points: Vec2[];
  }[],
}));

// T23 checks step 11's two-metre bound; step 12 has its own eight-metre contract (T24), the
// separation of coincident pairs and the relaxation (TASK-084) theirs (T36), the separation of
// close dual carriageways (TASK-087) its own (T39).
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

vi.mock(import('../../src/importers/osm/smooth'), async (load) => {
  const { smoothRoads } = await load();
  return {
    smoothRoads(...args: Parameters<typeof smoothRoads>) {
      observed.before = structuredClone(args[0]);
      observed.fillets.length = 0;
      smoothRoads(...args);
    },
  };
});

vi.mock(import('../../src/geo/polyline'), async (load) => {
  const actual = await load();
  return {
    ...actual,
    circularFillet(a: Vec2, b: Vec2, c: Vec2, target: number) {
      const result = actual.circularFillet(a, b, c, target);
      if (result) observed.fillets.push({ a, b, c, target, ...result, points: [...result.points] });
      return result;
    },
  };
});

function heading(a: Vec2, b: Vec2) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function turn(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
}

function distanceToLine(p: Vec2, line: Vec2[]) {
  let nearest = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
    nearest = Math.min(nearest, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return nearest;
}

const degree = Math.PI / 180;
const classByRadius = {
  400: 'motorway',
  250: 'trunk',
  120: 'primary',
  80: 'secondary',
  50: 'tertiary',
  60: 'ramp',
  25: 'residential',
  12: 'service',
};

test.each(
  tierCities([
    ['munich-donnersberger', [11.525, 48.135, 11.545, 48.148]],
    ['sindelfingen-a81', [8.98, 48.69, 9.0, 48.702]],
    ['downtown', undefined],
  ] as const),
)(
  'T23: %s preserves junctions and fits deterministic tangent fillets',
  (name, bbox) => {
    const { xml, options } = fixture(name);
    const imported = importOsm(xml, { ...options, bbox: bbox && [...bbox] });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const city = withoutLotAisles(imported.city);
    const before = observed.before!;
    const source = parseOsm(xml);
    if (typeof source === 'string') throw new Error(source);
    const ringIds = new Set(
      source.way.filter((w) => w.tag.junction === 'roundabout').map((w) => w.id),
    );
    const fixedIds = new Set([
      ...source.node
        .filter((n) => ['traffic_signals', 'stop', 'give_way'].includes(n.tag.highway ?? ''))
        .map((n) => n.id),
      ...source.relation.flatMap(({ member }) =>
        member.filter((m) => m.type === 'node' && m.role === 'via').map((m) => m.ref),
      ),
    ]);
    const roads = Object.values(city.roads);
    let moved = 0;
    let untouched = 0;
    let rings = 0;
    let maxDeviation = 0;
    let maxHeadingChange = 0;
    for (const road of roads) {
      const original = before.roads[road.id]!.centerline;
      const from = city.nodes[road.from]!.pos;
      const to = city.nodes[road.to]!.pos;
      const isRing = road.provenance.osmIds!.some((id) => ringIds.has(id));
      expect(road.centerline[0]).toEqual(from);
      expect(road.centerline.at(-1)).toEqual(to);
      // TASK-099: carriageways attached at the median (Arnulfstraße at n:138 and n:638) move by design.
      if (road.provenance.inferred!.includes('attached')) continue;
      if (
        isRing ||
        (original.length === 2 &&
          distance(from, original[0]!) === 0 &&
          distance(to, original[1]!) === 0)
      ) {
        expect(road.centerline).toEqual(original);
        if (isRing) rings++;
        else untouched++;
      }
      if (!road.provenance.inferred!.some((s) => s.startsWith('smoothed:'))) continue;
      for (const p of road.centerline)
        maxDeviation = Math.max(maxDeviation, distanceToLine(p, original));
      for (const p of original)
        maxDeviation = Math.max(maxDeviation, distanceToLine(p, road.centerline));
    }

    for (const node of Object.values(city.nodes)) {
      const original = before.nodes[node.id]!;
      if (distance(original.pos, node.pos) === 0) {
        expect(node.pos).toEqual(original.pos);
        continue;
      }
      moved++;
      const incoming = roads.filter((r) => r.to === node.id);
      const outgoing = roads.filter((r) => r.from === node.id);
      const incident = [...incoming, ...outgoing];
      expect(node.control).toBe('uncontrolled');
      expect(node.provenance.osmIds!.some((id) => fixedIds.has(id))).toBe(false);
      expect(incident.every((r) => r.layer === node.layer)).toBe(true);
      expect(node.provenance.inferred).not.toContain('junctionConsolidation');
      const arm = (road: (typeof roads)[number]) =>
        road.streetGroupId === null
          ? road.id
          : `${road.streetGroupId}:${road.from === node.id ? road.to : road.from}`;
      expect(new Set(incident.map(arm)).size).toBe(2);
      expect(
        Object.values(city.places)
          .filter((p) => p.kind === 'gateway')
          .every((p) =>
            p.connectors.every((c) =>
              c.direction === 'in'
                ? city.roads[c.roadId]!.to !== node.id
                : city.roads[c.roadId]!.from !== node.id,
            ),
          ),
      ).toBe(true);
      for (const a of incoming) {
        const b = outgoing.find((r) => arm(r) !== arm(a));
        if (!b) continue;
        expect(
          (a.name !== null && a.name === b.name) ||
            a.provenance.osmIds!.some((id) => b.provenance.osmIds!.includes(id)),
        ).toBe(true);
        maxHeadingChange = Math.max(
          maxHeadingChange,
          turn(heading(a.centerline.at(-2)!, node.pos), heading(node.pos, b.centerline[1]!)),
        );
      }
    }

    const forced = Object.fromEntries(
      Object.values(classByRadius).map((roadClass) => [roadClass, 0]),
    );
    expect(observed.fillets.length).toBeGreaterThan(0);
    for (const { a, b, c, radius, target, points } of observed.fillets) {
      const incoming = heading(a, b);
      const outgoing = heading(b, c);
      const angle = turn(incoming, outgoing);
      const entry = points[0]!;
      const exit = points.at(-1)!;
      const mid = points[(points.length - 1) / 2]!;
      const tangent = distance(entry, b);
      const deviation = distance(mid, b);
      expect(tangent).toBeLessThanOrEqual(Math.min(distance(a, b), distance(b, c)) / 2 + 1e-8);
      expect(deviation).toBeLessThanOrEqual(2 + 1e-8);
      if (radius < target) {
        expect(
          Math.abs(2 * tangent - Math.min(distance(a, b), distance(b, c))) < 1e-8 ||
            Math.abs(deviation - 2) < 1e-8,
        ).toBe(true);
        const roadClass = classByRadius[target as keyof typeof classByRadius];
        forced[roadClass]!++;
      } else {
        expect(radius).toBe(target);
      }
      // The arc starts and ends on the original segments, and every sample lies on
      // the same circle, whose radius at entry is perpendicular to the road.
      expect(distanceToLine(entry, [a, b])).toBeLessThan(1e-8);
      expect(distanceToLine(exit, [b, c])).toBeLessThan(1e-8);
      const side = Math.sign(Math.sin(outgoing - incoming));
      const center = {
        x: entry.x - side * radius * Math.sin(incoming),
        y: entry.y + side * radius * Math.cos(incoming),
      };
      let previous = incoming;
      for (let i = 1; i < points.length; i++) {
        const p = points[i]!;
        const q = points[i - 1]!;
        expect(Math.abs(distance(center, p) - radius)).toBeLessThan(1e-8);
        expect(distance(p, q)).toBeLessThanOrEqual(2 + 1e-8);
        const next = heading(q, p);
        maxHeadingChange = Math.max(maxHeadingChange, turn(previous, next));
        previous = next;
      }
      maxHeadingChange = Math.max(maxHeadingChange, turn(previous, outgoing));
      expect(angle / (points.length - 1)).toBeLessThanOrEqual(5 * degree + 1e-8);
    }
    expect(maxDeviation).toBeLessThanOrEqual(2 + 1e-8);
    expect(maxHeadingChange).toBeLessThanOrEqual(degree + 1e-6);
    expect(untouched).toBeGreaterThan(0);
    // TASK-131 (owner, checkpoint 0): smoothing never moves a node, so no Munich node moves (on
    // main, unstopped class seams and two-arm vertices were filleted away).
    expect(moved).toBe(0);
    if (name === 'munich-donnersberger') {
      console.info(
        'T23 Munich forced fillets (directed interiors, shared seams counted once)',
        forced,
      );
    }
    console.info('T23', name, {
      moved,
      rings,
      untouched,
      maxDeviation,
      headingDegrees: maxHeadingChange / degree,
    });
    expect(importOsm(xml, { ...options, bbox: bbox && [...bbox] })).toEqual(imported);
  },
  // Lead, 2026-11-10: Munich takes 20 s locally but 45-61 s on CI runners (as T24).
  Number(process.env.CITYFLOWS_TEST_TIMEOUT_MS ?? 180_000),
);
unitTest('T23: a two-way OSM bend has mirrored fillets and smoothing provenance', () => {
  const xml = `<osm>
    <node id="1" lat="48" lon="11"/>
    <node id="2" lat="48" lon="11.001"/>
    <node id="3" lat="48.001" lon="11.001"/>
    <way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/>
      <tag k="highway" v="residential"/>
    </way>
  </osm>`;
  const imported = importOsm(xml, { importerVersion: 'test' });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const [forward, backward] = Object.values(imported.city.roads);
  expect(forward!.centerline.length).toBeGreaterThan(3);
  expect(forward!.centerline).toEqual([...backward!.centerline].reverse());
  for (const road of [forward!, backward!])
    expect(road.provenance.inferred).toContain('smoothed:1');
});

unitTest.each([false, true])(
  // TASK-131 (owner, checkpoint 0): smoothing never moves a node, so a class transition keeps its
  // seam with or without a stop (it used to fillet the seam when no stop was there).
  'T23: a class transition keeps its seam node (stop %s)',
  (stop) => {
    const xml = `<osm>
    <node id="1" lat="48" lon="11"/>
    <node id="2" lat="48" lon="11.001">${stop ? '<tag k="highway" v="stop"/>' : ''}</node>
    <node id="3" lat="48.001" lon="11.001"/>
    <way id="10"><nd ref="1"/><nd ref="2"/>
      <tag k="highway" v="residential"/><tag k="name" v="Main"/>
    </way>
    <way id="11"><nd ref="2"/><nd ref="3"/>
      <tag k="highway" v="tertiary"/><tag k="name" v="Main"/>
    </way>
  </osm>`;
    const imported = importOsm(xml, { importerVersion: 'test' });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const seam = Object.values(imported.city.nodes).find((n) => n.provenance.osmIds!.includes(2))!;
    expect(seam.control).toBe('uncontrolled');
    expect(seam.pos).toEqual(observed.before!.nodes[seam.id]!.pos);
    expect(observed.fillets).toEqual([]);
  },
);
