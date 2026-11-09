import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { compile } from '../../src/network';
import { pointAtDistance } from '../../src/geo/polyline';
import { createHash } from 'node:crypto';
import { vehicleJson } from '../vehicle-json';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { town } from '../../src/fixtures/town';
import type { CompiledCity } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { eventTrips } from '../../src/demand/events';
import { defaultScenario } from '../../src/fixtures/scenarios';

test.each([
  ['munich-donnersberger', 'pk:2042'],
  ['sindelfingen-a81', 'pk:1474'],
])('T54 %s %s event arrivals reach their lot through the street and local graphs', (name, id) => {
  const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
    importerVersion: '1',
    context: false,
    terrain: false,
  });
  if (!imported.ok) throw new Error('import');
  const source = imported.city,
    lot = source.parking![id]!;
  source.places[lot.placeId!]!.events = [
    { id: 'arrival', name: 'Arrival', startS: 25200, durationS: 1800, arrivals: 16, departures: 0 },
  ];
  const result = compile(source);
  if (!result.ok) throw new Error('compile');
  const scenario = defaultScenario('grid5x5', 118);
  scenario.startS = 25200;
  scenario.endS = 32400;
  scenario.simParams.streetParkingShare = 0;
  scenario.demand.classShares = {
    local: { car: 1, van: 0, truck: 0, bus: 0 },
    through: { car: 1, van: 0, truck: 0, bus: 0 },
  };
  const trips = eventTrips(source, scenario),
    engine = createEngine();
  engine.load({ compiled: result.compiled, trips, scenario });
  engine.step(36000);
  const details = trips.map((_, i) => engine.inspect(i + 1));
  writeFileSync(
    `node_modules/.cache/task118-arrivals-${name}-${id.replace(':', '-')}.json`,
    JSON.stringify({ metrics: engine.metrics(), details }, null, 2),
  );
  expect(
    details.filter((d) => d?.parkingFacility === id && d.arrivedS !== null).length,
  ).toBeGreaterThan(0);
});

// Opt-in comparison with the lead's clean checkout, through the authorized city gate.
test.skipIf(!process.env.CITYFLOWS_BASELINE_ROOT)(
  'T54 grid, town and both extracts retain main vehicle geometry',
  async () => {
    const { compile: baselineCompile } = (await import(
      pathToFileURL(resolve(process.env.CITYFLOWS_BASELINE_ROOT!, 'src/network/index.ts')).href
    )) as { compile: typeof compile };
    const cities = [grid5x5(), town()];
    for (const name of ['munich-donnersberger', 'sindelfingen-a81']) {
      const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
        importerVersion: '1',
        context: false,
        terrain: false,
      });
      if (!imported.ok) throw new Error('import');
      cities.push(imported.city);
    }
    const geometry = (net: CompiledCity) =>
      JSON.stringify({
        nodes: net.nodes.map((n) =>
          n.signal
            ? {
                ...n,
                signal: {
                  ...n.signal,
                  phases: n.signal.phases.map(({ durationS, movements }) => ({
                    durationS,
                    movements,
                  })),
                },
              }
            : n,
        ),
        roads: net.roads,
        lanes: net.lanes.map((lane) => ({ ...lane, connectors: [] })),
        movements: net.movements,
      });
    const hashes = [];
    for (const city of cities) {
      const before = baselineCompile(structuredClone(city)),
        after = compile(structuredClone(city));
      if (!before.ok || !after.ok) throw new Error('compile');
      const digest = (net: CompiledCity) =>
        createHash('sha256').update(geometry(net)).digest('hex');
      expect(digest(after.compiled), city.name).toBe(digest(before.compiled));
      hashes.push({ name: city.name, hash: digest(after.compiled) });
    }
    writeFileSync(
      'node_modules/.cache/task118-vehicle-geometry.json',
      JSON.stringify(hashes, null, 2),
    );
  },
);

test.each(['munich-donnersberger', 'sindelfingen-a81'])('T54 %s circulation inventory', (name) => {
  const imported = importOsmCached(readFileSync(`fixtures/osm/${name}.osm`, 'utf8'), {
    importerVersion: '1',
    context: false,
    terrain: false,
  });
  if (!imported.ok) throw new Error('import');
  const result = compile(imported.city);
  if (!result.ok) throw new Error('compile');
  const lots = result.compiled.lots ?? [];
  // Courtyard lots reached through a building passage: the entry link may run under the
  // building exclusion (never over a bay), so their stalls stay usable.
  const courtyard = lots.find(
    (lot) => lot.id === (name === 'sindelfingen-a81' ? 'pk:1475' : 'pk:2037'),
  )!;
  expect(courtyard.circulation!.entries.length).toBeGreaterThan(0);
  expect(courtyard.circulation!.unreachable.length).toBeLessThan(courtyard.stallCount / 10);
  const sha = (value: string) => createHash('sha256').update(value).digest('hex');
  writeFileSync(
    `node_modules/.cache/task118-hashes-${name}.json`,
    JSON.stringify(
      {
        resultVehicle: sha(vehicleJson(result)),
        resultAll: sha(JSON.stringify(result, (_, v: unknown) => (v instanceof Map ? [...v] : v))),
        compiledVehicle: sha(vehicleJson(result.compiled, true)),
      },
      null,
      2,
    ),
  );
  const inventory = lots.map((l) => ({
    id: l.id,
    stalls: l.stallCount,
    entries: l.circulation?.entries.length ?? 0,
    unreachable: l.circulation?.unreachable.length ?? l.stallCount,
  }));
  expect(inventory.filter((l) => l.stalls > l.unreachable).length).toBeGreaterThan(0);
  writeFileSync(
    `node_modules/.cache/task118-inventory-${name}.json`,
    JSON.stringify(
      {
        city: name,
        lots: lots.length,
        withCirculation: inventory.filter((l) => l.stalls > l.unreachable).length,
        unreachable: inventory.reduce((n, l) => n + l.unreachable, 0),
        inventory,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    `node_modules/.cache/task118-lot-geometry-${name}.json`,
    JSON.stringify(
      lots.map((l) => {
        const f = result.compiled.parking[result.compiled.index.parking.get(l.id)!];
        return {
          id: l.id,
          source: imported.city.parking![l.id],
          stalls: l.stalls,
          aislePaths: l.aislePaths,
          graph: l.circulation,
          entries: f?.connectorsIn.map((i) => {
            const c = result.compiled.connectors[i]!,
              lane = result.compiled.lanes[c.lane]!;
            return {
              connector: c,
              point: pointAtDistance(lane.polyline, lane.cumulative, c.positionM),
            };
          }),
        };
      }),
    ),
  );
  console.info(
    'T54 circulation',
    JSON.stringify({
      city: name,
      lots: lots.length,
      withCirculation: inventory.filter((l) => l.stalls > l.unreachable).length,
      unreachable: inventory.reduce((sum, l) => sum + l.unreachable, 0),
      inventory,
    }),
  );
});
