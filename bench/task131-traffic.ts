import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAuditCity } from './junction-audit';
import { probeMorning } from './import-probe';
import { compile } from '../src/network';
import type { IntersectionObserver } from '../src/sim/intersection';
import { createEngine } from '../src/sim/engine';
import { createRouteProvider } from '../src/routing';
import { createRandom } from '../src/geo/random';
import { DEFAULT_SIM_PARAMS } from '../src/sim/params';
import { defaultScenario } from '../src/fixtures/scenarios';
import { generatePopulation, scheduleTrips } from '../src/demand';

// Phase 3 evidence: node admission decisions, continuous inner-link stops and B56 heads.
const cityName = process.env.CITYFLOWS_CITY === 'sindelfingen' ? 'sindelfingen' : 'munich';
const city = loadAuditCity(cityName);
const result = compile(city);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const { compiled } = result;
const seed = Number(process.env.CITYFLOWS_DEMAND_SEED ?? 1);
const untilS = Number(process.env.CITYFLOWS_UNTIL_S ?? 36000);
const out = process.env.CITYFLOWS_REPORT ?? 'task131-traffic.log';
const watched = new Set(['r:961', 'r:364', 'r:248', 'r:703', 'r:273', 'r:997']);
const decisions = new Map<
  number,
  { reason: Parameters<IntersectionObserver>[2]; movement: number; other?: number }
>();
const refusals: Record<string, number> = {};
const history: unknown[] = [];
const standing = new Map<number, { segment: number; sinceS: number }>();
const roadVisits = new Map<number, { road: string; sinceS: number; waitingOnEntryS: number }>();
const chainRefusals = new Map<string, unknown>();
const stoppedSince = new Map<number, number>();
const cycles: unknown[] = [];
const seenCycles = new Set<string>();
const traceCycles = process.env.CITYFLOWS_TRACE_CYCLES === '1';
const watchedIds = new Set(
  (process.env.CITYFLOWS_WATCH_IDS ?? '').split(',').map(Number).filter(Boolean),
);
const journeys: unknown[] = [];
const previousStates = new Map<number, { state: string; lane: number }>();
const originDecisions = new Map<
  number,
  {
    connector: string;
    firstReadyS: number;
    lastBlockedS: number | null;
    readyWaitS: number | null;
    facility: string | null;
  }
>();
let clockS = 25200;
const headQueries: unknown[] = [],
  headExecuted: unknown[] = [];
const seeds = new Map<number, number>();
if (watchedIds.size) {
  const scenario = defaultScenario('grid5x5', seed);
  scenario.demand.personsPerResident = 0.15;
  scenario.startS = 25200;
  scenario.endS = 36000;
  const trips = scheduleTrips(city, generatePopulation(city, scenario.demand), scenario);
  for (const id of watchedIds)
    for (let picks = 0; picks <= 2; picks++) {
      const rng = createRandom(scenario.seed).derive(trips[id - 1]!.id);
      for (let i = 0; i < picks; i++) rng.next();
      rng.normal(1, DEFAULT_SIM_PARAMS.idm.desiredSpeedSd);
      seeds.set(Math.floor(rng.next() * 0x100000000), id);
    }
}
const activeEngine = process.env.CITYFLOWS_ENGINE_ROOT
  ? (
      await import(
        pathToFileURL(resolve(process.env.CITYFLOWS_ENGINE_ROOT, 'src/sim/engine.ts')).href
      )
    ).createEngine()
  : createEngine();
const provider = createRouteProvider();
let endInnerOverBox = 0;
let endInnerStanding = 0;
let longestInnerStopS = 0;
let longestInnerStopVehicle = 0;
let tick = 0;
const morning = probeMorning(city, compiled, 0.15, {
  untilS,
  demandSeed: seed,
  engine: activeEngine,
  routeProvider: {
    route(net, costs, request) {
      const result = provider.route(net, costs, request);
      const id = seeds.get(request.seed);
      if (id !== undefined) {
        const stack = new Error().stack ?? '';
        if (stack.includes('detourHeads'))
          headQueries.push({
            id,
            timeS: activeEngine.timeS,
            version: costs.version,
            from: compiled.lanes[request.fromLane]!.id,
            positionM: request.fromPosM,
            to: compiled.connectors[request.toConnector]!.id,
            current: activeEngine.inspect(id),
            ok: result.ok,
            route: result.ok
              ? {
                  ...result.route,
                  roads: result.route.roads.map((r) => compiled.roads[r]!.id),
                  movements: result.route.movements.map((m) => compiled.movements[m]!.id),
                }
              : result.reason,
          });
      }
      return result;
    },
  },
  headDetourObserver(id, lane, movement) {
    if (watchedIds.has(id + 1))
      headExecuted.push({
        id: id + 1,
        timeS: activeEngine.timeS,
        from: compiled.lanes[lane]!.id,
        movement: compiled.movements[movement]!.id,
        current: activeEngine.inspect(id + 1),
      });
  },
  intersectionObserver(id, movement, reason, other) {
    decisions.set(id + 1, { reason, movement: movement.idx, other: other?.idx });
    const key = `${compiled.lanes[movement.fromLane]!.id}:${reason}`;
    refusals[key] = (refusals[key] ?? 0) + 1;
  },
  originObserver(id, connector, hasGap) {
    if (!watchedIds.has(id + 1)) return;
    let current = originDecisions.get(id + 1);
    if (!current) {
      current = {
        connector: connector.id,
        firstReadyS: clockS,
        lastBlockedS: null,
        readyWaitS: null,
        facility: null,
      };
      originDecisions.set(id + 1, current);
    }
    if (!hasGap) current.lastBlockedS = clockS;
  },
  observe(engine) {
    clockS = engine.timeS;
    for (const id of watchedIds) {
      const detail = engine.inspect(id);
      if (!detail) continue;
      const ready = originDecisions.get(id);
      if (ready && ready.readyWaitS === null) {
        ready.readyWaitS = detail.waitingS;
        ready.facility = detail.personId
          ? (engine.inspectPerson(detail.personId)?.car.facility ?? null)
          : null;
      }
      const previous = previousStates.get(id);
      if (previous?.state === detail.state && previous.lane === detail.lane) continue;
      previousStates.set(id, { state: detail.state, lane: detail.lane });
      const movement =
        detail.state === 'driving' && detail.lane < 0 && detail.lane !== -2147483648
          ? compiled.movements[-detail.lane - 1]
          : null;
      let exitRearM: number | null = null;
      if (movement) {
        const snapshot = engine.snapshot();
        for (const [i, otherId] of snapshot.id.entries()) {
          if (snapshot.lane[i] !== movement.toLane) continue;
          const other = engine.inspect(otherId)!;
          const rear =
            other.positionM - { car: 4.5, van: 5.5, truck: 12, bus: 12 }[other.vehicleClass];
          exitRearM = Math.min(exitRearM ?? Infinity, rear);
        }
      }
      journeys.push({
        timeS: engine.timeS,
        ...detail,
        segment: compiled.lanes[detail.lane]?.id ?? movement?.id,
        exitRearM,
        route: detail.route?.roads.map((r) => compiled.roads[r]!.id),
      });
    }
    if (++tick % 10) return;
    const snapshot = engine.snapshot();
    const active = new Set(snapshot.id);
    for (const id of roadVisits.keys()) if (!active.has(id)) roadVisits.delete(id);
    for (const id of standing.keys()) if (!active.has(id)) standing.delete(id);
    for (const id of stoppedSince.keys()) if (!active.has(id)) stoppedSince.delete(id);
    const heads = new Map<number, ReturnType<typeof engine.inspect>>();
    const allHeads = new Map<number, NonNullable<ReturnType<typeof engine.inspect>>>();
    const census = tick % 600 === 0 || traceCycles;
    let innerStanding = 0;
    let innerOverBox = 0;
    const innerStops: unknown[] = [];
    for (const [i, id] of snapshot.id.entries()) {
      const segment = snapshot.lane[i]!;
      if (segment === -2147483648) continue;
      const movement = segment < 0 ? compiled.movements[-segment - 1]! : null;
      const lane = compiled.lanes[movement?.fromLane ?? segment]!;
      const road = compiled.roads[lane.road]!;
      if (snapshot.speed[i]! < 0.1) {
        if (!stoppedSince.has(id)) stoppedSince.set(id, engine.timeS);
      } else stoppedSince.delete(id);
      const previousVisit = roadVisits.get(id);
      if (previousVisit?.road !== road.id)
        roadVisits.set(id, {
          road: road.id,
          sinceS: engine.timeS,
          waitingOnEntryS: engine.inspect(id)!.waitingS,
        });
      const inner = road.group !== undefined;
      if (inner && snapshot.speed[i]! < 0.1) {
        const previous = standing.get(id);
        const start = previous?.segment === segment ? previous.sinceS : snapshot.timeS;
        standing.set(id, { segment, sinceS: start });
        const stoppedS = snapshot.timeS - start;
        if (stoppedS > longestInnerStopS) {
          longestInnerStopS = stoppedS;
          longestInnerStopVehicle = id;
        }
        innerStanding++;
        if (stoppedS > 10) innerOverBox++;
        if (tick % 600 === 0)
          innerStops.push({
            id,
            lane: lane.id,
            segment: movement?.id ?? lane.id,
            stoppedS,
            visit: roadVisits.get(id),
            decision: decisions.get(id),
            detail: engine.inspect(id),
          });
      } else standing.delete(id);
      if (!census) continue;
      const current = engine.inspect(id)!;
      if (!allHeads.has(segment) || allHeads.get(segment)!.positionM < current.positionM)
        allHeads.set(segment, current);
      if (decisions.get(id)?.reason === 'box') {
        const detail = engine.inspect(id)!;
        const route = detail.route;
        const destination = route && compiled.roads[route.roads.at(-1)!]!;
        const key = `${lane.id}:${route?.roads.join(',')}`;
        if (!chainRefusals.has(key))
          chainRefusals.set(key, {
            id,
            lane: lane.id,
            timeS: engine.timeS,
            destinationRoad: destination?.id,
            destinationInner: destination?.group !== undefined,
            route: route?.roads.map((r) => compiled.roads[r]!.id),
            movements: route?.movements.map((m) => compiled.movements[m]!.id),
          });
      }
      if (!watched.has(road.id)) continue;
      const detail = engine.inspect(id)!;
      if (!heads.has(segment) || heads.get(segment)!.positionM < detail.positionM)
        heads.set(segment, detail);
    }
    if (traceCycles && engine.timeS >= 27000) {
      const edges = new Map<number, number>();
      const records = new Map<number, unknown>();
      for (const [segment, head] of allHeads) {
        if (
          head.state !== 'driving' ||
          engine.timeS - (stoppedSince.get(head.id) ?? engine.timeS) < 10
        )
          continue;
        const decision = decisions.get(head.id);
        const movement =
          segment < 0
            ? compiled.movements[-segment - 1]!
            : compiled.movements[decision?.movement ?? -1];
        if (!movement || decision?.reason === 'signal' || decision?.reason === 'stop') continue;
        let blocker = allHeads.get(movement.toLane);
        if (
          (decision?.reason === 'movement' || decision?.reason === 'approach') &&
          decision.other !== undefined
        ) {
          const other = compiled.movements[decision.other]!;
          blocker = allHeads.get(-other.idx - 1) ?? allHeads.get(other.fromLane);
        }
        if (!blocker || blocker.id === head.id || blocker.speedMps >= 0.1) continue;
        edges.set(head.id, blocker.id);
        records.set(head.id, {
          id: head.id,
          segment: segment >= 0 ? compiled.lanes[segment]!.id : movement.id,
          node: compiled.nodes[movement.node]!.id,
          planned: movement.id,
          decision,
          waitingS: head.waitingS,
          visit: roadVisits.get(head.id),
          origin: head.originPlace,
          destination: head.destinationPlace,
          blocker: blocker.id,
        });
      }
      for (const id of edges.keys()) {
        const path: number[] = [];
        let next: number | undefined = id;
        while (next !== undefined && !path.includes(next)) {
          path.push(next);
          next = edges.get(next);
        }
        if (next === undefined) continue;
        const ring = path.slice(path.indexOf(next));
        if (ring.length < 2 || !ring.some((id) => watched.has(roadVisits.get(id)?.road ?? '')))
          continue;
        const key = [...ring].sort((a, b) => a - b).join(',');
        if (seenCycles.has(key)) continue;
        seenCycles.add(key);
        const event = { timeS: engine.timeS, heads: ring.map((id) => records.get(id)) };
        cycles.push(event);
        console.info('cycle', JSON.stringify(event));
      }
    }
    if (tick % 600 === 0) {
      endInnerOverBox = innerOverBox;
      endInnerStanding = innerStanding;
      const row = {
        timeS: engine.timeS,
        innerStanding,
        innerOverBox,
        innerStops,
        heads: [...heads].map(([segment, detail]) => {
          const lane = compiled.lanes[segment];
          const step = lane ? (detail!.route?.roads.indexOf(lane.road) ?? -1) : -1;
          const movement = compiled.movements[detail!.route?.movements[step] ?? -1];
          return {
            ...detail,
            visit: roadVisits.get(detail!.id),
            route: detail!.route?.roads.map((r) => compiled.roads[r]!.id),
            segment: lane?.id ?? compiled.movements[-segment - 1]!.id,
            planned: movement?.id,
            node: movement && compiled.nodes[movement.node]!.id,
            lastDecision: decisions.get(detail!.id),
            targets: detail!.route?.targetLanes[step]?.map((l) => compiled.lanes[l]!.id),
          };
        }),
      };
      history.push(row);
      if (tick % 18000 === 0) console.info('checkpoint', engine.timeS, engine.metrics().trips);
    }
  },
});
const loopRoadDwell = Object.fromEntries(
  [...watched].map((road) => [
    road,
    [...roadVisits]
      .filter(([, visit]) => visit.road === road)
      .sort((a, b) => a[1].sinceS - b[1].sinceS)
      .slice(0, 3),
  ]),
);
writeFileSync(
  out,
  JSON.stringify(
    {
      cityName,
      morning,
      longestInnerStopS,
      longestInnerStopVehicle,
      endInnerOverBox,
      endInnerStanding,
      loopRoadDwell,
      cycles,
      journeys,
      headQueries,
      headExecuted,
      originDecisions: [...originDecisions],
      chainRefusals: [...chainRefusals.values()],
      refusals,
      history,
    },
    null,
    2,
  ),
);
console.info(
  JSON.stringify({
    cityName,
    seed,
    completed: morning.completed,
    gridlocked: morning.failedByReason.gridlocked,
    stalledHeads: morning.stalledHeads,
    loop: morning.loopCensus,
    longestInnerStopS,
    longestInnerStopVehicle,
    report: out,
  }),
);
