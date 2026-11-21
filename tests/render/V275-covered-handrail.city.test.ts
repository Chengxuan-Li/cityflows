import { expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import { segmentDistance } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { buildFootbridges } from '../../src/render3d/footbridges';
import { cityHeights } from '../../src/render3d/heights';
import { limit } from '../timeouts';

// TASK-275: Freiburg's covered ways and handrails (TASK-262's follow-up).
test(
  'V275 Freiburg: railings follow the mapped handrails; covered ways get canopies where nothing is over them',
  async () => {
    const city = (await openFreiburg()).city;
    const links = Object.values(city.walk!.links);
    expect(links.filter((l) => l.covered)).toHaveLength(207);
    expect(links.filter((l) => l.handrail)).toHaveLength(263);
    const result = compile(city);
    if (!result.ok) throw new Error('compile');
    const { group, counts } = buildFootbridges(
      result.compiled,
      city,
      cityHeights(result.compiled, city),
    );
    expect(counts).toMatchObject({
      bridges: 65,
      links: 230,
      piers: 72,
      canopies: 2,
      canopyPosts: 18,
      handrailLinks: 58,
      centerRailM: 15,
      coveredLinks: 167,
      lightCanopies: 90,
      lightCanopyM2: 529,
    });
    const p = (
      group.children[2] as never as {
        geometry: {
          getAttribute(n: string): {
            count: number;
            getX(i: number): number;
            getZ(i: number): number;
          };
        };
      }
    ).geometry.getAttribute('position');
    const canopy = Array.from({ length: p.count }, (_, i) => ({ x: p.getX(i), y: p.getZ(i) }));
    const near = (osm: number, m: number) => {
      const lines = links.filter((l) => l.provenance.osmIds?.[0] === osm).map((l) => l.line);
      expect(lines.length).toBeGreaterThan(0);
      return canopy.some((v) =>
        lines.some((line) => segmentDistance(v, line[0]!, line.at(-1)!) < m),
      );
    };
    // The Schwabentorsteg (`bridge=covered`) and its covered approach at grade.
    expect(near(4746445, 1.5)).toBe(true);
    expect(near(124127875, 1.5)).toBe(true);
    // Stühlingerplatz: the covered path under the rail bridge (layer 2) has none.
    expect(near(461616503, 0.5)).toBe(false);
  },
  limit(120_000),
);
