// TASK-136: crossing metadata/facilities change whole-network pins; T75 strips them and retains the previous bytes.
// TASK-127: compiled rail gains boundary flags; T62 still pins unchanged lanes/movements.
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
// TASK-140 (B59): compile pins follow V107 (walk links at the stripes; only the walk graph and
// the signal walk lists move).
// TASK-169: DE and US paint add keep-clear markings at lot and garage mouths; without
// `keepClearMarkings` every paint pin equals ddd8a78's (main with TASK-175).
const pins = {
  grid: {
    // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
    compile: '94f4c0a0c54c607f58d079b290976c3b5429903d55353ac5f66bee1948e9aa5e',
    lamps: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    curbs: 'e45b9bee6d047cf3354bb3e6f57e86ae929db7210a24bf866f44e2e46892736d',
    de: '822b5cf8111f54a40468c2a59f1bf1b48d4acbc602a8c78be8daf1bc70cf86d8',
    us: '619044a5c6f76eb0ae11811514404d30215ceebf4246e71469b1bed6f144e52f',
  },
  town: {
    // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
    compile: '3595116920f094559c7d78b9cc1cfde9fa1b0773419b31a7df233ea8a4909e79',
    lamps: 'bd56acb9b3028f1d5a884f0926a86e19405a839f16185957cb0479a89ee99d7f',
    curbs: 'e5b1df98b54b260c89c37bf096c4aa51ba309b50ed7b6dfdb318d0487fe170ca',
    de: '7f515227bf45fa456c539a3ec5b25cb9c98e2c45790f34d5fd89b62fc0b459a6',
    us: '832e7626f8885cb77334373a6a9c8ce57f9f73f9c828e11f4bffb80504d033da',
  },
  // TASK-131 keeps OSM geometry (no node merges, junction groups): the real cities' roads,
  // lamps, curbs and paint move, so they no longer equal main's.
  // Munich re-pinned for 06dae00 (median crossings offset by half their lane block)
  // and e4654d8 (merging lanes kept on a group's inner roads).
  munich: {
    // TASK-135: Munich's 54 tram tracks gain `form` and `provenance`; with them stripped (the
    // import without assignTramForms) every pin equals c3a6ec2's. Lead: Munich re-pinned for
    // TASK-135 and TASK-140 together.
    // TASK-132: building passages (Munich 18 tracks, Sindelfingen 3) gain `covered`; with it
    // stripped every pin equals 2df05a1's.
    // TASK-149 opens curbs at mapped parking mouths and bays in both extracts.
    // TASK-144 physical compile/lamps stay fixed; TASK-146 changes drawing-only curbs/paint.
    // TASK-152, TASK-156 and TASK-164 append 87 + 22 + 17 Munich bay departure connectors (lane connector lists too); with them
    // removed every pin equals 3e9951a's.
    // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
    // TASK-170: generated signal programs gain `actuated`; with GENERATED_TIMING empty every pin equals db08f1a's.
    compile: '730a7b22bb8300cf95b83da79f09250112eb3f3425cb3e07972ba8ee8fdacdb5',
    lamps: '75b5fb398a5f6b59992ac1e60aaa00e16d31a2039094e98e67bf3d1348f8fef4',
    curbs: '780f62342c39389d2fabd42f81e444fdc4c03c3070f91fce4489a3c671894919',
    de: '8b7938b03e68ee58a8aa0c86f5d0fbe3aac265f9d4f6fce9e61aa6980827dc79',
    us: '33c25b1c73892664627deb6c326fa7ead07815db265325ff3a67c567226946ac',
  },
  sindelfingen: {
    // TASK-136/151: Sindelfingen's 18 crossing facilities gain `spans`, `stops` and `railSpans`; without them it equals main's pin.
    // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
    // TASK-170: generated signal programs gain `actuated`; with GENERATED_TIMING empty every pin equals db08f1a's.
    compile: '543e8039b249d3b3b7d59dcf5fc78dc54796b4e28b911af176a995bf39dd8679',
    lamps: '0d8ddd17b55105372b0e41ea4f20ea63f8abfdc1eaf96fdba0e5acc34685e684',
    curbs: '24a6696b232568ba7bc93e4d1259eba28798648161c28e560d477bcd71496bd4',
    de: '008af8c2eb93c84032b0ca14492f91914ede12b4fce5b1c2572e540f3f1a292b',
    us: 'b54c8a1d4baaf30d9b48409e2b73b04a33c6b1f0e4d64fdbd273d14a5b8606a6',
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
