import { expect, test } from 'vitest';
import { defaultScenario } from '../../src/fixtures/scenarios';
import { syntheticAirport, syntheticAirportBacktrack } from '../../src/fixtures/synthetic-airport';
import { pointInPolygon } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { openProject } from '../../src/project/open';
import { saveProject } from '../../src/project/save';
import { citySchema, scenarioSchema } from '../../src/schema';
import { aircraftCodes, codeAdmits } from '../../src/schema/aircraft';
import { airsideReachable, expectAirsideTopology } from '../airside-topology';

test.for([
  { id: 'syntheticAirport', generate: syntheticAirport, backtrack: false },
  { id: 'syntheticAirportBacktrack', generate: syntheticAirportBacktrack, backtrack: true },
] as const)(
  '$id compiles and round-trips with connected, code-limited airside',
  async ({ id, generate, backtrack }) => {
    const scenario = scenarioSchema.parse(defaultScenario(id, 296));
    const city = generate(scenario.seed);
    expect(city).toEqual(generate(scenario.seed));
    expect(citySchema.parse(city)).toEqual(city);
    const compiled = compile(city);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.compiled.lots?.[0]?.stallCount).toBeGreaterThan(0);
    const project = { city, scenarios: [scenario] };
    expect(await openProject(await saveProject(project))).toEqual({ ok: true, project });

    const airport = city.airport!;
    expectAirsideTopology(airport);
    const [runway] = Object.values(airport.runways);
    expect(Object.keys(airport.runways)).toHaveLength(1);
    expect(runway!.ref).toBe('09/27');
    expect(runway!.ends.map((end) => end.designator)).toEqual(['09', '27']);
    const edges = Object.values(airport.edges);
    const holds = Object.values(airport.holdingPositions);
    const runwayNodes = new Set(
      runway!.edges.flatMap((id) => [airport.edges[id]!.from, airport.edges[id]!.to]),
    );
    const entries = edges.filter((edge) => edge.kind === 'taxiway' && runwayNodes.has(edge.from));
    expect(entries).toHaveLength(backtrack ? 1 : 4);
    expect(holds.map((hold) => hold.toward).sort()).toEqual(entries.map((edge) => edge.id).sort());
    expect(holds.every((hold) => hold.runway === runway!.id && hold.side === 'right')).toBe(true);

    const stands = Object.values(airport.stands);
    expect(
      stands
        .filter((stand) => stand.kind === 'contact')
        .map((stand) => stand.maxCode)
        .sort(),
    ).toEqual(['C', 'C', 'C', 'E', 'E', 'E']);
    expect(stands.filter((stand) => stand.kind === 'remote')).toHaveLength(2);
    const maintenance = stands.find((stand) => stand.kind === 'maintenance')!;
    expect(stands).toHaveLength(9);
    expect(airport.hangars).toHaveLength(1);
    expect(Object.keys(airport.terminals)).toHaveLength(1);
    expect(Object.keys(airport.helipads)).toHaveLength(1);
    const hangarApron = airport.surfaces.find((area) => area.name === 'Hangar apron')!.rings[0]!;
    expect(pointInPolygon(maintenance.pos, [...hangarApron, hangarApron[0]!])).toBe(true);
    for (const stand of stands) {
      expect(stand.provenance.source).toBe('generated');
      const { gate, maxCode, ref } = stand;
      if (stand.kind === 'contact')
        expect(airport.gates[gate!]).toMatchObject({ ref, terminal: expect.any(String) });
      const leadIn = airport.edges[stand.leadIn.at(-1)!]!;
      expect(leadIn.provenance.source).toBe('generated');
      for (const end of runway!.ends) {
        const admitsStandCode = (edge: (typeof edges)[number]) =>
          edge.maxCode !== null && codeAdmits(edge.maxCode, maxCode!);
        expect(airsideReachable(airport, end.node, admitsStandCode).has(leadIn.to)).toBe(true);
        expect(airsideReachable(airport, leadIn.to, admitsStandCode).has(end.node)).toBe(true);
      }
    }
    const largeStand = stands.find(({ maxCode }) => maxCode === 'E')!;
    expect(aircraftCodes.filter((code) => codeAdmits(largeStand.maxCode!, code))).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
    expect(edges.filter(({ kind }) => kind === 'taxilane').length).toBeGreaterThan(0);
    for (const lane of edges.filter(({ kind }) => kind === 'taxilane'))
      expect(aircraftCodes.filter((code) => codeAdmits(lane.maxCode!, code))).toEqual([
        'A',
        'B',
        'C',
      ]);

    const offRunway = (edge: (typeof edges)[number]) => edge.kind !== 'runway';
    const [west, east] = runway!.ends;
    if (backtrack) {
      expect(airport.turnPads.map((pad) => pad.node)).toEqual([west.node, east.node]);
      expect(airport.surfaces.filter((area) => area.kind === 'turn_pad')).toHaveLength(2);
      const entry = entries[0]!;
      const taxiOnly = airsideReachable(airport, entry.to, offRunway);
      expect(taxiOnly.has(entry.from)).toBe(true);
      for (const end of runway!.ends) {
        expect(taxiOnly.has(end.node)).toBe(false);
        expect(
          airsideReachable(airport, entry.from, (edge) => !offRunway(edge)).has(end.node),
        ).toBe(true);
      }
    } else {
      expect(airport.turnPads).toHaveLength(0);
      expect(airsideReachable(airport, west.node, offRunway).has(east.node)).toBe(true);
      const exitDeltas = entries.map(
        ({ from, to }) => airport.nodes[to]!.pos.x - airport.nodes[from]!.pos.x,
      );
      expect(exitDeltas).toEqual([0, expect.any(Number), expect.any(Number), 0]);
      expect(exitDeltas[1]).toBeLessThan(0); // 27: westbound
      expect(exitDeltas[2]).toBeGreaterThan(0); // 09: eastbound
    }
  },
);

test('topology detects a disconnected apron in a schema-valid copy', () => {
  const city = syntheticAirportBacktrack();
  const airport = city.airport!;
  const hold = Object.values(airport.holdingPositions)[0]!;
  const feeder = Object.values(airport.edges).find((edge) => edge.from === hold.node)!;
  delete airport.edges[feeder.id];
  expect(citySchema.safeParse(city).success).toBe(true);
  expect(() => expectAirsideTopology(airport)).toThrow('airside must be one component');
});
