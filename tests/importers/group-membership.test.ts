import { describe, expect, it } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile } from '../../src/network';
import type { City } from '../../src/schema';
import { osm } from './junction-group-osm';

// TASK-219 (TASK-216 D2): a junction group does not reach along a carriageway across a median
// crossover or a slip road's diverge before the junction.

const main = { highway: 'primary', oneway: 'yes', lanes: '5', name: 'Main' };
const H = 8;

/** A signalised junction at x = 0 of the dual carriageway Main (five-lane one-way primary ways,
 * eastbound at y = 8, westbound at y = -8) and the two-way Side; `crossover` adds an untagged
 * service crossover between the carriageways at x = 20, `slip` a link leaving the westbound
 * carriageway at x = 15 for Side north of the junction. */
function junction({ crossover = false, slip = false }) {
  const stops = [250, ...(crossover ? [20] : []), ...(slip ? [15] : [])].sort((a, b) => b - a);
  return osm(
    [
      {
        id: 1,
        tags: main,
        points: [[-250, H], [0, H], ...(crossover ? [[20, H]] : []), [250, H]] as [
          number,
          number,
        ][],
      },
      {
        id: 2,
        tags: main,
        points: [...stops.map((x) => [x, -H]), [0, -H], [-250, -H]] as [number, number][],
      },
      {
        id: 3,
        tags: { highway: 'residential', name: 'Side' },
        points: [[0, 250], [0, H], [0, -H], ...(slip ? [[0, -H - 20]] : []), [0, -250]] as [
          number,
          number,
        ][],
      },
      ...(crossover
        ? [
            {
              id: 4,
              tags: { highway: 'service' },
              points: [
                [20, -H],
                [20, H],
              ] as [number, number][],
            },
          ]
        : []),
      ...(slip
        ? [
            {
              id: 5,
              tags: { highway: 'primary_link', oneway: 'yes', name: 'Main' },
              points: [
                [15, -H],
                [5, -H - 15],
                [0, -H - 20],
              ] as [number, number][],
            },
          ]
        : []),
    ],
    { [`0,${-H}`]: { highway: 'traffic_signals' } },
  );
}

function load(xml: string) {
  const result = importOsm(xml, { importerVersion: 'test' });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const compiled = compile(result.city);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics.slice(0, 3)));
  return { city: result.city, compiled: compiled.compiled };
}

const nodeAt = (city: City, x: number, y: number) =>
  Object.values(city.nodes).find((n) => Math.hypot(n.pos.x - x, n.pos.y - y) < 0.5)!;
const westbound = (city: City) =>
  Object.values(city.roads).filter(
    (r) => r.provenance.osmIds?.includes(2) && city.nodes[r.to]!.pos.x >= -1,
  );

describe('TASK-219 junction-group membership', () => {
  it('a median crossover on the carriageway before the junction joins no group', () => {
    const { city, compiled } = load(junction({ crossover: true }));
    const [group] = Object.values(city.junctionGroups!);
    const ends = [nodeAt(city, 20, -H), nodeAt(city, 20, H)];
    for (const end of ends) {
      expect(group!.nodes).not.toContain(end.id);
      expect(end.control).toBe('uncontrolled');
    }
    expect(group!.nodes).toEqual([nodeAt(city, 0, H).id, nodeAt(city, 0, -H).id].sort());
    // The westbound stop line is at the junction: the entry is the 20 m from the crossover.
    const entry = westbound(city).find((r) => r.to === nodeAt(city, 0, -H).id)!;
    expect(entry.from).toBe(ends[0]!.id);
    const lanes = compiled.roads[compiled.index.road.get(entry.id)!]!.lanes;
    expect(lanes.every((lane) => compiled.lanes[lane]!.stopM !== undefined)).toBe(true);
  });

  it("a slip road's diverge before the junction joins no group", () => {
    const { city } = load(junction({ slip: true }));
    const [group] = Object.values(city.junctionGroups!);
    const diverge = nodeAt(city, 15, -H);
    expect(group!.nodes).not.toContain(diverge.id);
    expect(group!.nodes).toContain(nodeAt(city, 0, -H).id);
    expect(
      westbound(city).some((r) => r.from === diverge.id && r.to === nodeAt(city, 0, -H).id),
    ).toBe(true);
  });
});
