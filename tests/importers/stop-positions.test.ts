import { describe, expect, it } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import type { City } from '../../src/schema';
import { osm } from './junction-group-osm';

// TASK-255 (TASK-218's D4 with J1): a signal mapped at its stop position before the junction joins
// the junction's group, so the stop line stands at the signal, and the stop position stays a plain
// node (no floor, no cuts).

function load(xml: string): City {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return result.city;
}

/** Main eastbound into the junction with Side at the origin; its last 10 m (another way: a cycle
 * track begins) start at the signal 10 m before it, as Freiburg's Stefan-Meier-Straße (r:1178) and
 * Zur Unterführung (r:1185). `signal` tags the signal node. */
function approach(signal: Record<string, string>) {
  const main = { highway: 'secondary', oneway: 'yes', lanes: '2', name: 'Main' };
  return load(
    osm(
      [
        {
          id: 1,
          tags: main,
          points: [
            [-200, 0],
            [-10, 0],
          ],
        },
        {
          id: 2,
          tags: { ...main, 'cycleway:right': 'track' },
          points: [
            [-10, 0],
            [0, 0],
          ],
        },
        {
          id: 3,
          tags: main,
          points: [
            [0, 0],
            [200, 0],
          ],
        },
        {
          id: 4,
          tags: { highway: 'residential', name: 'Side' },
          points: [
            [0, -200],
            [0, 0],
            [0, 200],
          ],
        },
      ],
      { '-10,0': { highway: 'traffic_signals', ...signal } },
    ),
  );
}

const roadsOf = (city: City, way: number) =>
  Object.values(city.roads).filter((road) => road.provenance.osmIds!.includes(way));

describe('a signal at its stop position before the junction', () => {
  for (const [name, tags, before] of [
    ['on its crossing', { crossing: 'traffic_signals' }, 3],
    ['at its stop line', {}, 0],
  ] as const)
    it(`joins the junction's group and holds the stop line (${name})`, () => {
      const city = approach(tags);
      const signalNode = Object.values(city.nodes).find((n) => n.provenance.osmIds![0] === 2)!;
      const groups = Object.values(city.junctionGroups ?? {});
      expect(groups).toHaveLength(1);
      expect(groups[0]!.nodes).toContain(signalNode.id);
      // The last 10 m are an inner road of the group: no stop line there.
      expect(groups[0]!.innerRoads).toContain(roadsOf(city, 2)[0]!.id);
      const result = compile(city);
      if (!result.ok) throw new Error('compile');
      const net = result.compiled;
      const node = net.nodes[net.index.node.get(signalNode.id)!]!;
      // A plain node: no floor and no cuts (as a junction it took 10 m off both roads, J1).
      expect(node.outline).toEqual([]);
      expect(node.setbacks).toEqual([0, 0]);
      const entry = roadsOf(city, 1).find((road) => road.to === signalNode.id)!;
      const croad = net.roads[net.index.road.get(entry.id)!]!;
      for (const index of croad.lanes) {
        const lane = net.lanes[index]!;
        expect(lane.polyline.at(-1)!.x).toBeCloseTo(node.pos.x, 2);
        // Before the crossing where the signal stands on one, else at the signal.
        expect(lane.lengthM - lane.stopM).toBeCloseTo(before, 6);
      }
    });
});
