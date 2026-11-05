import { readFileSync } from 'node:fs';
import process from 'node:process';
import { generatePopulation, scheduleTrips } from '../src/demand';
import { defaultScenario } from '../src/fixtures/scenarios';
import { importOsm } from '../src/importers/osm';
import { compile } from '../src/network';
import { createEngine } from '../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../src/sim/params';
import { SETBACK_CAP_M } from '../src/network/junctions';

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
let sampleDecisions = false;
const refusals = new Map<string, number>();
const totals = new Map<string, number>();
const decisions = new Map<number, { reason: string; other?: string }>();
const boxWaitS = Number(
  process.argv.find((arg) => arg.startsWith('--box-wait='))?.split('=')[1] ?? 10,
);
engine.load({
  compiled,
  trips,
  scenario,
  params: { intersection: { ...DEFAULT_SIM_PARAMS.intersection, boxWaitS } },
  intersectionObserver: (id, movement, reason, other) => {
    if (!sampleDecisions) return;
    decisions.set(id + 1, { reason, other: other?.id });
    const category = other?.toLane === movement.toLane ? `${reason}:same-exit` : reason;
    totals.set(category, (totals.get(category) ?? 0) + 1);
    const key = `${compiled.nodes[movement.node]!.id} ${movement.id} ${category}`;
    refusals.set(key, (refusals.get(key) ?? 0) + 1);
  },
});
let peakDriving = 0;
const last = new Map<number, { lane: number; position: number; since: number }>();
for (let step = 0; step < 108000; step += 600) {
  engine.step(599);
  sampleDecisions = true;
  engine.step();
  sampleDecisions = false;
  peakDriving = Math.max(peakDriving, engine.metrics().trips.driving);
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
const active = [...engine.snapshot().id].map((id) => engine.inspect(id)!);
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
      decision: decisions.get(head.id),
      exitTail: path
        ? active
            .filter((car) => car.lane === path.toLane)
            .sort((a, b) => a.positionM - b.positionM)
            .slice(0, 1)
            .map((car) => ({ id: car.id, position: car.positionM, speed: car.speedMps }))
        : undefined,
      zoneBlockers: path?.conflicts.flatMap((idx, i) => {
        const other = compiled.movements[idx]!;
        const [start, end] = other.conflictZones[other.conflicts.indexOf(path.idx)]!;
        if (!lane && head.positionM > path.conflictZones[i]![0]) return [];
        return active
          .filter(
            (car) =>
              car.lane === -idx - 1 &&
              car.positionM > start &&
              car.positionM < end + DEFAULT_SIM_PARAMS.vehicleLengthM,
          )
          .map((car) => ({
            movement: other.id,
            id: car.id,
            position: car.positionM,
            zoneStart: path.conflictZones[i]![0],
            speed: car.speedMps,
          }));
      }),
    };
  })
  .sort((a, b) => b.stoppedOver5Min - a.stoppedOver5Min);
console.info(
  JSON.stringify(
    {
      cap: SETBACK_CAP_M,
      boxWaitS,
      trips: engine.metrics().trips,
      peakDriving,
      hash: engine.stateHash(),
      zoneStops: engine.metrics().zoneStops,
      // First decision/refusal per request, sampled once per simulated minute.
      sampledDecisions: Object.fromEntries(totals),
      topDecisions: [...refusals].sort((a, b) => b[1] - a[1]).slice(0, 40),
      blocked,
    },
    null,
    2,
  ),
);
