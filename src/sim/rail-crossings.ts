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
  /** TASK-211: run a settled vehicle's pass anyway and check that it changes nothing. TASK-237:
   * and check that the segment a caller passes is the vehicle's lane. */
  checkSkips = false,
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
  /** TASK-187: membership of `committed` by facility and vehicle, so that the per-vehicle passes
   * touch a set only to change it (the sets keep their order for `roadState`). */
  const facilityCount = facilities.length;
  /** TASK-237: by vehicle, then facility (`id * facilityCount + f`): a vehicle's flags share a
   * cache line, read together in its passes. */
  const committedFlags = new Uint8Array(vehicles.count * facilityCount);
  const commit = (f: number, id: number) => {
    const k = id * facilityCount + f;
    if (committedFlags[k]) return;
    committedFlags[k] = 1;
    committed[f]!.add(id);
  };
  const uncommit = (f: number, id: number) => {
    const k = id * facilityCount + f;
    if (!committedFlags[k]) return;
    committedFlags[k] = 0;
    committed[f]!.delete(id);
  };
  const railReady = new Uint8Array(facilities.length);
  const occupied = new Uint8Array(facilities.length);
  /** Per vehicle: 1 while its stop is a protected (closed or warning) crossing's and binds (a byte
   * each: `held` is asked for every driving car). */
  const holds = new Uint8Array(vehicles.count);
  /** Per vehicle at `id * 2` (TASK-237: one record, written for every car each step): its stop's
   * position and (TASK-222) the movement whose red stop line in the clear zone holds it, or -1. */
  const holdRecords = new Float64Array(vehicles.count * 2);
  for (let id = 0; id < vehicles.count; id++) holdRecords[id * 2 + 1] = -1;
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
  /** TASK-202: a lane whose movements all lead to one road continues an approach; any other lane
   * is a turn away from it, unless it carries the facility's own marking or span. */
  const through = Uint8Array.from(city.lanes, (lane) =>
    Number(new Set(lane.out.map((m) => city.lanes[city.movements[m]!.toLane]!.road)).size <= 1),
  );
  const onSegment = (b: number, facility: number) =>
    stopsBySegment[b]!.some((m) => m.facility === facility) ||
    spansBySegment[b]!.some((s) => s.facility === facility);
  /** Per vehicle in `roadOccupancy`: the facilities its body overlaps. */
  const bodyInside = new Uint8Array(facilities.length);
  /** TASK-176: a vehicle's path ahead and, per facility, its nearest stop marking and the extent
   * of its spans along it. TASK-187: the segments are kept while the vehicle's lane, movement,
   * route and route step stay the same (routes are replaced, never edited), walked on as the
   * vehicle moves up; the path at a position is their prefix up to the first segment ending more
   * than 600 m ahead. The ranges are kept while the position stays the same too: a standing queue,
   * and the hold after the occupancy pass in the same step, reuse them. `path` points `current`
   * and `segmentCount` at the vehicle's. TASK-237: the ranges read the position only by comparing
   * it with span ends and marking positions along the path, so they are also kept while the
   * vehicle moves up no farther than the nearest of those still ahead and the path's segment count
   * stays the same; the count changes only once the next segment's end comes within 600 m. What
   * these checks read is kept in `pathKeys`, one record per vehicle, so that a vehicle moving up
   * where neither changes reads no object. */
  type Path = {
    segments: number[];
    offsets: number[];
    /** Where each segment ends along the path. */
    segmentEnds: number[];
    /** The segments ending at most 600 m past `position`, which only grows while kept. */
    leading: number;
    /** The segments with a stop marking or span, by index. */
    markedAt: number[];
    /** TASK-202: per segment, how many lanes up to it turn away from an approach. */
    turns: number[];
    /** Where the walk goes on: its next segment and route step, or done. */
    nextSegment: number;
    nextStep: number;
    done: boolean;
    /** Per facility, its nearest stop marking, then the start and the end of its spans
     * (`f`, `facilityCount + f`, `2 * facilityCount + f`; TASK-237: one array). */
    range: Float64Array;
    /** TASK-202: per facility, whether the path from its first segment reaches one of the
     * facility's spans without turning away: the encounter a marking just passed guards. */
    live: Uint8Array;
  };
  const paths = Array<Path | undefined>(vehicles.count).fill(undefined);
  /** Per vehicle at `id * 8`: the path's lane, route step (-1: no path yet), first movement,
   * position and segment count; its ranges' state (`UNRANGED`, or found with a served facility's
   * span past the position or not: `AHEAD`, `CLEAR`); the end of the first segment not yet
   * counted (Infinity once the walk is done); and how far the ranges hold. The route is in
   * `pathRoutes`. */
  const pathKeys = new Float64Array(vehicles.count * 8);
  for (let id = 0; id < vehicles.count; id++) pathKeys[id * 8 + 1] = -1;
  const pathRoutes = Array<(typeof vehicles.route)[number] | undefined>(vehicles.count).fill(
    undefined,
  );
  const [LANE, STEP, MOVEMENT, POSITION, COUNT, RANGES, NEXT_END, RANGED_UNTIL] = [
    0, 1, 2, 3, 4, 5, 6, 7,
  ];
  const [UNRANGED, CLEAR, AHEAD] = [0, 1, 2];
  let current: Path | undefined,
    currentKey = 0,
    segmentCount = 0;
  const liveList: number[] = [];
  const liveFlags = new Uint8Array(facilities.length);
  function clearLive() {
    for (const f of liveList) liveFlags[f] = 0;
    liveList.length = 0;
  }
  /** Each vehicle's history: its segment and position at its last pass of `roadOccupancy` and
   * the segments its body trails back over. TASK-237: the segment and position are its settled
   * record's (`settledRecord`, which also says whether it has a history and the trail's length);
   * the trails are here, in the order first seen (`roadState`) and by vehicle. */
  const histories = new Map<number, number[]>();
  const trails = Array<number[] | undefined>(vehicles.count).fill(undefined);
  const setHistory = (id: number, trail: number[], segment: number, position: number) => {
    histories.set(id, trail);
    trails[id] = trail;
    settledRecord[id * 8 + 1] = segment;
    settledRecord[id * 8 + 2] = position;
    settledRecord[id * 8 + 7] = 1 + trail.length;
  };
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
  /** `lane`: the vehicle's segment (`vehicles.lane[id]`), which every caller has at hand. */
  function path(id: number, lane: number) {
    if (checkSkips && vehicles.lane[id] !== lane)
      throw new Error(`Vehicle ${id}: path asked off its segment`);
    const position = vehicles.position[id]!,
      routeStep = vehicles.routeStep[id]!,
      firstMovement = vehicles.movement[id]!,
      route = vehicles.route[id];
    const k = id * 8;
    currentKey = k;
    current = paths[id];
    const kept =
      pathKeys[k + STEP] === routeStep &&
      pathKeys[k + LANE] === lane &&
      pathKeys[k + MOVEMENT] === firstMovement &&
      pathRoutes[id] === route;
    const previous = pathKeys[k + POSITION]!;
    if (kept && position === previous) {
      segmentCount = pathKeys[k + COUNT]!;
      return;
    }
    const still = kept && position > previous && !(pathKeys[k + NEXT_END]! - position <= 600);
    if (still && !checkSkips) {
      // The walk below would count no further segment (under `debugSkips` it checks so).
      segmentCount = pathKeys[k + COUNT]!;
      pathKeys[k + POSITION] = position;
      if (!(position <= pathKeys[k + RANGED_UNTIL]!)) pathKeys[k + RANGES] = UNRANGED;
      return;
    }
    let entry = current;
    if (!entry) {
      entry = {
        segments: [],
        offsets: [],
        segmentEnds: [],
        leading: 0,
        markedAt: [],
        turns: [],
        nextSegment: lane,
        nextStep: routeStep,
        done: false,
        range: new Float64Array(3 * facilityCount),
        live: new Uint8Array(facilities.length),
      };
      paths[id] = current = entry;
    }
    const { segments, offsets } = entry;
    if (!kept) {
      pathKeys[k + LANE] = lane;
      pathKeys[k + STEP] = routeStep;
      pathKeys[k + MOVEMENT] = firstMovement;
      pathRoutes[id] = route;
      entry.nextSegment = lane;
      entry.nextStep = routeStep;
      entry.done = false;
      segments.length =
        offsets.length =
        entry.segmentEnds.length =
        entry.markedAt.length =
        entry.turns.length =
          0;
    }
    const ends = entry.segmentEnds;
    // The walk as it was done for each position: up to 128 segments, the last one the first that
    // ends more than 600 m ahead or the last the plan and route lead on to.
    const onward = kept && position >= previous;
    const ranged = onward && position <= pathKeys[k + RANGED_UNTIL]!;
    const previousCount = pathKeys[k + COUNT]!;
    let count = onward ? entry.leading : 0;
    pathKeys[k + POSITION] = position;
    while (count < segments.length && ends[count]! - position <= 600) count++;
    while (count === segments.length && !entry.done) {
      const segment = entry.nextSegment;
      const offset = segments.length ? ends[segments.length - 1]! : 0;
      if (marked[bucket(segment)]) entry.markedAt.push(segments.length);
      entry.turns.push((entry.turns.at(-1) ?? 0) + (segment >= 0 && !through[segment] ? 1 : 0));
      segments.push(segment);
      offsets.push(offset);
      ends.push(offset + segmentLength(segment));
      if (segments.length === 128) entry.done = true;
      else if (segment >= 0) {
        const movement =
          segments.length === 1 ? firstMovement : (route?.movements[entry.nextStep] ?? -1);
        if (movement === -1 || city.movements[movement]!.fromLane !== segment) entry.done = true;
        else entry.nextSegment = -movement - 1;
      } else {
        entry.nextSegment = city.movements[-segment - 1]!.toLane;
        entry.nextStep++;
      }
      if (ends[ends.length - 1]! - position <= 600) count++;
    }
    if (still && count !== entry.leading)
      throw new Error(`Vehicle ${id}: kept path count would change`);
    entry.leading = count;
    pathKeys[k + COUNT] = segmentCount = Math.min(count + 1, segments.length);
    pathKeys[k + NEXT_END] = count < segments.length ? ends[count]! : Infinity;
    if (!(ranged && segmentCount === previousCount)) pathKeys[k + RANGES] = UNRANGED;
  }
  function overlaps(f: number, segment: number, front: number, rear: number) {
    return spansBySegment[bucket(segment)]!.some(
      (s) => s.facility === f && front >= s.from && rear <= s.to,
    );
  }
  /** The current path's ranges from the vehicle's position. */
  function ranges() {
    const k = currentKey;
    if (pathKeys[k + RANGES] !== UNRANGED && !checkSkips) return;
    const entry = current!;
    const { segments, offsets, range: pathRange, live: pathLive } = entry;
    if (pathKeys[k + RANGES] !== UNRANGED) {
      // Under `debugSkips`, find them again and compare.
      const kept = [pathRange.slice(), pathLive.slice(), pathKeys[k + RANGES]];
      pathKeys[k + RANGES] = UNRANGED;
      ranges();
      if (
        kept[2] !== pathKeys[k + RANGES] ||
        (kept[0] as Float64Array).some((v, i) => v !== pathRange[i]) ||
        (kept[1] as Uint8Array).some((v, i) => v !== pathLive[i])
      )
        throw new Error(`Vehicle ${k / 8}: kept rail ranges differ`);
      return;
    }
    const position = pathKeys[k + POSITION]!;
    let until = Infinity;
    const startAt = facilityCount,
      endAt = 2 * facilityCount;
    pathRange.fill(Infinity, 0, endAt);
    pathRange.fill(-Infinity, endAt);
    let ahead = false;
    for (const s of entry.markedAt) {
      if (s >= segmentCount) break;
      const b = bucket(segments[s]!);
      const offset = offsets[s]!;
      for (const span of spansBySegment[b]!) {
        if (offset + span.to < position) continue;
        until = Math.min(until, offset + span.to);
        const f = span.facility;
        pathRange[startAt + f] = Math.min(pathRange[startAt + f]!, offset + span.from);
        pathRange[endAt + f] = Math.max(pathRange[endAt + f]!, offset + span.to);
        if (served[f]) ahead = true;
      }
    }
    pathKeys[k + RANGES] = ahead ? AHEAD : CLEAR;
    // TASK-202: a stop marking binds only for the encounter it guards on this path: a span of its
    // facility reached from it without turning away (through movements, lanes that lead on to one
    // road, and lanes with the facility's own marking or span). A marking for a turn the vehicle
    // does not take, met again from another approach further on, does not hold it back here.
    // Walked backward over the marked segments; the earliest bound marking is the stop.
    const turns = entry.turns;
    clearLive();
    let after = segmentCount;
    for (let k = entry.markedAt.length - 1; k >= 0; k--) {
      const s = entry.markedAt[k]!;
      if (s >= segmentCount) continue;
      if (after - 1 > s && turns[after - 1]! > turns[s]!) clearLive();
      after = s;
      const segment = segments[s]!,
        b = bucket(segment),
        offset = offsets[s]!;
      if (segment >= 0 && !through[segment] && liveList.length) {
        let kept = 0;
        for (const f of liveList)
          if (onSegment(b, f)) liveList[kept++] = f;
          else liveFlags[f] = 0;
        liveList.length = kept;
      }
      for (const marking of stopsBySegment[b]!) {
        const at = offset + marking.at;
        if (at < position - 1e-6) continue;
        until = Math.min(until, at);
        const f = marking.facility;
        if (
          liveFlags[f] ||
          spansBySegment[b]!.some(
            (span) => span.facility === f && span.to >= marking.at && offset + span.to >= position,
          )
        )
          pathRange[f] = Math.min(pathRange[f]!, at);
      }
      for (const span of spansBySegment[b]!)
        if (offset + span.to >= position && !liveFlags[span.facility]) {
          liveFlags[span.facility] = 1;
          liveList.push(span.facility);
        }
      if (s === 0) {
        pathLive.fill(0);
        for (const f of liveList) pathLive[f] = 1;
      }
      // A marking on a lane without the facility's span begins the encounter: one further back
      // guards another visit, if any.
      if (stopsBySegment[b]!.length && liveList.length) {
        let kept = 0;
        for (const f of liveList)
          if (
            !stopsBySegment[b]!.some((m) => m.facility === f) ||
            spansBySegment[b]!.some((span) => span.facility === f)
          )
            liveList[kept++] = f;
          else liveFlags[f] = 0;
        liveList.length = kept;
      }
    }
    if (after > 0) {
      if (turns[after - 1]! > 0) clearLive();
      pathLive.fill(0);
      for (const f of liveList) pathLive[f] = 1;
    }
    pathKeys[k + RANGED_UNTIL] = until;
  }
  const platoonLane = Uint8Array.from(city.lanes, (lane) =>
    Number(lane.left === -1 && lane.right === -1),
  );
  for (const space of city.parkingSpaces ?? []) platoonLane[space.lane] = 0;
  const walkStops = city.lanes.map(() => [] as number[]);
  const laneStops = Float64Array.from(city.lanes, (lane) => lane.stopM);
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

  /** TASK-211: what each vehicle's last pass of `roadOccupancy` read and marked. A vehicle with
   * the same segment, position, speed, movement, route and route step as in the pass just before
   * would repeat it exactly: its path and ranges are kept, no marking is passed (it has not
   * moved), its body covers the same spans, and the per-facility rules are idempotent on the
   * commitments that pass left (only `roadOccupancy` changes them, but for the dilemma commit in
   * `publish`, which clears the record). So it only marks the facilities it marked then. */
  let pass = 1;
  /** TASK-237: one record per vehicle (pass, segment, position, speed, route step, movement, whether
   * it marked any facility, and 0 without a history or 1 + its trail's length), so that the check
   * and the history read one cache line. */
  const settledRecord = new Float64Array(vehicles.count * 8);
  const settledRoute = Array<(typeof vehicles.route)[number]>(vehicles.count).fill(null);
  const markedBy = new Uint8Array(vehicles.count * facilityCount);
  const settledFlags = new Uint8Array(facilities.length);
  const settledMarks = new Uint8Array(facilities.length);
  function roadOccupancy() {
    occupied.fill(0);
    pass++;
    for (const b of vehicles.occupied) {
      if (!influences[b]) continue;
      const field = b < city.lanes.length ? b : city.lanes.length - b - 1;
      for (let id = vehicles.first(field); id !== -1; id = vehicles.next[id]!) {
        if (vehicles.state[id] !== DRIVING && vehicles.state[id] !== QUEUED_DESTINATION) continue;
        const position = vehicles.position[id]!;
        const speed = vehicles.speed[id]!;
        const r = id * 8;
        const settled =
          settledRecord[r] === pass - 1 &&
          settledRecord[r + 1] === field &&
          settledRecord[r + 2] === position &&
          settledRecord[r + 3] === speed &&
          settledRecord[r + 4] === vehicles.routeStep[id] &&
          settledRecord[r + 5] === vehicles.movement[id] &&
          settledRoute[id] === vehicles.route[id];
        if (settled && !checkSkips) {
          settledRecord[r] = pass;
          if (settledRecord[r + 6])
            for (let f = 0, k = id * facilityCount; f < facilityCount; f++, k++)
              if (markedBy[k]) occupied[f] = 1;
          continue;
        }
        if (settled)
          for (let f = 0; f < facilities.length; f++) {
            settledFlags[f] = committedFlags[id * facilityCount + f]!;
            settledMarks[f] = markedBy[id * facilityCount + f]!;
          }
        const tracked = settledRecord[r + 7]! > 0;
        const previousSegment = tracked ? settledRecord[r + 1]! : field;
        const previousPosition = tracked ? settledRecord[r + 2]! : -Infinity;
        let trailLength = tracked ? settledRecord[r + 7]! - 1 : 0;
        settledRecord[r] = pass;
        settledRecord[r + 1] = field;
        settledRecord[r + 2] = position;
        settledRecord[r + 3] = speed;
        settledRecord[r + 4] = vehicles.routeStep[id]!;
        settledRecord[r + 5] = vehicles.movement[id]!;
        settledRoute[id] = vehicles.route[id]!;
        let continuous = true;
        if (!tracked) setHistory(id, [], field, position);
        else if (previousSegment !== field) {
          continuous =
            previousSegment < 0
              ? city.movements[-previousSegment - 1]!.toLane === field
              : field < 0
                ? city.movements[-field - 1]!.fromLane === previousSegment
                : city.lanes[previousSegment]!.out.some(
                    (m) => city.movements[m]!.toLane === field && city.movements[m]!.lengthM === 0,
                  );
          const trail = trails[id]!;
          if (continuous) trail.unshift(previousSegment);
          else trail.length = 0;
          trailLength = trail.length;
        } else if (position < previousPosition - 1e-6) {
          if (trailLength) trails[id]!.length = 0;
          trailLength = 0;
          continuous = false;
        }
        if (!continuous) for (let f = 0; f < facilities.length; f++) uncommit(f, id);
        if (trailLength) {
          const trail = trails[id]!;
          let remaining = length(id) - position,
            keep = 0;
          while (remaining > 0 && keep < trail.length) remaining -= segmentLength(trail[keep++]!);
          if (keep < trail.length) trail.length = keep;
          trailLength = trail.length;
        }
        settledRecord[r + 7] = 1 + trailLength;
        path(id, field);
        ranges();
        // Without a served span ahead every facility's is at Infinity (`ranges`).
        const pathRange = pathKeys[currentKey + RANGES] === AHEAD ? current!.range : undefined;
        for (const marking of continuous ? stopsBySegment[bucket(previousSegment)]! : []) {
          const passed = field === previousSegment ? position > marking.at + 1e-6 : true;
          // TASK-202: only a marking for the encounter ahead commits the vehicle to it.
          if (
            passed &&
            previousPosition <= marking.at + 1e-6 &&
            (field === previousSegment
              ? current!.live[marking.facility]
              : spansBySegment[bucket(previousSegment)]!.some(
                  (s) => s.facility === marking.facility && s.to >= marking.at,
                ) ||
                (current!.live[marking.facility] &&
                  !(
                    field >= 0 &&
                    stopsBySegment[field]!.some((m) => m.facility === marking.facility) &&
                    !spansBySegment[field]!.some((s) => s.facility === marking.facility)
                  )))
          )
            commit(marking.facility, id);
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
          const actual = back < trailLength ? trails[id]![back] : undefined;
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
        let marking = 0;
        const row = id * facilityCount;
        const brake = profiles[vehicles.vclass[id]!]!.idm.bMps2;
        for (let f = 0; f < facilities.length; f++) {
          markedBy[row + f] = 0;
          if (!served[f]) continue;
          const stop = pathRange ? pathRange[f]! : Infinity,
            near = pathRange ? pathRange[facilityCount + f]! : Infinity;
          // An unmetered upstream vehicle can wait before the conflict if it can brake there.
          // Only an actual marked entry, a braking dilemma, or its physical body reserves rail.
          if (
            near < Infinity &&
            stop > near &&
            speed > 0.1 &&
            near - position < (speed * speed) / (2 * brake) + params.idm.minGapM
          )
            commit(f, id);
          const inside = bodyInside[f] === 1;
          if (inside) {
            occupied[f] = 1;
            commit(f, id);
          }
          if (speed < 0.1 && !inside && near > position + 1e-6) uncommit(f, id);
          if (committedFlags[row + f]) {
            if (near < Infinity || inside) occupied[f] = 1;
            else uncommit(f, id);
          }
          if (inside || (committedFlags[row + f] && near < Infinity)) {
            markedBy[row + f] = 1;
            marking = 1;
          }
        }
        settledRecord[r + 6] = marking;
        if (settled)
          for (let f = 0; f < facilities.length; f++)
            if (
              settledFlags[f] !== committedFlags[row + f] ||
              settledMarks[f] !== markedBy[row + f]
            )
              throw new Error(`Settled vehicle ${id} changed its pass at facility ${f}`);
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
          path(id, field);
          const { segments, offsets } = current!;
          let stop = Infinity;
          for (let s = 0; s < segmentCount; s++)
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
            commit(f, id);
            settledRecord[id * 8] = 0;
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
        setHistory(history.id, history.trail, history.segment, vehicles.position[history.id]!);
    for (let f = 0; f < facilities.length; f++) {
      const previous = roadState.admissions.find(
        (a) =>
          a.nodes.length === facilities[f]!.nodes.length &&
          a.nodes.every((n) => facilities[f]!.nodes.includes(n)),
      );
      if (previous) for (const id of previous.ids) if (histories.has(id)) commit(f, id);
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
  /** TASK-228: per route, its occupancy by track (`TrainRoute.occupancy`, one entry per section),
   * and whether two routes run a shared track in opposite directions (a route that turns back at a
   * terminal runs each of its tracks both ways). */
  const occupancyByTrack = table.routes.map((route) => {
    const byTrack = new Map<number, { enterS: number; exitS: number; forward: boolean }[]>();
    route.occupancy.forEach((o, i) => {
      const list = byTrack.get(o.track) ?? [];
      list.push({ enterS: o.enterS, exitS: o.exitS, forward: route.sections[i]!.forward });
      byTrack.set(o.track, list);
    });
    return byTrack;
  });
  const opposes = table.routes.map((a, i) =>
    table.routes.map((b, j) =>
      [...occupancyByTrack[i]!].some(([track, mine]) =>
        occupancyByTrack[j]!.get(track)?.some(
          (theirs) =>
            a.terminal !== undefined ||
            b.terminal !== undefined ||
            mine.some((m) => m.forward !== theirs.forward),
        ),
      ),
    ),
  );
  /** The services in service behind their timetable at the start of the step, and whether each
   * was standing (held) then. */
  const delayed: number[] = [];
  const delayedStanding: boolean[] = [];
  /** TASK-228: whether a service about to enter at `ageS` on `route` waits for the delayed service
   * `delayed[k]`. As before TASK-228, it waits for a delayed run of its own route, and for one on
   * a route running a shared track in the opposite direction, since the two could meet head on.
   * For any other route it waits only when, on the delayed service's clock, the delayed one would
   * still hold a shared track while the entering one is on it: the timetable's own check
   * (`buildTimetable`) on live clocks. A delayed service standing still holds every shared track
   * still ahead of it without end, since when it moves again is not known. Before, one delayed
   * tram held every unstarted run of every route sharing any of its tracks until it left the map,
   * and the runs it held, late in turn, held the next ones (Freiburg's backlog). */
  function waitsFor(k: number, route: number, ageS: number) {
    const other = services[delayed[k]!]!;
    const theirs = table.departures[other.departure]!.route;
    if (theirs === route || opposes[theirs]![route]) return true;
    const mine = occupancyByTrack[route]!;
    for (const o of table.routes[theirs]!.occupancy) {
      if (o.exitS <= other.ageS) continue;
      const exitS = delayedStanding[k] ? Infinity : o.exitS - other.ageS;
      for (const m of mine.get(o.track) ?? [])
        if (m.enterS - ageS < exitS && m.exitS - ageS > o.enterS - other.ageS) return true;
    }
    return false;
  }
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
      delayed.length = 0;
      delayedStanding.length = 0;
      for (let i = 0; i < services.length; i++) {
        const service = services[i]!;
        tracksAt(service, service.ageS, service.current);
        tracksAt(service, service.ageS + params.dtS, service.proposed);
        for (const track of service.current) trackOwners[track] = i;
        const departure = table.departures[service.departure]!;
        if (
          service.current.length &&
          timeS - departure.timeS - service.cycle * table.periodS - service.ageS > params.dtS
        ) {
          delayed.push(i);
          delayedStanding.push(service.held);
        }
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
        // A delayed train keeps its physical track reservation; following/opposing services
        // wait before their nose enters it. Other routes retain their own clocks.
        const trackHeld =
          service.proposed.some(
            (track) =>
              (trackOwners[track] !== -1 && trackOwners[track] !== i) || nextOwners[track] !== -1,
          ) ||
          (!service.current.length &&
            service.proposed.length > 0 &&
            delayed.some((_, k) => waitsFor(k, route, service.ageS)));
        // TASK-225: a service standing still for its track (or before it enters the map) does
        // not keep a crossing it has not reached closed; a fresh warning runs when it moves.
        events[route]!.forEach((event, index) => {
          if (
            service.ageS < event.enterS &&
            service.ageS >= event.enterS - event.warningS &&
            ((blocked && event.facility !== blocked.facility && event.enterS > blocked.enterS) ||
              (trackHeld && next < event.enterS - params.dtS))
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
        if (!service.held) service.held = trackHeld;
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
    /** `field`: the vehicle's segment (TASK-237: the engine's following pass has it at hand). */
    hold(id: number, field = vehicles.lane[id]!) {
      const h = id * 2;
      holds[id] = 0;
      holdRecords[h] = Infinity;
      holdRecords[h + 1] = -1;
      if (checkSkips && vehicles.lane[id] !== field)
        throw new Error(`Vehicle ${id}: hold asked off its segment`);
      if (field < -city.movements.length || !influences[bucket(field)]) return Infinity;
      path(id, field);
      ranges();
      // TASK-237: without a served facility's span ahead on the path, no stop below binds.
      if (pathKeys[currentKey + RANGES] !== AHEAD) return Infinity;
      const { segments, offsets, range: pathRange } = current!;
      const position = vehicles.position[id]!;
      const row = id * facilityCount;
      let best = Infinity;
      let protectedStop = false;
      for (let f = 0; f < facilityCount; f++) {
        if (!served[f]) continue;
        if (committedFlags[row + f]) continue;
        const near = pathRange[facilityCount + f]!,
          end = pathRange[2 * facilityCount + f]!,
          marked = pathRange[f]!;
        const stop = marked <= near ? marked : Math.max(position, near - params.idm.minGapM);
        if (stop === Infinity || end < stop || stop >= best) continue;
        let blocked = states[f] !== CROSSING_OPEN;
        let redLine = -1;
        const clear = end + length(id) + params.idm.minGapM;
        if (!blocked)
          for (let s = 0; s < segmentCount; s++) {
            const segment = segments[s]!,
              offset = offsets[s]!;
            if (offset > clear) break;
            // The nearest car ahead. On its own segment the list is ordered (vehicle.ts): the cars
            // behind it stand no farther on, so the search starts at it (TASK-187).
            // TASK-237: once blocked, only the first red line can still change the outcome.
            if (!blocked) {
              let tail = s === 0 ? vehicles.previous[id]! : vehicles.last(segment);
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
            }
            if (segment >= 0 && s + 1 < segmentCount) {
              const next = segments[s + 1]!;
              const line = offset + laneStops[segment]!;
              if (next < 0 && line > stop && line < clear && red(-next - 1)) {
                blocked = true;
                redLine = -next - 1;
                break;
              }
            }
          }
        if (blocked) {
          best = stop;
          protectedStop = states[f] !== CROSSING_OPEN;
          holdRecords[h + 1] = redLine;
        }
      }
      holds[id] = Number(protectedStop);
      holdRecords[h] = best;
      return best;
    },
    /** TASK-222: the movement whose red stop line, inside the clear zone beyond the tracks, held
     * `id` at its last `hold`, or -1. */
    holdRed: (id: number) => holdRecords[id * 2 + 1]!,
    binding(id: number, binding: boolean) {
      if (!binding) holds[id] = 0;
    },
    blocksExit: (id: number, lengthM: number) => holdRecords[id * 2]! <= lengthM + 1e-6,
    held: (id: number) =>
      !!holds[id] &&
      vehicles.speed[id]! < 0.1 &&
      Math.abs(vehicles.position[id]! - holdRecords[id * 2]!) < 0.5,
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
      for (const [id, previousTrail] of histories) {
        const at = settledRecord[id * 8 + 1]!;
        const segment = remap(at);
        if (segment === undefined || (at >= 0 && segment === -1)) continue;
        const trail: number[] = [];
        for (const previous of previousTrail) {
          const mapped = remap(previous);
          if (mapped === undefined || (previous >= 0 && mapped === -1)) break;
          trail.push(mapped);
        }
        result.histories.push({ id, segment, trail, position: settledRecord[id * 8 + 2]! });
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
