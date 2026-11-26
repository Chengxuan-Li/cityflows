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
    // TASK-276: the yellow lines are the importer's (`kerbLine`), here on every nearside kerb.
    for (const r of Object.values(b.city.roads))
      r.provenance = { ...r.provenance, inferred: [`kerbLine:${drivingSide}:double`] };
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
  // TASK-276: a double line read from OSM (`kerbLine`); a single one runs on beside a strip.
  road!.provenance = { ...road!.provenance, inferred: ['kerbLine:left:double'] };
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
    // TASK-347: de and us paint re-pinned: lines run on across nodes drawn as road (`roadStrip`).
    de: '2d19675fa4222eb502744d015d9bcf2e7169d619527efadfd943dde61a1214df',
    us: '45aed65f4a39dd7b22be56faca277223f5513b325fbd4f3c4fcfb97d5472790f',
  },
  town: {
    // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
    compile: '3595116920f094559c7d78b9cc1cfde9fa1b0773419b31a7df233ea8a4909e79',
    lamps: 'bd56acb9b3028f1d5a884f0926a86e19405a839f16185957cb0479a89ee99d7f',
    curbs: 'e5b1df98b54b260c89c37bf096c4aa51ba309b50ed7b6dfdb318d0487fe170ca',
    // TASK-347: de and us paint re-pinned: lines run on across nodes drawn as road (`roadStrip`).
    de: 'e913ff2e280188a585418e78b300ea574809f38da5cb213038b19d17ec0d43d7',
    us: '8fa5348ccedded4b4b79333cbf2186b6602fabd54ade18f0626a2d924e665d45',
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
    // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
    // TASK-190: no bay under 4.5 m of a ramp: Munich pk:2050 and pk:2056 lose 2 + 4 bays, so their capacities and every
    // later parking space and connector index move; with the bays restored every pin equals 9680f36's.
    // TASK-194: generated signal programs are actuated (`actuated: true`).
    // TASK-213: two corners are rounded (n:324's acute corner a gore; n:661's gore tip).
    // TASK-214: lanes through splits and merges (Munich: r:589, r:728, the n:27 and n:194 ramps).
    // TASK-220: 16 of Munich's 54 tram tracks change `form` (10 grass, 6 embedded); with every
    // tram `form` stripped the city equals b3bcde6's.
    // TASK-233: Munich's 10 Trappentreustraße roads are shared lanes (sharedLane inferred, no centre line).
    // TASK-235 (TASK-221): lane transitions carried through plain nodes (Munich: the n:194 ramp, r:259).
    // TASK-239: one crossing link from the zebra mapped only as node 1252289978 (at n:6).
    // TASK-271: Munich's 14 passage roads and 77 passage walk links at grade.
    // TASK-290: Munich's compiled garage connector c:1911 moves from r:1071 to r:1070.
    // TASK-294: four public roads only Munich's private r:1109 reaches are a pocket (zone ids).
    // TASK-265: n:6's crossing link and conflict spans move with its zebra.
    compile: '36c6183040ae5dd944b7b38eee98c3fe4e85a597dee15a8e3b29e2e8be9e31c6',
    lamps: 'e6ec57e8fa1239190122a425614fcc3957e5bd0fec8c2895a1e67d288d9f7777',
    // TASK-190: the curbs open at each bay, and six bays are gone.
    // TASK-214: lanes through splits and merges (Munich: r:589, r:728, the n:27 and n:194 ramps).
    // TASK-271: Munich's 14 passage roads and 77 passage walk links at grade.
    // TASK-290: Munich's garage mouth moves from r:1071 to r:1070 and changes the curb openings.
    // TASK-265: the curb openings at n:6 move with the zebra on r:10 and r:11.
    curbs: '907fbbb59a2e30e065383e82b34e283c89bda20c5f26d612970bb13a45acb0ac',
    // TASK-229 (N1): the four dividers of the inner road r:267; without them both equal 5c47b75's.
    // TASK-233: Munich's 10 Trappentreustraße roads are shared lanes (sharedLane inferred, no centre line).
    // TASK-235 (TASK-221): lane transitions carried through plain nodes (Munich: the n:194 ramp, r:259).
    // TASK-241: no hatch at lane gains (18 roads), r:269#4's arrow left out (keep-clear box).
    // TASK-246: keep-clear boxes keep to the whole lane (r:654#3 and #4 left out).
    // TASK-256: no keep-clear box on shared one-lane streets (r:379, r:380: 3 boxes).
    // TASK-290: Munich's moved garage mouth changes German keep-clear paint on r:1070 and r:1071.
    // TASK-347: de and us paint re-pinned: lines run on across nodes drawn as road (`roadStrip`).
    // TASK-265: n:6's zebra moves onto the crossing node and lane lines end there.
    de: '246a94348f15f725c742865919fbcbb70ede7346c3e7e6995622ba5aa4390683',
    // TASK-214: lanes through splits and merges (Munich: r:589, r:728, the n:27 and n:194 ramps).
    // TASK-233: Munich's 10 Trappentreustraße roads are shared lanes (sharedLane inferred, no centre line).
    // TASK-235 (TASK-221): lane transitions carried through plain nodes (Munich: the n:194 ramp, r:259).
    // TASK-241: no hatch at lane gains (18 roads), r:269#4's arrow left out (keep-clear box).
    // TASK-246: keep-clear boxes keep to the whole lane (r:654#3 and #4 left out).
    // TASK-256: no keep-clear box on shared one-lane streets (r:379, r:380: 3 boxes).
    // TASK-290: Munich's moved garage mouth changes US keep-clear paint on r:1070 and r:1071.
    // TASK-265: n:6's zebra moves onto the crossing node and lane lines end there.
    us: '21e453bbbffc04351868c80ba4187989eb2ad16d1947ed9034f63abbf66a13ac',
  },
  sindelfingen: {
    // TASK-136/151: Sindelfingen's 18 crossing facilities gain `spans`, `stops` and `railSpans`; without them it equals main's pin.
    // TASK-175: compiled nodes, roads and lanes gain `grade`; with it stripped every pin equals 6ea2994's.
    // TASK-180: generated signal programs are fixed-time again (no `actuated`, as before TASK-170).
    // TASK-194: generated signal programs are actuated (`actuated: true`).
    // TASK-213: four corners are rounded (gore fillets at n:27, n:68, n:1162; n:365's corner).
    // TASK-214: lanes through splits and merges (Sindelfingen geometry moves by millimetres).
    // TASK-233: 8 Sindelfingen roads are shared lanes (sharedLane inferred, no centre line).
    // TASK-235 (TASK-221): lane transitions carried through plain nodes (Sindelfingen geometry moves by millimetres).
    // TASK-271: Sindelfingen's 48 passage roads at grade; a works block splits in two.
    // TASK-290: Sindelfingen's compiled garage connector c:1449 moves from r:97 to r:954.
    // TASK-294: lot pk:1490, reached only through the works' private roads, gains its bay departures.
    // TASK-348: Sindelfingen's signalised crossings n:422 and n:733 laid out as plain nodes.
    // TASK-351: Entenseestraße's loop joins the circulation core; p:1408, p:1410 move onto it.
    // TASK-348 + TASK-351: both on main (crossings laid out as plain nodes; the new circulation core).
    compile: '249401dfe79a8392f2b379483652931468bc5b2889f9c20c761d0c3ccb1e7065',
    // TASK-271: Sindelfingen's 48 passage roads at grade; a works block splits in two.
    // TASK-351: Entenseestraße's loop joins the circulation core; p:1408, p:1410 move onto it.
    lamps: '4cb04c240a77c3c0f3cc71a27ebb6edc8a3f2fc0710ac19af31b44255c590bc4',
    // TASK-235 (TASK-221): lane transitions carried through plain nodes (Sindelfingen geometry moves by millimetres).
    // TASK-271: Sindelfingen's 48 passage roads at grade; a works block splits in two.
    // TASK-290: Sindelfingen's garage mouth moves from r:97 to r:954 and changes the curb openings.
    // TASK-348: Sindelfingen's signalised crossings n:422 and n:733 laid out as plain nodes.
    // TASK-351: p:1408's and p:1410's garages move onto Entenseestraße's loop (driveway mouths).
    // TASK-348 + TASK-351: both on main (crossings laid out as plain nodes; the new circulation core).
    curbs: 'dfa5d8eb80d56ed65989a069a22e8ec724487db62fc7fc1eb6541d231e0107f5',
    // TASK-233: 8 Sindelfingen roads are shared lanes (sharedLane inferred, no centre line).
    // TASK-240: arrows of the junction ahead on r:1057 and r:821.
    // TASK-241: no hatch at lane gains (5 roads).
    // TASK-256: no keep-clear box on shared one-lane streets (r:737, r:738: 2 boxes).
    // TASK-271: Sindelfingen's 48 passage roads at grade; a works block splits in two.
    // TASK-290: Sindelfingen's moved garage mouth changes German keep-clear paint on r:97 and r:954.
    // TASK-347: de and us paint re-pinned: lines run on across nodes drawn as road (`roadStrip`).
    // TASK-348: Sindelfingen's signalised crossings n:422 and n:733 laid out as plain nodes.
    // TASK-351: p:1408's and p:1410's garages move onto Entenseestraße's loop (driveway mouths).
    // TASK-348 + TASK-351: both on main (crossings laid out as plain nodes; the new circulation core).
    de: 'd5d2bbc64526cf2de0e05e308988333d58191efc0bb0d2e1f27f2d44dac811ee',
    // TASK-235 (TASK-221): lane transitions carried through plain nodes (Sindelfingen geometry moves by millimetres).
    // TASK-240: arrows of the junction ahead on r:1057 and r:821.
    // TASK-241: no hatch at lane gains (5 roads).
    // TASK-256: no keep-clear box on shared one-lane streets (r:737, r:738: 2 boxes).
    // TASK-271: Sindelfingen's 48 passage roads at grade; a works block splits in two.
    // TASK-290: Sindelfingen's moved garage mouth changes US keep-clear paint on r:97 and r:954.
    // TASK-348: Sindelfingen's signalised crossings n:422 and n:733 laid out as plain nodes.
    // TASK-351: p:1408's and p:1410's garages move onto Entenseestraße's loop (driveway mouths).
    // TASK-348 + TASK-351: both on main (crossings laid out as plain nodes; the new circulation core).
    us: '171f7361ff074a2aad0de374629e4d846c809a9206f115fc1228c043ec5e0f0c',
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
