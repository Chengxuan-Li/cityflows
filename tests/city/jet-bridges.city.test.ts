import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { distance, segmentDistance } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import {
  apronLayout,
  bridgeSize,
  closed,
  dockedPose,
  JetBridgeStates,
  reaches,
} from '../../src/render/apron';
import { aircraftTypes } from '../../src/schema/aircraft';
import { createAircraftFleet } from '../../src/sim/aircraft';

// TASK-315: jet bridges where a multi-level terminal faces a contact stand admitting a jet (code
// C or larger) with a mapped gate: every such stand at Zurich (Dock E, Docks A and B, at least
// 8 m high), none at London City (eight such stands before a two-level apron front, where
// passengers walk out). Each rotunda stands just off a terminal facade or at the end of a fixed
// link from one, and reaches the stand's reference aircraft.

test.each([
  ['london-city-airport', 8, 0],
  ['zurich-airport', 20, 20],
])('%s: of %i mapped contact gates, %i bridged from a terminal', async (id, gates, bridged) => {
  const { city } = await openBundled(id);
  const result = compile(city);
  if (!result.ok) throw new Error(`${id} does not compile`);
  const graph = result.compiled.airside!;
  const airport = city.airport!;
  const { bridges, boards } = apronLayout(airport, graph, city.context);
  const facades = Object.values(airport.terminals).flatMap((t) => {
    const ring = closed(t.rings[0]!);
    return ring.slice(1).map((b, i) => [ring[i]!, b] as const);
  });
  const toFacade = (p: { x: number; y: number }) =>
    Math.min(...facades.map(([a, b]) => segmentDistance(p, a, b)));
  const mapped = graph.stands.filter(
    (s) => s.kind === 'contact' && airport.stands[s.id]!.gate && s.maxCode >= 2,
  );
  expect(mapped).toHaveLength(gates);
  const byStand = new Map(bridges.map((b) => [b.stand, b]));
  expect(bridges).toHaveLength(bridged);
  for (const bridge of bridges) {
    const stand = graph.stands[bridge.index]!;
    expect(mapped).toContain(stand);
    if (bridge.link) {
      expect(toFacade(bridge.link[0]!)).toBeLessThan(1e-6);
      expect(distance(bridge.link[0]!, bridge.rotunda)).toBeLessThanOrEqual(bridgeSize.linkMaxM);
    } else expect(toFacade(bridge.rotunda)).toBeLessThan(bridgeSize.rotundaRadiusM + 0.6);
    const reference = aircraftTypes.find(
      (t) => t.id === (stand.maxCode >= 5 ? 'A388' : stand.maxCode === 4 ? 'B77W' : 'A20N'),
    )!;
    expect(reaches(bridge, dockedPose(stand, reference))).toBe(true);
  }
  expect(byStand.size).toBe(bridged);
  expect(boards).toHaveLength(bridges.length);
});

test.each([
  ['boston-logan', 111, 'C9', 'BCS3'],
  ['heathrow', 15, '223', 'A21N'],
])('%s draws all %i imported bridge ways and docks a jet', async (id, count, ref, typeId) => {
  const { city } = await openBundled(id);
  const result = compile(city);
  if (!result.ok) throw new Error(`${id} does not compile`);
  const airport = city.airport!;
  const graph = result.compiled.airside!;
  const { bridges } = apronLayout(airport, graph, city.context);
  expect(airport.jetBridges).toHaveLength(count);
  expect(bridges).toHaveLength(count);
  for (const [i, bridge] of bridges.entries()) {
    const { line, stand } = airport.jetBridges![i]!;
    expect(graph.stands[bridge.index]?.id).toBe(stand);
    expect(bridge.mappedTip).toEqual(line.at(-1));
    expect(line).toContainEqual(bridge.rotunda);
    if (bridge.link) expect(bridge.link[0]).toEqual(line[0]);
  }
  const stand = graph.stands.find((stand) => stand.ref === ref)!;
  const fleet = createAircraftFleet(graph, 1);
  expect(fleet.spawnParked({ typeId, stand: stand.id }).ok).toBe(true);
  const states = new JetBridgeStates(bridges);
  states.update(fleet.snapshot(), 0);
  expect(
    bridges.some((bridge, i) => bridge.stand === stand.id && states.progress(i, 0) === 1),
  ).toBe(true);
});
