import { headingAtDistance, pointAtDistance } from '../geo/polyline';
import { createRandom } from '../geo/random';
import { walkGreenS, walkWindows, type CLane, type CMovement, type CompiledCity } from '../network';
import { createWalkRouter, type WalkLeg, type WalkRoute } from '../routing/walk';
import type { PlaceId, Scenario, SimParams } from '../schema';
import { createVehicleProfiles, type Vehicles } from './vehicle';

/**
 * Test and person pedestrians and the rules between them and vehicles (architecture section 8).
 * Walkers follow walk routes (TASK-110) at a fixed speed and never collide with each other. A
 * crossing run is a maximal sequence of crossing legs; a walker waits at its kerb until it may
 * step out: every approaching vehicle on the crossed lanes can stop comfortably before the
 * stripes or has passed them, and at a signal the run has walk green for long enough. Waiting
 * (eligible) and crossing walkers hold the lanes they have not passed by `crossingClearM`: their
 * stripes' near edge is a standing obstacle for every vehicle that can still stop before it.
 */

export const WALKER_STATES = [
  'pending',
  'walking',
  'waiting',
  'crossing',
  'done',
  'dropped',
] as const;
export type WalkerState = (typeof WALKER_STATES)[number];
const [PENDING, WALKING, WAITING, CROSSING, DONE, DROPPED] = [0, 1, 2, 3, 4, 5] as const;
const ZEBRA = 0;
const SIGNAL = 1;
/** Beyond this distance any vehicle on a city street can stop for a crossing. */
const RANGE_M = 100;
/** How far ahead of a crossing a walker on it already counts as inside a lane's band. */
const ENTER_M = 0.5;

export interface WalkerSnapshot {
  count: number;
  id: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  heading: Float32Array;
  state: Uint8Array; // WALKER_STATES index: 1 walking, 2 waiting, 3 crossing
  layer: Int8Array; // grade of the walk link
  tripLeg: Uint8Array; // 0 test, 1 access, 2 egress, 3 whole walk
}

export type WalkerTripLeg = 'test' | 'access' | 'egress' | 'walk';

export interface WalkerSpawn {
  route: WalkRoute;
  timeS: number;
  fromPlaceId: PlaceId;
  toPlaceId: PlaceId;
  personId: string;
  tripId: string;
  tripLeg: Exclude<WalkerTripLeg, 'test'>;
}

export interface WalkerDetail {
  id: number;
  fromPlace: PlaceId;
  toPlace: PlaceId;
  personId: string | null;
  tripId: string | null;
  tripLeg: WalkerTripLeg;
  state: WalkerState;
  spawnedS: number;
  arrivedS: number | null;
  /** Total time waiting at kerbs, and the current wait. */
  waitingS: number;
  currentWaitS: number;
  crossings: number;
  /** The kind of crossing it waits at or is on. */
  crossing: 'zebra' | 'signal' | null;
  route: { links: number[]; lengthM: number } | null;
  link: number;
  positionM: number;
}

export interface WalkerMetrics {
  spawned: number;
  completed: number;
  dropped: number;
  active: number;
  peakActive: number;
  meanWalkTimeS: number;
  /** Mean wait at the kerb per crossing taken, by crossing kind. */
  meanWaitS: { zebra: number; signal: number };
  crossings: { zebra: number; signal: number };
  /** Vehicles that came to a stop for a walker, and the time they lost against their desired
   * speed while yielding (zebras; turning and other yields at signals). */
  vehicleStops: { zebra: number; signal: number };
  vehicleDelayS: { zebra: number; signal: number };
  /** Vehicles held by a walker already in their lane's band that could not stop comfortably. */
  hardStops: number;
}

interface RunSpan {
  lane: number;
  lo: number; // along the lane
  hi: number;
  at: number; // along the run
  half: number;
}

type Profiles = ReturnType<typeof createVehicleProfiles>;
type Numbers = Uint8Array | Uint16Array | Int32Array | Float64Array;
const TRIP_LEGS: WalkerTripLeg[] = ['test', 'access', 'egress', 'walk'];

function grow<T extends Numbers>(values: T, capacity: number, fill = 0): T {
  const next = new (values.constructor as { new (length: number): T })(capacity);
  if (fill !== 0) next.fill(fill); // NaN is falsy: arrivedS grows with NaN (lead)
  next.set(values);
  return next;
}

const legLength = (leg: WalkLeg) => Math.abs(leg.toM - leg.fromM);
const kindOf = (city: CompiledCity, legs: WalkLeg[], start: number, end: number) =>
  legs.slice(start, end).some((leg) => city.walk.links[leg.link]!.crossing!.control === 'signal')
    ? SIGNAL
    : ZEBRA;

export function createWalkers(
  initial: CompiledCity,
  scenario: Scenario,
  params: SimParams,
  vehicles: Vehicles,
  enabled = false,
) {
  const sources = scenario.walkers ?? [];
  if (!sources.length && !enabled) return null;
  let city = initial;
  const { dtS } = params;
  const profiles: Profiles = createVehicleProfiles(params);
  const lengthOf = (id: number) => profiles[vehicles.vclass[id]!]!.lengthM;
  const brakeOf = (id: number) => profiles[vehicles.vclass[id]!]!.idm.bMps2;
  const minGapM = params.idm.minGapM;

  // Spawn times: a Poisson stream per source over the scenario, from the scenario seed.
  const spawns: { timeS: number; source: number }[] = [];
  const root = createRandom(scenario.seed).derive('walkers');
  sources.forEach(({ perHour }, source) => {
    if (perHour <= 0) return;
    const random = root.derive(source);
    for (let t = scenario.startS; ;) {
      t += (-Math.log(1 - random.next()) * 3600) / perHour;
      if (t >= scenario.endS) break;
      spawns.push({ timeS: t, source });
    }
  });
  spawns.sort((a, b) => a.timeS - b.timeS || a.source - b.source);
  // Every test-source id is reserved up front; person ids follow them, without reuse.
  const testCount = spawns.length;
  let count = testCount;
  let capacity = testCount;
  const source = Int32Array.from(spawns, (s) => s.source);
  let spawnS = Float64Array.from(spawns, (s) => s.timeS);
  let state = new Uint8Array(capacity);
  const route: (WalkRoute | null)[] = Array(capacity).fill(null);
  let leg = new Int32Array(capacity);
  let along = new Float64Array(capacity);
  let runEnd = new Int32Array(capacity).fill(-1);
  let runPos = new Float64Array(capacity);
  let runLength = new Float64Array(capacity);
  let runKind = new Uint8Array(capacity);
  const runSpans: (RunSpan[] | null)[] = Array(capacity).fill(null);
  let waitS = new Float64Array(capacity);
  let currentWaitS = new Float64Array(capacity);
  let arrivedS = new Float64Array(capacity).fill(NaN);
  let crossings = new Uint16Array(capacity);
  let green = new Uint8Array(capacity);
  let tripLeg = new Uint8Array(capacity);
  const owners: ({
    fromPlaceId: PlaceId;
    toPlaceId: PlaceId;
    personId: string;
    tripId: string;
    target: { linkId: string; positionM: number } | null;
    onArrival: ((timeS: number, dropped: boolean) => void) | null;
  } | null)[] = Array(capacity).fill(null);
  function reserve() {
    if (count < capacity) return;
    capacity = Math.max(16, capacity * 2);
    spawnS = grow(spawnS, capacity);
    state = grow(state, capacity);
    leg = grow(leg, capacity);
    along = grow(along, capacity);
    runEnd = grow(runEnd, capacity, -1);
    runPos = grow(runPos, capacity);
    runLength = grow(runLength, capacity);
    runKind = grow(runKind, capacity);
    waitS = grow(waitS, capacity);
    currentWaitS = grow(currentWaitS, capacity);
    arrivedS = grow(arrivedS, capacity, NaN);
    crossings = grow(crossings, capacity);
    green = grow(green, capacity);
    tripLeg = grow(tripLeg, capacity);
  }
  let next = 0;
  let lastTimeS = scenario.startS;
  let activeCount = 0;
  let peakActive = 0;
  let active: number[] = [];
  const totals = {
    spawned: 0,
    completed: 0,
    dropped: 0,
    walkTimeS: 0,
    waits: [0, 0],
    crossings: [0, 0],
    stops: [0, 0],
    delayS: [0, 0],
    hardStops: 0,
  };
  // Per vehicle, during one yield: whether it has stopped, and whether it was held hard.
  const stoppedFor = new Uint8Array(vehicles.count);
  const hardFor = new Uint8Array(vehicles.count);

  let router = createWalkRouter(city.walk);
  const routeBetween = (from: PlaceId, to: PlaceId) => {
    const result = router.route({
      from: { placeId: from },
      to: { placeId: to },
      speedMps: params.walkSpeedMps,
      stepsFactor: params.walkStepsFactor,
    });
    return result.ok && result.route.legs.length ? result.route : null;
  };
  let sourceRoutes = sources.map(({ fromPlaceId, toPlaceId }) =>
    routeBetween(fromPlaceId, toPlaceId),
  );

  function activate(id: number) {
    active.push(id);
    activeCount++;
    peakActive = Math.max(peakActive, activeCount);
  }

  // Lanes held this step: flat [lo, hi, inside, kind] per lane.
  let blocks: (number[] | undefined)[] = [];
  let touched: number[] = [];
  let blocking = false;

  const link = (index: number) => city.walk.links[index]!;
  const speedOn = (index: number) =>
    params.walkSpeedMps * (link(index).kind === 'steps' ? params.walkStepsFactor : 1);
  const isCrossing = (legs: WalkLeg[], i: number) =>
    i < legs.length && !!link(legs[i]!.link).crossing;

  /** Remaining walk green of a link at `timeS`: 0 when red, Infinity off a signal. */
  let windows = new Map<number, [number, number][]>();
  function walkGreen(index: number, timeS: number) {
    const crossing = link(index).crossing!;
    if (crossing.control !== 'signal') return Infinity;
    const signal = city.nodes[crossing.node]?.signal;
    if (!signal) return 0;
    let spans = windows.get(index);
    if (!spans) windows.set(index, (spans = walkWindows(signal, index)));
    return walkGreenS(signal, index, timeS, spans);
  }

  function beginRun(id: number) {
    const legs = route[id]!.legs;
    const start = leg[id]!;
    let end = start;
    // One run per crossing: pieces of one arm's crossing (or one road's midblock zebra) go
    // together; a walker waits again where the next crossing begins, as on a refuge island.
    const key = (i: number) => {
      const { control, node, arm, road } = link(legs[i]!.link).crossing!;
      return node >= 0 ? `${control}:${node}:${arm}` : `${control}:road:${road}`;
    };
    const first = key(start);
    while (isCrossing(legs, end) && key(end) === first) end++;
    const spans: RunSpan[] = [];
    let offset = 0;
    for (let i = start; i < end; i++) {
      const { link: index, fromM, toM } = legs[i]!;
      const lo = Math.min(fromM, toM),
        hi = Math.max(fromM, toM);
      for (const span of link(index).crossing!.spans) {
        if (span.linkM < lo - 1e-9 || span.linkM > hi + 1e-9) continue;
        spans.push({
          lane: span.lane,
          lo: span.atM - span.halfM,
          hi: span.atM + span.halfM,
          at: offset + Math.abs(span.linkM - fromM),
          half: span.linkHalfM,
        });
      }
      offset += legLength(legs[i]!);
    }
    runEnd[id] = end;
    runPos[id] = 0;
    runLength[id] = offset;
    runKind[id] = kindOf(city, legs, start, end);
    runSpans[id] = spans;
    state[id] = WAITING;
    currentWaitS[id] = 0;
  }

  /**
   * Whether the vehicles that reach `lane` up to the span [lo, hi] let a walker go: none
   * overlaps it, and every one approaching stops before it. Strict (stepping out): it is
   * standing, or its braking distance at bMps2 plus minGapM fits; relaxed (entering the next
   * lane from the crossing): its braking distance alone fits. Upstream lanes count only vehicles
   * that plan the movement toward the span.
   */
  function clear(lane: number, lo: number, hi: number, strict: boolean) {
    const scan = (index: number, offset: number, via: number, depth: number): boolean => {
      for (let id = vehicles.first(index); id !== -1; id = vehicles.next[id]!) {
        if (via !== -1 && vehicles.movement[id] !== via) continue;
        const front = offset + vehicles.position[id]!;
        if (front - lengthOf(id) >= hi) continue;
        if (front > lo) return false;
        const d = lo - front;
        if (d > RANGE_M) break;
        const v = vehicles.speed[id]!;
        const braking = (v * v) / (2 * brakeOf(id));
        if (strict ? !(v < 0.1 || braking + minGapM <= d) : braking > d) return false;
      }
      if (depth === 2) return true;
      const target = city.lanes[index]!;
      // A vehicle that turned off this lane can still have its rear over a span at its end.
      if (depth === 0)
        for (const m of target.out)
          for (let id = vehicles.last(-m - 1); id !== -1; id = vehicles.previous[id]!) {
            if (target.lengthM + vehicles.position[id]! - lengthOf(id) >= hi) break;
            return false;
          }
      for (const m of target.in) {
        const movement = city.movements[m]!;
        const start = offset - movement.lengthM;
        if (lo - start > RANGE_M) continue;
        if (!scan(-m - 1, start, -1, 2)) return false;
        const from = city.lanes[movement.fromLane]!;
        if (!scan(from.idx, start - from.lengthM, m, depth + 1)) return false;
      }
      return true;
    };
    return scan(lane, 0, -1, 0);
  }

  /** At a signal, the run's walk green covers the crossing at walking speed plus the clearance. */
  function greenEnough(id: number, timeS: number) {
    if (runKind[id] !== SIGNAL) return true;
    const legs = route[id]!.legs;
    let green = Infinity;
    for (let i = leg[id]!; i < runEnd[id]!; i++)
      if (link(legs[i]!.link).crossing!.control === 'signal')
        green = Math.min(green, walkGreen(legs[i]!.link, timeS));
    return green >= runLength[id]! / params.walkSpeedMps + params.walkClearanceS;
  }

  // Whether each waiting walker has enough walk green this step (set in `step`).
  const canStepOut = (id: number) =>
    green[id] === 1 && runSpans[id]!.every((span) => clear(span.lane, span.lo, span.hi, true));

  function finish(id: number, timeS: number) {
    if (state[id] !== PENDING) activeCount--;
    state[id] = DONE;
    arrivedS[id] = timeS;
    totals.completed++;
    totals.walkTimeS += timeS - spawnS[id]!;
    notify(id, timeS, false);
  }

  function notify(id: number, timeS: number, dropped: boolean) {
    const owner = owners[id];
    const callback = owner?.onArrival;
    if (!callback) return;
    owner.onArrival = null;
    callback(timeS, dropped);
  }

  function drop(id: number, timeS: number) {
    state[id] = DROPPED;
    activeCount--;
    totals.dropped++;
    notify(id, timeS, true);
  }

  /** Walk on from the current leg position by `distance`, stopping at a crossing's kerb. */
  function walk(id: number, distance: number, timeS: number) {
    const legs = route[id]!.legs;
    while (distance > 1e-12) {
      const current = legs[leg[id]!]!;
      const left = legLength(current) - along[id]!;
      const step = distance * (speedOn(current.link) / params.walkSpeedMps);
      if (step < left) {
        along[id] = along[id]! + step;
        return;
      }
      distance -= (left * params.walkSpeedMps) / speedOn(current.link);
      along[id] = legLength(current);
      if (leg[id]! + 1 >= legs.length) {
        finish(id, timeS);
        return;
      }
      leg[id] = leg[id]! + 1;
      along[id] = 0;
      if (isCrossing(legs, leg[id]!)) {
        beginRun(id);
        return;
      }
    }
  }

  function cross(id: number, timeS: number) {
    let target = runPos[id]! + params.walkSpeedMps * dtS;
    // Do not enter a lane's band while a vehicle is in its span or will not stop for it.
    for (const span of runSpans[id]!) {
      const edge = span.at - span.half - ENTER_M;
      if (edge < runPos[id]! - 1e-9 || edge >= target) continue;
      if (!clear(span.lane, span.lo, span.hi, false)) target = Math.min(target, edge);
    }
    const advance = target - runPos[id]!;
    runPos[id] = target;
    if (target < runLength[id]!) return;
    const legs = route[id]!.legs;
    const overflow = target - runLength[id]!;
    runSpans[id] = null;
    leg[id] = runEnd[id]!;
    runEnd[id] = -1;
    along[id] = 0;
    if (leg[id]! >= legs.length) {
      leg[id] = legs.length - 1;
      along[id] = legLength(legs[leg[id]!]!);
      finish(id, timeS);
      return;
    }
    if (isCrossing(legs, leg[id]!)) {
      beginRun(id);
      return;
    }
    state[id] = WALKING;
    if (advance > 0) walk(id, overflow, timeS);
  }

  function holdLanes() {
    for (const lane of touched) blocks[lane] = undefined;
    touched = [];
    for (const id of active) {
      const s = state[id];
      if (s !== WAITING && s !== CROSSING) continue;
      // A waiting walker holds lanes only when it would step out but for the traffic.
      if (s === WAITING && !green[id]) continue;
      const position = s === CROSSING ? runPos[id]! : 0;
      for (const span of runSpans[id]!) {
        if (position > span.at + span.half + params.crossingClearM) continue;
        const inside = s === CROSSING && position >= span.at - span.half - ENTER_M ? 1 : 0;
        let list = blocks[span.lane];
        if (!list) {
          blocks[span.lane] = list = [];
          touched.push(span.lane);
        }
        list.push(span.lo, span.hi, inside, runKind[id]!);
      }
    }
    blocking = touched.length > 0;
  }

  // Scratch for `hold`: the kind of the binding block.
  let heldKind = 0;
  let heldInside = 0;

  /** The nearest held span ahead of a vehicle, in its segment's metres (Infinity for none):
   * blocks on its lane, then along its plan and route up to RANGE_M. A vehicle stops for a
   * block it can still stop before at bMps2, and for one a walker is already inside. */
  function hold(id: number, lane: CLane | undefined, path: CMovement | null) {
    const position = vehicles.position[id]!;
    const v = vehicles.speed[id]!;
    held.position = position;
    held.braking = (v * v) / (2 * brakeOf(id));
    held.best = Infinity;
    const route = vehicles.route[id];
    const step = vehicles.routeStep[id]!;
    let offset: number;
    let current: number;
    if (lane) {
      check(lane.idx, 0);
      const movement = city.movements[vehicles.movement[id]!];
      if (!movement || lane.lengthM - position > RANGE_M) return held.best;
      offset = lane.lengthM + movement.lengthM;
      current = movement.toLane;
    } else {
      offset = path!.lengthM;
      current = path!.toLane;
    }
    check(current, offset);
    const after = city.movements[route?.movements[step + 1] ?? -1];
    if (after && after.fromLane === current) {
      offset += city.lanes[current]!.lengthM + after.lengthM;
      if (offset - position <= RANGE_M) check(after.toLane, offset);
    }
    return held.best;
  }

  /** The vehicle `hold` asks about, and the nearest held span found so far. */
  const held = { position: 0, braking: 0, best: Infinity };
  function check(index: number, offset: number) {
    const list = blocks[index];
    if (!list) return;
    for (let i = 0; i < list.length; i += 4) {
      const at = offset + list[i]!;
      const d = at - held.position;
      if (d < 0 || at >= held.best) continue;
      if (held.braking > d && !list[i + 2]) continue;
      held.best = at;
      heldKind = list[i + 3]!;
      heldInside = list[i + 2]!;
    }
  }

  return {
    /** Returns the public id (1-based); an empty route arrives immediately. */
    spawn(input: WalkerSpawn, onArrival: (timeS: number, dropped: boolean) => void) {
      reserve();
      const id = count++;
      const last = input.route.legs.at(-1);
      owners[id] = {
        fromPlaceId: input.fromPlaceId,
        toPlaceId: input.toPlaceId,
        personId: input.personId,
        tripId: input.tripId,
        target: last ? { linkId: link(last.link).id, positionM: last.toM } : null,
        onArrival,
      };
      tripLeg[id] = TRIP_LEGS.indexOf(input.tripLeg);
      route[id] = input.route;
      spawnS[id] = input.timeS;
      totals.spawned++;
      if (!last) finish(id, input.timeS);
      else {
        state[id] = WALKING;
        activate(id);
        if (isCrossing(input.route.legs, 0)) beginRun(id);
      }
      return id + 1;
    },
    /** Spawn and advance walkers, then mark the lanes they hold this step. */
    step(timeS: number) {
      lastTimeS = timeS;
      while (next < testCount && spawnS[next]! <= timeS + 1e-9) {
        const id = next++;
        totals.spawned++;
        const path = sourceRoutes[source[id]!]!;
        if (!path) {
          state[id] = DROPPED;
          totals.dropped++;
          continue;
        }
        route[id] = path;
        leg[id] = 0;
        along[id] = 0;
        state[id] = WALKING;
        activate(id);
        if (isCrossing(path.legs, 0)) beginRun(id);
      }
      const advancing = active.length;
      for (let i = 0; i < advancing; i++) {
        const id = active[i]!;
        if (state[id] === WALKING) walk(id, params.walkSpeedMps * dtS, timeS);
        else if (state[id] === WAITING) {
          green[id] = Number(greenEnough(id, timeS));
          if (canStepOut(id)) {
            state[id] = CROSSING;
            crossings[id]!++;
            totals.crossings[runKind[id]!]!++;
            totals.waits[runKind[id]!]! += currentWaitS[id]!;
            cross(id, timeS);
          } else {
            waitS[id] = waitS[id]! + dtS;
            currentWaitS[id] = currentWaitS[id]! + dtS;
          }
        } else if (state[id] === CROSSING) cross(id, timeS);
      }
      if (active.some((id) => state[id] === DONE))
        active = active.filter((id) => state[id] !== DONE);
      holdLanes();
    },
    get blocking() {
      return blocking;
    },
    hold(id: number, lane: CLane | undefined, path: CMovement | null) {
      return blocking ? hold(id, lane, path) : Infinity;
    },
    /** A vehicle's yield this step: binding when its walker stop was its nearest obstacle. */
    account(id: number, binding: boolean, speed: number, desiredSpeed: number, gapM: number) {
      if (!binding) {
        stoppedFor[id] = hardFor[id] = 0;
        return;
      }
      const kind = heldKind;
      totals.delayS[kind]! += dtS * Math.max(0, 1 - speed / desiredSpeed);
      if (speed < 0.1 && !stoppedFor[id]) {
        stoppedFor[id] = 1;
        totals.stops[kind]!++;
      }
      if (heldInside && !hardFor[id] && (speed * speed) / (2 * brakeOf(id)) > gapM) {
        hardFor[id] = 1;
        totals.hardStops++;
      }
    },
    snapshot(): WalkerSnapshot {
      const visible = active.filter((id) => state[id] !== DONE);
      const n = visible.length;
      const snapshot: WalkerSnapshot = {
        count: n,
        id: new Uint32Array(n),
        x: new Float32Array(n),
        y: new Float32Array(n),
        heading: new Float32Array(n),
        state: new Uint8Array(n),
        layer: new Int8Array(n),
        tripLeg: new Uint8Array(n),
      };
      visible.forEach((id, i) => {
        const { link: index, s, forward } = where(id);
        const line = link(index);
        const point = pointAtDistance(line.line, line.cumulative, s);
        let heading = headingAtDistance(line.line, line.cumulative, s);
        if (!forward) heading += Math.PI;
        // Keep right of the walking direction so walkers meeting on a path pass each other.
        snapshot.x[i] = point.x - Math.sin(heading) * 0.35;
        snapshot.y[i] = point.y + Math.cos(heading) * 0.35;
        snapshot.heading[i] = heading;
        snapshot.id[i] = id + 1;
        snapshot.state[i] = state[id]!;
        snapshot.layer[i] = line.layer;
        snapshot.tripLeg[i] = tripLeg[id]!;
      });
      return snapshot;
    },
    metrics(): WalkerMetrics {
      const mean = (sum: number, n: number) => (n ? sum / n : 0);
      return {
        spawned: totals.spawned,
        completed: totals.completed,
        dropped: totals.dropped,
        active: activeCount,
        peakActive,
        meanWalkTimeS: mean(totals.walkTimeS, totals.completed),
        meanWaitS: {
          zebra: mean(totals.waits[ZEBRA]!, totals.crossings[ZEBRA]!),
          signal: mean(totals.waits[SIGNAL]!, totals.crossings[SIGNAL]!),
        },
        crossings: { zebra: totals.crossings[ZEBRA]!, signal: totals.crossings[SIGNAL]! },
        vehicleStops: { zebra: totals.stops[ZEBRA]!, signal: totals.stops[SIGNAL]! },
        vehicleDelayS: { zebra: totals.delayS[ZEBRA]!, signal: totals.delayS[SIGNAL]! },
        hardStops: totals.hardStops,
      };
    },
    inspect(walkerId: number): WalkerDetail | null {
      const id = walkerId - 1;
      if (id < 0 || id >= count || state[id] === PENDING) return null;
      const path = route[id];
      const position = path?.legs.length && state[id] !== DROPPED ? where(id) : null;
      const owner = owners[id];
      return {
        id: walkerId,
        fromPlace: owner?.fromPlaceId ?? sources[source[id]!]!.fromPlaceId,
        toPlace: owner?.toPlaceId ?? sources[source[id]!]!.toPlaceId,
        personId: owner?.personId ?? null,
        tripId: owner?.tripId ?? null,
        tripLeg: TRIP_LEGS[tripLeg[id]!]!,
        state: WALKER_STATES[state[id]!]!,
        spawnedS: spawnS[id]!,
        arrivedS: Number.isNaN(arrivedS[id]) ? null : arrivedS[id]!,
        waitingS: waitS[id]!,
        currentWaitS: state[id] === WAITING ? currentWaitS[id]! : 0,
        crossings: crossings[id]!,
        crossing:
          state[id] === WAITING || state[id] === CROSSING
            ? runKind[id] === SIGNAL
              ? 'signal'
              : 'zebra'
            : null,
        route: path ? { links: path.links.slice(), lengthM: path.lengthM } : null,
        link: position?.link ?? -1,
        positionM: position?.s ?? 0,
      };
    },
    /** Walker state for the state hash, once any walker has spawned. */
    hash(word: (hash: number, value: number) => number, hash: number) {
      const append = (id: number) => {
        hash = word(hash, id + 1);
        hash = word(hash, state[id]!);
        hash = word(hash, leg[id]!);
        hash = word(hash, Math.round((state[id] === CROSSING ? runPos[id]! : along[id]!) * 100));
        if (owners[id]) hash = word(hash, tripLeg[id]!);
      };
      for (let id = 0; id < next; id++) append(id);
      for (let id = testCount; id < count; id++) append(id);
      return hash;
    },
    get spawned() {
      return totals.spawned;
    },
    /** TASK-051 live edits: links keep walkers by id; a walker whose remaining route lost a link
     * reroutes from where it stands, and is dropped if its own link is gone or no route remains. */
    patch(signalled: CompiledCity, timeS = lastTimeS) {
      const before = city;
      city = signalled;
      router = createWalkRouter(city.walk);
      windows = new Map();
      sourceRoutes = sources.map(({ fromPlaceId, toPlaceId }) =>
        routeBetween(fromPlaceId, toPlaceId),
      );
      blocks = [];
      touched = [];
      blocking = false;
      const index = city.walk.links.map((l) => l.id);
      const byId = new Map(index.map((id, i) => [id, i]));
      for (const id of active.slice()) {
        const path = route[id]!;
        const remap = (l: number) => byId.get(before.walk.links[l]!.id) ?? -1;
        const legs = path.legs.map((l) => ({ ...l, link: remap(l.link) }));
        const first = leg[id]!;
        const here = where(id, before);
        const own = remap(here.link);
        if (own === -1) {
          drop(id, timeS);
          continue;
        }
        const s = Math.min(here.s, city.walk.links[own]!.lengthM);
        const broken =
          legs.slice(first).some((l) => l.link === -1) ||
          legs
            .slice(first)
            .some((l) => Math.max(l.fromM, l.toM) > city.walk.links[l.link]!.lengthM + 1e-6);
        const crossingAgain = state[id] === WAITING || state[id] === CROSSING;
        if (!broken) {
          route[id] = { ...path, legs, links: legs.map((l) => l.link) };
        } else {
          const target = owners[id]?.target;
          const targetLink = target ? byId.get(target.linkId) : undefined;
          if (target && targetLink === undefined) {
            drop(id, timeS);
            continue;
          }
          const result = router.route({
            from: { link: own, positionM: s },
            to: target
              ? { link: targetLink!, positionM: target.positionM }
              : { placeId: sources[source[id]!]!.toPlaceId },
            speedMps: params.walkSpeedMps,
            stepsFactor: params.walkStepsFactor,
          });
          if (!result.ok || !result.route.legs.length) {
            if (result.ok && owners[id]) {
              route[id] = result.route;
              leg[id] = 0;
              along[id] = 0;
              finish(id, timeS);
            } else drop(id, timeS);
            continue;
          }
          route[id] = result.route;
          leg[id] = 0;
          along[id] = 0;
          state[id] = WALKING;
          runSpans[id] = null;
          runEnd[id] = -1;
          if (isCrossing(result.route.legs, 0)) beginRun(id);
          continue;
        }
        if (crossingAgain) {
          const position = runPos[id]!;
          const wasCrossing = state[id] === CROSSING;
          const waited = currentWaitS[id]!;
          beginRun(id);
          currentWaitS[id] = waited;
          if (wasCrossing) {
            state[id] = CROSSING;
            runPos[id] = Math.min(position, runLength[id]!);
          }
        }
      }
      active = active.filter((id) => state[id] !== DROPPED && state[id] !== DONE);
      stoppedFor.fill(0);
      hardFor.fill(0);
    },
  };

  /** The link and position on it of an active walker. */
  function where(id: number, on = city) {
    const legs = route[id]!.legs;
    let i = leg[id]!;
    let rest = state[id] === CROSSING ? runPos[id]! : along[id]!;
    const end = state[id] === CROSSING ? runEnd[id]! : i + 1;
    while (i < end - 1 && rest > legLength(legs[i]!)) {
      rest -= legLength(legs[i]!);
      i++;
    }
    const current = legs[i]!;
    const forward = current.toM >= current.fromM;
    const length = on.walk.links[current.link]!.lengthM;
    const s = Math.max(0, Math.min(length, current.fromM + (forward ? rest : -rest)));
    return { link: current.link, s, forward };
  }
}

export type Walkers = NonNullable<ReturnType<typeof createWalkers>>;
