import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { distance, polylineLength, segmentDistance } from '../../src/geo/polyline';
import { lonLatToLocal } from '../../src/geo/projection';
import { importOsm } from '../../src/importers/osm';
import { parseOsm } from '../../src/importers/osm/parse';
import { compile, signalStateAt, type CompiledCity } from '../../src/network';
import type { City } from '../../src/schema';
import { dualSingle } from './junction-group-osm';

// TASK-131 Phase 1, Gate 1 on synthetic OSM: a dual carriageway crossed by a two-way street.

function load(xml: string, junctionGroupMaxM?: number) {
  const result = importOsm(xml, {
    importerVersion: 'test',
    ...(junctionGroupMaxM === undefined ? {} : { junctionGroupMaxM }),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const compiled = compile(result.city);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics.slice(0, 3)));
  return { city: result.city, compiled: compiled.compiled, xml };
}

/** Every OSM node of the document in the city's frame. */
function osmPositions(city: City, xml: string) {
  const data = parseOsm(xml);
  if (typeof data === 'string') throw new Error(data);
  return new Map(data.node.map((node) => [node.id, lonLatToLocal(city.geo!, node)]));
}

const roadPairs = (net: CompiledCity) =>
  [
    ...new Set(
      net.groups![0]!.chains.map((c) => `${net.roads[c.from]!.id}>${net.roads[c.to]!.id}`),
    ),
  ].sort();

describe('T68 junction groups at import', () => {
  it('T68.1: a dual carriageway crossing a single road is two nodes at their OSM positions in one group', () => {
    const { city, xml } = load(dualSingle(20));
    const groups = Object.values(city.junctionGroups ?? {});
    expect(groups).toHaveLength(1);
    const [group] = groups;
    // Node and road ids are main's: the crossings n:2 and n:7, the Side road's piece r:14/r:15.
    expect(group!.nodes).toEqual(['n:2', 'n:7']);
    expect(group!.innerRoads).toEqual(['r:14', 'r:15']);
    expect(group!.signal).toBeNull();
    const osm = osmPositions(city, xml);
    for (const node of Object.values(city.nodes))
      expect(distance(node.pos, osm.get(node.provenance.osmIds![0]!)!)).toBeLessThan(0.01);
    // The inner links keep their true length, 20 m between the two OSM nodes.
    for (const id of group!.innerRoads)
      expect(polylineLength(city.roads[id]!.centerline)).toBeCloseTo(
        distance(osm.get(2)!, osm.get(5)!),
        6,
      );
    // No road point leaves its OSM way.
    const data = parseOsm(xml);
    if (typeof data === 'string') throw new Error(data);
    const segments = data.way.flatMap(({ nd }) =>
      nd.slice(1).map((id, i) => [osm.get(nd[i]!)!, osm.get(id)!] as const),
    );
    for (const road of Object.values(city.roads))
      for (const p of road.centerline)
        expect(Math.min(...segments.map(([a, b]) => segmentDistance(p, a, b)))).toBeLessThan(0.01);
  });

  it('T68.2: a link longer than junctionGroupMaxM leaves two separate junctions', () => {
    expect(load(dualSingle(40)).city.junctionGroups).toBeUndefined();
    // The threshold is the import option: 20 m does not group a 24 m crossing, 30 m does.
    expect(load(dualSingle(24), 20).city.junctionGroups).toBeUndefined();
    expect(Object.values(load(dualSingle(24)).city.junctionGroups ?? {})).toHaveLength(1);
  });

  it('T68.3: turn permissions through the group equal those of the merged node', () => {
    // The road pairs main's consolidated node n:2 allowed for this document (lead review,
    // TASK-131 Phase 1): every entry to every exit the lane graph reaches, U-turns included.
    const merged = [
      'r:12>r:10',
      'r:12>r:17',
      'r:12>r:5',
      'r:18>r:10',
      'r:18>r:13',
      'r:18>r:5',
      'r:3>r:10',
      'r:3>r:13',
      'r:3>r:17',
      'r:3>r:5',
      'r:8>r:10',
      'r:8>r:13',
      'r:8>r:17',
      'r:8>r:5',
    ];
    expect(roadPairs(load(dualSingle(20)).compiled)).toEqual(merged);
    expect(roadPairs(load(dualSingle(20, true)).compiled)).toEqual(merged);
  });

  it('T68.4: one signal makes the group signalised; one program clears every entry to its exit', () => {
    const { city, compiled } = load(dualSingle(20, true));
    const group = Object.values(city.junctionGroups!)[0]!;
    expect(group.signal).not.toBeNull();
    for (const id of group.nodes) {
      expect(city.nodes[id]!.control).toBe('signal');
      expect(city.nodes[id]!.signal).toBeNull();
    }
    const cgroup = compiled.groups![0]!;
    const signals = cgroup.nodes.map((n) => compiled.nodes[n]!.signal!);
    // The members run the group's timing in lockstep.
    for (const signal of signals) {
      expect(signal.cycleS).toBe(signals[0]!.cycleS);
      expect(signal.phases.map((p) => p.durationS)).toEqual(
        group.signal!.phases.map((p) => p.durationS),
      );
    }
    // In each phase, every chain of a green group is green at each member it crosses.
    group.signal!.phases.forEach((phase, p) => {
      const timeS = signals[0]!.phases.slice(0, p).reduce((t, x) => t + x.durationS + 4, 0) + 1;
      for (const { from, to } of phase.groups) {
        const chains = cgroup.chains.filter(
          (c) => compiled.roads[c.from]!.id === from && compiled.roads[c.to]!.id === to,
        );
        expect(chains.length).toBeGreaterThan(0);
        for (const chain of chains)
          for (const m of chain.movements) {
            const signal = compiled.nodes[compiled.movements[m]!.node]!.signal!;
            const state = signalStateAt(signal, timeS);
            expect(state).toEqual({ phase: p, state: 'green' });
            expect(signal.phases[p]!.movements).toContain(m);
          }
      }
    });
  });

  it('T68.5: the same import gives the same city hash', () => {
    const hash = () =>
      createHash('sha256')
        .update(JSON.stringify(load(dualSingle(20, true)).city))
        .digest('hex');
    expect(hash()).toBe(hash());
  });
});
