import {
  signalStateAt,
  walkGreenS,
  walkWindows,
  type CConnector,
  type CSignal,
  type CompiledCity,
} from '../network';
import { demandSplit, MIN_GREEN_S, SPLIT_FLOOR_SHARE } from '../network/signal-program';
import { freeFlowLinkCosts, type RouteProvider } from '../routing';
import type { SimParams, VehicleClass, VehiclePurpose } from '../schema';
import type { Vehicles } from './vehicle';

/** Keep phase epochs separate from the canonical program sent back to restart. */
export function patchSignals(
  before: CompiledCity,
  after: CompiledCity,
  timeS: number,
  epochs: Map<string, number>,
) {
  const signature = (city: CompiledCity, index: number) => {
    const signal = city.nodes[index]!.signal;
    return (
      signal &&
      JSON.stringify({
        ...signal,
        phases: signal.phases.map((phase) => ({
          ...phase,
          movements: phase.movements.map((i) => city.movements[i]!.id),
          // TASK-111: walk links by id; their indices shift with unrelated edits.
          walk: phase.walk.map((i) => city.walk.links[i]!.id),
        })),
      })
    );
  };
  return {
    ...after,
    nodes: after.nodes.map((node) => {
      const old = before.index.node.get(node.id);
      if (
        node.signal &&
        (old === undefined || signature(before, old) !== signature(after, node.idx))
      )
        epochs.set(node.id, timeS);
      const epoch = epochs.get(node.id);
      return node.signal && epoch !== undefined
        ? { ...node, signal: { ...node.signal, offsetS: node.signal.offsetS - epoch } }
        : node;
    }),
  };
}

export const RED = 0;
export const GREEN = 1;
export const AMBER = 2;

/** TASK-170: one signal controller: a signalised junction group's members (its id) in lockstep,
 * or a single signal node. */
interface Controller {
  id: string;
  nodes: number[];
}

export function signalControllers(city: CompiledCity): Controller[] {
  const controllers: Controller[] = [];
  for (const group of city.groups ?? [])
    if (group.signalised) {
      const nodes = group.nodes.filter((n) => city.nodes[n]!.signal);
      if (nodes.length) controllers.push({ id: group.id, nodes });
    }
  for (const node of city.nodes)
    if (node.signal && node.group === undefined)
      controllers.push({ id: node.id, nodes: [node.idx] });
  return controllers;
}

const fromInner = (city: CompiledCity, movement: number) =>
  city.roads[city.lanes[city.movements[movement]!.fromLane]!.road]!.group !== undefined;

/** TASK-170: each phase's minimum green: `MIN_GREEN_S`, and for a phase with walk green the time
 * to cross its longest arm at walking speed plus the walk clearance (TASK-111's step-out rule),
 * never more than the phase's own green. */
function minimumGreens(city: CompiledCity, signals: readonly CSignal[], params: SimParams) {
  return signals[0]!.phases.map((phase, p) => {
    let walkS = 0;
    for (const signal of signals) {
      const arms = new Map<number, number>();
      for (const link of signal.phases[p]!.walk) {
        const { lengthM, crossing } = city.walk.links[link]!;
        arms.set(crossing!.arm, (arms.get(crossing!.arm) ?? 0) + lengthM);
      }
      for (const lengthM of arms.values())
        walkS = Math.max(walkS, Math.ceil(lengthM / params.walkSpeedMps + params.walkClearanceS));
    }
    return Math.min(phase.durationS, Math.max(MIN_GREEN_S, walkS));
  });
}

/** TASK-170: one car trip of the scenario, for the expected demand. */
export interface DemandTrip {
  origin: CConnector;
  destination: number;
  vehicleClass: VehicleClass;
  purpose: VehiclePurpose;
}

/**
 * TASK-170: the expected demand at signals: each car trip routed from its origin connector on
 * free-flow costs (no noise), counted on every movement of its route, by movement id so that it
 * survives live edits. Trips between the same connectors share one route.
 */
export function signalDemand(
  city: CompiledCity,
  provider: RouteProvider,
  trips: Iterable<DemandTrip>,
): Map<string, number> {
  const costs = freeFlowLinkCosts(city);
  const routes = new Map<string, number[] | null>();
  const demand = new Map<string, number>();
  for (const { origin, destination, vehicleClass, purpose } of trips) {
    const key = `${origin.idx}>${destination}>${vehicleClass}>${purpose}`;
    let movements = routes.get(key);
    if (movements === undefined) {
      const result = provider.route(city, costs, {
        fromLane: origin.lane,
        fromPosM: origin.positionM,
        toConnector: destination,
        vehicleClass,
        purpose,
        desiredSpeedFactor: 1,
        noise: 0,
        seed: 0,
      });
      movements = result.ok ? result.route.movements : null;
      routes.set(key, movements);
    }
    for (const m of movements ?? []) {
      const id = city.movements[m]!.id;
      demand.set(id, (demand.get(id) ?? 0) + 1);
    }
  }
  return demand;
}

/**
 * TASK-170: the signal timing a run uses, per node: the compiled signal, or for a controller
 * whose program has `demandSplit`, the same phases with the green split by `demand`
 * (`demandSplit`). A green group is a road pair at a member, not from an inner road; its load is
 * its movements' demand per approach lane. Every member of a group gets the same split.
 */
export function timedSignals(
  city: CompiledCity,
  demand: ReadonlyMap<string, number>,
  params: SimParams,
): (CSignal | null)[] {
  const timed = city.nodes.map((node) => node.signal);
  for (const { nodes } of signalControllers(city)) {
    const signals = nodes.map((n) => city.nodes[n]!.signal!);
    if (!signals[0]!.demandSplit) continue;
    const groups = new Map<string, { served: Set<number>; flow: number; lanes: Set<number> }>();
    const counted = new Set<number>();
    signals.forEach((signal, i) =>
      signal.phases.forEach((phase, p) => {
        for (const m of phase.movements) {
          if (fromInner(city, m)) continue;
          const movement = city.movements[m]!;
          const key = `${nodes[i]}:${city.lanes[movement.fromLane]!.road}>${city.lanes[movement.toLane]!.road}`;
          let group = groups.get(key);
          if (!group) groups.set(key, (group = { served: new Set(), flow: 0, lanes: new Set() }));
          group.served.add(p);
          group.lanes.add(movement.fromLane);
          if (!counted.has(m)) group.flow += demand.get(movement.id) ?? 0;
          counted.add(m);
        }
      }),
    );
    const list = [...groups.values()];
    const totalS = signals[0]!.phases.reduce((sum, phase) => sum + phase.durationS, 0);
    const split = demandSplit(
      list.map((g) => [...g.served].sort((a, b) => a - b)),
      list.map((g) => g.flow / g.lanes.size),
      minimumGreens(city, signals, params).map((minS, p) =>
        Math.max(minS, SPLIT_FLOOR_SHARE * signals[0]!.phases[p]!.durationS),
      ),
      totalS,
    );
    if (!split) continue;
    signals.forEach((signal, i) => {
      timed[nodes[i]!] = {
        ...signal,
        phases: signal.phases.map((phase, p) => ({ ...phase, durationS: split[p]! })),
        cycleS: split.reduce((sum, s) => sum + s + signal.amberS + signal.allRedS, 0),
      };
    });
  }
  return timed;
}

/** TASK-170: how far before its stop line a vehicle calls or extends its phase. */
export const DETECT_M = 40;
/** TASK-170: how long a vehicle in that range keeps its phase green (the passage time). */
export const PASSAGE_S = 3;

const GREEN_STAGE = 0;
const AMBER_STAGE = 1;
const ALL_RED_STAGE = 2;

interface ActuatedState {
  phase: number;
  stage: number;
  stageS: number;
  untilS: number;
  next: number;
}

/**
 * TASK-170: the signals as a run drives them (architecture section 5.4). A fixed controller
 * shows its timed signal at `timeS` (`signalStateAt`). An actuated one keeps its own state: its
 * green lasts at least the phase's minimum green; a vehicle within `DETECT_M` of its stop line
 * planning a movement the phase serves keeps it green for `PASSAGE_S` more, and a walker waiting
 * at one of its walk-green crossings for the time its run needs; once another phase has demand
 * (such a vehicle or walker for it) the green ends when no extension holds it or at the phase's
 * timed green, and amber and all-red lead to the next phase with demand. Without other demand it
 * rests in green. `walkCalls` gives the walk links walkers wait at, with the green they need.
 */
export function createSignalControl(
  city: CompiledCity,
  signals: readonly (CSignal | null)[],
  vehicles: Vehicles,
  params: SimParams,
  timeS: number,
  walkCalls: () => ReadonlyMap<number, number> | undefined,
  previous?: ReadonlyMap<string, ActuatedState>,
) {
  const actuated = signalControllers(city).flatMap((controller) => {
    const members = controller.nodes.map((n) => signals[n]!);
    if (!members[0]!.actuated) return [];
    const phaseMask = new Map<number, number>();
    const walkMask = new Map<number, number>();
    members.forEach((signal) =>
      signal.phases.forEach((phase, p) => {
        for (const m of phase.movements)
          if (!fromInner(city, m)) phaseMask.set(m, (phaseMask.get(m) ?? 0) | (1 << p));
        for (const link of phase.walk) walkMask.set(link, (walkMask.get(link) ?? 0) | (1 << p));
      }),
    );
    const lanes = [...new Set([...phaseMask.keys()].map((m) => city.movements[m]!.fromLane))];
    const old = previous?.get(controller.id);
    const state: ActuatedState =
      old && old.phase < members[0]!.phases.length
        ? { ...old }
        : {
            phase: signalStateAt(members[0]!, timeS).phase,
            stage: GREEN_STAGE,
            stageS: timeS,
            untilS: -Infinity,
            next: 0,
          };
    return [
      {
        ...controller,
        members,
        phaseMask,
        walkMask,
        lanes: lanes.sort((a, b) => a - b),
        minS: minimumGreens(city, members, params),
        state,
      },
    ];
  });
  const owner = new Int32Array(city.nodes.length).fill(-1);
  actuated.forEach((c, i) => c.nodes.forEach((n) => (owner[n] = i)));
  const windows = new Map<number, [number, number][]>();
  const eps = 1e-9;

  function advance(c: (typeof actuated)[number], timeS: number) {
    const s = c.state;
    const { amberS, allRedS, phases } = c.members[0]!;
    if (s.stage === GREEN_STAGE) {
      const own = 1 << s.phase;
      let extend = false;
      let calls = 0;
      for (const lane of c.lanes) {
        const stopM = city.lanes[lane]!.stopM;
        for (let id = vehicles.first(lane); id !== -1; id = vehicles.next[id]!) {
          if (vehicles.position[id]! < stopM - DETECT_M) break;
          const mask = c.phaseMask.get(vehicles.movement[id]!) ?? 0;
          if (mask & own) extend = true;
          else calls |= mask;
        }
      }
      let walkNeedS = 0;
      for (const [link, needS] of walkCalls() ?? []) {
        const mask = c.walkMask.get(link);
        if (mask === undefined) continue;
        if (mask & own) walkNeedS = Math.max(walkNeedS, needS);
        else calls |= mask;
      }
      calls &= ~own;
      let until = Math.max(s.untilS, s.stageS + c.minS[s.phase]!);
      if (extend) until = Math.max(until, timeS + PASSAGE_S);
      if (walkNeedS) until = Math.max(until, timeS + walkNeedS);
      if (calls)
        until = Math.max(
          s.stageS + c.minS[s.phase]!,
          Math.min(until, s.stageS + phases[s.phase]!.durationS),
        );
      else until = Math.max(until, timeS + params.dtS);
      s.untilS = until;
      if (!calls || timeS < until - eps) return;
      s.stage = AMBER_STAGE;
      s.stageS = timeS;
      for (let k = 1; k <= phases.length; k++) {
        const q = (s.phase + k) % phases.length;
        if (calls & (1 << q)) {
          s.next = q;
          break;
        }
      }
    }
    if (s.stage === AMBER_STAGE) {
      if (timeS < s.stageS + amberS - eps) return;
      s.stage = ALL_RED_STAGE;
      s.stageS += amberS;
    }
    if (timeS < s.stageS + allRedS - eps) return;
    s.phase = s.next;
    s.stage = GREEN_STAGE;
    s.stageS = timeS;
    s.untilS = -Infinity;
  }

  const stateOf = (node: number, timeS: number): { phase: number; state: number } => {
    const c = actuated[owner[node]!];
    if (c) return { phase: c.state.phase, state: c.state.stage };
    const { phase, state } = signalStateAt(signals[node]!, timeS);
    return {
      phase,
      state: state === 'green' ? GREEN_STAGE : state === 'amber' ? AMBER_STAGE : ALL_RED_STAGE,
    };
  };

  /** Remaining walk green of a signal crossing link: an actuated green can end once its
   * extensions lapse, so it counts only to the green's current end. */
  function walkGreen(link: number, timeS: number) {
    const node = city.walk.links[link]!.crossing!.node;
    const signal = signals[node];
    if (!signal) return 0;
    const c = actuated[owner[node]!];
    if (c) {
      const s = c.state;
      return s.stage === GREEN_STAGE && (c.walkMask.get(link) ?? 0) & (1 << s.phase)
        ? Math.max(0, s.untilS - timeS)
        : 0;
    }
    let spans = windows.get(link);
    if (!spans) windows.set(link, (spans = walkWindows(signal, link)));
    return walkGreenS(signal, link, timeS, spans);
  }

  return {
    /** The movement colours at `timeS`, advancing actuated controllers to it. */
    update(timeS: number, colors: Uint8Array) {
      for (const c of actuated) advance(c, timeS);
      for (const node of city.nodes) {
        const signal = signals[node.idx];
        if (!signal) continue;
        for (const movement of node.movements) colors[movement] = RED;
        const { phase, state } = stateOf(node.idx, timeS);
        if (state === ALL_RED_STAGE) continue;
        const color = state === GREEN_STAGE ? GREEN : AMBER;
        for (const movement of signal.phases[phase]!.movements) colors[movement] = color;
      }
    },
    walkGreen,
    /** Each node's phase and stage (0 green, 1 amber, 2 all-red; phase -1 without a signal)
     * and each walk link's walk light (1 green), for the renderers. */
    snapshot(timeS: number) {
      const phase = new Int16Array(city.nodes.length).fill(-1);
      const state = new Uint8Array(city.nodes.length);
      const walk = new Uint8Array(city.walk.links.length);
      signals.forEach((signal, n) => {
        if (!signal) return;
        ({ phase: phase[n], state: state[n] } = stateOf(n, timeS));
      });
      for (const link of city.walk.links)
        if (link.crossing?.control === 'signal' && signals[link.crossing.node])
          walk[link.idx] = Number(walkGreen(link.idx, timeS) > 0);
      return { phase, state, walk };
    },
    /** The phase greens of each demand-split controller, by group or node id. */
    timing() {
      return Object.fromEntries(
        signalControllers(city).flatMap(({ id, nodes }) => {
          const signal = signals[nodes[0]!]!;
          return signal.demandSplit ? [[id, signal.phases.map((p) => p.durationS)]] : [];
        }),
      ) as Record<string, number[]>;
    },
    /** Actuated states by controller id, carried over a live edit. */
    states: () => new Map(actuated.map((c) => [c.id, c.state])),
  };
}

/** Each signal's movement colours at `timeS` from its compiled program alone. */
export function updateSignals(compiled: CompiledCity, timeS: number, colors: Uint8Array) {
  for (const node of compiled.nodes) {
    const signal = node.signal;
    if (!signal) continue;
    for (const movement of node.movements) colors[movement] = RED;
    const { phase, state } = signalStateAt(signal, timeS);
    if (state === 'all-red') continue;
    const color = state === 'green' ? GREEN : AMBER;
    for (const movement of signal.phases[phase]!.movements) colors[movement] = color;
  }
}

export type SignalControl = ReturnType<typeof createSignalControl>;
export type SignalStates = ReturnType<SignalControl['snapshot']>;
