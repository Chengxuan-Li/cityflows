import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { auditCities, compileAuditCity, type AuditCity } from '../../bench/junction-audit';
import { buildCity } from '../../src/fixtures/build-city';
import { clipOutside, polylineLength, segmentsIntersect } from '../../src/geo/polyline';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CompiledCity } from '../../src/network';
import { containMovements, junctionCurbs, junctionOutline } from '../../src/network/junctions';
import type { Road } from '../../src/schema';

// T31 (architecture 5.1, TASK-078): curb aprons with a class radius, drawn beside the junction
// surface; nothing the simulation reads changes.

const compiled = new Map<AuditCity, CompiledCity>();
function city(name: AuditCity) {
  let net = compiled.get(name);
  if (!net) compiled.set(name, (net = compileAuditCity(name)));
  return net;
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };
const boxOf = (ring: Vec2[]): Box => ({
  minX: Math.min(...ring.map((p) => p.x)),
  minY: Math.min(...ring.map((p) => p.y)),
  maxX: Math.max(...ring.map((p) => p.x)),
  maxY: Math.max(...ring.map((p) => p.y)),
});
const meet = (a: Box, b: Box) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** Length of `ring`'s boundary deeper than 0.05 m inside `other`. */
const deepLength = (ring: Vec2[], other: Vec2[]) =>
  polylineLength(ring) -
  clipOutside(ring, [other], 0.05).reduce((sum, piece) => sum + polylineLength(piece), 0);
const overlap = (a: Vec2[], b: Vec2[]) => deepLength(a, b) > 1e-6 || deepLength(b, a) > 1e-6;

function simple(ring: Vec2[]) {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return false;
    }
  return true;
}

const degrees = (a: Vec2, p: Vec2, b: Vec2) =>
  (Math.abs(
    Math.atan2(
      (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x),
      (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y),
    ),
  ) *
    180) /
  Math.PI;

test.each(auditCities)(
  'T31: %s aprons are simple, outside every road surface and each other, tangent to the edges',
  (name) => {
    const net = city(name);
    const aprons = net.nodes.flatMap((node) => node.curbs.map((ring) => ({ node, ring })));
    expect(aprons.length).toBeGreaterThan(0);
    const surfaces = net.roads.map((road) => [...road.surface, road.surface[0]!]);
    const surfaceBoxes = surfaces.map(boxOf);
    const boxes = aprons.map(({ ring }) => boxOf(ring));
    const failures: string[] = [];
    aprons.forEach(({ node, ring }, k) => {
      const where = `${node.id} apron ${node.curbs.indexOf(ring)}`;
      if (!simple(ring)) failures.push(`${where}: not simple`);
      surfaces.forEach((surface, r) => {
        if (meet(boxes[k]!, surfaceBoxes[r]!) && overlap(ring, surface))
          failures.push(`${where}: overlaps ${net.roads[r]!.id}`);
      });
      for (let j = k + 1; j < aprons.length; j++)
        if (meet(boxes[k]!, boxes[j]!) && overlap(ring, aprons[j]!.ring))
          failures.push(`${where}: overlaps apron of ${aprons[j]!.node.id}`);
      // The polygon is the corner (its first vertex), road edge vertices and the cut corners
      // (vertices of the incident surfaces), and the arc. At a tangent point the boundary comes
      // back along the edge it left (a cusp between edge and arc), within 2 degrees of a
      // reversal; along the arc it turns at most 3 degrees a vertex.
      const own = new Set(
        net.roads
          .filter((road) => road.from === node.idx || road.to === node.idx)
          .flatMap((road) => road.surface.map((p) => `${p.x},${p.y}`)),
      );
      const n = ring.length - 1;
      for (let i = 1; i < n; i++) {
        if (own.has(`${ring[i]!.x},${ring[i]!.y}`)) continue;
        const turn = degrees(ring[i - 1]!, ring[i]!, ring[i + 1]!);
        if (turn > 90 ? 180 - turn >= 2 : turn > 3 + 1e-6)
          failures.push(`${where}: turns ${turn.toFixed(2)} degrees at vertex ${i}`);
      }
    });
    expect(failures).toEqual([]);
  },
  120_000,
);

/** Area of a closed ring. */
const area = (ring: Vec2[]) =>
  Math.abs(ring.slice(1).reduce((s, q, i) => s + ring[i]!.x * q.y - q.x * ring[i]!.y, 0)) / 2;
/** A fillet of radius `r` in a right-angle corner: the square minus the quarter disc. */
const rightCorner = (r: number) => r * r * (1 - Math.PI / 4);

test('T31: class radii: 6 m residential corners, 6 m at a side street, 12 m primary corners', () => {
  const { city, node, road, street } = buildCity('Curb classes', 1);
  const two = (
    a: ReturnType<typeof node>,
    b: ReturnType<typeof node>,
    roadClass: Road['roadClass'],
  ) => {
    const streetGroupId = `street:${a.id}:${b.id}`;
    road(a, b, { roadClass, streetGroupId });
    road(b, a, { roadClass, streetGroupId });
  };
  // A residential crossing, a residential side street at a secondary road, a primary crossing,
  // each arm 200 m.
  const residential = node(0, 0);
  for (const [x, y] of [
    [200, 0],
    [-200, 0],
    [0, 200],
    [0, -200],
  ] as const)
    street(residential, node(x, y));
  const side = node(1000, 0);
  two(node(800, 0), side, 'secondary');
  two(side, node(1200, 0), 'secondary');
  street(side, node(1000, 200));
  const primary = node(2000, 0);
  for (const [x, y] of [
    [2200, 0],
    [1800, 0],
    [2000, 200],
    [2000, -200],
  ] as const)
    two(primary, node(x, y), 'primary');
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const net = result.compiled;
  const aprons = junctionCurbs(net.nodes, net.roads);
  const at = (id: string) => aprons.filter((a) => net.nodes[a.node]!.id === id);
  expect(at(residential.id).map((a) => [a.classRadius, a.radius])).toEqual(Array(4).fill([6, 6]));
  expect(at(side.id).map((a) => [a.classRadius, a.radius])).toEqual(Array(2).fill([6, 6]));
  expect(at(primary.id).map((a) => [a.classRadius, a.radius])).toEqual(Array(4).fill([12, 12]));
  // Measured on the polygons: the corner beyond the arc is all that is filled.
  for (const [id, r] of [
    [residential.id, 6],
    [side.id, 6],
    [primary.id, 12],
  ] as const)
    for (const apron of at(id))
      // Within 1 percent: the arc is a polygon of 3 degree chords.
      expect(Math.abs(area(apron.ring) / rightCorner(r) - 1)).toBeLessThan(0.01);
});

/** Everything compiled except the aprons, hashed. */
function fingerprint(net: CompiledCity) {
  const hash = createHash('sha256');
  const plain = (value: unknown) =>
    JSON.stringify(value, (key, v: unknown) =>
      key === 'curbs' ? undefined : v instanceof Float64Array ? Array.from(v) : v,
    );
  for (const list of [net.nodes, net.roads, net.lanes, net.movements, net.places, net.connectors])
    for (const item of list) hash.update(plain(item));
  return hash.digest('hex').slice(0, 16);
}

// Measured with this function on main (5024a83), before TASK-078; Sindelfingen and Munich
// re-measured after TASK-080's shorter tapers and side-by-side branches moved their lanes.
const mainFingerprints: Record<AuditCity, string> = {
  grid: '56deba638330bc89',
  town: 'a9cf734107d1e3f0',
  sindelfingen: 'c6ff38c41895d357',
  munich: '7949ab181ce05d46',
};

test.each(auditCities)(
  'T31: %s setbacks, outlines, lanes and movements are as on main',
  (name) => {
    expect(fingerprint(city(name))).toBe(mainFingerprints[name]);
  },
  120_000,
);

test.each(auditCities)(
  'T31: %s has no apron at through or continuation nodes, nor at a gore',
  (name) => {
    const net = city(name);
    const plain = net.nodes.filter((n) => !n.outline.length);
    if (name === 'munich' || name === 'sindelfingen') expect(plain.length).toBeGreaterThan(0);
    expect(plain.filter((n) => n.curbs.length).map((n) => n.id)).toEqual([]);
    let gores = 0;
    for (const original of net.nodes) {
      if (!original.outline.length) continue;
      const node = { ...original };
      node.outline = junctionOutline(
        node,
        net.roads.filter((r) => r.from === node.idx || r.to === node.idx),
        net.lanes,
      );
      for (const join of containMovements(node, net.movements, net.lanes).joins) {
        if (join.kind !== 'gore') continue;
        gores++;
        const tip = join.control!;
        // An apron at a gore would start at its tip, where the facing edges meet.
        for (const ring of original.curbs)
          expect(ring.some((p) => Math.hypot(p.x - tip.x, p.y - tip.y) < 0.05)).toBe(false);
      }
    }
    if (name === 'munich' || name === 'sindelfingen') expect(gores).toBeGreaterThan(0);
  },
  120_000,
);
