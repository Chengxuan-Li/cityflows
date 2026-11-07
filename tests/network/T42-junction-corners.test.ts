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
    const city = loadAuditCity(name);
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

// Sharp corners left, each with its reason (keys: node, then the two road ends in outline order).
const named: Record<AuditCity, Record<string, string>> = {
  grid: {},
  town: {},
  sindelfingen: {
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
  },
  munich: {
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

cityTest(
  'T42.2: the owner’s corners at n:262, n:291, n:104 and n:967 have curbs (n:967’s gore since TASK-093)',
  () => {
    const { city, net } = load('munich');
    for (const id of ['n:262', 'n:291', 'n:104', 'n:967']) {
      const corners = cornerAudit(city, net, node(net, id));
      expect(corners.length, id).toBeGreaterThan(2);
      const sharp = corners.filter((c) => c.sharp).map((c) => `${c.node} ${c.roads}`);
      expect(sharp, id).toEqual([]);
    }
    // n:262's marked corner (Trappentreustraße r:252 into Landsberger r:922) and n:291's (the
    // north road into the south-west road) were missing; n:967's north-west corner had none.
    const curb = (id: string, a: string, b: string) =>
      junctionCorners(node(net, id)).find(
        (c) => c.kind === 'curb' && c.roads.map((r) => net.roads[r]!.id).join('>') === `${a}>${b}`,
      );
    for (const [id, a, b] of [
      ['n:262', 'r:252', 'r:922'],
      ['n:291', 'r:293', 'r:301'],
      ['n:967', 'r:364', 'r:703'],
      ['n:104', 'r:964', 'r:107'],
    ] as const)
      expect(curb(id, a, b)?.radius, `${id} ${a}>${b}`).toBeGreaterThan(2);
  },
  120_000,
);

cityTest(
  'T42.3: split-pair median noses are rounded at n:104, n:774, n:949 and n:1181',
  () => {
    const { city, net } = load('munich');
    for (const id of ['n:104', 'n:774', 'n:949', 'n:1181']) {
      const n = node(net, id);
      const noses = junctionCorners(n).filter((c) => c.kind === 'nose');
      expect(noses.length, id).toBeGreaterThan(0);
      const audited = cornerAudit(city, net, n).filter((c) => c.kind === 'nose');
      expect(audited.length, id).toBeGreaterThan(0);
      expect(
        audited.filter((c) => c.sharp).map((c) => c.roads),
        id,
      ).toEqual([]);
    }
    // n:104's west nose between r:476 and r:1308: a half circle across the 2.2 m median.
    const west = junctionCorners(node(net, 'n:104')).find(
      (c) => c.kind === 'nose' && c.roads.map((r) => net.roads[r]!.id).join('>') === 'r:476>r:1308',
    );
    expect(west?.radius).toBeGreaterThan(1);
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
