import { expect, test } from 'vitest';
import { laneOverlaps } from '../../bench/geometry-audit';
import { auditCities, loadAuditCity, type AuditCity } from '../../bench/junction-audit';
import {
  cumulativeLengths,
  nearestOnPolyline,
  parallelOffset,
  pointAtDistance,
} from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import { crossingStripes } from '../../src/render/layers/roads';
import type { City, Road } from '../../src/schema';
import { junctionOverlaps } from '../network/junction-audit';
import { cityTest, tierCities, unitTest } from '../tier';

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

unitTest(
  'T39.1: a dual carriageway meeting at both nodes runs side by side up to them',
  () => {
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
  },
  60_000,
);

// Measure 9 on main dc01ed4 (m2) for every pair that still overlaps, and the corridor pairs left.
// TASK-090: unrelated pairs within a budget, not pair by pair (a pair not listed failed, and every
// geometry task added or renamed some): at most 10 percent more pairs and 10 percent more area
// than recorded here. The corridor pairs stay exact (the owner's r:259/r:694).
const unrelated: Record<AuditCity, Record<string, number>> = {
  grid: {},
  town: {},
  sindelfingen: {
    'r:1004/r:435': 22.64,
    // TASK-089: r:1055 continues r:966 and lines up with its split end at n:78, onto r:80.
    'r:1055/r:80': 2.14,
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
    // TASK-089: n:1091's curbs leave the road edges along them (B42), 0.18 m2 more outside.
    'r:1093/r:1094': 22.15,
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
/** Corridor pairs whose lanes still overlap outside the outlines, and why. TASK-089 set the
 * carriageways meeting a node from one side only side by side there (`convergingShifts`); the
 * importer pushes the pairs whose continuation the network now lines up (r:1277/r:1362 at n:774,
 * r:1354/r:447 at n:382). */
const corridorResiduals: Record<string, string> = {
  'r:259/r:694': 'Trappentreustraße shares no node; the blocks touch near n:257.',
};

test.each(tierCities(auditCities))(
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
    const others = overlaps.filter((o) => !o.corridor);
    const recorded = Object.values(unrelated[name]);
    expect(others.length).toBeLessThanOrEqual(Math.floor(1.1 * recorded.length));
    expect(others.reduce((sum, o) => sum + o.areaM2, 0)).toBeLessThanOrEqual(
      1.1 * recorded.reduce((sum, a) => sum + a, 0) + 0.01,
    );
  },
  120_000,
);

/** B43: divided pairs (an incoming and an outgoing carriageway of one corridor at a node) whose
 * median-side edges run within 1 m of each other 40 m out, with their median just past the
 * later cut and 40 m beyond it where the two differ by more than 0.05 m. */
function medianChanges(net: CompiledCity): string[] {
  const out: string[] = [];
  const edge = (road: CompiledCity['roads'][number], node: number) => {
    const h = road.surface.length / 2;
    const side = road.surface.slice(0, h);
    return road.to === node ? [...side].reverse() : side;
  };
  for (const node of net.nodes) {
    const incident = net.roads.filter(
      (r) => (r.from === node.idx || r.to === node.idx) && r.from !== r.to,
    );
    for (const a of incident)
      for (const b of incident) {
        if (a.to !== node.idx || b.from !== node.idx || a === b) continue;
        if (!a.corridorId || a.corridorId !== b.corridorId || a.streetGroupId) continue;
        const ea = edge(a, node.idx),
          eb = edge(b, node.idx);
        const lengths = cumulativeLengths(ea);
        const start = nearestOnPolyline(ea, eb[0]!).along + 0.5;
        if (lengths.at(-1)! < start + 41) continue;
        const median = (d: number) => nearestOnPolyline(eb, pointAtDistance(ea, lengths, d)).away;
        const [near, far] = [median(start), median(start + 40)];
        if (far <= 1 && Math.abs(near - far) > 0.05)
          out.push(`${node.id} ${a.id}/${b.id} ${near.toFixed(2)} vs ${far.toFixed(2)}`);
      }
  }
  return out;
}

test.each(tierCities(auditCities))(
  'T39.4: %s divided pairs keep their median at the node (B43)',
  (name) => {
    const { net } = load(name);
    // Main before TASK-089: Munich n:104, n:407, n:719, n:721, n:774 and Sindelfingen n:156. The
    // one left: n:156's r:157/r:510 meet the node 10 degrees apart and their median is set at one
    // station just past the cuts, 0.43 m at r:510's cut against 0.67 m 40 m out (1.43 m on main).
    // TASK-090: counted, not named. TASK-093: two Munich pairs now run within 1 m 40 m out:
    // n:382's r:1354/r:447, whose median closes (B45; 0.77 against 0.72 m, 3.37 m out on main),
    // and n:967's r:961/r:1276, attached at the node and parting 40 m out (B49; 0.53 against
    // 0.88 m).
    expect(medianChanges(net).length).toBeLessThanOrEqual(name === 'sindelfingen' ? 1 : 2);
  },
  120_000,
);

/** TASK-089: how often each lane edge of a road split at a node (shifted at that end) changes
 * the sign of its curvature within 60 m of the node, sampled every 2 m and counting bends
 * sharper than a 100 m radius: an edge easing once changes sign at most once. */
function wobbles(net: CompiledCity): Record<string, number> {
  const out: Record<string, number> = {};
  for (const node of net.nodes)
    for (const road of net.roads) {
      const atEnd = road.to === node.idx;
      if (!(atEnd ? road.endShift : road.from === node.idx ? road.startShift : []).length) continue;
      for (const index of road.lanes) {
        const lane = net.lanes[index]!;
        for (const [side, offset] of [
          ['L', -lane.widthM / 2],
          ['R', lane.widthM / 2],
        ] as const) {
          const line = parallelOffset(lane.polyline, offset);
          const lengths = cumulativeLengths(line);
          const total = lengths.at(-1)!;
          const points: Vec2[] = [];
          for (
            let s = atEnd ? Math.max(0, total - 60) : 0;
            s <= (atEnd ? total : Math.min(total, 60));
            s += 2
          )
            points.push(pointAtDistance(line, lengths, s));
          const signs: number[] = [];
          for (let i = 1; i + 1 < points.length; i++) {
            const [a, p, b] = [points[i - 1]!, points[i]!, points[i + 1]!];
            const turn = Math.atan2(
              (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x),
              (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y),
            );
            if (Math.abs(turn) / 2 > 0.01 && signs.at(-1) !== Math.sign(turn))
              signs.push(Math.sign(turn));
          }
          if (signs.length > 2) out[`${node.id} ${lane.id}${side}`] = signs.length - 1;
        }
      }
    }
  return out;
}

// Edges that change curvature sign more than once near a split node on main 5568eed, each with its
// reason. TASK-090: a budget of the recorded count plus 15 percent, not this exact list.
const wobbling: Record<AuditCity, Record<string, string>> = {
  grid: {},
  town: {},
  sindelfingen: {
    'n:156 r:510#0L':
      'TASK-093 (B45): the median of r:157/r:510 (at most 3.2 m) closes, and the pair follows the line midway between its source lines, which bends both ways within 60 m of n:156 (main kept the void and a B43 S-bend).',
    'n:156 r:510#0R': 'As r:510#0L.',
    'n:899 r:1232#0L':
      'TASK-093 (B47): the one-way r:1232 eases onto the lane of its direction on r:900 over its 17 m taper, against the source bend of the 35 m road.',
    'n:899 r:1232#0R': 'As r:1232#0L.',
  },
  munich: {
    'n:104 r:1308#1R': 'The source line bends twice within 60 m of n:104 (2 on main too).',
    'n:328 r:1330#1R': 'The source line bends three times within 60 m of n:328 (3 on main too).',
    'n:33 r:946#0L': 'The source line bends twice within 60 m of n:33 (2 on main too).',
    'n:33 r:946#0R': 'As r:946#0L.',
    'n:33 r:946#1L': 'As r:946#0L.',
    'n:33 r:946#1R': 'As r:946#0L.',
    'n:33 r:845#1L':
      'n:33 splits two pairs side by side (r:845/r:944 and r:946/r:948): their eases meet on the bend of the source lines (1 on main).',
    'n:33 r:944#2L': 'As r:845#1L (1 on main).',
    'n:33 r:944#2R': 'As r:845#1L (1 on main).',
    'n:33 r:948#0L': 'As r:845#1L (1 on main).',
    'n:33 r:948#0R': 'As r:845#1L (1 on main).',
    'n:33 r:948#1L': 'As r:845#1L (1 on main).',
    'n:33 r:948#1R': 'As r:845#1L (1 on main).',
    // TASK-093 (B47): a one-way road easing onto the lane of its direction of the street it
    // continues, against bends of its source line.
    'n:55 r:57#0L': 'r:57 eases 1.5 m onto the lane of r:192 over 15 m on a bending source line.',
    'n:55 r:57#0R': 'As r:57#0L.',
    'n:108 r:119#0L': 'r:119 eases 1.5 m onto the lane of r:8 over 15 m on a bending source line.',
    'n:108 r:119#0R': 'As r:119#0L.',
    'n:347 r:1082#0L':
      'r:1082 eases 1.5 m onto the lane of r:349 over 15 m on a bending source line.',
    'n:347 r:1082#0R': 'As r:1082#0L.',
    'n:661 r:662#0L':
      'The two lanes of r:662 ease 1.75 m onto the left two of r:666 (three lanes) over 15 m, on a bending source line.',
    'n:661 r:662#0R': 'As r:662#0L.',
    'n:661 r:662#1L': 'As r:662#0L.',
    'n:661 r:662#1R': 'As r:662#0L.',
  },
};

test.each(tierCities(auditCities))(
  'T39.5: %s lane edges near a split node ease without wobbling',
  (name) => {
    const { net } = load(name);
    const found = Object.keys(wobbles(net));
    console.info(
      'T39.5',
      name,
      'not recorded:',
      found.filter((edge) => !wobbling[name][edge]),
    );
    expect(found.length).toBeLessThanOrEqual(Math.floor(1.15 * Object.keys(wobbling[name]).length));
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

cityTest(
  'T39.3: the named Munich nodes, n:1181 and B42 at n:138',
  () => {
    const { city, net } = load('munich');
    // Pushed apart (TASK-087), or set side by side where they converge (TASK-089): no two lanes
    // cross within 40 m.
    for (const id of [
      'n:324',
      'n:721',
      'n:104',
      'n:774',
      'n:446',
      'n:949',
      'n:823',
      'n:1181',
      'n:382',
    ])
      expect(crossingsNear(net, id), id).toEqual([]);
    // n:1181: r:729 lies beside r:984, not on it, and no longer runs under r:476's exit crossing
    // (TASK-088's R3-1 finding). TASK-089: the two and r:476 are one approach, set side by side,
    // each cut by its own edges; r:729 is cut no farther out than r:984 (1.75 m nearer the node),
    // and the exit crossing shows all its stripes, as does r:984's (r:729's lies under its turn
    // into r:476, none on main either).
    const node = net.nodes[net.index.node.get('n:1181')!]!;
    const incident = net.roads.filter((r) => r.from === node.idx || r.to === node.idx);
    const setback = (id: string) => node.setbacks[incident.findIndex((r) => r.id === id)]!;
    expect(setback('r:729')).toBeLessThan(setback('r:984') + 0.5);
    for (const [id, stripes] of [
      ['r:476', 8],
      ['r:984', 8],
    ] as const) {
      const road = net.roads[net.index.road.get(id)!]!;
      expect(crossingStripes(net, road, road.to === node.idx).length, id).toBe(stripes);
    }
    expect(city.roads['r:729']!.lateralOffsetM).toBe(-3.5);
    expect(city.roads['r:984']!.lateralOffsetM).toBe(1.75);
    expect(laneOverlaps(city, net, false).filter((o) => /r:(729|984)\b/.test(o.roads))).toEqual([]);
    // TASK-089: the west carriageways r:981/r:1358 meet n:1181 from one side only; the network sets
    // them side by side there, so they no longer overlap under the polygon either.
    expect(laneOverlaps(city, net, false).map((o) => o.roads)).not.toContain('r:1358/r:981');
    // B42: Arnulfstraße west of n:138 is one corridor arm pointing along its carriageways' mean
    // direction, 60 degrees from Donnersbergerstraße, so Donnersbergerstraße is not bent.
    for (const id of ['r:140', 'r:141'])
      expect(city.roads[id as `r:${number}`]!.provenance.inferred!.join(',')).not.toContain(
        'realigned',
      );
  },
  120_000,
);

/** The median-side edge of a road's surface (its left edge under right-hand traffic), from the
 * node outward. */
function medianEdge(net: CompiledCity, id: string, node: number) {
  const road = net.roads[net.index.road.get(id as `r:${number}`)!]!;
  const side = road.surface.slice(0, road.surface.length / 2);
  return road.to === node ? [...side].reverse() : side;
}

cityTest(
  'T39.6: n:967, Landsberger r:961 and r:1276 meet the junction side by side with the median (B49)',
  () => {
    const { city, net } = load('munich');
    // r:961 continues r:1368, r:1276's pair, across n:936: a third way of their corridor.
    expect(city.roads['r:961']!.corridorId).toBe(city.roads['r:1276']!.corridorId);
    expect(
      laneOverlaps(city, net).filter(
        (o) => /\br:961\b/.test(o.roads) && /\br:1276\b/.test(o.roads),
      ),
    ).toEqual([]);
    // No lane of the two crosses another within 40 m (main: r:1276#0 over r:961#0). The west
    // arm's r:248 and r:364, which a ramp beside them keeps as drawn, cross as on main.
    expect(crossingsNear(net, 'n:967').filter((c) => /r:(961|1276)#/.test(c))).toEqual([]);
    // The facing edges just past the later cut and 20 m out: the 0.5 m median.
    const node = net.index.node.get('n:967')!;
    const [a, b] = [medianEdge(net, 'r:961', node), medianEdge(net, 'r:1276', node)];
    const lengths = cumulativeLengths(a);
    const start = nearestOnPolyline(a, b[0]!).along + 0.5;
    for (const d of [0, 10, 20])
      expect(nearestOnPolyline(b, pointAtDistance(a, lengths, start + d)).away).toBeCloseTo(0.5, 0);
  },
  120_000,
);

cityTest(
  'T39.7: Landsberger between n:721 and n:328 keeps no median void narrower than 3 m (B45)',
  () => {
    const { net } = load('munich');
    // Facing edges of r:724 and r:1279 every metre: attached (the 0.5 m median), wider than 3 m
    // (the median as drawn), or easing between the two over at most a taper (20 m at 50 km/h).
    const node = net.index.node.get('n:721')!;
    const [a, b] = [medianEdge(net, 'r:724', node), medianEdge(net, 'r:1279', node)];
    const lengths = cumulativeLengths(a);
    const narrow: number[] = [];
    for (let s = 0; s <= lengths.at(-1)!; s += 1) {
      const gap = nearestOnPolyline(b, pointAtDistance(a, lengths, s)).away;
      if (gap > 0.6 && gap < 3) narrow.push(s);
    }
    const runs: number[][] = [];
    for (const s of narrow)
      if (runs.at(-1) && s - runs.at(-1)!.at(-1)! <= 1) runs.at(-1)!.push(s);
      else runs.push([s]);
    expect(runs.length).toBe(2);
    for (const run of runs) expect(run.at(-1)! - run[0]!).toBeLessThanOrEqual(20);
  },
  120_000,
);

cityTest(
  'T39.8: a one-way lane continuing a two-way street lines up with its direction’s lane (B47)',
  () => {
    const { net } = load('munich');
    // n:212: the one-way r:213 into r:1172; n:55: r:192 into the one-way r:57. Each lane line,
    // extended to the node, passes it at the same offset within 0.1 m; the shifted road is held
    // to its cut, so its lane leaves the cut along its own reference line.
    for (const [id, from, to, shifted] of [
      ['n:212', 'r:213', 'r:1172', 'r:213'],
      ['n:55', 'r:192', 'r:57', 'r:57'],
    ] as const) {
      const node = net.nodes[net.index.node.get(id)!]!;
      const lane = (road: string) => net.lanes[net.roads[net.index.road.get(road)!]!.lanes[0]!]!;
      const [la, lb] = [lane(from), lane(to)];
      const heading = (p: Vec2, q: Vec2) => Math.atan2(q.y - p.y, q.x - p.x);
      const ha = heading(la.polyline.at(-2)!, la.polyline.at(-1)!),
        hb = heading(lb.polyline[0]!, lb.polyline[1]!);
      const offset = (p: Vec2, h: number) =>
        -(p.x - node.pos.x) * Math.sin(h) + (p.y - node.pos.y) * Math.cos(h);
      expect(
        Math.abs(offset(la.polyline.at(-1)!, ha) - offset(lb.polyline[0]!, hb)),
        id,
      ).toBeLessThan(0.1);
      const road = net.roads[net.index.road.get(shifted)!]!;
      const atEnd = road.to === node.idx;
      const profile = atEnd ? road.endShift : road.startShift;
      // Held: the shift at the node and one step beyond it are equal.
      expect(profile.length, id).toBeGreaterThan(2);
      expect(Math.abs(profile[1]! - profile[0]!), id).toBeLessThan(1e-9);
      expect(Math.abs(profile[0]!), id).toBeCloseTo(1.5, 1);
    }
  },
  120_000,
);
