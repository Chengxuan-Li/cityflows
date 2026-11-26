import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import {
  nodeMarkingGeometry,
  roadMarkingGeometry,
  zebraBeacons,
  type MarkingShape,
} from '../../src/render/marking-geometry';
import { markingThemes } from '../../src/render/style';
import { buildGeometry } from '../../src/render3d/geometry';
import { buildBeacons } from '../../src/render3d/markings';
import type { City } from '../../src/schema';

// TASK-269 (D4, D16): excerpts of TASK-259's York and Cambridge extracts (tests/importers/osm,
// ATTRIBUTION.txt), imported with left-hand traffic.
function load(name: string, drivingSide: 'left' | 'right' = 'left') {
  const result = importOsm(readFileSync(`tests/importers/osm/${name}.osm`, 'utf8'), {
    importerVersion: 'test',
    drivingSide,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(-3)));
  const compiled = compile(result.city);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics.slice(0, 3)));
  return { city: result.city, compiled: compiled.compiled };
}
const minis = (city: City, compiled: CompiledCity, osmIds: number[]) =>
  osmIds.map((osm) => {
    const node = Object.values(city.nodes).find((n) => n.provenance.osmIds?.includes(osm))!;
    return { node, compiled: compiled.nodes[compiled.index.node.get(node.id)!]! };
  });

test.each([
  ['cambridge-trumpington', [609070, 6572064]],
  ['york-piccadilly', [27231340, 2369587625]],
] as const)(
  '%s: each mini-roundabout gives way on every entry, no arm above another',
  (name, ids) => {
    const { city, compiled } = load(name);
    expect(city.markingTheme).toBe('uk');
    const roads = Object.values(city.roads);
    for (const { node, compiled: c } of minis(city, compiled, [...ids])) {
      expect(node.control).toBe('yield');
      expect(node.minorRoads.sort()).toEqual(
        roads
          .filter((r) => r.to === node.id)
          .map((r) => r.id)
          .sort(),
      );
      expect(c.miniRoundabout).toBe(true);
      expect(c.group).toBeUndefined();
      expect(c.movements.length).toBeGreaterThan(2);
      expect(new Set(c.movements.map((i) => compiled.movements[i]!.priority))).toEqual(
        new Set([0]),
      );
    }
    // Cambridge's Trumpington Road (primary) meets Trumpington Street (residential) at 609070.
    if (name === 'cambridge-trumpington') {
      const { node } = minis(city, compiled, [609070])[0]!;
      expect(new Set(roads.filter((r) => r.to === node.id).map((r) => r.roadClass)).size).toBe(2);
    }
  },
);

/** The signed angle a polygon's points sweep round `centre`, in order (positive: clockwise with
 * y south). */
function sweep(points: { x: number; y: number }[], centre: { x: number; y: number }) {
  const angles = points.map((p) => Math.atan2(p.y - centre.y, p.x - centre.x));
  let total = 0;
  for (let i = 1; i < angles.length / 2; i++)
    total += Math.atan2(
      Math.sin(angles[i]! - angles[i - 1]!),
      Math.cos(angles[i]! - angles[i - 1]!),
    );
  return total;
}

test.each(['left', 'right'] as const)(
  'a mini-roundabout draws its disc, and under the UK theme arrows circulating with %s-hand traffic',
  (side) => {
    const { city, compiled } = load('york-piccadilly', side);
    for (const { compiled: node } of minis(city, compiled, [27231340, 2369587625])) {
      const discs = (theme: 'uk' | 'de') =>
        nodeMarkingGeometry(compiled, node, markingThemes[theme]).filter(
          (s): s is Extract<MarkingShape, { kind: 'polygon' }> =>
            s.kind === 'polygon' && s.role === 'arrow',
        );
      const [disc, ...arrows] = discs('uk');
      const radii = disc!.points.map((p) => Math.hypot(p.x - node.pos.x, p.y - node.pos.y));
      expect(Math.min(...radii)).toBeGreaterThanOrEqual(0.75 - 1e-9);
      expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-9);
      expect(arrows).toHaveLength(3);
      for (const arrow of arrows)
        expect(Math.sign(sweep(arrow.points, node.pos))).toBe(side === 'left' ? 1 : -1);
      expect(discs('de')).toHaveLength(1);
      // Every entry carries its give-way line (the UK's double broken line).
      for (const road of compiled.roads.filter((r) => r.to === node.idx))
        expect(
          roadMarkingGeometry(compiled, road, city, markingThemes.uk).above.filter(
            (s) => s.role === 'stop',
          ).length,
        ).toBeGreaterThan(0);
    }
    // No other node draws one.
    expect(
      compiled.nodes.filter((n) =>
        nodeMarkingGeometry(compiled, n, markingThemes.de).some((s) => s.role === 'arrow'),
      ),
    ).toHaveLength(2);
  },
);

const zigZags = (shapes: MarkingShape[]) =>
  shapes.filter((s) => s.kind === 'line' && s.role === 'lane' && !s.dash && s.points.length > 2);

test('UK zebras draw zig-zag marks and Belisha beacons; other themes draw neither', () => {
  const { city, compiled } = load('york-piccadilly');
  for (const id of ['uk', 'de', 'us'] as const) {
    const lines = compiled.roads.flatMap((road) =>
      zigZags(roadMarkingGeometry(compiled, road, city, markingThemes[id]).below),
    );
    const beacons = zebraBeacons(compiled, city, markingThemes[id]);
    if (id !== 'uk') {
      expect(lines).toEqual([]);
      expect(beacons).toEqual([]);
      continue;
    }
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // Marks of 2 m, alternating 0.4 m across: from two to eight.
      expect(line.points.length).toBeGreaterThanOrEqual(3);
      expect(line.points.length).toBeLessThanOrEqual(9);
      for (let i = 1; i < line.points.length; i++) {
        const d = Math.hypot(
          line.points[i]!.x - line.points[i - 1]!.x,
          line.points[i]!.y - line.points[i - 1]!.y,
        );
        expect(d).toBeGreaterThan(1.9);
        expect(d).toBeLessThan(2.2);
      }
    }
    expect(beacons.length).toBeGreaterThanOrEqual(2);
  }
  const source = { ...city, markingTheme: 'uk' as const };
  const geometry = buildGeometry(compiled, source);
  const group = buildBeacons(compiled, source, geometry.heights);
  const globes = group.children.at(-1) as unknown as { count: number };
  expect(globes.count).toBe(zebraBeacons(compiled, city, markingThemes.uk).length);
  expect(
    buildBeacons(compiled, { ...city, markingTheme: 'de' }, geometry.heights).children,
  ).toEqual([]);
});
