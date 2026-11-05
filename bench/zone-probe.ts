import { readFileSync } from 'node:fs';
import { generatePopulation, scheduleTrips } from '../src/demand';
import { defaultScenario } from '../src/fixtures/scenarios';
import { importOsm } from '../src/importers/osm';
import { compile } from '../src/network';
import { createEngine } from '../src/sim/engine';

// Diagnose the remaining Munich queues without changing routing, geometry, or simulation rules.
// node --experimental-strip-types --import ./bench/register.ts ./bench/zone-probe.ts
const imported = importOsm(readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8'), {
  importerVersion: '1',
  drivingSide: 'right',
  bbox: [11.525, 48.135, 11.545, 48.148],
});
if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
const { city } = imported;
const result = compile(city);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const { compiled } = result;
console.info(
  JSON.stringify(
    result.diagnostics.filter((d) => d.code === 'road_too_short'),
    null,
    2,
  ),
);
const scenario = defaultScenario('grid5x5');
scenario.startS = 7 * 3600;
scenario.endS = 10 * 3600;
scenario.demand.personsPerResident = 0.15;
const trips = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
const engine = createEngine();
engine.load({ compiled, trips, scenario });
const last = new Map<number, { lane: number; position: number; since: number }>();
for (let step = 0; step < 108000; step += 600) {
  engine.step(600);
  for (const id of engine.snapshot().id) {
    const car = engine.inspect(id)!;
    const before = last.get(id);
    if (!before || before.lane !== car.lane || Math.abs(before.position - car.positionM) > 1)
      last.set(id, { lane: car.lane, position: car.positionM, since: engine.timeS });
  }
}
const groups = new Map<number, number[]>();
for (const id of engine.snapshot().id) {
  const car = engine.inspect(id)!;
  if (car.speedMps >= 0.1 || engine.timeS - last.get(id)!.since < 300) continue;
  const group = groups.get(car.lane) ?? [];
  group.push(id);
  groups.set(car.lane, group);
}
const blocked = [...groups]
  .map(([field, ids]) => {
    ids.sort((a, b) => engine.inspect(b)!.positionM - engine.inspect(a)!.positionM);
    const head = engine.inspect(ids[0]!)!;
    const lane = compiled.lanes[field];
    const path = lane
      ? compiled.movements[
          head.route!.movements.find((idx) => compiled.movements[idx]!.fromLane === field) ?? -1
        ]
      : compiled.movements[-field - 1];
    return {
      segment: lane?.id ?? path!.id,
      node: path ? compiled.nodes[path.node]!.id : null,
      stoppedOver5Min: ids.length,
      headVehicle: head.id,
      positionM: head.positionM,
      lengthM: lane?.lengthM ?? path!.lengthM,
      nextMovement: path?.id,
      movementLengthM: path?.lengthM,
      zones: path?.conflictZones,
    };
  })
  .sort((a, b) => b.stoppedOver5Min - a.stoppedOver5Min);
console.info(
  JSON.stringify(
    { trips: engine.metrics().trips, zoneStops: engine.metrics().zoneStops, blocked },
    null,
    2,
  ),
);
