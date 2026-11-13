import { withoutLotAisles } from '../without-lot-aisles';
import { readFileSync } from 'node:fs';
import { expect, vi } from 'vitest';
import { unrelatedOverlaps } from '../../bench/geometry-audit';
import { cumulativeLengths, nearestOnPolyline, pointAtDistance } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import type { City, Road } from '../../src/schema';
import { cityTest, unitTest } from '../tier';
import { fixture } from './fixtures';
import { limit } from '../timeouts';

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
    // Marsstraße's opposite one-way ways 51775137 and 69811613 were one centerline only because
    // the merge joined their far ends. TASK-131 keeps OSM nodes: r:368 runs to n:1369 and r:480
    // from n:478 (15 m apart) and they leave n:366 53 degrees apart, a wedge and not a pair.
    expect(roads['r:368']!.corridorId).toBeNull();
    expect(roads['r:480']!.corridorId).toBeNull();
    // Arnulfstraße west of n:138: one-way carriageways about 15 m apart.
    expect(roads['r:715']!.corridorId).toBe('corridor:151784477+316052825');
    expect(roads['r:958']!.corridorId).toBe('corridor:151784477+316052825');
    expect(roads['r:715']!.provenance.inferred).not.toContain('separated');
    // Arnulfstraße's way 54200280 pairs with 57832630 on two sections: numbered like street groups.
    // TASK-131: with OSM nodes kept, the first section's 54200280 carriageway is r:1350 (r:395,
    // its 30 m piece between n:150 and n:1349, has no partner).
    expect(roads['r:1350']!.corridorId).toBe('corridor:54200280+57832630');
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
    // TASK-131 keeps OSM nodes: main's five coincident pairs ran between the same two nodes only
    // because the merge joined their ends (5 -> 0).
    expect(kinds.coincident).toBe(0);
    expect(kinds.dual).toBeGreaterThan(0);
    // TASK-131: main's pushed pairs (TASK-087's Landsberger r:325/r:941, r:327/r:1330,
    // r:724/r:1279 and TASK-089's r:1277/r:1362, r:1354/r:447) were close only after the merge
    // and the median pull; on their OSM lines their medians are 9 m or more, so they stay dual.
    // The one pushed pair is Trappentreutunnel r:687/r:1030 (10.1 m apart for 10.5 m of lanes,
    // pushOverlapping) (5 -> 1). The same-direction Landsberger pair r:729/r:984 met at main's
    // merged n:1181; kept, r:728 and r:984 end at n:474 and n:1353 (1 -> 0).
    expect(kinds.pushed).toBe(1);
    expect(kinds.sameDirection).toBe(0);
    // TASK-093: Landsberger r:961 (beside r:1276 and r:1366 into n:362), r:978 (r:476/r:1308) and
    // r:644 (r:922/r:964), Marsstraße r:944 (r:845/r:1370) and Arnulfstraße r:654 (r:680/r:698)
    // continue their pair's carriageway.
    expect(kinds.thirdWay).toBe(5);
  },
  limit(120_000),
);

// TASK-131 rewrote T36.2: it pinned separateCoincident on Marsstraße r:368/r:480, a pair the merge
// had made coincident (offset 3.75 m, a 0.5 m median) and TASK-099's attached joint n:652. With
// OSM nodes kept they are a real divided pair (a wedge out of n:366): drawn where OSM draws them.
cityTest(
  'T36.2: Marsstraße keeps its OSM lines, topology unchanged and no node moved',
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
      expect(road.lateralOffsetM).toBe(0);
      expect(road.provenance.inferred).not.toContain('separated');
      expect(road.centerline).toEqual(original.centerline);
    }
    expect(a.from).toBe(b.to);
    expect(a.to).not.toBe(b.from);
    expect(Object.keys(city.roads)).toEqual(Object.keys(before.roads));
    // TASK-131: attachCarriageways is deleted, and no later pass moves a node.
    for (const node of Object.values(city.nodes))
      expect(node.pos).toEqual(before.nodes[node.id]!.pos);

    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(
      unrelatedOverlaps(city, result.compiled).filter((o) => /r:(368|480)\b/.test(o.roads)),
    ).toEqual([]);
  },
  limit(120_000),
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
    // TASK-131: the collision model is off by default; it still works at its former 3 m bound.
    const city = run(3);
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
    // TASK-131 (B55): two streets overlapping side by side are drawn with an edge line between
    // them and are not unrelated overlap, relaxed or not; the clearance above is the measure.
    expect([overlapOff, overlapOn]).toEqual([0, 0]);
    expect(JSON.stringify(run(3))).toBe(JSON.stringify(city));
    // A bridge does not interact with the road under it.
    const bridge = importOsm(parallel({ bridge: 'yes', layer: '1' }), { importerVersion: 'test' });
    if (!bridge.ok) throw new Error(JSON.stringify(bridge.diagnostics));
    for (const road of Object.values(bridge.city.roads)) expect(relaxed(road)).toBe(0);
  },
);

// T36.4, Munich's morning, became the traffic gate in tests/traffic/munich-morning.test.ts.
