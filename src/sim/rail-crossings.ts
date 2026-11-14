import type { CompiledCity } from '../network';
import {
  trainDefaults,
  trainPoseAt,
  trainsAt,
  trainPositionAt,
  type TrainPose,
  type TrainRoute,
} from '../network/trains';
import { railTimetable } from '../network/trams';
import type { SimParams } from '../schema';
import { createVehicleProfiles, DRIVING, QUEUED_DESTINATION, type Vehicles } from './vehicle';

export const CROSSING_OPEN = 0;
export const CROSSING_WARNING = 1;
export const CROSSING_CLOSED = 2;
export interface RailSnapshot {
  /** Dense compiled rail.facilities order; open=0, warning=1, closed=2. */
  crossings: Uint8Array;
  railReady: Uint8Array;
  /** Controlled positions, including services waiting for a committed road vehicle. */
  trains: TrainPose[];
}
type Event = { facility: number; enterS: number; exitS: number; warningS: number };
type Service = {
  departure: number;
  cycle: number;
  ageS: number;
  held: boolean;
  current: number[];
  proposed: number[];
  tailClearedS: number[];
  /** NaN: ordinary motion warning; Infinity: upstream interlock; finite: fresh warning. */
  warningStartedS: number[];
};
type Clock = {
  routeId: string;
  requestedS: number;
  cycle: number;
  ageS: number;
  held: boolean;
  tailCleared?: { nodes: string[]; enterS: number; exitS: number; timeS: number }[];
  warningRestarts?: { nodes: string[]; enterS: number; exitS: number; startedS: number | null }[];
};
type RoadState = {
  histories: { id: number; segment: number; trail: number[]; position: number }[];
  admissions: { nodes: string[]; ids: number[] }[];
};

/** Time at a coordinate within one monotonic motion phase. */
function phaseTime(phase: TrainRoute['phases'][number], position: number) {
  let low = 0,
    high = phase.durationS;
  const forward = phase.speedMps + (phase.acceleration * phase.durationS) / 2 >= 0;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const at = phase.positionM + phase.speedMps * mid + (phase.acceleration * mid * mid) / 2;
    if (at < position === forward) low = mid;
    else high = mid;
  }
  return phase.timeS + (low + high) / 2;
}

export function createRailCrossings(
  city: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  startS: number,
  red: (movement: number) => boolean,
  clocks?: Clock[],
  roadState?: RoadState,
) {
  const rail = city.rail;
  if (!rail) return undefined;
  const table = railTimetable(rail);
  const facilities = rail.facilities ?? [];
  const profiles = createVehicleProfiles(params);
  const maxLength = Math.max(...profiles.map((p) => p.lengthM));
  const length = (id: number) => profiles[vehicles.vclass[id]!]!.lengthM;
  const events = table.routes.map((route) => {
    const result: Event[] = [];
    facilities.forEach((facility, index) => {
      let lo = Infinity,
        hi = -Infinity;
      for (const span of facility.railSpans ?? [])
        for (const section of route.sections) {
          if (section.track !== span.track) continue;
          const track = rail.tracks[span.track]!;
          lo = Math.min(
            lo,
            section.startM + (section.forward ? span.fromM : track.lengthM - span.toM),
          );
          hi = Math.max(
            hi,
            section.startM + (section.forward ? span.toM : track.lengthM - span.fromM),
          );
        }
      if (lo > hi) return;
      const half = trainDefaults[route.kind].lengthM / 2;
      lo -= half;
      hi += half;
      // Enough warning for the fastest legal road approach, including long-vehicle clearance.
      const speed = Math.max(
        0,
        ...city.lanes
          .filter((l) => facility.stops?.some((s) => s.lane === l.idx))
          .map((l) => l.speedLimitMps),
      );
      const warningS = Math.max(12, speed / Math.min(...profiles.map((p) => p.idm.bMps2)) + 6);
      for (const phase of route.phases) {
        const end =
          phase.positionM +
          phase.speedMps * phase.durationS +
          (phase.acceleration * phase.durationS ** 2) / 2;
        const low = Math.max(lo, Math.min(phase.positionM, end));
        const high = Math.min(hi, Math.max(phase.positionM, end));
        if (low > high) continue;
        const forward = end >= phase.positionM;
        const enterS =
          Math.abs(end - phase.positionM) < 1e-9
            ? phase.timeS
            : phaseTime(phase, forward ? low : high);
        const exitS =
          Math.abs(end - phase.positionM) < 1e-9
            ? phase.timeS + phase.durationS
            : phaseTime(phase, forward ? high : low);
        const previous = result.at(-1);
        if (previous?.facility === index && enterS <= previous.exitS + 1e-6)
          previous.exitS = Math.max(previous.exitS, exitS);
        else result.push({ facility: index, enterS, exitS, warningS });
      }
    });
    return result.sort((a, b) => a.enterS - b.enterS || a.facility - b.facility);
  });
  const served = Uint8Array.from(facilities, (_, f) =>
    Number(events.some((e) => e.some((v) => v.facility === f))),
  );
  const states = new Uint8Array(facilities.length);
  const previousStates = new Uint8Array(facilities.length);
  const committed = facilities.map(() => new Set<number>());
  const railReady = new Uint8Array(facilities.length);
  const occupied = new Uint8Array(facilities.length);
  const holds = new Uint8Array(vehicles.count);
  const holdPositions = new Float64Array(vehicles.count);
  const services: Service[] = [];
  const nextCycle = new Int32Array(table.departures.length);
  const warningMax = Math.max(0, ...events.flatMap((e) => e.map((v) => v.warningS)));
  const influences = new Uint8Array(city.lanes.length + city.movements.length);
  const reach = new Float64Array(influences.length).fill(-Infinity);
  const bucket = (segment: number) => (segment >= 0 ? segment : city.lanes.length - segment - 1);
  const stopsBySegment = Array.from(
    { length: influences.length },
    () => [] as { facility: number; at: number }[],
  );
  const spansBySegment = Array.from(
    { length: influences.length },
    () => [] as { facility: number; from: number; to: number }[],
  );
  facilities.forEach((f, facility) => {
    for (const stop of f.stops ?? [])
      stopsBySegment[bucket(stop.lane)]!.push({ facility, at: stop.stopM });
    for (const span of f.spans ?? [])
      spansBySegment[bucket(span.segment)]!.push({ facility, from: span.fromM, to: span.toM });
  });
  /** Segments with a stop marking or a span: most of a path has neither (TASK-176). */
  const marked = Uint8Array.from(stopsBySegment, (stops, b) =>
    Number(stops.length > 0 || spansBySegment[b]!.length > 0),
  );
  /** Per vehicle in `roadOccupancy`: the facilities its body overlaps. */
  const bodyInside = new Uint8Array(facilities.length);
  /** TASK-176: a vehicle's path ahead and, per facility, its nearest stop marking and the extent
   * of its spans along it. Kept while the vehicle's lane, position, movement, route and route step
   * stay the same (routes are replaced, never edited): a standing queue, and the hold after the
   * occupancy pass in the same step, reuse it. `path` points the names below at the vehicle's. */
  type Path = {
    lane: number;
    position: number;
    step: number;
    movement: number;
    route: (typeof vehicles.route)[number] | undefined;
    segments: number[];
    offsets: number[];
    stops: Float64Array;
    starts: Float64Array;
    ends: Float64Array;
    ranged: boolean;
  };
  const paths: (Path | undefined)[] = [];
  let current: Path | undefined,
    segments: number[] = [],
    offsets: number[] = [],
    pathStops: Float64Array = new Float64Array(0),
    pathStarts = pathStops,
    pathEnds = pathStops;
  const histories = new Map<number, { segment: number; trail: number[]; position: number }>();
  const segmentLength = (segment: number) =>
    segment >= 0 ? city.lanes[segment]!.lengthM : city.movements[-segment - 1]!.lengthM;
  const influencing = (segment: number, left: number) => {
    const b = bucket(segment);
    if (left <= reach[b]!) return;
    reach[b] = left;
    influences[b] = 1;
    if (left <= 0) return;
    if (segment >= 0) {
      for (const m of city.lanes[segment]!.in) influencing(-m - 1, left - segmentLength(-m - 1));
    } else {
      const lane = city.movements[-segment - 1]!.fromLane;
      influencing(lane, left - segmentLength(lane));
    }
  };
  for (let f = 0; f < facilities.length; f++)
    if (served[f]) {
      for (const stop of facilities[f]!.stops ?? []) influencing(stop.lane, 300);
      for (const span of facilities[f]!.spans ?? []) influencing(span.segment, 300);
    }
  function tailInfluence(segment: number, left: number, visited = new Set<number>()) {
    if (left < 0 || visited.has(segment)) return;
    visited.add(segment);
    influences[bucket(segment)] = 1;
    if (segment >= 0)
      for (const m of city.lanes[segment]!.out)
        tailInfluence(-m - 1, left - segmentLength(segment), visited);
    else
      tailInfluence(city.movements[-segment - 1]!.toLane, left - segmentLength(segment), visited);
  }
  for (let f = 0; f < facilities.length; f++)
    if (served[f])
      for (const span of facilities[f]!.spans ?? []) {
        tailInfluence(span.segment, span.toM + maxLength);
      }
  // Initial occurrences include trains already inside the imported network.
  table.departures.forEach((d, i) => {
    const route = table.routes[d.route]!;
    nextCycle[i] = Math.floor((startS - d.timeS - route.durationS) / table.periodS);
  });
  let nextSpawnS = -Infinity;
  function spawn(timeS: number) {
    if (timeS + warningMax < nextSpawnS) return;
    nextSpawnS = Infinity;
    table.departures.forEach((departure, i) => {
      while (departure.timeS + nextCycle[i]! * table.periodS <= timeS + warningMax) {
        const cycle = nextCycle[i]!++;
        const ageS = timeS - departure.timeS - cycle * table.periodS;
        if (ageS < table.routes[departure.route]!.durationS + 1)
          services.push({
            departure: i,
            cycle,
            ageS,
            held: false,
            current: [],
            proposed: [],
            tailClearedS: events[departure.route]!.map((event) =>
              ageS > event.exitS ? timeS - (ageS - event.exitS) : Infinity,
            ),
            warningStartedS: events[departure.route]!.map(() => NaN),
          });
      }
      nextSpawnS = Math.min(nextSpawnS, departure.timeS + nextCycle[i]! * table.periodS);
    });
  }
  function path(id: number) {
    const lane = vehicles.lane[id]!,
      position = vehicles.position[id]!,
      routeStep = vehicles.routeStep[id]!,
      firstMovement = vehicles.movement[id]!,
      route = vehicles.route[id];
    let entry = paths[id];
    const kept =
      entry !== undefined &&
      entry.lane === lane &&
      entry.position === position &&
      entry.step === routeStep &&
      entry.movement === firstMovement &&
      entry.route === route;
    if (!entry) {
      entry = {
        lane,
        position,
        step: routeStep,
        movement: firstMovement,
        route,
        segments: [],
        offsets: [],
        stops: new Float64Array(facilities.length),
        starts: new Float64Array(facilities.length),
        ends: new Float64Array(facilities.length),
        ranged: false,
      };
      paths[id] = entry;
    }
    current = entry;
    segments = entry.segments;
    offsets = entry.offsets;
    pathStops = entry.stops;
    pathStarts = entry.starts;
    pathEnds = entry.ends;
    if (kept) return;
    entry.lane = lane;
    entry.position = position;
    entry.step = routeStep;
    entry.movement = firstMovement;
    entry.route = route;
    entry.ranged = false;
    segments.length = offsets.length = 0;
    let segment = lane,
      offset = 0,
      step = routeStep;
    for (let count = 0; count < 128; count++) {
      segments.push(segment);
      offsets.push(offset);
      offset += segmentLength(segment);
      if (offset - position > 600) break;
      if (segment >= 0) {
        const movement = segments.length === 1 ? firstMovement : (route?.movements[step] ?? -1);
        if (movement === -1 || city.movements[movement]!.fromLane !== segment) break;
        segment = -movement - 1;
      } else {
        segment = city.movements[-segment - 1]!.toLane;
        step++;
      }
    }
  }
  function overlaps(f: number, segment: number, front: number, rear: number) {
    return spansBySegment[bucket(segment)]!.some(
      (s) => s.facility === f && front >= s.from && rear <= s.to,
    );
  }
  /** The current path's ranges from the vehicle's position. */
  function ranges() {
    const entry = current!;
    if (entry.ranged) return;
    entry.ranged = true;
    const position = entry.position;
    pathStops.fill(Infinity);
    pathStarts.fill(Infinity);
    pathEnds.fill(-Infinity);
    for (let s = 0; s < segments.length; s++) {
      const b = bucket(segments[s]!);
      if (!marked[b]) continue;
      const offset = offsets[s]!;
      for (const marking of stopsBySegment[b]!) {
        const at = offset + marking.at;
        if (at >= position - 1e-6)
          pathStops[marking.facility] = Math.min(pathStops[marking.facility]!, at);
      }
      for (const span of spansBySegment[b]!) {
        if (offset + span.to < position) continue;
        pathStarts[span.facility] = Math.min(pathStarts[span.facility]!, offset + span.from);
        pathEnds[span.facility] = Math.max(pathEnds[span.facility]!, offset + span.to);
      }
    }
  }
  const platoonLane = Uint8Array.from(city.lanes, (lane) =>
    Number(lane.left === -1 && lane.right === -1),
  );
  for (const space of city.parkingSpaces ?? []) platoonLane[space.lane] = 0;
  const walkStops = city.lanes.map(() => [] as number[]);
  for (const link of city.walk.links)
    for (const span of link.crossing?.spans ?? [])
      walkStops[span.lane]!.push(span.atM - span.halfM - params.idm.minGapM);

  /** An exclusive lane prefix can store the whole platoon even if every vehicle stops.
   * Never borrow space across a junction, parking manoeuvre, lateral entry or access point. */
  function platoonFits(id: number, facility: number, end: number) {
    const field = vehicles.lane[id]!;
    if (field < 0 || !platoonLane[field]) return false;
    const lane = city.lanes[field]!,
      position = vehicles.position[id]!,
      gap = params.idm.minGapM;
    if (end > lane.lengthM) return false;
    // A downstream vehicle's rear can extend back from the next segment or a new access spawn.
    let frontier = lane.stopM - maxLength - gap;
    for (const index of lane.connectors) {
      const at = city.connectors[index]!.positionM;
      if (at > position) frontier = Math.min(frontier, at - maxLength - gap);
    }
    for (const at of walkStops[field]!) if (at > position) frontier = Math.min(frontier, at);
    for (const marking of stopsBySegment[bucket(field)]!)
      if (marking.facility !== facility && served[marking.facility] && marking.at > position)
        frontier = Math.min(frontier, marking.at);
    let needed = length(id) + gap;
    if (frontier - end < needed) return false;
    for (let ahead = vehicles.previous[id]!; ahead !== -1; ahead = vehicles.previous[ahead]!) {
      const front = vehicles.position[ahead]!,
        rear = front - length(ahead);
      if (front >= frontier || vehicles.speed[ahead]! < 0.1 || vehicles.state[ahead] !== DRIVING) {
        frontier = Math.min(frontier, rear - gap);
        break;
      }
      needed += length(ahead) + gap;
      if (frontier - end < needed) return false;
    }
    return frontier - end >= needed;
  }

  function roadOccupancy() {
    occupied.fill(0);
    for (const b of vehicles.occupied) {
      if (!influences[b]) continue;
      const field = b < city.lanes.length ? b : city.lanes.length - b - 1;
      for (let id = vehicles.first(field); id !== -1; id = vehicles.next[id]!) {
        if (vehicles.state[id] !== DRIVING && vehicles.state[id] !== QUEUED_DESTINATION) continue;
        const position = vehicles.position[id]!;
        let history = histories.get(id);
        const previousSegment = history?.segment ?? field;
        const previousPosition = history?.position ?? -Infinity;
        let continuous = true;
        if (!history) {
          history = { segment: field, trail: [], position };
          histories.set(id, history);
        } else if (history.segment !== field) {
          continuous =
            history.segment < 0
              ? city.movements[-history.segment - 1]!.toLane === field
              : field < 0
                ? city.movements[-field - 1]!.fromLane === history.segment
                : city.lanes[history.segment]!.out.some(
                    (m) => city.movements[m]!.toLane === field && city.movements[m]!.lengthM === 0,
                  );
          if (continuous) history.trail.unshift(history.segment);
          else history.trail.length = 0;
          history.segment = field;
        } else if (position < history.position - 1e-6) {
          history.trail.length = 0;
          continuous = false;
        }
        if (!continuous) for (const entries of committed) entries.delete(id);
        history.position = position;
        let remaining = length(id) - position,
          keep = 0;
        while (remaining > 0 && keep < history.trail.length)
          remaining -= segmentLength(history.trail[keep++]!);
        history.trail.length = keep;
        path(id);
        ranges();
        for (const marking of continuous ? stopsBySegment[bucket(previousSegment)]! : []) {
          const passed = field === previousSegment ? position > marking.at + 1e-6 : true;
          if (passed && previousPosition <= marking.at + 1e-6) committed[marking.facility]!.add(id);
        }
        // The body, walked back once for every facility: the segments it covers.
        bodyInside.fill(0);
        let segment = field,
          front = position,
          rear = front - length(id),
          step = vehicles.routeStep[id]!;
        for (let back = 0; back < 32; back++) {
          const b = bucket(segment);
          if (marked[b])
            for (const s of spansBySegment[b]!)
              if (front >= s.from && rear <= s.to) bodyInside[s.facility] = 1;
          if (rear >= 0) break;
          const actual = history.trail[back];
          if (actual !== undefined) {
            if (segment >= 0) step--;
            segment = actual;
          } else if (segment < 0) segment = city.movements[-segment - 1]!.fromLane;
          else {
            const m = vehicles.route[id]?.movements[--step];
            if (m === undefined) break;
            segment = -m - 1;
          }
          front = segmentLength(segment);
          rear += front;
        }
        for (let f = 0; f < facilities.length; f++) {
          if (!served[f]) continue;
          const stop = pathStops[f]!,
            near = pathStarts[f]!;
          // An unmetered upstream vehicle can wait before the conflict if it can brake there.
          // Only an actual marked entry, a braking dilemma, or its physical body reserves rail.
          const speed = vehicles.speed[id]!;
          const brake = profiles[vehicles.vclass[id]!]!.idm.bMps2;
          if (
            near < Infinity &&
            stop > near &&
            speed > 0.1 &&
            near - position < (speed * speed) / (2 * brake) + params.idm.minGapM
          )
            committed[f]!.add(id);
          const inside = bodyInside[f] === 1;
          if (inside) {
            occupied[f] = 1;
            committed[f]!.add(id);
          }
          if (speed < 0.1 && !inside && near > position + 1e-6) committed[f]!.delete(id);
          if (committed[f]!.has(id)) {
            if (near < Infinity || inside) occupied[f] = 1;
            else committed[f]!.delete(id);
          }
        }
      }
    }
  }
  function publish() {
    previousStates.set(states);
    states.fill(CROSSING_OPEN);
    for (const service of services) {
      const route = table.departures[service.departure]!.route;
      for (const [index, event] of events[route]!.entries()) {
        if (
          service.ageS < event.enterS - event.warningS ||
          (service.ageS > event.exitS && snapshotTimeS > service.tailClearedS[index]! + 1)
        )
          continue;
        const warningStart = service.warningStartedS[index]!;
        if (warningStart === Infinity) continue;
        const state = (
          Number.isNaN(warningStart)
            ? service.ageS >= event.enterS - event.warningS + 3
            : snapshotTimeS >= warningStart + 3
        )
          ? CROSSING_CLOSED
          : CROSSING_WARNING;
        states[event.facility] = Math.max(states[event.facility]!, state);
      }
    }
    for (let f = 0; f < states.length; f++)
      railReady[f] = Number(states[f] === CROSSING_CLOSED && !occupied[f]);
    for (let f = 0; f < states.length; f++) {
      if (previousStates[f] !== CROSSING_OPEN || states[f] === CROSSING_OPEN) continue;
      // A driver in the dilemma zone clears instead of receiving a physically impossible stop.
      for (const b of vehicles.occupied) {
        if (!influences[b]) continue;
        const field = b < city.lanes.length ? b : city.lanes.length - b - 1;
        for (let id = vehicles.first(field); id !== -1; id = vehicles.next[id]!) {
          path(id);
          let stop = Infinity;
          for (let s = 0; s < segments.length; s++)
            for (const marking of facilities[f]!.stops ?? [])
              if (
                marking.lane === segments[s] &&
                offsets[s]! + marking.stopM >= vehicles.position[id]!
              )
                stop = Math.min(stop, offsets[s]! + marking.stopM);
          const distance = stop - vehicles.position[id]!;
          const speed = vehicles.speed[id]!;
          const brake = profiles[vehicles.vclass[id]!]!.idm.bMps2;
          if (
            distance >= 0 &&
            speed > 0.1 &&
            distance < (speed * speed) / (2 * brake) + params.idm.minGapM
          ) {
            committed[f]!.add(id);
            occupied[f] = 1;
            railReady[f] = 0;
          }
        }
      }
    }
  }
  let snapshotTimeS = startS;
  const enabled = served.some(Boolean);
  if (roadState) {
    for (const history of roadState.histories)
      if (history.segment === vehicles.lane[history.id])
        histories.set(history.id, { ...history, position: vehicles.position[history.id]! });
    for (let f = 0; f < facilities.length; f++) {
      const previous = roadState.admissions.find(
        (a) =>
          a.nodes.length === facilities[f]!.nodes.length &&
          a.nodes.every((n) => facilities[f]!.nodes.includes(n)),
      );
      if (previous) for (const id of previous.ids) if (histories.has(id)) committed[f]!.add(id);
    }
  }
  spawn(startS);
  if (clocks) {
    for (const clock of clocks) {
      const departure = table.departures.findIndex(
        (d) => d.requestedS === clock.requestedS && table.routes[d.route]!.id === clock.routeId,
      );
      if (departure < 0) continue;
      let service = services.find((s) => s.departure === departure && s.cycle === clock.cycle);
      if (!service) {
        service = {
          departure,
          cycle: clock.cycle,
          ageS: clock.ageS,
          held: false,
          current: [],
          proposed: [],
          tailClearedS: [],
          warningStartedS: [],
        };
        services.push(service);
      }
      service.ageS = clock.ageS;
      service.held = clock.held;
      service.tailClearedS = events[table.departures[departure]!.route]!.map((event) => {
        if (clock.ageS <= event.exitS) return Infinity;
        const nodes = facilities[event.facility]!.nodes;
        const previous = clock.tailCleared?.find(
          (clear) =>
            clear.enterS === event.enterS &&
            clear.exitS === event.exitS &&
            clear.nodes.length === nodes.length &&
            clear.nodes.every((node) => nodes.includes(node)),
        );
        return previous?.timeS ?? startS - (clock.ageS - event.exitS);
      });
      service.warningStartedS = events[table.departures[departure]!.route]!.map((event) => {
        const nodes = facilities[event.facility]!.nodes;
        const previous = clock.warningRestarts?.find(
          (warning) =>
            warning.enterS === event.enterS &&
            warning.exitS === event.exitS &&
            warning.nodes.length === nodes.length &&
            warning.nodes.every((n) => nodes.includes(n)),
        );
        return previous ? (previous.startedS ?? Infinity) : NaN;
      });
    }
    roadOccupancy();
    for (const service of services)
      for (const event of events[table.departures[service.departure]!.route]!)
        if (
          occupied[event.facility] &&
          service.ageS >= event.enterS &&
          service.ageS <= event.exitS
        ) {
          service.ageS = event.enterS - params.dtS;
          service.held = true;
        }
    for (const service of services)
      events[table.departures[service.departure]!.route]!.forEach((event, index) => {
        if (service.ageS <= event.exitS) service.tailClearedS[index] = Infinity;
      });
  }
  publish();
  function tracksAt(service: Service, age: number, into: number[]) {
    into.length = 0;
    const route = table.routes[table.departures[service.departure]!.route]!;
    if (age < 0 || age >= route.durationS) return;
    const at = trainPositionAt(route, age).positionM;
    const half = trainDefaults[route.kind].lengthM / 2;
    let low = 0,
      high = route.sections.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (route.sections[mid]!.endM <= at - half) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < route.sections.length && route.sections[i]!.startM < at + half; i++)
      into.push(route.sections[i]!.track);
  }
  const trackOwners = new Int32Array(rail.tracks.length);
  const nextOwners = new Int32Array(rail.tracks.length);
  const delayedTracks = new Uint8Array(rail.tracks.length);
  return {
    canSpawn(lane: number, positionM: number, lengthM: number) {
      for (let f = 0; f < facilities.length; f++)
        if (states[f] !== CROSSING_OPEN) {
          if (overlaps(f, lane, positionM, positionM - lengthM)) return false;
          const stop = facilities[f]!.stops?.find((s) => s.lane === lane && s.stopM < positionM);
          if (stop && facilities[f]!.spans?.some((s) => s.segment === lane && s.toM >= positionM))
            return false;
        }
      return true;
    },
    step(timeS: number) {
      snapshotTimeS = timeS + params.dtS;
      if (!enabled) return;
      spawn(timeS);
      roadOccupancy();
      trackOwners.fill(-1);
      nextOwners.fill(-1);
      delayedTracks.fill(0);
      for (let i = 0; i < services.length; i++) {
        const service = services[i]!;
        tracksAt(service, service.ageS, service.current);
        tracksAt(service, service.ageS + params.dtS, service.proposed);
        for (const track of service.current) trackOwners[track] = i;
        const departure = table.departures[service.departure]!;
        if (
          service.current.length &&
          timeS - departure.timeS - service.cycle * table.periodS - service.ageS > params.dtS
        )
          for (const section of table.routes[departure.route]!.sections)
            delayedTracks[section.track] = 1;
      }
      for (let i = 0; i < services.length; i++) {
        const service = services[i]!;
        const route = table.departures[service.departure]!.route;
        const next = service.ageS + params.dtS;
        const blocked = events[route]!.find(
          (event) =>
            occupied[event.facility] &&
            service.ageS <= event.enterS &&
            next >= event.enterS - params.dtS,
        );
        service.held = blocked !== undefined;
        events[route]!.forEach((event, index) => {
          if (
            blocked &&
            event.facility !== blocked.facility &&
            event.enterS > blocked.enterS &&
            service.ageS < event.enterS &&
            service.ageS >= event.enterS - event.warningS
          )
            service.warningStartedS[index] = Infinity;
          else if (service.warningStartedS[index] === Infinity)
            service.warningStartedS[index] = timeS;
        });
        // A downstream discharge may reopen while the train is positively held at a
        // different crossing. Its nose cannot enter until a full new warning completes.
        if (!service.held)
          service.held = events[route]!.some(
            (event, index) =>
              Number.isFinite(service.warningStartedS[index]) &&
              timeS < service.warningStartedS[index]! + event.warningS &&
              service.ageS <= event.enterS &&
              next >= event.enterS - params.dtS,
          );
        // A delayed train keeps its physical track reservation; following/opposing services
        // wait before their nose enters it. Other routes retain their own clocks.
        if (!service.held)
          service.held = service.proposed.some(
            (track) =>
              (trackOwners[track] !== -1 && trackOwners[track] !== i) || nextOwners[track] !== -1,
          );
        if (!service.held && !service.current.length && service.proposed.length) {
          service.held = table.routes[route]!.sections.some((s) => delayedTracks[s.track]);
        }
        if (!service.held) {
          events[route]!.forEach((event, index) => {
            if (service.ageS <= event.exitS && next > event.exitS)
              service.tailClearedS[index] = timeS + event.exitS - service.ageS;
            if (next > event.enterS) service.warningStartedS[index] = NaN;
          });
          service.ageS = next;
          for (const track of service.proposed) nextOwners[track] = i;
        } else service.proposed.length = 0;
      }
      for (let i = services.length - 1; i >= 0; i--)
        if (
          services[i]!.ageS >=
            table.routes[table.departures[services[i]!.departure]!.route]!.durationS &&
          services[i]!.tailClearedS.every((cleared) => snapshotTimeS > cleared + 1)
        )
          services.splice(i, 1);
      publish();
    },
    hold(id: number) {
      holds[id] = 0;
      holdPositions[id] = Infinity;
      const field = vehicles.lane[id]!;
      if (field < -city.movements.length || !influences[bucket(field)]) return Infinity;
      path(id);
      ranges();
      const position = vehicles.position[id]!;
      let best = Infinity;
      let protectedStop = false;
      for (let f = 0; f < facilities.length; f++) {
        if (!served[f]) continue;
        if (committed[f]!.has(id)) continue;
        const near = pathStarts[f]!,
          end = pathEnds[f]!;
        const stop =
          pathStops[f]! <= near ? pathStops[f]! : Math.max(position, near - params.idm.minGapM);
        if (stop === Infinity || end < stop || stop >= best) continue;
        let blocked = states[f] !== CROSSING_OPEN;
        const clear = end + length(id) + params.idm.minGapM;
        if (!blocked)
          for (let s = 0; s < segments.length; s++) {
            const segment = segments[s]!,
              offset = offsets[s]!;
            if (offset > clear) break;
            let tail = vehicles.last(segment);
            while (tail !== -1 && (tail === id || offset + vehicles.position[tail]! <= position))
              tail = vehicles.previous[tail]!;
            if (
              tail !== -1 &&
              tail !== id &&
              offset + vehicles.position[tail]! > position &&
              offset + vehicles.position[tail]! - length(tail) < clear &&
              (segment !== field || !platoonFits(id, f, end))
            )
              blocked = true;
            if (segment >= 0) {
              const next = segments[s + 1];
              if (
                next !== undefined &&
                next < 0 &&
                red(-next - 1) &&
                offset + city.lanes[segment]!.stopM > stop &&
                offset + city.lanes[segment]!.stopM < clear
              )
                blocked = true;
            }
          }
        if (blocked) {
          best = stop;
          protectedStop = states[f] !== CROSSING_OPEN;
        }
      }
      holds[id] = Number(protectedStop);
      holdPositions[id] = best;
      return best;
    },
    binding(id: number, binding: boolean) {
      if (!binding) holds[id] = 0;
    },
    blocksExit: (id: number, lengthM: number) => holdPositions[id]! <= lengthM + 1e-6,
    held: (id: number) =>
      !!holds[id] &&
      vehicles.speed[id]! < 0.1 &&
      Math.abs(vehicles.position[id]! - holdPositions[id]!) < 0.5,
    clocks(): Clock[] {
      return services.map((s) => ({
        routeId: table.routes[table.departures[s.departure]!.route]!.id,
        requestedS: table.departures[s.departure]!.requestedS,
        cycle: s.cycle,
        ageS: s.ageS,
        held: s.held,
        warningRestarts: events[table.departures[s.departure]!.route]!.flatMap((event, index) =>
          Number.isNaN(s.warningStartedS[index])
            ? []
            : [
                {
                  nodes: facilities[event.facility]!.nodes,
                  enterS: event.enterS,
                  exitS: event.exitS,
                  startedS: Number.isFinite(s.warningStartedS[index])
                    ? s.warningStartedS[index]!
                    : null,
                },
              ],
        ),
        tailCleared: events[table.departures[s.departure]!.route]!.flatMap((event, index) =>
          Number.isFinite(s.tailClearedS[index])
            ? [
                {
                  nodes: facilities[event.facility]!.nodes,
                  enterS: event.enterS,
                  exitS: event.exitS,
                  timeS: s.tailClearedS[index]!,
                },
              ]
            : [],
        ),
      }));
    },
    roadState(mapping: { lanes: number[]; movements: number[] }): RoadState {
      const remap = (segment: number) => {
        if (segment >= 0) return mapping.lanes[segment] ?? -1;
        const movement = mapping.movements[-segment - 1] ?? -1;
        return movement < 0 ? undefined : -movement - 1;
      };
      const result: RoadState = {
        histories: [],
        admissions: facilities.map((f, i) => ({ nodes: f.nodes, ids: [...committed[i]!] })),
      };
      for (const [id, history] of histories) {
        const segment = remap(history.segment);
        if (segment === undefined || (history.segment >= 0 && segment === -1)) continue;
        const trail: number[] = [];
        for (const previous of history.trail) {
          const mapped = remap(previous);
          if (mapped === undefined || (previous >= 0 && mapped === -1)) break;
          trail.push(mapped);
        }
        result.histories.push({ id, segment, trail, position: history.position });
      }
      return result;
    },
    /** TASK-174: the runs in service at their controlled ages, or null when no crossing is served
     * and the timetable runs as published. */
    services() {
      return enabled
        ? services.map((s) => ({ departure: s.departure, cycle: s.cycle, ageS: s.ageS }))
        : null;
    },
    snapshot(): RailSnapshot {
      return {
        crossings: states.slice(),
        railReady: railReady.slice(),
        trains: !enabled
          ? trainsAt(rail, table, snapshotTimeS)
          : services.flatMap((s) => {
              const pose = trainPoseAt(rail, table, s.departure, s.cycle, s.ageS);
              if (pose && s.held) pose.speedMps = 0;
              return pose ? [pose] : [];
            }),
      };
    },
  };
}
