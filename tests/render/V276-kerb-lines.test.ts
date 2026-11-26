import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { cumulativeLengths, nearestOnPolyline, pointInPolygon } from '../../src/geo/polyline';
import { buildCity } from '../../src/fixtures/build-city';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import {
  nodeMarkingGeometry,
  roadMarkingGeometry,
  type MarkingShape,
} from '../../src/render/marking-geometry';
import { markingThemes } from '../../src/render/style';
import { allocateId, type City, type Road } from '../../src/schema';

// TASK-276 (TASK-259's D8): UK kerbs carry the yellow lines read from OSM, single or double,
// none where untagged, stopped at junction mouths.

const uk = markingThemes.uk;
const YELLOW = uk.colors.edge,
  WHITE = uk.colors.lane;
const kerbs = (road: Road, ...lines: string[]) => {
  road.provenance = { ...road.provenance, inferred: lines.map((l) => `kerbLine:${l}`) };
};
const compiled = (city: City) => {
  const result = compile(city);
  if (!result.ok) throw Error('compile');
  return result.compiled;
};
const edges = (net: CompiledCity, city: City, id: string, theme = uk) =>
  roadMarkingGeometry(net, net.roads[net.index.road.get(id)!]!, city, theme).below.filter(
    (s) => s.role === 'edge',
  );
const length = (shapes: MarkingShape[]) =>
  shapes.reduce((sum, s) => sum + cumulativeLengths(s.points).at(-1)!, 0);
/** How far a shape's start lies right of the road's reference line (y grows south here). */
const offset = (s: MarkingShape) => s.points[0]!.y;

test.each(['single', 'double'] as const)(
  'V276: a %s yellow line on the kerb it is read for',
  (kind) => {
    const b = buildCity('UK kerb', 1);
    b.city.drivingSide = 'left';
    const [east, west] = b.street(b.node(0, 0), b.node(100, 0));
    for (const r of [east, west]) r.lateralOffsetM *= -1;
    kerbs(east, `left:${kind}`);
    const net = compiled(b.city);
    const lines = edges(net, b.city, east.id);
    expect(lines).toHaveLength(kind === 'double' ? 2 : 1);
    for (const s of lines) {
      expect(s.color).toBe(YELLOW);
      expect(s.kind === 'line' && s.widthM).toBe(0.1);
      expect(length([s])).toBeGreaterThan(90);
    }
    // Eastbound under left-hand traffic: the kerb is north (y < 0), 0.15 m and 0.35 m inside it.
    const kerb = net.roads[net.index.road.get(east.id)!]!.surface[0]!.y;
    expect(lines.map((s) => offset(s) - kerb).sort()).toEqual(
      (kind === 'double' ? [0.15, 0.35] : [0.15]).map((m) => expect.closeTo(m, 6)),
    );
    // The westbound road has no lines read: its kerb has no line at all.
    expect(edges(net, b.city, west.id)).toEqual([]);
  },
);

test.each([
  ['residential', 0],
  ['primary', 0],
  ['trunk', 2],
  ['service', 2],
] as const)('V276: an untagged UK %s one-way road has %s white edge lines', (roadClass, count) => {
  const b = buildCity('UK untagged', 1);
  const road = b.road(b.node(0, 0), b.node(100, 0), { roadClass });
  const net = compiled(b.city);
  const lines = edges(net, b.city, road.id);
  expect(lines).toHaveLength(count);
  for (const s of lines) expect(s.color).toBe(WHITE);
  // German and US edges are not the importer's: unchanged.
  expect(edges(net, b.city, road.id, markingThemes.us)).toHaveLength(2);
});

test('V276: a double line stops beside a parking strip, a single one runs on', () => {
  const b = buildCity('UK strip', 1);
  const road = b.road(b.node(0, 0), b.node(120, 0));
  kerbs(road, 'right:double', 'left:single');
  for (const side of ['left', 'right'] as const) {
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
      strip: { roadId: road.id, side, fromM: 30, toM: 85, layout: 'parallel' },
      provenance: { source: 'authored' },
    };
  }
  const net = compiled(b.city);
  const lines = edges(net, b.city, road.id);
  const kerb = net.roads[0]!.surface;
  const left = lines.filter((s) => offset(s) < (kerb[0]!.y + kerb.at(-1)!.y) / 2);
  const right = lines.filter((s) => !left.includes(s));
  expect(left).toHaveLength(1);
  expect(length(left)).toBeGreaterThan(110);
  // Two lines, each cut into two pieces by the 55 m strip.
  expect(right).toHaveLength(4);
  expect(length(right)).toBeGreaterThan(2 * 50);
  expect(length(right)).toBeLessThan(2 * 70);
});

test.each([
  ['secondary', 'none', undefined],
  ['trunk', 'white', WHITE],
] as const)('V276: across a side road on a UK %s, the edge guide is %s', (roadClass, _, color) => {
  const b = buildCity('UK mouth', 1);
  const centre = b.node(100, 0);
  for (const [from, to] of [
    [b.node(0, 0), centre],
    [centre, b.node(200, 0)],
  ] as const)
    b.street(from, to).forEach((r) => (r.roadClass = roadClass));
  b.street(centre, b.node(100, 80));
  for (const r of Object.values(b.city.roads)) kerbs(r, 'left:double', 'right:double');
  const net = compiled(b.city);
  const node = net.nodes[net.index.node.get(centre.id)!]!;
  // The German theme continues the kerb across the mouth; so did the UK theme, in yellow.
  expect(
    nodeMarkingGeometry(net, node, markingThemes.de).filter((s) => s.role === 'edge').length,
  ).toBeGreaterThan(0);
  const guides = nodeMarkingGeometry(net, node, uk).filter((s) => s.role === 'edge');
  if (color === undefined) expect(guides).toEqual([]);
  else {
    expect(guides.length).toBeGreaterThan(0);
    for (const s of guides) expect(s.color).toBe(color);
  }
});

test('V276: York, Blossom Street: yellow only on tagged kerbs, none in junction mouths', () => {
  const result = importOsm(readFileSync('tests/importers/york-blossom-street.osm', 'utf8'), {
    importerVersion: '1',
    drivingSide: 'left',
  });
  if (!result.ok) throw Error('import');
  const { city } = result;
  const net = compiled(city);
  const tagged = (road: Road) => road.provenance.inferred!.some((v) => v.startsWith('kerbLine:'));
  let yellowM = 0;
  for (const r of net.roads) {
    const road = city.roads[r.id]!;
    const lines = roadMarkingGeometry(net, r, city, uk).below.filter((s) => s.role === 'edge');
    const yellow = lines.filter((s) => s.color === YELLOW);
    if (!tagged(road)) expect(yellow, road.id).toEqual([]);
    if (['residential', 'tertiary', 'secondary', 'primary'].includes(r.roadClass) && !tagged(road))
      expect(lines, road.id).toEqual([]);
    yellowM += length(yellow);
    for (const s of yellow)
      for (const p of s.points)
        for (const n of net.nodes) {
          if (!n.outline.length) continue;
          const ring = [...n.outline, n.outline[0]!];
          expect(pointInPolygon(p, ring, 0) && nearestOnPolyline(ring, p).away > 0.05).toBe(false);
        }
  }
  // Blossom Street's three tagged ways, both kerbs, double: over 300 m of line.
  expect(yellowM).toBeGreaterThan(300);
  for (const n of net.nodes)
    expect(
      nodeMarkingGeometry(net, n, uk).filter(
        (s) => s.color === YELLOW || (s.role === 'edge' && s.color === undefined),
      ),
    ).toEqual([]);
});
