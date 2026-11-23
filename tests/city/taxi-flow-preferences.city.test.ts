import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import type { AirsideGraph } from '../../src/network/airside';
import { taxiFlowPreferences } from '../../src/sim/taxi-flow-preferences';

function reachable(graph: AirsideGraph, preferred: Int8Array, roots: number[], reverse: boolean) {
  const reached = new Set(roots);
  for (const node of reached) {
    for (const idx of graph.nodes[node]!.edges) {
      const { kind, maxCode, from, to, oneway } = graph.edges[idx]!;
      if ((kind !== 'taxiway' && kind !== 'taxilane') || maxCode < 0) continue;
      const forward = (node === from) !== reverse;
      if ((!forward && oneway) || preferred[idx] === (forward ? -1 : 1)) continue;
      reached.add(node === from ? to : from);
    }
  }
  return reached;
}

test('London City reverses taxi flow when the runway direction changes', async () => {
  const { city } = await openBundled('london-city-airport');
  const result = compile(city);
  if (!result.ok || !result.compiled.airside) throw new Error('Expected London City airside');
  const graph = result.compiled.airside;
  const east = taxiFlowPreferences(graph, { arrivalEnds: ['09'], departureEnds: ['09'] }).preferred;
  const west = taxiFlowPreferences(graph, { arrivalEnds: ['27'], departureEnds: ['27'] }).preferred;
  const flipped = graph.edges.filter(({ idx }) => east[idx] !== 0 && east[idx] === -west[idx]!);
  expect(flipped.length).toBeGreaterThan(0);
  expect(flipped.every(({ kind }) => kind === 'taxiway' || kind === 'taxilane')).toBe(true);

  // The far runway exits for arrivals and the near line-up for departures, by runway station.
  const runway = graph.runways[0]!;
  const at = (station: number) =>
    runway.nodes[runway.stationsM.findIndex((m) => Math.round(m) === station)]!;
  for (const { preferred, exits, lineUp } of [
    { preferred: east, exits: [1447, 1464], lineUp: 46 },
    { preferred: west, exits: [46, 94], lineUp: 1464 },
  ]) {
    const taxiIn = reachable(graph, preferred, exits.map(at), false);
    const taxiOut = reachable(graph, preferred, [at(lineUp)], true);
    const stands = graph.stands.map(({ root }) => root);
    expect(stands).toHaveLength(19);
    expect(stands.filter((root) => !taxiIn.has(root) || !taxiOut.has(root))).toEqual([]);
  }
});
