import { writeFileSync } from 'node:fs';
import { loadAuditCity } from './junction-audit';
import { probeMorning } from './import-probe';
import { compile } from '../src/network';
import type { IntersectionObserver } from '../src/sim/intersection';

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
const decisions = new Map<number, Parameters<IntersectionObserver>[2]>();
const refusals: Record<string, number> = {};
const history: unknown[] = [];
const standing = new Map<number, { segment: number; sinceS: number }>();
const roadVisits = new Map<number, { road: string; sinceS: number; waitingOnEntryS: number }>();
const chainRefusals = new Map<string, unknown>();
let endInnerOverBox = 0;
let endInnerStanding = 0;
let longestInnerStopS = 0;
let longestInnerStopVehicle = 0;
let tick = 0;
const morning = probeMorning(city, compiled, 0.15, {
  untilS,
  demandSeed: seed,
  intersectionObserver(id, movement, reason) {
    decisions.set(id + 1, reason);
    const key = `${compiled.lanes[movement.fromLane]!.id}:${reason}`;
    refusals[key] = (refusals[key] ?? 0) + 1;
  },
  observe(engine) {
    if (++tick % 10) return;
    const snapshot = engine.snapshot();
    const heads = new Map<number, ReturnType<typeof engine.inspect>>();
    let innerStanding = 0;
    let innerOverBox = 0;
    for (const [i, id] of snapshot.id.entries()) {
      const segment = snapshot.lane[i]!;
      if (segment === -2147483648) continue;
      const movement = segment < 0 ? compiled.movements[-segment - 1]! : null;
      const lane = compiled.lanes[movement?.fromLane ?? segment]!;
      const road = compiled.roads[lane.road]!;
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
      } else standing.delete(id);
      if (tick % 600) continue;
      if (decisions.get(id) === 'box') {
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
    if (tick % 600 === 0) {
      endInnerOverBox = innerOverBox;
      endInnerStanding = innerStanding;
      const row = {
        timeS: engine.timeS,
        innerStanding,
        innerOverBox,
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
