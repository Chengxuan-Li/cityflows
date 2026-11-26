import { expect, test } from 'vitest';
import type { City } from '../../src/schema';
import { buildCity } from '../../src/fixtures/build-city';
import { compile } from '../../src/network';
import { pointInPolygon } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { walkGeometry } from '../../src/render/walk-geometry';
import { buildWalk, walkLevels } from '../../src/render3d/walk';
import { cityHeights } from '../../src/render3d/heights';

// TASK-261 (owner's bugs 3 and 4, Freiburg 2026-11-20).

type Link = NonNullable<City['walk']>['links'][string];

/** A walk graph from points and links between them, as the OSM importer writes it: one link per
 * segment, each node at the grade the importer gave it. */
function walkCity(
  name: string,
  points: { pos: Vec2; layer: number }[],
  links: { from: number; to: number; kind: Link['kind']; layer: number; widthM?: number }[],
) {
  const { city } = buildCity(name, 1);
  const nodes = points.map((p, i) => ({
    id: `wn:${i + 1}`,
    pos: p.pos,
    layer: p.layer,
    provenance: { source: 'osm' as const },
  }));
  city.walk = {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    links: Object.fromEntries(
      links.map((l, i) => {
        const id = `wl:${points.length + i + 1}`;
        const link: Link = {
          id,
          from: nodes[l.from]!.id,
          to: nodes[l.to]!.id,
          line: [nodes[l.from]!.pos, nodes[l.to]!.pos],
          kind: l.kind,
          layer: l.layer,
          widthM: l.widthM ?? null,
          provenance: { source: 'osm' },
        };
        return [id, link];
      }),
    ),
  };
  city.nextId = points.length + links.length + 1;
  const r = compile(city);
  if (!r.ok) throw new Error('compile');
  return { city, compiled: r.compiled };
}

const heightsOf = (geometry: ReturnType<typeof buildWalk>[keyof ReturnType<typeof buildWalk>]) => {
  const p = geometry.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => ({ x: p.getX(i), y: p.getZ(i), z: p.getY(i) }));
};

test('V261 a curved walk mapped one segment per link is paved without notches at its bends', () => {
  // The Hauptbahnhof bus loop's island: a 3 m pedestrian way round a 4 m radius, 1 m segments.
  const points = Array.from({ length: 13 }, (_, i) => ({
    pos: { x: 4 * Math.cos((i * Math.PI) / 12), y: 4 * Math.sin((i * Math.PI) / 12) },
    layer: 0,
  }));
  const links = points.slice(1).map((_, i) => ({
    from: i,
    to: i + 1,
    kind: 'pedestrian' as const,
    layer: 0,
    widthM: 3,
  }));
  const { city, compiled } = walkCity('Curved island', points, links);
  const shapes = walkGeometry(compiled, city);
  for (let i = 1; i < points.length - 1; i++) {
    // The outer corner of the bend, 1.2 m out from the joint (80% of the half width).
    const p = points[i]!.pos,
      r = Math.hypot(p.x, p.y);
    const corner = { x: p.x * (1 + 1.2 / r), y: p.y * (1 + 1.2 / r) };
    expect(
      shapes.some((s) => s.polygons.some((t) => pointInPolygon(corner, [...t, t[0]!], 1e-4))),
      `bend ${i}`,
    ).toBe(true);
  }
  // A dead end stays square: nothing paved behind the first node along the first segment.
  const [p0, p1] = [points[0]!.pos, points[1]!.pos];
  const d = {
    x: (p1.x - p0.x) / Math.hypot(p1.x - p0.x, p1.y - p0.y),
    y: (p1.y - p0.y) / Math.hypot(p1.x - p0.x, p1.y - p0.y),
  };
  for (const s of shapes)
    for (const t of s.polygons)
      for (const v of t) expect((v.x - p0.x) * d.x + (v.y - p0.y) * d.y).toBeGreaterThan(-1e-3);
});

test('V261 a stair up to a footbridge climbs from the platform to the deck in level treads', () => {
  // As the Hauptbahnhof platform stairs: the stair is `layer=1`, the footbridge `layer=2`; the
  // importer leaves the node they share at grade 0, so main drew the stair as a 5 m arch back to
  // the platform and the footbridge's spur as a 10 m drop.
  const { city, compiled } = walkCity(
    'Platform stair',
    [
      { pos: { x: -10, y: 0 }, layer: 0 },
      { pos: { x: 0, y: 0 }, layer: 0 },
      { pos: { x: 15, y: 0 }, layer: 0 },
      { pos: { x: 18, y: 0 }, layer: 2 },
      { pos: { x: 18, y: 30 }, layer: 2 },
    ],
    [
      { from: 0, to: 1, kind: 'footway', layer: 0 },
      { from: 1, to: 2, kind: 'steps', layer: 1, widthM: 2.5 },
      { from: 2, to: 3, kind: 'footway', layer: 2 },
      { from: 3, to: 4, kind: 'footway', layer: 2 },
    ],
  );
  expect(walkLevels(compiled)).toEqual([0, 0, 2, 2, 2]);
  const meshes = buildWalk(compiled, city, cityHeights(compiled, city));
  const treads = heightsOf(meshes.footways).filter((v) => v.x > 0.01 && v.x < 14.99);
  // 10 m in risers of about 17 cm, each tread level and on the pitch line within a riser.
  const levels = [...new Set(treads.map((v) => v.z.toFixed(3)))].map(Number).sort((a, b) => a - b);
  expect(levels.length).toBe(59);
  expect(levels.at(-1)).toBeCloseTo(10.14, 3);
  for (const v of treads) {
    expect(v.z).toBeGreaterThanOrEqual(0.14 + (10 * v.x) / 15 - 1e-3);
    expect(v.z).toBeLessThanOrEqual(0.14 + (10 * v.x) / 15 + 10 / 59 + 1e-3);
    expect(Math.abs(v.y)).toBeLessThanOrEqual(1.25 + 1e-6);
  }
  expect(treads.some((v) => Math.abs(v.y) > 1.24)).toBe(true);
  // The spur onto the footbridge is level with its deck.
  for (const v of heightsOf(meshes.footways).filter((v) => v.x > 15.5 && v.x < 17.5))
    expect(v.z).toBeCloseTo(10.14, 3);
  for (const g of Object.values(meshes)) g.dispose();
});

test('V261 a stair whose ends stand at one grade is level, not an arch', () => {
  // `layer=1` steps between two ground walks (Freiburg wl:5915, wl:5917).
  const { city, compiled } = walkCity(
    'Level stair',
    [
      { pos: { x: -10, y: 0 }, layer: 0 },
      { pos: { x: 0, y: 0 }, layer: 0 },
      { pos: { x: 4, y: 0 }, layer: 0 },
      { pos: { x: 14, y: 0 }, layer: 0 },
    ],
    [
      { from: 0, to: 1, kind: 'footway', layer: 0 },
      { from: 1, to: 2, kind: 'steps', layer: 1 },
      { from: 2, to: 3, kind: 'footway', layer: 0 },
    ],
  );
  const meshes = buildWalk(compiled, city, cityHeights(compiled, city));
  for (const geometry of Object.values(meshes))
    for (const v of heightsOf(geometry)) expect(v.z).toBeLessThan(0.16);
  for (const g of Object.values(meshes)) g.dispose();
});

test('V261 a stair end no walk meets takes the height of the road bridge it lands on', () => {
  const { city, node, street } = buildCity('Stair to a bridge', 1);
  for (const road of street(node(0, 0, 1), node(200, 0, 1))) road.layer = 1;
  const walk = walkCity(
    'scratch',
    [
      { pos: { x: 100, y: 30 }, layer: 0 },
      { pos: { x: 100, y: 20 }, layer: 0 },
      { pos: { x: 100, y: 4 }, layer: 0 },
    ],
    [
      { from: 0, to: 1, kind: 'footway', layer: 0 },
      { from: 1, to: 2, kind: 'steps', layer: 1 },
    ],
  ).city.walk!;
  city.walk = walk;
  city.nextId += 10;
  const r = compile(city);
  if (!r.ok) throw new Error('compile');
  const meshes = buildWalk(r.compiled, city, cityHeights(r.compiled, city));
  // The flight tops out where it lands on the deck, not halfway as an arch.
  const treads = heightsOf(meshes.footways).filter((v) => Math.abs(v.x - 100) < 2);
  const top = treads.filter((v) => v.y < 4.3);
  expect(top.length).toBeGreaterThan(0);
  for (const v of top) expect(v.z).toBeCloseTo(5.14, 1);
  expect(Math.max(...treads.map((v) => v.z))).toBeCloseTo(5.14, 1);
  for (const g of Object.values(meshes)) g.dispose();
});
