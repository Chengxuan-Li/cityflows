// TASK-124: re-pin repaired/split connector data and exit warnings; T61 pins unchanged car geometry and strips.
// TASK-126: whole-city/compile pins include rail and station metadata; T62 keeps main lane/movement hashes.
import { createHash } from 'node:crypto';
import { compileAuditCity, loadAuditCity } from '../../bench/junction-audit';
import { placeTrees } from '../../src/render/vegetation';
import { treeContext } from '../../src/render/street';
import { transitionMarkings, nodeMarkingGeometry } from '../../src/render/marking-geometry';
import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { placeStreet } from '../../src/render/street';
import { roadMarkingGeometry } from '../../src/render/marking-geometry';
import { markingThemes } from '../../src/render/style';
import { cumulativeLengths } from '../../src/geo/polyline';
import { allocateId } from '../../src/schema';
import { unitTest, tierCities } from '../tier';

unitTest('V117 neighbouring entries move along their kerbs until faces and posts are clear', () => {
  const b = buildCity('close entries', 1);
  for (const y of [0, 3]) b.road(b.node(0, y), b.node(60, y)).access = { all: 'destination' };
  const result = compile(b.city);
  if (!result.ok) throw Error('compile');
  const street = placeStreet(result.compiled, b.city, []);
  expect(street.signs).toHaveLength(2);
  const [a, bSign] = street.signs;
  // Each disc is 2.5m tall and its plate extends below it, so 3m is insufficient.
  expect(Math.abs(a!.pos.x - bSign!.pos.x)).toBeGreaterThanOrEqual(6);
  expect(Math.hypot(a!.pos.x - bSign!.pos.x, a!.pos.y - bSign!.pos.y)).toBeGreaterThanOrEqual(1.5);
  expect(bSign!.pos.x - a!.pos.x).toBeLessThanOrEqual(8);
  expect(placeStreet(result.compiled, b.city, []).signs).toEqual(street.signs);
  for (const theme of ['de', 'us', 'uk'] as const)
    expect(placeStreet(result.compiled, { ...b.city, markingTheme: theme }, []).signs).toEqual(
      street.signs,
    );
});

unitTest('V117 equal-rule entries of one street group keep one sign', () => {
  const b = buildCity('shared entries', 1);
  for (const y of [0, 3])
    b.road(b.node(0, y), b.node(60, y), { streetGroupId: 'shared' }).access = { all: 'delivery' };
  const result = compile(b.city);
  if (!result.ok) throw Error('compile');
  expect(placeStreet(result.compiled, b.city, []).signs).toHaveLength(1);
});

unitTest('V117 equal-rule entries of one street group far apart keep their own signs', () => {
  // Lead: the two directions of a long restricted street enter at opposite ends.
  const b = buildCity('distant entries', 1);
  const west = b.node(0, 0),
    east = b.node(120, 0);
  b.road(b.node(-60, 0), west);
  b.road(b.node(180, 0), east);
  for (const [from, to] of [
    [west, east],
    [east, west],
  ] as const)
    b.road(from, to, { streetGroupId: 'long' }).access = { all: 'delivery' };
  const result = compile(b.city);
  if (!result.ok) throw Error('compile');
  expect(placeStreet(result.compiled, b.city, []).signs).toHaveLength(2);
});

unitTest.each(['motorway', 'trunk', 'ramp'] as const)(
  'V117 UK %s edges are all white',
  (roadClass) => {
    const b = buildCity('UK edges', 1);
    b.road(b.node(0, 0), b.node(100, 0), { roadClass });
    const result = compile(b.city);
    if (!result.ok) throw Error('compile');
    const marks = roadMarkingGeometry(
      result.compiled,
      result.compiled.roads[0]!,
      b.city,
      markingThemes.uk,
    ).below.filter((s) => s.role === 'edge');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((s) => (s.color ?? markingThemes.uk.colors.edge) === 0xfffcf3)).toBe(true);
  },
);

unitTest.each(['right', 'left'] as const)(
  'V117 UK %s-driving residential kerbs are yellow and divided primary medians are white',
  (drivingSide) => {
    const b = buildCity('UK street', 1);
    b.city.drivingSide = drivingSide;
    b.street(b.node(0, 0), b.node(100, 0));
    const divided = b.street(b.node(0, 50), b.node(100, 50));
    for (const r of divided) {
      r.streetGroupId = null;
      r.corridorId = 'divided';
      r.lateralOffsetM += 4;
      r.roadClass = 'primary';
    }
    if (drivingSide === 'left') for (const r of Object.values(b.city.roads)) r.lateralOffsetM *= -1;
    const result = compile(b.city);
    if (!result.ok) throw Error('compile');
    for (const r of result.compiled.roads) {
      const edges = roadMarkingGeometry(result.compiled, r, b.city, markingThemes.uk).below.filter(
        (s) => s.role === 'edge',
      );
      expect(edges.length).toBeGreaterThan(0);
      for (const s of edges) {
        const y = s.points[0]!.y;
        const median = r.corridorId === 'divided' && Math.abs(y - 50) < 5;
        expect(s.color ?? markingThemes.uk.colors.edge).toBe(median ? 0xfffcf3 : 0xf2ca4b);
      }
    }
  },
);

unitTest('V117 UK kerb lines leave out parking strip runs (lead, TASK-103 merge)', () => {
  const b = buildCity('UK strip', 1);
  b.city.drivingSide = 'left';
  const [road] = b.street(b.node(0, 0), b.node(120, 0));
  for (const r of Object.values(b.city.roads)) r.lateralOffsetM *= -1;
  const yellow = (city: typeof b.city) => {
    const result = compile(city);
    if (!result.ok) throw Error('compile');
    const r = result.compiled.roads[result.compiled.index.road.get(road!.id)!]!;
    return roadMarkingGeometry(result.compiled, r, city, markingThemes.uk)
      .below.filter((s) => s.role === 'edge' && (s.color ?? 0xf2ca4b) === 0xf2ca4b)
      .reduce((sum, s) => sum + cumulativeLengths(s.points).at(-1)!, 0);
  };
  const before = yellow(b.city);
  const id = allocateId(b.city, 'pk');
  (b.city.parking ??= {})[id] = {
    id,
    kind: 'roadside',
    name: null,
    access: 'public',
    placeId: null,
    capacity: 10,
    connectors: [],
    shape: null,
    strip: { roadId: road!.id, side: 'left', fromM: 30, toM: 85, layout: 'parallel' },
    provenance: { source: 'authored' },
  };
  // The 55 m run leaves the yellow line; the rest of the kerb keeps it.
  expect(before - yellow(b.city)).toBeGreaterThan(50);
  expect(yellow(b.city)).toBeGreaterThan(20);
});

// Main 606ee51: display-only fixes must retain all network, lamp, curb and DE/US paint bytes.
// Lead, TASK-111 merge: compile pins follow V107 (crossing spans and walk phases added; the
// previous pins return with them stripped); TASK-103 moves Munich and Sindelfingen as in V107,
// and its parking bands move their lamps and curbs outward (V103 covers them).
// TASK-123: only the walk graph and derived signal walk indices move.
// TASK-123: only the walk graph and derived signal walk indices move.
const pins = {
  grid: {
    compile: '9ab97a7cc8f1c8e0a01f469f56babc7828ba5a3f89ef75171c83523ae74cffdd',
    lamps: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    curbs: 'e45b9bee6d047cf3354bb3e6f57e86ae929db7210a24bf866f44e2e46892736d',
    de: 'e2a4f545e1d33189b550c6ab045eaef2ed5305a3f8def23d48d86f6d990c4852',
    us: '15ec3e5bd9c9bae2e76e2aede004db70fa1f18dc6f9a7af2197f22138009f570',
  },
  town: {
    compile: '8b07424297d91cd0910fa75a40359442258224b805faaed31449971693e7116f',
    lamps: 'bd56acb9b3028f1d5a884f0926a86e19405a839f16185957cb0479a89ee99d7f',
    curbs: 'e5b1df98b54b260c89c37bf096c4aa51ba309b50ed7b6dfdb318d0487fe170ca',
    de: '84454e2c6b1b1eeac928e004cdab547b5884ab43d3f70b7e8f6c7d7fb89ba7da',
    us: '819ef4cd85ef88daf63225cf166ce7ebd9053abcce407c7d81e3f3a055e19041',
  },
  munich: {
    compile: 'd8191fa39ec06e5504abde5711ab02a992fab15ed47fc20daa837d390d9da9dc',
    lamps: '27483774592d8fd96b6a5ab0a4126d9aeaa8ef05f184a2d6222cc7bad0d33f89',
    curbs: 'fc216c4ce748916e00e0ae196aae0d9875f4dc1c0f9b47f53e61f30ded45a934',
    de: 'a973da11dc6d6336e946ebf1100f67e3ec830d8d8ec22b1f5b24f0b5847daf1a',
    us: '5ce0616a8c61c9ab622c57b16a14eb94091811feb935af8ef95d3ac961db2b8d',
  },
  sindelfingen: {
    compile: 'dea66c80f1e22f42cce2fe73ef9e2425c431b63993eeec09d9f43a67b33de40a',
    lamps: '0563d1323ef08a9cb2b3b71280f6ae9e1cf5208c3f7caebcfddfe55aa1d8a2ad',
    curbs: '9fe71ec6feadfb41a3c86111638d13618b7731286d4ec4104c4d3832b20233ce',
    de: 'ba5b9756f97538de3f62cec3d63df7dbebddb6e27336f946b1dabf3bcd4634f6',
    us: 'c323dc2ff69850bb63f12141e3b2b00e81520238f7411e8e11ecf0c082b2d3d4',
  },
} as const;
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value, (_, v: unknown) => (v instanceof Map ? [...v] : v)))
    .digest('hex');
test.each(tierCities(['grid', 'town', 'munich', 'sindelfingen'] as const))(
  'V117 %s preserves main geometry and resolves sign collisions',
  (name) => {
    const source = loadAuditCity(name),
      city = compileAuditCity(name);
    expect(hash(compile(source))).toBe(pins[name].compile);
    const trees = placeTrees(city, treeContext(source)).trees;
    const start = performance.now(),
      street = placeStreet(city, source, trees);
    console.info('V117', name, {
      placementMs: performance.now() - start,
      ...street.counts.signPlacement,
    });
    expect(hash(street.lamps)).toBe(pins[name].lamps);
    expect(hash(street.curbs)).toBe(pins[name].curbs);
    for (const id of ['de', 'us'] as const)
      expect(
        hash([
          city.roads.map((r) => [
            roadMarkingGeometry(city, r, source, markingThemes[id]),
            transitionMarkings(city, r, markingThemes[id]),
          ]),
          city.nodes.map((n) => nodeMarkingGeometry(city, n, markingThemes[id])),
        ]),
      ).toBe(pins[name][id]);
    expect(street.counts.signPlacement.after).toEqual({ footprints: 0, posts: 0, pairs: [] });
    expect(hash(compile(source))).toBe(pins[name].compile);
  },
);

unitTest.each([8, 60])(
  'V117 a blocked %sm kerb retains and counts the sign at its limit',
  (length) => {
    const b = buildCity('blocked entries', 1);
    for (const y of [0, 0.5]) b.road(b.node(0, y), b.node(length, y)).access = { all: 'delivery' };
    const result = compile(b.city);
    if (!result.ok) throw Error('compile');
    const street = placeStreet(result.compiled, b.city, []);
    expect(street.signs).toHaveLength(2);
    expect(street.counts.signPlacement.before.posts).toBe(1);
    expect(street.counts.signPlacement.after.footprints).toBe(1);
    expect(street.counts.signPlacement.moved).toBe(1);
    const road = result.compiled.roads[1]!,
      edge = road.surface.slice(road.surface.length / 2).reverse();
    expect(street.signs[1]!.pos.x - edge[0]!.x).toBeCloseTo(
      Math.min(12, edge.at(-1)!.x - edge[0]!.x),
    );
  },
);
