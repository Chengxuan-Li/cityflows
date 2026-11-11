import { withoutLotAisles } from '../without-lot-aisles';
import { expect, test } from 'vitest';
import { cornerAudit } from '../../bench/geometry-audit';
import { auditCities, loadAuditCity, type AuditCity } from '../../bench/junction-audit';
import { buildCity } from '../../src/fixtures/build-city';
import { compile, type CompiledCity, type CNode } from '../../src/network';
import { junctionCorners } from '../../src/network/junctions';
import type { City } from '../../src/schema';
import { cityTest, tierCities, unitTest } from '../tier';

// T42 (TASK-092, B48, B51, B52): every junction corner sweeps with a radius and every median nose
// is rounded, by the geometry audit's corner sharpness (measure 10): a corner is sharp where its
// drawn curb turns more than 30 degrees between 0.5 m samples or is missing.

const compiled = new Map<AuditCity, { city: City; net: CompiledCity }>();
function load(name: AuditCity) {
  let entry = compiled.get(name);
  if (!entry) {
    const city = withoutLotAisles(loadAuditCity(name));
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 5)));
    compiled.set(name, (entry = { city, net: result.compiled }));
  }
  return entry;
}

const node = (net: CompiledCity, id: string) =>
  net.nodes[net.index.node.get(id as `n:${number}`)!]!;

const edgeBends =
  'a facing edge bends away within a metre of the cuts (a curving ramp or loop): no arc of 0.5 m beyond the cuts fits';
const shortRoad = (road: string, m: number) =>
  `${road} is ${m} m long: the curb has under a metre between its cut and the next junction's half`;
const narrowGore =
  'carriageways converging at a small angle overlap past the 10 m cap: the gore tip lies too far out for a 0.5 m fillet';
// TASK-131 keeps OSM geometry (no merge, realignRoads deleted, smoothing 30 m clear of nodes).
const keptShort = (road: string, m: number) => `TASK-131 keeps OSM nodes: ${shortRoad(road, m)}`;
const acuteArms = (degrees: number) =>
  `TASK-131: OSM arms ${degrees} degrees apart, no longer realigned: no arc beyond the cuts fits`;
const unsmoothed = (road: string, degrees: number, m: number) =>
  `TASK-131: ${road}'s ${degrees}-degree OSM vertex ${m} m from the node is no longer filleted, so its edge bends just past the cut`;
const sideBySide = (degrees: number) =>
  `TASK-131 (B55): different streets ${degrees} degrees apart keep their OSM lines up to the node, side by side: their nose has no room`;
const groupInner = (road: string, m: number) =>
  `group: ${road} (${m} m) is the group's inner road; the curb from it to the arm at this member has no room for an arc`;

// Sharp corners left, each with its reason (keys: node, then the two road ends in outline order).
const named: Record<AuditCity, Record<string, string>> = {
  grid: {},
  town: {},
  sindelfingen: {
    // TASK-101: short private/bus-exempt segments that consolidation must now retain.
    'n:1069 r:878>r:1070':
      'the retained 9.52 m private bus-exempt approach has a 1.54 m curb turning 31.1 degrees between samples',
    'n:1102 r:1113>r:1110':
      'the retained 4.13 m bus-exempt segment has a 1.46 m curb turning 30.3 degrees between samples',
    'n:167 r:169>r:1111':
      'the other end of the retained 4.13 m segment: a 1.42 m curb turning 30.3 degrees between samples',
    'n:365 r:968>r:367':
      'the retained 5.85 m bus-exempt link meets a 7.09 m private road; no curb fits between their cuts',
    'n:1028 r:1178>r:1029': edgeBends,
    'n:1157 r:1159>r:1170': edgeBends,
    'n:1237 r:1249>r:1247': shortRoad('r:1249', 11),
    'n:139 r:187>r:526': edgeBends,
    'n:156 r:473>r:521': shortRoad('r:473', 10),
    'n:156 r:157>r:510':
      'the 0.2 m median between r:157 and r:510 (TASK-089 named n:156’s median): its 0.1 m nose is under the 0.5 m sampling',
    'n:217 r:218>r:219': 'r:218 and r:219 are 6 m long: the curb is 0.49 m, a turn of 6 degrees',
    'n:276 r:400>r:285': edgeBends,
    'n:294 r:298>r:1198': edgeBends,
    'n:436 r:444>r:15': narrowGore,
    'n:497 r:1070>r:499': `${edgeBends} (r:1070 is 12 m long)`,
    'n:78 r:80>r:1055': `${narrowGore} (r:574/r:971 still cross at n:78, TASK-089)`,
    'n:81 r:665>r:505': narrowGore,
    'n:81 r:82>r:647': edgeBends,
    'n:867 r:866>r:432': `${edgeBends} (all four one-way ramps at n:867 turn within 10 m)`,
    'n:867 r:432>r:874': `${edgeBends} (all four one-way ramps at n:867 turn within 10 m)`,
    'n:875 r:876>r:1070': `${edgeBends} (r:1070 is 12 m long)`,
    'n:887 r:1091>r:892': `${edgeBends}: the arc shrinks to 0.53 m`,
    'n:915 r:999>r:917': shortRoad('r:999', 3),
    'n:924 r:925>r:1020': shortRoad('r:1020', 17),
    // TASK-131: short roads between OSM nodes main merged.
    'n:1047 r:1048>r:1229': keptShort('r:1229', 9),
    'n:1047 r:1229>r:1049': keptShort('r:1049', 7),
    'n:123 r:1239>r:909': keptShort('r:909', 7),
    'n:355 r:359>r:732': keptShort('r:732', 8),
    'n:554 r:1223>r:1221': keptShort('r:1223', 1),
    'n:554 r:555>r:1223': `${keptShort('r:555', 2)} (r:1223 is 1 m)`,
    // TASK-131: acute OSM arms.
    'n:12 r:437>r:13': `${acuteArms(35)} (r:437 is 7 m)`,
    'n:27 r:697>r:29': acuteArms(27),
    'n:436 r:437>r:444': `${acuteArms(34)} (r:437 is 7 m)`,
    'n:87 r:645>r:88': acuteArms(31),
    'n:1161 r:1174>r:1164': `${acuteArms(37)} (a triangle of service ways, legs 15.5 to 36 m)`,
    'n:1162 r:1169>r:1164': `${acuteArms(12)} (the same triangle)`,
    'n:1167 r:1169>r:1174': `${keptShort('r:1174', 16)} (the same triangle, arms 68 degrees apart)`,
    // TASK-131: sharp OSM vertices near the node.
    'n:1105 r:1108>r:1124': unsmoothed('r:1124', 35, 8.1),
    'n:306 r:311>r:307': unsmoothed('r:311', 51, 5.2),
    // TASK-131: side-by-side noses.
    'n:68 r:69>r:245': sideBySide(18),
    'n:294 r:1198>r:298': sideBySide(20),
    'n:440 r:740>r:442': sideBySide(19),
    'n:1157 r:1170>r:1159': sideBySide(8),
    'n:867 r:1065>r:871':
      "TASK-131: Benzstraße's split n:867, merged on main, is a junction since 797678e; r:1065 and r:871 leave it 23 degrees apart and their nose has no room",
    // TASK-131: corners between a group's short inner road and an arm at a member.
    'n:139 r:143>r:475': groupInner('r:143', 6.3),
    'n:142 r:146>r:184': groupInner('r:146', 4.5),
    'n:198 r:202>r:243': groupInner('r:202', 3.9),
    'n:241 r:243>r:852': groupInner('r:852', 4.2),
    'n:631 r:1029>r:636': groupInner('r:636', 5.1),
    'n:970 r:1155>r:972': groupInner('r:972', 2.8),
    'n:1083 r:1086>r:1091': groupInner('r:1086', 7.9),
  },
  munich: {
    // TASK-101: retaining access boundaries keeps these short approaches explicit. Main's
    // compiler on this same canonical City produces these exact corner measurements too.
    'n:1037 r:1109>r:1043':
      'the curved 21.04 m private approach r:1109 leaves a 1.08 m minimum radius on the drawn curb',
    'n:138 r:715>r:1316':
      'the retained 9.87 m truck-delivery segment leaves a 1.39 m curb turning 32.7 degrees between samples',
    'n:138 r:1316>r:716':
      'the other side of the retained 9.87 m segment meets the attached carriageway: minimum radius 0.86 m',
    'n:138 r:386>r:716':
      'the attached 0.5 m median has a 0.22 m nose radius, below the 0.5 m sampling interval',
    'n:153 r:717>r:156':
      'the retained 5.95 m truck-delivery segment leaves a 1.33 m curb turning 32.5 degrees between samples',
    'n:284 r:285>r:490':
      'the retained height-restricted approaches are 13.20 and 13.16 m long; their curb has a 0.74 m radius',
    'n:324 r:325>r:1073':
      'the retained 17.57 m private approach leaves a 1 m curb with a 0.49 m radius',
    'n:384 r:399>r:1263':
      'the retained 14.08 m approach beside the truck-delivery boundary leaves a 1.63 m curb turning 33.2 degrees',
    'n:384 r:1260>r:383':
      'the retained 15.70 m approach beside the truck-delivery boundary leaves a 0.84 m curb with a 0.68 m radius',
    'n:1091 r:1092>r:1095':
      'r:1093 lies on the service pair r:1094/r:1095 (coincident ways, measure 9 43 m2): the edge from r:1092 crosses its end',
    'n:440 r:444>r:1093': 'as at n:1091: r:1093 lies on r:1094/r:1095 and its corner pokes out',
    'n:1375 r:1044>r:1358': narrowGore,
    'n:1375 r:986>r:988': narrowGore,
    'n:138 r:958>r:156':
      'a right turn into r:155 reaches past r:156’s cut: a curb from r:156 to r:29 would cut into it',
    'n:138 r:156>r:155': 'as n:138 r:958>r:156: the same turn covers r:156’s corner',
    'n:138 r:958>r:155':
      'TASK-099: as n:138 r:958>r:156, with r:716 attached the right turn into r:155 covers r:156’s corners too (115 degrees)',
    'n:182 r:221>r:1172': shortRoad('r:1172', 5),
    'n:212 r:1172>r:213':
      'B47 (TASK-093): the one-way r:213 continues as the two-way r:1172/r:1173, aligned by the centre lines',
    'n:382 r:1262>r:1354': shortRoad('r:1262', 14),
    'n:510 r:512>r:1230': `${edgeBends}: r:1229/r:1230 turns across r:511/r:512 within 15 m`,
    'n:544 r:553>r:580':
      'service ways 25 degrees apart: the class radius beyond the nearer cut leaves 1.4 m',
    'n:590 r:602>r:606':
      'service ways 25 degrees apart: the class radius beyond the nearer cut leaves 1.3 m',
    'n:570 r:606>r:602': `${edgeBends} (r:565/r:589 and r:566/r:588 lie on each other here, measure 9)`,
    'n:638 r:651>r:648': `${narrowGore} (the Donnersbergerbrücke ramps)`,
    'n:823 r:368>r:480': 'Marsstraße’s coincident carriageways (case Mars)',
    'n:894 r:900>r:1025':
      'the service way r:1025 lies on r:899/r:900 (T38.4’s r:1024): a curb would cut a movement surface',
    'n:975 r:1081>r:976': 'r:976 is 0 m long (source)',
    // TASK-131: short roads between OSM nodes main merged.
    'n:1303 r:1306>r:1304': keptShort('r:1304', 12),
    'n:215 r:1068>r:220': keptShort('r:220', 4),
    'n:549 r:551>r:579': keptShort('r:551', 4),
    // TASK-131: acute OSM arms. r:1072 is a private service way across Landsberger Straße's
    // median (17.5 m, n:324 to n:938): the access change keeps the two nodes apart (no group).
    'n:324 r:325>r:1072': acuteArms(38),
    'n:938 r:1326>r:1072': `${keptShort('r:1072', 18)} (arms 60 degrees apart)`,
    'n:851 r:857>r:855': `${acuteArms(31)} (a service loop, legs 21 and 27 m, OSM vertices of 85 and 34 degrees)`,
    'n:854 r:857>r:855': `${acuteArms(65)} (the same loop)`,
    // TASK-131: sharp OSM vertices near the node.
    'n:180 r:762>r:181': unsmoothed('r:181', 23, 7.7),
    'n:212 r:213>r:1173': `${unsmoothed('r:213', 12, 6.9)} (B47, as n:212 r:1172>r:213)`,
    // TASK-131: corners between a group's short inner road and an arm at a member.
    'n:1 r:3>r:211': groupInner('r:3', 6.1),
    'n:1126 r:1128>r:1135': groupInner('r:1128', 8.2),
    'n:1129 r:1132>r:1131': groupInner('r:1132', 4),
    'n:52 r:54>r:1312': groupInner('r:1312', 4.2),
    'n:597 r:609>r:598': groupInner('r:598', 3),
    'n:621 r:623>r:1245': groupInner('r:1245', 2.5),
  },
};

test.each(tierCities(auditCities))(
  'T42.1: %s junction corners sweep with a radius, except the named ones',
  (name) => {
    const { city, net } = load(name);
    const sharp = net.nodes
      .flatMap((n) => cornerAudit(city, net, n))
      .filter((c) => c.sharp)
      .map((c) => `${c.node} ${c.roads}`);
    console.info('T42.1', name, sharp.length, 'sharp, named', Object.keys(named[name]).length);
    expect(sharp.filter((key) => !named[name][key])).toEqual([]);
  },
  120_000,
);

// TASK-131 keeps OSM nodes: main's merged n:262 and n:247 are members of one group (n:246, n:249,
// n:251 and n:362 around the Donnersberger bridge); main's n:291 is no node of its own (its
// signal stands at n:294, a group with n:12, and Westendstraße r:301 runs from n:1 to n:294); n:104
// is a group with n:1307. T42.2 and T42.3 check the members.
cityTest(
  'T42.2: the owner’s corners at n:262, n:291, n:104 and n:247 have curbs (B49)',
  () => {
    const { city, net } = load('munich');
    for (const id of ['n:246', 'n:249', 'n:251', 'n:362', 'n:294', 'n:12', 'n:104', 'n:1307']) {
      const corners = cornerAudit(city, net, node(net, id));
      expect(corners.length, id).toBeGreaterThan(1);
      const sharp = corners.filter((c) => c.sharp).map((c) => `${c.node} ${c.roads}`);
      expect(sharp, id).toEqual([]);
    }
    // n:262's marked corner (Trappentreustraße r:252 into Landsberger r:922, now at n:251) and
    // n:291's (the north road into the south-west road; at n:294 now the group's curb from the
    // inner link r:1186 into Westendstraße r:292) were missing; n:247's north-west corner (now at
    // n:362) had none.
    const curb = (id: string, a: string, b: string) =>
      junctionCorners(node(net, id)).find(
        (c) => c.kind === 'curb' && c.roads.map((r) => net.roads[r]!.id).join('>') === `${a}>${b}`,
      );
    for (const [id, a, b] of [
      ['n:251', 'r:252', 'r:922'],
      ['n:294', 'r:1186', 'r:292'],
      ['n:362', 'r:364', 'r:703'],
      ['n:104', 'r:964', 'r:107'],
    ] as const)
      expect(curb(id, a, b)?.radius, `${id} ${a}>${b}`).toBeGreaterThan(2);
  },
  120_000,
);

// TASK-131 rewrote T42.3: main's split-pair noses came from the merge, which joined a pair's two
// carriageways at one node. Kept, each carriageway meets its own group member and the median ends
// at the inner median link, rounded by a curb on either side of it (n:104 with n:1307, n:774 with
// n:1365); main's n:949 is n:366's group, where Marsstraße's wedge r:480/r:368 has a nose; main's
// n:1181 is the group of n:474 and n:1353.
cityTest(
  'T42.3: split-pair median noses are rounded at n:104, n:774, n:949 and n:1181',
  () => {
    const { city, net } = load('munich');
    for (const id of ['n:104', 'n:1307', 'n:774', 'n:1365', 'n:366', 'n:417', 'n:474', 'n:1353'])
      expect(
        cornerAudit(city, net, node(net, id))
          .filter((c) => c.sharp)
          .map((c) => c.roads),
        id,
      ).toEqual([]);
    const corner = (id: string, kind: string, roads: string) =>
      junctionCorners(node(net, id)).find(
        (c) => c.kind === kind && c.roads.map((r) => net.roads[r]!.id).join('>') === roads,
      );
    // n:104's west median between r:476 and r:1308 (main: a half circle across its 2.2 m) ends at
    // the inner link r:1309/r:1310, with curbs at both members; so does n:774's.
    for (const [id, roads] of [
      ['n:104', 'r:476>r:1310'],
      ['n:1307', 'r:1310>r:1308'],
      ['n:774', 'r:1276>r:1368'],
      ['n:774', 'r:1367>r:1277'],
      ['n:1365', 'r:1358>r:1367'],
      ['n:1365', 'r:1368>r:1366'],
    ] as const)
      expect(corner(id, 'curb', roads)?.radius, `${id} ${roads}`).toBeGreaterThan(2);
    expect(corner('n:366', 'curb', 'r:480>r:368')?.radius).toBeGreaterThan(2);
    expect(
      cornerAudit(city, net, node(net, 'n:366')).filter((c) => c.kind === 'nose' && !c.sharp),
    ).toHaveLength(1);
  },
  120_000,
);

unitTest('T42.4: the corner measure finds a junction drawn without its curbs', () => {
  const { city, node: at, street } = buildCity('Corner measure', 1);
  const centre = at(0, 0);
  for (const [x, y] of [
    [200, 0],
    [-200, 0],
    [0, 200],
    [0, -200],
  ] as const)
    street(centre, at(x, y));
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const net = result.compiled;
  const n: CNode = node(net, centre.id);
  const curbs = cornerAudit(city, net, n);
  expect(curbs.map((c) => [c.kind, c.sharp])).toEqual(Array(4).fill(['corner', false]));
  expect(Math.min(...curbs.map((c) => c.radiusM))).toBeGreaterThan(5.8);
  // The outline cut back to the square between the road ends' corners: four sharp corners.
  const corners = net.roads
    .filter((r) => r.from === n.idx || r.to === n.idx)
    .flatMap((r) => {
      const half = r.surface.length / 2;
      return r.to === n.idx
        ? [r.surface[half - 1]!, r.surface[half]!]
        : [r.surface[0]!, r.surface.at(-1)!];
    })
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  n.outline = [...corners, corners[0]!];
  const square = cornerAudit(city, net, n);
  expect(square.map((c) => [c.kind, c.sharp])).toEqual(Array(4).fill(['corner', true]));
});
