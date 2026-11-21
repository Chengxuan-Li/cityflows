import { headingAtDistance, pointAtDistance } from '../geo/polyline';
import { createRandom } from '../geo/random';
import {
  walkGreenS,
  walkWindows,
  type CLane,
  type CMovement,
  type CompiledCity,
  type CrossingControl,
} from '../network';
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
 * TASK-279: at an unmarked crossing (StVO §25(3)) a walker has priority only over drivers turning
 * into the arm (§9(3)): it steps out in a gap of the other traffic and, while waiting, holds only
 * the turning drivers.
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
const UNMARKED = 2;
const KINDS: CrossingControl[] = ['zebra', 'signal', 'unmarked'];
/** `clear`'s vehicles: every one; (TASK-279) all but those turning into the arm, which must
 * leave the walker a gap; only those turning into the arm. */
const ALL = 0;
const GAP = 1;
const TURNING = 2;
/** Beyond this distance any vehicle on a city street can stop for a crossing. */
const RANGE_M = 100;
/** How far ahead of a crossing a walker on it already counts as inside a lane's band. */
const ENTER_M = 0.5;
/** TASK-245: rounding allowed when walk green is compared with the green a run needs. */
const GREEN_EPS_S = 1e-6;

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
  crossing: CrossingControl | null;
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
  meanWaitS: Record<CrossingControl, number>;
  crossings: Record<CrossingControl, number>;
  /** Vehicles that came to a stop for a walker, and the time they lost against their desired
   * speed while yielding (zebras; turning and other yields at signals; turning drivers and walkers
   * already on the road at unmarked crossings). */
  vehicleStops: Record<CrossingControl, number>;
  vehicleDelayS: Record<CrossingControl, number>;
  /** Vehicles held by a walker already in their lane's band that could not stop comfortably. */
  hardStops: number;
}

interface RunSpan {
  lane: number;
  lo: number; // along the lane
  hi: number;
  at: number; // along the run
  half: number;
  /** TASK-279: the crossing's node (-1 midblock), and the time a walker stepping out needs
   * before a vehicle that does not yield to it may reach the span. */
  node: number;
  needS: number;
}

type Profiles = ReturnType<typeof createVehicleProfiles>;
type Numbers = Uint8Array | Uint16Array | Int32Array | Float64Array;
const TRIP_LEGS: WalkerTripLeg[] = ['test', 'access', 'egress', 'walk'];
const byKind = (value: (kind: number) => number) =>
  Object.fromEntries(KINDS.map((k, i) => [k, value(i)])) as Record<CrossingControl, number>;

function grow<T extends Numbers>(values: T, capacity: number, fill = 0): T {
  const next = new (values.constructor as { new (length: number): T })(capacity);
  if (fill !== 0) next.fill(fill); // NaN is falsy: arrivedS grows with NaN (lead)
  next.set(values);
  return next;
}

const legLength = (leg: WalkLeg) => Math.abs(leg.toM - leg.fromM);
const kindOf = (city: CompiledCity, legs: WalkLeg[], start: number, end: number) => {
  const controls = legs
    .slice(start, end)
    .map((leg) => city.walk.links[leg.link]!.crossing!.control);
  return controls.includes('signal')
    ? SIGNAL
    : controls.every((c) => c === 'unmarked')
      ? UNMARKED
      : ZEBRA;
};
/** TASK-279: a driver turning into the arm at the crossing's node, who yields to walkers (§9(3)). */
const turnsInto = (movement: CMovement, node: number) =>
  movement.node === node &&
  (movement.turn === 'left' || movement.turn === 'right' || movement.turn === 'uturn');

export function createWalkers(
  initial: CompiledCity,
  scenario: Scenario,
  params: SimParams,
  vehicles: Vehicles,
  enabled = false,
  /** TASK-170: remaining walk green from the run's signal control (timed and actuated signals);
   * without it, from the compiled programs. */
  signalWalkGreen?: (link: number, timeS: number) => number,
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
  let yields = new Uint8Array(capacity);
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
    yields = grow(yields, capacity);
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
    waits: [0, 0, 0],
    crossings: [0, 0, 0],
    stops: [0, 0, 0],
    delayS: [0, 0, 0],
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

  // Lanes held this step: flat [lo, hi, inside, kind, node] per lane; `node` >= 0 (TASK-279): held
  // only for drivers turning into the arm there (a walker waiting at an unmarked crossing).
  // TASK-211: allocated whole (a sparse `[]` written at large lane indices becomes a dictionary).
  let blocks = Array<number[] | undefined>(city.lanes.length).fill(undefined);
  let touched: number[] = [];
  let blocking = false;
  /** TASK-187: the lanes held this step and the lanes with a movement onto one. `hold` looks at a
   * vehicle's lane, the lane its movement enters and the lane its route takes from there, so it
   * finds nothing for a vehicle whose lane is not held and whose movement enters no such lane. */
  let nearHeld = new Uint8Array(city.lanes.length);
  let nearHeldLanes: number[] = [];

  const link = (index: number) => city.walk.links[index]!;
  const speedOn = (index: number) =>
    params.walkSpeedMps * (link(index).kind === 'steps' ? params.walkStepsFactor : 1);
  const isCrossing = (legs: WalkLeg[], i: number) =>
    i < legs.length && !!link(legs[i]!.link).crossing;

  /** TASK-245: the signal crossing links some phase of their node's program gives walk green.
   * A walker at one no phase serves waited for ever (Freiburg: about 200 walkers a morning at 9
   * mapped crossings); it crosses there as without a signal, in a gap it needs no one to stop for
   * (`yields`). */
  const servedLinks = (on: CompiledCity) => {
    const served = new Uint8Array(on.walk.links.length);
    for (const node of on.nodes)
      for (const phase of node.signal?.phases ?? [])
        for (const index of phase.walk) served[index] = 1;
    return served;
  };
  let served = servedLinks(city);

  /** Remaining walk green of a link at `timeS`: 0 when red, Infinity off a signal or at a signal
   * crossing no phase serves. */
  let windows = new Map<number, [number, number][]>();
  function walkGreen(index: number, timeS: number) {
    const crossing = link(index).crossing!;
    if (crossing.control !== 'signal' || !served[index]) return Infinity;
    if (signalWalkGreen) return signalWalkGreen(index, timeS);
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
      const crossing = link(index).crossing!;
      for (const span of crossing.spans) {
        if (span.linkM < lo - 1e-9 || span.linkM > hi + 1e-9) continue;
        const at = offset + Math.abs(span.linkM - fromM);
        spans.push({
          lane: span.lane,
          lo: span.atM - span.halfM,
          hi: span.atM + span.halfM,
          at,
          half: span.linkHalfM,
          node: crossing.node,
          needS: (at + span.linkHalfM) / params.walkSpeedMps + params.walkClearanceS,
        });
      }
      offset += legLength(legs[i]!);
    }
    runEnd[id] = end;
    runPos[id] = 0;
    runLength[id] = offset;
    runKind[id] = kindOf(city, legs, start, end);
    yields[id] = Number(
      legs
        .slice(start, end)
        .some((l) => link(l.link).crossing!.control === 'signal' && !served[l.link]),
    );
    runSpans[id] = spans;
    state[id] = WAITING;
    currentWaitS[id] = 0;
  }

  /** TASK-279: whether a vehicle on `lane` entered it turning into the arm at `node` (the
   * movement before its route step; unknown after a reroute, then not). */
  function turnedInto(id: number, lane: number, node: number) {
    const step = vehicles.routeStep[id]!;
    const m = step > 0 ? vehicles.route[id]?.movements[step - 1] : undefined;
    if (m === undefined) return false;
    const movement = city.movements[m]!;
    return (
      city.lanes[movement.toLane]!.road === city.lanes[lane]!.road && turnsInto(movement, node)
    );
  }

  /**
   * Whether the vehicles that reach `lane` up to the span [lo, hi] let a walker go: none
   * overlaps it, and every one approaching stops before it. Strict (stepping out): it is
   * standing, or its braking distance at bMps2 plus minGapM fits; relaxed (entering the next
   * lane from the crossing): its braking distance alone fits. Upstream lanes count only vehicles
   * that plan the movement toward the span. TASK-279 at an unmarked crossing, by `mode`: `GAP`
   * reads only the vehicles not turning into the arm at `node`, each standing or reaching the
   * span no sooner than `needS` at its speed; `TURNING` only those turning in, strictly.
   */
  function clear(
    lane: number,
    lo: number,
    hi: number,
    strict: boolean,
    mode = ALL,
    node = -1,
    needS = 0,
  ) {
    const scan = (
      index: number,
      offset: number,
      via: number,
      depth: number,
      turning: boolean,
    ): boolean => {
      for (let id = vehicles.first(index); id !== -1; id = vehicles.next[id]!) {
        if (via !== -1 && vehicles.movement[id] !== via) continue;
        const front = offset + vehicles.position[id]!;
        if (front - lengthOf(id) >= hi) continue;
        const d = lo - front;
        if (d > RANGE_M) break;
        if (
          mode !== ALL &&
          (depth === 0 ? turnedInto(id, index, node) : turning) !== (mode === TURNING)
        )
          continue;
        if (front > lo) return false;
        const v = vehicles.speed[id]!;
        if (mode === GAP) {
          if (v >= 0.1 && d < v * needS) return false;
          continue;
        }
        const braking = (v * v) / (2 * brakeOf(id));
        if (strict ? !(v < 0.1 || braking + minGapM <= d) : braking > d) return false;
      }
      if (depth === 2) return true;
      const target = city.lanes[index]!;
      // A vehicle that turned off this lane can still have its rear over a span at its end.
      if (depth === 0 && mode !== TURNING)
        for (const m of target.out)
          for (let id = vehicles.last(-m - 1); id !== -1; id = vehicles.previous[id]!) {
            if (target.lengthM + vehicles.position[id]! - lengthOf(id) >= hi) break;
            return false;
          }
      for (const m of target.in) {
        const movement = city.movements[m]!;
        const start = offset - movement.lengthM;
        if (lo - start > RANGE_M) continue;
        const turns = depth === 0 ? turnsInto(movement, node) : turning;
        if (!scan(-m - 1, start, -1, 2, turns)) return false;
        const from = city.lanes[movement.fromLane]!;
        if (!scan(from.idx, start - from.lengthM, m, depth + 1, turns)) return false;
      }
      return true;
    };
    return scan(lane, 0, -1, 0, false);
  }

  /** At a signal, the run's walk green covers the crossing at walking speed plus the clearance.
   * TASK-170: a walker without it calls for that green at each signal leg of its run (`calls`).
   * TASK-245: within `GREEN_EPS_S`: an actuated green extended for the call ends at `timeS +
   * needS`, and `(timeS + needS) - timeS` can fall short of `needS` by a rounding error, every
   * step, so a walker at a resting green waited until some vehicle ended it (Freiburg: 424 s on
   * average). */
  let calls = new Map<number, number>();
  function greenEnough(id: number, timeS: number) {
    // TASK-279: at an unmarked crossing, the gap in the traffic that does not yield.
    if (runKind[id] === UNMARKED)
      return runSpans[id]!.every((span) =>
        clear(span.lane, span.lo, span.hi, true, GAP, span.node, span.needS),
      );
    if (runKind[id] !== SIGNAL) return true;
    const legs = route[id]!.legs;
    const needS = runLength[id]! / params.walkSpeedMps + params.walkClearanceS;
    let green = Infinity;
    for (let i = leg[id]!; i < runEnd[id]!; i++)
      if (link(legs[i]!.link).crossing!.control === 'signal')
        green = Math.min(green, walkGreen(legs[i]!.link, timeS));
    if (green >= needS - GREEN_EPS_S) return true;
    for (let i = leg[id]!; i < runEnd[id]!; i++) {
      const index = legs[i]!.link;
      if (link(index).crossing!.control === 'signal')
        calls.set(index, Math.max(calls.get(index) ?? 0, needS));
    }
    return false;
  }

  // Whether each waiting walker has enough walk green (or its gap) this step (set in `step`).
  const canStepOut = (id: number) =>
    green[id] === 1 &&
    runSpans[id]!.every((span) =>
      clear(span.lane, span.lo, span.hi, true, runKind[id] === UNMARKED ? TURNING : ALL, span.node),
    );

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
    for (const lane of nearHeldLanes) nearHeld[lane] = 0;
    touched = [];
    nearHeldLanes = [];
    for (const id of active) {
      const s = state[id];
      if (s !== WAITING && s !== CROSSING) continue;
      // A waiting walker holds lanes only when it would step out but for the traffic, and not
      // at a signal crossing no phase serves, where it waits for a gap (TASK-245); at an
      // unmarked crossing, in a gap, only for drivers turning into the arm (TASK-279).
      if (s === WAITING && (!green[id] || yields[id])) continue;
      const position = s === CROSSING ? runPos[id]! : 0;
      const turning = s === WAITING && runKind[id] === UNMARKED;
      for (const span of runSpans[id]!) {
        if (turning && span.node < 0) continue;
        if (position > span.at + span.half + params.crossingClearM) continue;
        const inside = s === CROSSING && position >= span.at - span.half - ENTER_M ? 1 : 0;
        let list = blocks[span.lane];
        if (!list) {
          blocks[span.lane] = list = [];
          touched.push(span.lane);
        }
        list.push(span.lo, span.hi, inside, runKind[id]!, turning ? span.node : -1);
      }
    }
    blocking = touched.length > 0;
    const mark = (lane: number) => {
      if (nearHeld[lane]) return;
      nearHeld[lane] = 1;
      nearHeldLanes.push(lane);
    };
    for (const lane of touched) {
      mark(lane);
      for (const m of city.lanes[lane]!.in) mark(city.movements[m]!.fromLane);
    }
  }

  // Scratch for `hold`: the kind of the binding block.
  let heldKind = 0;
  let heldInside = 0;

  /** The nearest held span ahead of a vehicle, in its segment's metres (Infinity for none):
   * blocks on its lane, then along its plan and route up to RANGE_M. A vehicle stops for a
   * block it can still stop before at bMps2, and for one a walker is already inside; for one
   * held only for turning drivers (TASK-279) if it enters that lane turning into the arm. */
  function hold(id: number, lane: CLane | undefined, path: CMovement | null) {
    const position = vehicles.position[id]!;
    const v = vehicles.speed[id]!;
    held.id = id;
    held.position = position;
    held.braking = (v * v) / (2 * brakeOf(id));
    held.best = Infinity;
    let offset: number;
    let current: number;
    let via: CMovement;
    if (lane) {
      check(lane.idx, 0, null);
      const movement =
        vehicles.movement[id] === -1 ? undefined : city.movements[vehicles.movement[id]!];
      if (!movement || lane.lengthM - position > RANGE_M) return held.best;
      offset = lane.lengthM + movement.lengthM;
      current = movement.toLane;
      via = movement;
    } else {
      offset = path!.lengthM;
      current = path!.toLane;
      via = path!;
    }
    check(current, offset, via);
    // The route is read only when the next movement can start within range (its lengthM >= 0).
    if (offset + city.lanes[current]!.lengthM - position > RANGE_M) return held.best;
    // TASK-230: no array read at -1 (a negative index takes V8's slow lookup path).
    const next = vehicles.route[id]?.movements[vehicles.routeStep[id]! + 1] ?? -1;
    const after = next < 0 ? undefined : city.movements[next];
    if (after && after.fromLane === current) {
      offset += city.lanes[current]!.lengthM + after.lengthM;
      if (offset - position <= RANGE_M) check(after.toLane, offset, after);
    }
    return held.best;
  }

  /** The vehicle `hold` asks about, and the nearest held span found so far. */
  const held = { id: 0, position: 0, braking: 0, best: Infinity };
  /** `via`: the movement by which the vehicle enters `index`; null for its own lane. */
  function check(index: number, offset: number, via: CMovement | null) {
    const list = blocks[index];
    if (!list) return;
    for (let i = 0; i < list.length; i += 5) {
      const at = offset + list[i]!;
      const d = at - held.position;
      if (d < 0 || at >= held.best) continue;
      if (held.braking > d && !list[i + 2]) continue;
      const node = list[i + 4]!;
      if (node >= 0 && !(via ? turnsInto(via, node) : turnedInto(held.id, index, node))) continue;
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
      calls = new Map();
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
    /** TASK-170: the signal crossing links walkers wait at for walk green, with the green their
     * runs need (seconds), as of the last step. */
    walkCalls: () => calls,
    hold(id: number, lane: CLane | undefined, path: CMovement | null) {
      if (!blocking) return Infinity;
      if (lane) {
        const movement =
          vehicles.movement[id] === -1 ? undefined : city.movements[vehicles.movement[id]!];
        if (!blocks[lane.idx] && (!movement || !nearHeld[movement.toLane])) return Infinity;
      } else if (!nearHeld[path!.toLane]) return Infinity;
      return hold(id, lane, path);
    },
    /** TASK-165: whether a span a walker holds this step overlaps [fromM, toM] of `lane`. A lane
     * change must not land a body there: `clear` checked the lane, not its neighbours. */
    holds(lane: number, fromM: number, toM: number) {
      const list = blocking ? blocks[lane] : undefined;
      if (!list) return false;
      for (let i = 0; i < list.length; i += 5)
        if (list[i + 4]! < 0 && list[i]! < toM && list[i + 1]! > fromM) return true;
      return false;
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
        meanWaitS: byKind((k) => mean(totals.waits[k]!, totals.crossings[k]!)),
        crossings: byKind((k) => totals.crossings[k]!),
        vehicleStops: byKind((k) => totals.stops[k]!),
        vehicleDelayS: byKind((k) => totals.delayS[k]!),
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
        crossing: state[id] === WAITING || state[id] === CROSSING ? KINDS[runKind[id]!]! : null,
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
      served = servedLinks(city);
      sourceRoutes = sources.map(({ fromPlaceId, toPlaceId }) =>
        routeBetween(fromPlaceId, toPlaceId),
      );
      blocks = Array<number[] | undefined>(city.lanes.length).fill(undefined);
      touched = [];
      blocking = false;
      nearHeld = new Uint8Array(city.lanes.length);
      nearHeldLanes = [];
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
          // Legs already walked may have lost their link (-1): drop them so every leg of a kept
          // route exists, or the next edit cannot remap it (TASK-178).
          const kept = legs.slice(0, first).some((l) => l.link === -1) ? legs.slice(first) : legs;
          route[id] = { ...path, legs: kept, links: kept.map((l) => l.link) };
          if (kept !== legs) {
            leg[id] = 0;
            if (runEnd[id]! >= 0) runEnd[id] = runEnd[id]! - first;
          }
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
