import { expect, test } from 'vitest';
import { syntheticAirport, syntheticAirportBacktrack } from '../../src/fixtures/synthetic-airport';
import { compile } from '../../src/network';
import { allocateId, type City } from '../../src/schema';
import { taxiFlowPreferences } from '../../src/sim/taxi-flow-preferences';

const mixed = (end: string) => ({ arrivalEnds: [end], departureEnds: [end] });

function airside(city: City) {
  const result = compile(city);
  if (!result.ok || !result.compiled.airside) throw new Error('Expected a compiled airport');
  return result.compiled.airside;
}

test('opposite configurations reverse the synthetic runway parallel', () => {
  const graph = airside(syntheticAirport());
  const east = taxiFlowPreferences(graph, mixed('09')).preferred;
  const west = taxiFlowPreferences(graph, mixed('27')).preferred;
  const parallel = graph.edges.filter(({ ref }) => ref === 'A');
  expect(parallel).toHaveLength(4);
  // Each angled exit joins inside the parallel. Both central edges carry both configurations.
  const ordered = parallel.toSorted(
    (a, b) => graph.nodes[a.from]!.pos.x - graph.nodes[b.from]!.pos.x,
  );
  expect(ordered.map(({ idx }) => east[idx])).toEqual([-1, -1, -1, 0]);
  expect(ordered.map(({ idx }) => west[idx])).toEqual([0, 1, 1, 1]);
  for (const { idx, kind } of graph.edges) {
    if (kind === 'runway' || kind === 'lead_in') {
      expect(east[idx]).toBe(0);
      expect(west[idx]).toBe(0);
    }
  }
});

test('shared access stays neutral and parallel access separates opposing flows', () => {
  const city = syntheticAirportBacktrack();
  const airport = city.airport!;
  const access = Object.values(airport.edges).find(
    ({ ref, from }) =>
      ref === 'B' && Object.values(airport.holdingPositions).some((h) => h.node === from),
  )!;
  const single = airside(city);
  expect(
    taxiFlowPreferences(single, mixed('09')).preferred[single.index.edge.get(access.id)!],
  ).toBe(0);

  // Add a return leg to the apron access. The runway and all stand roots stay the same.
  const id = allocateId(city, 'ae');
  const [start, end] = access.line;
  airport.edges[id] = {
    ...access,
    id,
    line: [start!, { x: (start!.x + end!.x) / 2 + 25, y: (start!.y + end!.y) / 2 }, end!],
  };
  const loop = airside(city);
  const { preferred, wrongWayCost } = taxiFlowPreferences(loop, mixed('09'));
  const out = preferred[loop.index.edge.get(access.id)!]!;
  const back = preferred[loop.index.edge.get(id)!]!;
  expect(Math.abs(out)).toBe(1);
  expect(back).toBe(-out);
  expect(wrongWayCost).toBeGreaterThan(1);
});
