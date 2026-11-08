import { withoutLotAisles } from '../without-lot-aisles';
import { readFileSync } from 'node:fs';
import { expect, vi } from 'vitest';
import { directionPairs, pairGapAudit, unrelatedOverlaps } from '../../bench/geometry-audit';
import { cumulativeLengths, nearestOnPolyline, pointAtDistance } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { importOsm } from '../../src/importers/osm';
import { DEFAULT_RELAX_MAX_M } from '../../src/importers/osm/relax';
import { compile } from '../../src/network';
import type { City, Road } from '../../src/schema';
import { cityTest, unitTest } from '../tier';
import { fixture } from './fixtures';

const observed = vi.hoisted(() => ({ beforeSeparation: undefined as City | undefined }));
vi.mock(import('../../src/importers/osm/corridors'), async (load) => {
  const actual = await load();
  return {
    ...actual,
    separateCoincident(...args: Parameters<typeof actual.separateCoincident>) {
      observed.beforeSeparation = structuredClone(args[0]);
      actual.separateCoincident(...args);
    },
  };
});

const munich = () => {
  const result = importOsm(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
    importerVersion: 'test',
    drivingSide: 'right',
    bbox: [11.525, 48.135, 11.545, 48.148],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return withoutLotAisles(result.city);
};

/** An OSM document of straight ways given in metres (x east, y south) around 48 N, 11 E. */
function osm(ways: { id: number; tags: Record<string, string>; points: [number, number][] }[]) {
  const metres = 111_320;
  const ll = (x: number, y: number) => ({
    lat: 48 - y / metres,
    lon: 11 + x / (metres * Math.cos((48 * Math.PI) / 180)),
  });
  let id = 1;
  const nodes: string[] = [];
  const body = ways.map(({ id: wayId, tags, points }) => {
    const refs = points.map(([x, y]) => {
      const { lat, lon } = ll(x, y);
      nodes.push(`<node id="${id}" lat="${lat.toFixed(10)}" lon="${lon.toFixed(10)}"/>`);
      return `<nd ref="${id++}"/>`;
    });
    const tagged = Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`);
    return `<way id="${wayId}">${refs.join('')}${tagged.join('')}</way>`;
  });
  const [nw, se] = [ll(-100, -100), ll(300, 100)];
  const bounds = `minlat="${se.lat}" minlon="${nw.lon}" maxlat="${nw.lat}" maxlon="${se.lon}"`;
  return `<osm><bounds ${bounds}/>${nodes.join('')}${body.join('')}</osm>`;
}

const relaxed = (road: Road) =>
  Number(road.provenance.inferred!.find((s) => s.startsWith('relaxed:'))?.slice(8) ?? 0);

/** Smallest radius through three consecutive centerline points. */
function minimumRadius(line: Vec2[]) {
  let radius = Infinity;
  for (let i = 1; i < line.length - 1; i++) {
    const [a, b, c] = [line[i - 1]!, line[i]!, line[i + 1]!];
    const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const sides = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y);
    if (cross > 1e-12)
      radius = Math.min(radius, (sides * Math.hypot(c.x - a.x, c.y - a.y)) / (2 * cross));
  }
  return radius;
}

cityTest(
  'T36.1: corridors of two-way ways, coincident pairs and dual carriageways, stable ids',
  () => {
    const { xml, options } = fixture('downtown');
    const downtown = importOsm(xml, options);
    if (!downtown.ok) throw new Error(JSON.stringify(downtown.diagnostics));
    const twoWay = Object.values(downtown.city.roads).filter((r) => r.streetGroupId !== null);
    expect(twoWay.length).toBeGreaterThan(0);
    for (const road of twoWay) expect(road.corridorId).toBe(road.streetGroupId);

    const city = munich();
    const roads = city.roads;
    // Marsstraße: opposite one-way ways 51775137 and 69811613 drawn on one centerline.
    expect(roads['r:368']!.corridorId).toBe('corridor:51775137+69811613');
    expect(roads['r:480']!.corridorId).toBe('corridor:51775137+69811613');
    // Arnulfstraße west of n:138: one-way carriageways about 15 m apart.
    expect(roads['r:715']!.corridorId).toBe('corridor:151784477+316052825');
    expect(roads['r:958']!.corridorId).toBe('corridor:151784477+316052825');
    expect(roads['r:715']!.provenance.inferred).not.toContain('separated');
    // Arnulfstraße's way 54200280 pairs with 57832630 on two sections: numbered like street groups.
    expect(roads['r:395']!.corridorId).toBe('corridor:54200280+57832630');
    expect(roads['r:451']!.corridorId).toBe('corridor:54200280+57832630/1');

    const ids = (c: City) => Object.values(c.roads).map((r) => [r.id, r.corridorId]);
    expect(ids(munich())).toEqual(ids(city));
    const kinds = {
      twoWay: 0,
      coincident: 0,
      dual: 0,
      pushed: 0,
      sameDirection: 0,
      thirdWay: 0,
      none: 0,
    };
    const members = new Map<string, Road[]>();
    for (const road of Object.values(roads)) {
      if (road.corridorId === null) kinds.none++;
      else members.set(road.corridorId!, [...(members.get(road.corridorId!) ?? []), road]);
    }
    for (const [id, list] of members) {
      let pair = list;
      if (list.length === 3) {
        // TASK-093 (B49): a carriageway drawn as two ways that meet at a node joins its pair's
        // corridor as a third way.
        const joint = list.find((y) => list.some((x) => x.to === y.from));
        expect(joint, id).toBeDefined();
        kinds.thirdWay++;
        pair = list.filter((r) => r !== joint);
      }
      expect(pair).toHaveLength(2);
      const [x, y] = pair as [Road, Road];
      if (!id.startsWith('corridor:')) kinds.twoWay++;
      else if (x.from === y.from) kinds.sameDirection++;
      else if (!x.provenance.inferred!.includes('separated')) kinds.dual++;
      else if (JSON.stringify(x.centerline) === JSON.stringify([...y.centerline].reverse()))
        kinds.coincident++;
      else kinds.pushed++;
    }
    console.info('T36.1 Munich corridors', kinds);
    // TASK-101: retained truck-delivery boundaries make r:392/r:402, r:406/r:1346 and
    // r:451/r:1342 pushed rather than coincident; retained r:1322/r:1350 adds one pair (7-3+1).
    expect(kinds.coincident).toBe(5);
    expect(kinds.dual).toBeGreaterThan(0);
    // TASK-087 (T39): three dual carriageways pushed apart (Landsberger r:325/r:941, r:327/r:1330,
    // r:724/r:1279) and the same-direction Landsberger pair r:729/r:984. TASK-089: two more whose
    // continuation across a node the network now sets side by side (Landsberger r:1277/r:1362 at
    // n:774, Arnulfstraße r:1354/r:447 at n:382).
    expect(kinds.pushed).toBe(5);
    expect(kinds.sameDirection).toBe(1);
    // TASK-093: Landsberger r:961 (beside r:1276 into n:967), r:1044 and r:1308, Marsstraße r:944
    // and r:698 continue their pair's carriageway.
    expect(kinds.thirdWay).toBe(5);
  },
  120_000,
);

cityTest(
  'T36.2: Marsstraße becomes a divided pair with a 0.5 m median, topology unchanged',
  () => {
    const city = munich();
    const before = observed.beforeSeparation!;
    const [a, b] = [city.roads['r:368']!, city.roads['r:480']!];
    for (const road of [a, b]) {
      const original = before.roads[road.id]!;
      expect([road.from, road.to, road.provenance.osmIds]).toEqual([
        original.from,
        original.to,
        original.provenance.osmIds,
      ]);
      expect(original.lateralOffsetM).toBe(0);
      // Half its two 3.5 m lanes plus half the median, to the right of travel.
      expect(road.lateralOffsetM).toBe(3.75);
      expect(road.provenance.inferred).toContain('separated');
    }
    expect(a.centerline).toEqual(before.roads['r:368']!.centerline);
    expect(b.centerline).toEqual([...a.centerline].reverse());
    expect(Object.keys(city.roads)).toEqual(Object.keys(before.roads));
    // TASK-099: a joint of an attached carriageway moves with it (n:652, 2.24 m).
    const joint = (id: string) => {
      const incident = Object.values(city.roads).filter((r) => r.from === id || r.to === id);
      return (
        incident.length === 2 && incident.every((r) => r.provenance.inferred!.includes('attached'))
      );
    };
    for (const node of Object.values(city.nodes))
      if (!joint(node.id)) expect(node.pos).toEqual(before.nodes[node.id]!.pos);

    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const net = result.compiled;
    const pair = directionPairs(city, net).find(({ a: x, b: y }) =>
      [x.id, y.id].every((id) => id === 'r:368' || id === 'r:480'),
    )!;
    // Measure 2: the median edges run 0.5 m apart (7 m overlapping before).
    const gap = pairGapAudit(net, pair.a, pair.b, pair.kind, [0, 0]);
    expect(gap.signedM).toBeCloseTo(0.5, 2);
    expect(gap.maxM).toBeCloseTo(0.5, 2);
    expect(unrelatedOverlaps(city, net).filter((o) => /r:(368|480)\b/.test(o.roads))).toEqual([]);
  },
  120_000,
);

unitTest(
  'T36.2: a coincident pair on separate nodes parts in its middle, eased at the ends',
  () => {
    // Westbound B lies 0.4 m south of eastbound A over A's length, then leaves at 45 degrees.
    const xml = osm([
      {
        id: 1,
        tags: { highway: 'residential', oneway: 'yes' },
        points: [
          [0, 0],
          [200, 0],
        ],
      },
      {
        id: 2,
        tags: { highway: 'residential', oneway: 'yes' },
        points: [
          [240, 40.4],
          [200, 0.4],
          [0, 0.4],
          [-40, 40.4],
        ],
      },
    ]);
    const result = importOsm(xml, { importerVersion: 'test', relaxMaxM: 0 });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const [a, b] = Object.values(result.city.roads) as [Road, Road];
    const before = observed.beforeSeparation!;
    expect(a.corridorId).toBe('corridor:1+2');
    expect(b.corridorId).toBe('corridor:1+2');
    for (const road of [a, b]) {
      expect(road.provenance.inferred).toContain('separated');
      expect(road.centerline[0]).toEqual(before.roads[road.id]!.centerline[0]);
      expect(road.centerline.at(-1)).toEqual(before.roads[road.id]!.centerline.at(-1));
      // B's 45 degree bends are smoothing fillets (about 25 m) that the easing shifts inward.
      expect(minimumRadius(road.centerline)).toBeGreaterThan(10);
    }
    const yAt = (road: Road, x: number) =>
      nearestOnPolyline(road.centerline, { x: x + a.centerline[0]!.x, y: a.centerline[0]!.y }).point
        .y - a.centerline[0]!.y;
    // Middle line y = 0.2 (the mean over the coincident run, within 5 cm); each centerline half
    // its 3 m lane plus 0.25 m to its right.
    for (const x of [50, 100, 150]) {
      expect(yAt(a, x)).toBeCloseTo(0.2 + 1.75, 1);
      expect(yAt(b, x)).toBeCloseTo(0.2 - 1.75, 1);
    }
    // Eased over A's junction zones and back onto B's own line beyond the taper.
    expect(Math.abs(yAt(a, 1))).toBeLessThan(0.05);
    const lengths = cumulativeLengths(b.centerline);
    const original = before.roads[b.id]!.centerline;
    for (const s of [5, lengths.at(-1)! - 5])
      expect(
        nearestOnPolyline(original, pointAtDistance(b.centerline, lengths, s)).away,
      ).toBeLessThan(1e-6);
  },
);

const parallel = (minor: Record<string, string>) =>
  osm([
    {
      id: 10,
      tags: { highway: 'primary', oneway: 'yes', lanes: '1', name: 'Major' },
      points: [
        [0, 0],
        [200, 0],
      ],
    },
    // A 3 m residential lane whose centerline is 1.25 m from the 3.5 m primary lane's: 2 m overlap.
    {
      id: 20,
      tags: { highway: 'residential', oneway: 'yes', name: 'Minor', ...minor },
      points: [
        [0, 1.25],
        [200, 1.25],
      ],
    },
  ]);

unitTest(
  'T36.3: relaxation clears unrelated parallel roads, smoothly and deterministically',
  () => {
    const xml = parallel({});
    const run = (relaxMaxM: number) => {
      const result = importOsm(xml, { importerVersion: 'test', relaxMaxM });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      return withoutLotAisles(result.city);
    };
    const off = run(0);
    const city = run(DEFAULT_RELAX_MAX_M);
    const [major, minor] = [city.roads['r:3']!, city.roads['r:6']!];
    expect([major.name, minor.name]).toEqual(['Major', 'Minor']);
    for (const road of Object.values(off.roads)) {
      expect(road.centerline).toHaveLength(2);
      expect(relaxed(road)).toBe(0);
    }
    expect(city.nodes).toEqual(off.nodes);
    for (const road of [major, minor]) {
      expect(road.centerline[0]).toEqual(off.roads[road.id]!.centerline[0]);
      expect(road.centerline.at(-1)).toEqual(off.roads[road.id]!.centerline.at(-1));
      expect(minimumRadius(road.centerline)).toBeGreaterThan(30);
    }
    // The residential road takes the larger share.
    expect(relaxed(minor)).toBeGreaterThan(2 * relaxed(major));
    expect(relaxed(minor) + relaxed(major)).toBeLessThan(3);
    // Clear of each other (blocks 0.5 m apart, the capsules' 0.6 m less a few centimetres) from
    // 45 m past the junction zones' 15 m ramp to the same distance before the far end.
    const origin = major.centerline[0]!;
    for (let x = 45; x <= 155; x += 5) {
      const p = nearestOnPolyline(major.centerline, { x: origin.x + x, y: origin.y }).point;
      expect(nearestOnPolyline(minor.centerline, p).away).toBeGreaterThan(1.75 + 1.5 + 0.5);
    }
    const compiled = (c: City) => {
      const result = compile(c);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      return unrelatedOverlaps(c, result.compiled).reduce((sum, o) => sum + o.areaM2, 0);
    };
    const [overlapOff, overlapOn] = [compiled(off), compiled(city)];
    console.info(
      'T36.3 overlap m2',
      { off: overlapOff, relaxed: overlapOn },
      {
        major: relaxed(major),
        minor: relaxed(minor),
        radius: [minimumRadius(major.centerline), minimumRadius(minor.centerline)],
      },
    );
    expect(overlapOn).toBeLessThan(overlapOff / 4);
    expect(JSON.stringify(run(DEFAULT_RELAX_MAX_M))).toBe(JSON.stringify(city));
    // A bridge does not interact with the road under it.
    const bridge = importOsm(parallel({ bridge: 'yes', layer: '1' }), { importerVersion: 'test' });
    if (!bridge.ok) throw new Error(JSON.stringify(bridge.diagnostics));
    for (const road of Object.values(bridge.city.roads)) expect(relaxed(road)).toBe(0);
  },
);

// T36.4, Munich's morning, became the traffic gate in tests/traffic/munich-morning.test.ts.
