import { describe, expect, it } from 'vitest';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import { crossingSpan } from '../../src/network/crossings';
import { INNER_LANE_M_PENDING } from '../../src/network/lanes';
import type { City } from '../../src/schema';
import { dualSingle, osm } from '../importers/junction-group-osm';

// TASK-348: lane geometry under junction groups and at signalised crossings, one test per rule.

function compiled(xml: string, edit?: (city: City) => void): { city: City; net: CompiledCity } {
  const imported = importOsm(xml, { importerVersion: 'test' });
  if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics.slice(0, 3)));
  edit?.(imported.city);
  const result = compile(imported.city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  return { city: imported.city, net: result.compiled };
}

const setbackAt = (net: CompiledCity, node: number, road: number) => {
  const incident = net.roads
    .filter((r) => r.from === node || r.to === node)
    .map((r) => r.idx)
    .sort((a, b) => a - b);
  return net.nodes[node]!.setbacks[incident.indexOf(road)]!;
};

describe('TASK-348 junction lanes', () => {
  // Rule 1 is off (`INNER_LANE_M`) until its follow-up diagnoses Freiburg's gridlock with it.
  it.skip('an inner road shorter than its members’ cuts carries no lane block of its own', () => {
    // An 8 m median crossing between two 7 m carriageways: each member cuts it by more than half.
    const { net } = compiled(dualSingle(8, true));
    const group = net.groups![0]!;
    expect(group.innerRoads.length).toBeGreaterThan(0);
    for (const idx of group.innerRoads) {
      const road = net.roads[idx]!;
      const cuts = setbackAt(net, road.from, idx) + setbackAt(net, road.to, idx);
      expect(cuts).toBeGreaterThan(road.lengthM);
      // The 5 m floor kept the whole 8 m road as lanes inside the group surface.
      expect(road.stations.at(-1)! - road.stations[0]!).toBeCloseTo(INNER_LANE_M_PENDING, 6);
      for (const lane of road.lanes) expect(net.lanes[lane]!.lengthM).toBeLessThan(1);
    }
  });

  it('a signalised crossing between junctions is laid out as a plain node', () => {
    // A street changing its name at a signalised crossing, which keeps the signal there.
    const street = { highway: 'residential' };
    const { city, net } = compiled(
      osm(
        [
          {
            id: 1,
            tags: { ...street, name: 'West' },
            points: [
              [-200, 0],
              [-9, 0],
              [0, 0],
            ],
          },
          {
            id: 2,
            tags: { ...street, name: 'East' },
            points: [
              [0, 0],
              [200, 0],
            ],
          },
        ],
        {
          '0,0': { highway: 'traffic_signals', crossing: 'traffic_signals' },
          '-9,0': { highway: 'crossing', crossing: 'zebra' },
        },
      ),
    );
    expect(Object.values(city.walk!.links).some((link) => link.marking === 'zebra')).toBe(true);
    const node = net.nodes.find((n) => n.control === 'signal')!;
    expect(node).toBeDefined();
    expect(node.setbacks.every((s) => s === 0)).toBe(true);
    expect(node.outline).toEqual([]);
    // The approaches keep their crossing and stop before it.
    const approaches = net.roads.filter((r) => r.to === node.idx);
    expect(approaches).toHaveLength(2);
    for (const road of approaches) {
      const lane = net.lanes[road.lanes[0]!]!;
      const span = crossingSpan(net, lane, true, city);
      expect(span).not.toBeNull();
      expect(lane.stopM).toBeLessThan(span!.farM);
      // Keep TASK-348's floor and storage, even with a nearby node-only zebra on the approach.
      expect(lane.lengthM - span!.nearM).toBeCloseTo(lane.widthM / 2 + 1.25, 6);
    }
  });

  it('a one-way road continuing a two-way street is a continuation with a lane taper', () => {
    const { net, node } = oneWaySeam(200, 30);
    expect(node.setbacks.every((s) => s === 0)).toBe(true);
    expect(node.outline).toEqual([]);
    // The one-way lane runs on into the eastbound lane, and its surface widens over its taper to
    // take the westbound lane on.
    const oneWay = net.roads.find((r) => r.to === node.idx && r.streetGroupId === null)!;
    const on = net.roads.find((r) => r.from === node.idx)!;
    const [movement] = node.movements.map((i) => net.movements[i]!);
    expect(node.movements).toHaveLength(1);
    expect(movement).toMatchObject({ fromLane: oneWay.lanes[0], toLane: on.lanes[0] });
    const a = net.lanes[oneWay.lanes[0]!]!.polyline.at(-1)!;
    const b = net.lanes[on.lanes[0]!]!.polyline[0]!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.05);
    const half = oneWay.surface.length / 2;
    const width = (i: number) =>
      Math.hypot(
        oneWay.surface[i]!.x - oneWay.surface[2 * half - 1 - i]!.x,
        oneWay.surface[i]!.y - oneWay.surface[2 * half - 1 - i]!.y,
      );
    expect(width(half - 1)).toBeGreaterThan(width(0) + 2.5);
  });

  it('leaves room for a full speed-scaled taper on the one-way road', () => {
    // 36 m can fit the 15 m taper at 30 km/h in its near half, but not the 24 m at 60.
    expect(oneWaySeam(36, 30).node.outline).toEqual([]);
    const { net, node } = oneWaySeam(36, 60);
    expect(node.outline.length).toBeGreaterThan(0);
    expect(net.movements[node.movements[0]!]!.lengthM).toBeGreaterThan(0);
  });

  it('keeps the junction at the entry to a group', () => {
    const { net, node } = oneWaySeam(200, 30, { grouped: true });
    expect(node.group).toBeDefined();
    expect(node.outline.length).toBeGreaterThan(0);
    expect(net.movements[node.movements[0]!]!.lengthM).toBeGreaterThan(0);
  });

  it('keeps the existing cuts where a lane step already joins the lanes', () => {
    const { net, node } = oneWaySeam(200, 30, { stepped: true });
    const oneWay = net.roads.find((r) => r.to === node.idx && r.streetGroupId === null)!;
    expect(oneWay.endShift.length).toBeGreaterThan(0);
    expect(node.setbacks.every((s) => s > 0)).toBe(true);
    expect(net.movements[node.movements[0]!]!.lengthM).toBeGreaterThan(0);
  });
});

function oneWaySeam(lengthM: number, kmh: number, { grouped = false, stepped = false } = {}) {
  const { net } = compiled(
    osm([
      {
        id: 1,
        tags: {
          highway: 'residential',
          oneway: 'yes',
          name: stepped ? 'Main' : 'West',
          maxspeed: String(kmh),
        },
        points: [
          [-lengthM, 0],
          [0, 0],
        ],
      },
      {
        id: 2,
        tags: { highway: 'residential', name: 'Main', maxspeed: String(kmh) },
        points: [
          [0, 0],
          [grouped ? 9 : 200, 0],
        ],
      },
    ]),
    grouped
      ? (city) => {
          const roads = Object.values(city.roads).filter((road) => road.streetGroupId !== null);
          const id = `jg:${city.nextId++}` as const;
          city.junctionGroups = {
            [id]: {
              id,
              nodes: [roads[0]!.from, roads[0]!.to],
              innerRoads: roads.map((road) => road.id),
              signal: null,
              provenance: { source: 'authored' },
            },
          };
        }
      : undefined,
  );
  const node = net.nodes.find(
    (n) => net.roads.filter((r) => r.from === n.idx || r.to === n.idx).length === 3,
  )!;
  return { net, node };
}
