import { readFileSync } from 'node:fs';
import process from 'node:process';
import { importOsmCached } from './city-cache';
import { probeMorning } from './import-probe';
import { compile } from '../src/network';
import { keepClearZones } from '../src/network/keep-clear';

// TASK-180: Munich's morning as the traffic tier runs it (munich-full-demand at scale 1,
// munich-morning at 0.15), with the summary the throughput diagnosis compares.
// Usage: node --experimental-strip-types --import ./bench/register.ts bench/throughput-probe.ts
// [--scale n] [--seed n] [--mode-choice on|off] [--actuated on|off] (every generated program's
// actuation, TASK-170). Defaults: full demand, seed 1, choice off, programs as imported.
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1]!;
};
const scale = Number(option('scale', '1'));
const seed = Number(option('seed', '1'));
const modeChoice = option('mode-choice', 'off') === 'on';
const xml = readFileSync('fixtures/osm/munich-donnersberger.osm', 'utf8');
const imported = importOsmCached(xml, {
  importerVersion: 'test',
  bbox: [11.525, 48.135, 11.545, 48.148],
});
if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
// The import (cached) generated the programs; the flag is set on every one of them.
const actuated = option('actuated', 'default');
if (actuated !== 'default')
  for (const owner of [
    ...Object.values(imported.city.nodes),
    ...Object.values(imported.city.junctionGroups ?? {}),
  ])
    if (owner.signal) owner.signal.actuated = actuated === 'on';
const result = compile(imported.city);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const { compiled } = result;
// Where queues form: the junction decisions that hold a vehicle back, in vehicle-seconds, by
// reason and by node; and the departures held for a gap, by what they leave (TASK-180).
const dtS = 0.1;
const denied: Record<string, number> = {};
const deniedAt: Record<string, Record<string, number>> = {};
const held: Record<string, number> = {};
const heldAt: Record<string, number> = {};
// Every minute, the stopped cars on lanes by where they stand: held short of a keep-clear zone
// (front within 1.5 m of its start), on a zone, at the stop line, or in a queue; vehicle-seconds,
// for all stopped cars and for the stopped first car of each lane.
const zones = keepClearZones(compiled);
const stood: Record<string, number> = {};
const stoodHeads: Record<string, number> = {};
const heldShortAt: Record<string, number> = {};
let tick = 0;
const m = probeMorning(imported.city, compiled, scale, {
  demandSeed: seed,
  modeChoice,
  observe(engine) {
    if (++tick % 600) return;
    const snap = engine.snapshot();
    const front = new Map<number, { id: number; at: number }>();
    const cars: { id: number; lane: number; at: number; length: number }[] = [];
    for (const [i, id] of snap.id.entries()) {
      const lane = snap.lane[i]!;
      if (lane < 0 || snap.speed[i]! >= 0.1) continue;
      const detail = engine.inspect(id)!;
      if (detail.state !== 'driving') continue;
      cars.push({
        id,
        lane,
        at: detail.positionM,
        length: detail.vehicleClass === 'car' ? 4.5 : 8,
      });
    }
    for (const [i, id] of snap.id.entries()) {
      const lane = snap.lane[i]!;
      if (lane < 0) continue;
      const at = engine.inspect(id)!.positionM;
      const f = front.get(lane);
      if (!f || at > f.at) front.set(lane, { id, at });
    }
    for (const car of cars) {
      const lane = compiled.lanes[car.lane]!;
      let where = 'queue';
      if (lane.stopM - car.at < 1.5) where = 'stop line';
      for (const z of zones[car.lane]!) {
        if (car.at <= z.fromM && z.fromM - car.at < 1.5 && where !== 'stop line') {
          where = `held short of ${z.kind}`;
          if (z.kind === 'mouth') {
            const road = compiled.roads[lane.road]!.id;
            heldShortAt[road] = (heldShortAt[road] ?? 0) + 60;
          }
        } else if (z.fromM < car.at && z.toM > car.at - car.length && where === 'queue')
          where = `on ${z.kind}`;
      }
      stood[where] = (stood[where] ?? 0) + 60;
      if (front.get(car.lane)?.id === car.id) stoodHeads[where] = (stoodHeads[where] ?? 0) + 60;
    }
  },
  intersectionObserver(_id, movement, reason) {
    if (reason === 'granted') return;
    denied[reason] = (denied[reason] ?? 0) + dtS;
    const node = compiled.nodes[movement.node]!;
    const at = (deniedAt[reason] ??= {});
    const key = `${node.id}${node.signal ? ' (signal)' : ''}`;
    at[key] = (at[key] ?? 0) + dtS;
  },
  originObserver(_id, connector, hasGap) {
    if (hasGap) return;
    const kind =
      connector.parking === undefined
        ? compiled.places[connector.place]!.kind
        : compiled.parking[connector.parking]!.kind;
    held[kind] = (held[kind] ?? 0) + dtS;
    const id =
      connector.parking === undefined
        ? compiled.places[connector.place]!.id
        : compiled.parking[connector.parking]!.id;
    heldAt[id] = (heldAt[id] ?? 0) + dtS;
  },
});
const top = (counts: Record<string, number>, n = 12) =>
  Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, n)
      .map(([k, v]) => [k, Math.round(v)]),
  );
console.info(
  JSON.stringify(
    {
      scale,
      seed,
      modeChoice,
      releasedTrips: m.releasedTrips,
      completed: m.completed,
      failed: m.failed,
      failedByReason: Object.fromEntries(Object.entries(m.failedByReason).filter(([, n]) => n > 0)),
      driving: m.driving,
      queuedOrigin: m.queuedOrigin,
      queuedDestination: m.queuedDestination,
      peakDriving: m.peakDriving,
      meanDelayS: Math.round(m.meanDelayS),
      stalledHeads: m.stalledHeads,
      respawns: m.respawns,
      zoneStops: m.zoneStops,
      completedByHalfHour: m.completedByHalfHour,
      gridlockedRoads: top(m.gridlockedRoads),
      stalledHeadRoads: top(
        m.stalledHeadDetails.reduce<Record<string, number>>((c, d) => {
          c[d.road] = (c[d.road] ?? 0) + 1;
          return c;
        }, {}),
      ),
      loopCensus: m.loopCensus,
      deniedS: top(denied),
      deniedAtS: Object.fromEntries(Object.entries(deniedAt).map(([r, at]) => [r, top(at, 8)])),
      originHeldS: top(held),
      stoppedS: top(stood),
      stoppedHeadsS: top(stoodHeads),
      heldShortOfMouthAtS: top(heldShortAt),
      originHeldAtS: top(heldAt),
      stateHash: m.stateHash,
      stepTimeS: Math.round(m.stepTimeMs / 1000),
    },
    null,
    1,
  ),
);
