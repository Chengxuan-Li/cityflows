import { expect, test } from 'vitest';
import { laneOverlaps } from '../../bench/geometry-audit';
import { auditCities, loadAuditCity, type AuditCity } from '../../bench/junction-audit';
import { cumulativeLengths, nearestOnPolyline, pointAtDistance } from '../../src/geo/polyline';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import type { City, Road } from '../../src/schema';
import { junctionOverlaps } from '../network/junction-audit';

// T39 (TASK-087, B41, B42): carriageways of one street must not overlap outside the junction
// polygons. The importer pushes apart the two carriageways of a dual-carriageway corridor that
// meet at both their nodes (`separateDual`) and lays a same-direction coincident pair side by
// side (`pairSameDirection`); measure 9 of the geometry audit (lane overlap) checks the result.

const compiled = new Map<AuditCity, { city: City; net: CompiledCity }>();
function load(name: AuditCity) {
  let entry = compiled.get(name);
  if (!entry) {
    const city = loadAuditCity(name);
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
    compiled.set(name, (entry = { city, net: result.compiled }));
  }
  return entry;
}

/** An OSM document of ways given in metres (x east, y south) around 48 N, 11 E. */
function osm(ways: { id: number; tags: Record<string, string>; points: [number, number][] }[]) {
  const metres = 111_320;
  const ll = (x: number, y: number) => ({
    lat: 48 - y / metres,
    lon: 11 + x / (metres * Math.cos((48 * Math.PI) / 180)),
  });
  const ids = new Map<string, number>();
  const nodes: string[] = [];
  const body = ways.map(({ id: wayId, tags, points }) => {
    const refs = points.map(([x, y]) => {
      const key = `${x},${y}`;
      if (!ids.has(key)) {
        ids.set(key, ids.size + 1);
        const { lat, lon } = ll(x, y);
        nodes.push(
          `<node id="${ids.get(key)}" lat="${lat.toFixed(10)}" lon="${lon.toFixed(10)}"/>`,
        );
      }
      return `<nd ref="${ids.get(key)}"/>`;
    });
    const tagged = Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`);
    return `<way id="${wayId}">${refs.join('')}${tagged.join('')}</way>`;
  });
  const [nw, se] = [ll(-200, -100), ll(400, 100)];
  const bounds = `minlat="${se.lat}" minlon="${nw.lon}" maxlat="${nw.lat}" maxlon="${se.lon}"`;
  return `<osm><bounds ${bounds}/>${nodes.join('')}${body.join('')}</osm>`;
}

/** Eastbound A straight from (0, 0) to (200, 0); westbound B from (200, 0) back to (0, 0) through
 * (100, -12), so the two meet at both nodes at about 13 degrees; two-lane primary carriageways
 * of one name. A side street at each node; `west` continues the street west of (0, 0). */
function dual(west: 'two-way' | 'one-way') {
  const street = { highway: 'primary', oneway: 'yes', lanes: '2', name: 'Dual' };
  return osm([
    {
      id: 1,
      tags: street,
      points: [
        [0, 0],
        [200, 0],
      ],
    },
    {
      id: 2,
      tags: street,
      points: [
        [200, 0],
        [150, -11],
        [100, -12],
        [50, -11],
        [0, 0],
      ],
    },
    {
      id: 3,
      tags: west === 'two-way' ? { highway: 'primary', lanes: '4', name: 'Dual' } : street,
      points: [
        [0, 0],
        [-150, 0],
      ],
    },
    {
      id: 4,
      tags: { highway: 'residential', name: 'Side' },
      points: [
        [0, 0],
        [0, 80],
      ],
    },
    {
      id: 5,
      tags: { highway: 'residential', name: 'Side' },
      points: [
        [200, 0],
        [200, 80],
      ],
    },
  ]);
}

const blockAt = (road: Road, s: number) => {
  const lengths = cumulativeLengths(road.centerline);
  const p = pointAtDistance(road.centerline, lengths, s);
  const q = pointAtDistance(road.centerline, lengths, Math.min(lengths.at(-1)!, s + 0.5));
  const o = pointAtDistance(road.centerline, lengths, Math.max(0, s - 0.5));
  const d = Math.hypot(q.x - o.x, q.y - o.y);
  return {
    x: p.x - ((q.y - o.y) / d) * road.lateralOffsetM,
    y: p.y + ((q.x - o.x) / d) * road.lateralOffsetM,
  };
};

test('T39.1: a dual carriageway meeting at both nodes runs side by side up to them', () => {
  const run = (xml: string) => {
    const result = importOsm(xml, { importerVersion: 'test', relaxMaxM: 0 });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    return result.city;
  };
  const city = run(dual('two-way'));
  const [a, b] = ['Dual', 'Dual'].map((_, k) =>
    Object.values(city.roads).find(
      (r) => r.provenance.osmIds!.includes(k + 1) && r.streetGroupId === null,
    ),
  ) as [Road, Road];
  expect(a.corridorId).toBe(b.corridorId);
  for (const road of [a, b]) {
    // Half its two 3.5 m lanes plus half the 0.5 m median, to the right of travel.
    expect(road.lateralOffsetM).toBe(3.75);
    expect(road.provenance.inferred).toContain('separated');
    expect(road.centerline[0]).toEqual(city.nodes[road.from]!.pos);
    expect(road.centerline.at(-1)).toEqual(city.nodes[road.to]!.pos);
  }
  // Near the nodes the centerlines are one middle line, the blocks 7.5 m apart; in the middle,
  // where the source draws them 12 m apart, the lanes stay on their own lines.
  const length = cumulativeLengths(a.centerline).at(-1)!;
  for (const s of [0, 2, 5, 10, length - 5, length]) {
    const p = pointAtDistance(a.centerline, cumulativeLengths(a.centerline), s);
    expect(nearestOnPolyline(b.centerline, p).away).toBeLessThan(1e-6);
  }
  expect(Math.abs(blockAt(a, 100).y - a.centerline[0]!.y)).toBeLessThan(0.02);
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(laneOverlaps(city, result.compiled).filter((o) => o.corridor)).toEqual([]);
  expect(junctionOverlaps(result.compiled)).toEqual([]);

  // A centred one-way continuation west of the node: pushing the pair would make the through
  // lanes there jog by 3.75 m, so the pair stays as drawn.
  const centred = run(dual('one-way'));
  for (const road of Object.values(centred.roads).filter((r) => r.name === 'Dual'))
    expect(road.lateralOffsetM).toBe(0);
}, 60_000);

// Measure 9 on main dc01ed4 (m2) for every pair that still overlaps, and the corridor pairs left.
const unrelated: Record<AuditCity, Record<string, number>> = {
  grid: {},
  town: {},
  sindelfingen: {
    'r:1004/r:435': 22.64,
    'r:1029/r:1179': 112,
    'r:1030/r:1178': 113.39,
    'r:1091/r:892': 7.3,
    'r:1228/r:140': 8.57,
    'r:1247/r:451': 0.37,
    'r:1252/r:545': 6.25,
    'r:1254/r:464': 0.71,
    'r:1255/r:464': 0.84,
    'r:1255/r:545': 16.57,
    'r:127/r:424': 1.71,
    'r:128/r:424': 5.93,
    'r:13/r:439': 22.73,
    'r:13/r:442': 138.69,
    'r:140/r:475': 18.17,
    'r:140/r:476': 135.5,
    'r:141/r:476': 17.44,
    'r:284/r:400': 5.22,
    'r:285/r:399': 5.61,
    'r:432/r:874': 49.61,
    'r:464/r:543': 7.71,
    'r:475/r:520': 3.88,
    'r:476/r:521': 4.18,
    'r:499/r:876': 47.18,
    'r:650/r:80': 169.7,
    'r:674/r:873': 5.02,
    'r:695/r:9': 22.83,
    'r:708/r:715': 0.01,
    'r:920/r:997': 21.99,
  },
  munich: {
    'r:1024/r:899': 87.09,
    'r:1027/r:900': 83.69,
    'r:1030/r:416': 33.56,
    'r:1030/r:687': 4.09,
    'r:1093/r:1094': 21.97,
    'r:1093/r:1095': 20.87,
    'r:1189/r:735': 6.28,
    'r:196/r:259': 4.59,
    'r:196/r:416': 72.62,
    'r:259/r:261': 2.42,
    'r:416/r:694': 0.94,
    'r:565/r:589': 120.34,
    'r:566/r:588': 117.57,
    'r:685/r:997': 0.04,
    'r:735/r:925': 6.89,
  },
};
/** Corridor pairs whose lanes still overlap outside the outlines, and why. Each needs its two
 * ends side by side at a node where a single `lateralOffsetM` per road cannot put them (the
 * pair meets that node from one side only, or a centred continuation would jog across it). */
const corridorResiduals: Record<string, string> = {
  'r:1276/r:1368': 'Landsberger meets n:774 from the west only (far ends n:967, n:936).',
  'r:1277/r:1362': 'Landsberger n:774 to n:719: pushing it would jog through r:1276 at n:774.',
  'r:1354/r:447': 'Arnulfstraße n:446 to n:382: pushing it would jog through r:383/r:399 at n:382.',
  'r:1372/r:845': 'Marsstraße meets n:823 from one side only (far ends n:367, n:33).',
  'r:259/r:694': 'Trappentreustraße shares no node; the blocks touch near n:257.',
  'r:636/r:950': 'Arnulfstraße meets the signal n:949 from one side only.',
  'r:644/r:964': 'Landsberger meets n:104 from the east only (far ends n:642, n:963).',
  'r:712/r:955': 'Arnulfstraße meets the signal n:949 from one side only.',
};

test.each(auditCities)(
  'T39.2: %s lane overlap outside the outlines (measure 9)',
  (name) => {
    const { city, net } = load(name);
    const overlaps = laneOverlaps(city, net);
    console.info(
      'T39.2',
      name,
      overlaps.map((o) => `${o.roads}${o.corridor ? '*' : ''} ${o.areaM2} (${o.node})`).join(', '),
    );
    expect(
      overlaps
        .filter((o) => o.corridor)
        .map((o) => o.roads)
        .sort(),
    ).toEqual(name === 'munich' ? Object.keys(corridorResiduals).sort() : []);
    for (const o of overlaps.filter((o) => !o.corridor))
      expect(o.areaM2, o.roads).toBeLessThanOrEqual(unrelated[name][o.roads]! + 0.01);
  },
  120_000,
);

/** Lane pairs of the node's roads crossing within `reach` of the node. */
function crossingsNear(net: CompiledCity, id: string, reach = 40) {
  const node = net.nodes[net.index.node.get(id as `n:${number}`)!]!;
  return junctionOverlaps(net)
    .filter((o) => o.node === id)
    .filter((o) =>
      o.lanes.some((laneId) => {
        const lane = net.lanes.find((l) => l.id === laneId)!;
        return lane.polyline.some((p) => Math.hypot(p.x - node.pos.x, p.y - node.pos.y) < reach);
      }),
    )
    .map((o) => o.lanes.join('>'));
}

test('T39.3: the named Munich nodes, n:1181 and B42 at n:138', () => {
  const { city, net } = load('munich');
  // Pushed apart: no two lanes cross within 40 m.
  for (const id of ['n:324', 'n:721']) expect(crossingsNear(net, id), id).toEqual([]);
  // Met from one side only, or behind a centred continuation (`corridorResiduals`): the lanes of
  // the two carriageways still cross near the node.
  for (const id of ['n:104', 'n:774', 'n:446', 'n:949'])
    expect(crossingsNear(net, id).length, id).toBeGreaterThan(0);
  // n:1181: r:729 lies beside r:984, not on it, and is cut where r:984 is, so it no longer runs
  // under r:476's exit crossing (TASK-088's R3-1 finding).
  const node = net.nodes[net.index.node.get('n:1181')!]!;
  const incident = net.roads.filter((r) => r.from === node.idx || r.to === node.idx);
  const setback = (id: string) => node.setbacks[incident.findIndex((r) => r.id === id)]!;
  expect(setback('r:729')).toBeCloseTo(setback('r:984'), 6);
  expect(city.roads['r:729']!.lateralOffsetM).toBe(-3.5);
  expect(city.roads['r:984']!.lateralOffsetM).toBe(1.75);
  expect(laneOverlaps(city, net, false).filter((o) => /r:(729|984)\b/.test(o.roads))).toEqual([]);
  // The west carriageways r:981/r:1358 meet n:1181 from one side only: they still overlap under
  // the polygon's gore, which the network has to set side by side.
  expect(laneOverlaps(city, net, false).map((o) => o.roads)).toContain('r:1358/r:981');
  // B42: Arnulfstraße west of n:138 is one corridor arm pointing along its carriageways' mean
  // direction, 60 degrees from Donnersbergerstraße, so Donnersbergerstraße is not bent.
  for (const id of ['r:140', 'r:141'])
    expect(city.roads[id as `r:${number}`]!.provenance.inferred!.join(',')).not.toContain(
      'realigned',
    );
}, 120_000);
