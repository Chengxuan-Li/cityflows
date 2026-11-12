import { signalStateAt, type CMovement, type CompiledCity } from '../network';
import { railTimetable } from '../network/trams';
import type { SimParams } from '../schema';
import { idmAcceleration } from './idm';
import { createVehicleProfiles, DRIVING, type Vehicles } from './vehicle';

type Path = { entry: number; exit: number; facility: number; stop: number; end: number };
type Claim = {
  path: Path;
  route: NonNullable<Vehicles['route'][number]>;
  prefix: number;
  clear: number;
  expires: number;
};

/** An optional, bounded exclusion of rivals; ordinary movement grants still authorize travel. */
export function createCompactClaims(
  city: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  options: {
    grants: Int32Array;
    continuations: boolean[];
    nextMovement: (id: number, lane: number, step: number) => number;
    available: (id: number) => boolean;
  },
) {
  const profiles = createVehicleProfiles(params),
    maxLength = Math.max(...profiles.map((p) => p.lengthM));
  const profile = (id: number) => profiles[vehicles.vclass[id]!]!;
  const candidates = city.movements.map(() => [] as Path[]);
  const claims = new Map<number, Claim>();
  const table = city.rail && railTimetable(city.rail);
  const facilities = city.rail?.facilities ?? [];
  const served = facilities.map(
    (f) =>
      table?.departures.some((d) =>
        table.routes[d.route]!.sections.some((s) =>
          f.railSpans?.some((span) => span.track === s.track),
        ),
      ) ?? false,
  );
  let timeS = 0;

  for (const entry of city.movements) {
    const compact = city.lanes[entry.toLane]!,
      group = city.nodes[entry.node]!.group;
    if (group === undefined || compact.lengthM > maxLength + params.idm.minGapM) continue;
    for (const index of compact.out) {
      const exit = city.movements[index]!;
      if (
        city.nodes[exit.node]!.group !== group ||
        exit.neverGreen ||
        exit.turnOnRed ||
        exit.turn === 'merge'
      )
        continue;
      const control = city.nodes[exit.node]!.control;
      if (control === 'stop' || control === 'yield') continue;
      const from = city.lanes[entry.fromLane]!,
        receiver = city.lanes[exit.toLane]!;
      if ([...compact.in, ...receiver.in].some((m) => options.continuations[m])) continue;
      const offsets = new Map([
        [entry.fromLane, -from.lengthM],
        [-entry.idx - 1, 0],
        [compact.idx, entry.lengthM],
        [-exit.idx - 1, entry.lengthM + compact.lengthM],
        [receiver.idx, entry.lengthM + compact.lengthM + exit.lengthM],
      ]);
      facilities.forEach((facility, f) => {
        if (!served[f] || !facility.spans?.some((s) => s.segment === compact.idx)) return;
        const stop = facility.stops?.find((s) => s.lane === from.idx)?.stopM;
        if (stop === undefined) return;
        const spans = facility.spans.filter((s) => offsets.has(s.segment));
        const end = Math.max(...spans.map((s) => offsets.get(s.segment)! + s.toM));
        const start = stop - from.lengthM,
          clear = end + maxLength + params.idm.minGapM;
        if (end < entry.lengthM || end >= offsets.get(receiver.idx)! + receiver.lengthM - maxLength)
          return;
        // A new access manoeuvre must not be able to fill the reserved prefix from inside it.
        const prefix = Math.max(maxLength + params.idm.minGapM, clear - offsets.get(receiver.idx)!);
        if (
          receiver.connectors.some((c) => city.connectors[c]!.positionM - maxLength < prefix) ||
          city.parkingSpaces?.some(
            (p) => p.lane === receiver.idx && p.positionM - maxLength < prefix,
          )
        )
          return;
        if (compact.connectors.length || city.parkingSpaces?.some((p) => p.lane === compact.idx))
          return;
        if (
          city.walk.links.some((l) =>
            l.crossing?.spans.some(
              (s) =>
                offsets.has(s.lane) &&
                offsets.get(s.lane)! + s.atM + s.halfM > start &&
                offsets.get(s.lane)! + s.atM - s.halfM < clear,
            ),
          )
        )
          return;
        if (
          facilities.some(
            (other, o) =>
              o !== f &&
              served[o] &&
              other.spans?.some(
                (s) =>
                  offsets.has(s.segment) &&
                  offsets.get(s.segment)! + s.toM > start &&
                  offsets.get(s.segment)! + s.fromM < clear,
              ),
          )
        )
          return;
        candidates[entry.idx]!.push({ entry: entry.idx, exit: exit.idx, facility: f, stop, end });
      });
    }
  }

  function progress(id: number, path: Path) {
    const a = city.movements[path.entry]!,
      b = city.movements[path.exit]!,
      field = vehicles.lane[id]!,
      at = vehicles.position[id]!;
    if (field === a.fromLane) return at - city.lanes[field]!.lengthM;
    if (field === -a.idx - 1) return at;
    if (field === a.toLane) return a.lengthM + at;
    if (field === -b.idx - 1) return a.lengthM + city.lanes[a.toLane]!.lengthM + at;
    if (field === b.toLane) return a.lengthM + city.lanes[a.toLane]!.lengthM + b.lengthM + at;
    return Infinity;
  }

  function greenRemaining(m: CMovement) {
    const signal = city.nodes[m.node]!.signal;
    if (!signal) return Infinity;
    const at = signalStateAt(signal, timeS);
    if (at.state !== 'green' || !signal.phases[at.phase]!.movements.includes(m.idx)) return 0;
    let elapsed = (((timeS + signal.offsetS) % signal.cycleS) + signal.cycleS) % signal.cycleS;
    for (let i = 0; i < at.phase; i++)
      elapsed -= signal.phases[i]!.durationS + signal.amberS + signal.allRedS;
    return signal.phases[at.phase]!.durationS - elapsed;
  }

  function allowsLane(id: number, lane: number, position: number, length: number) {
    for (const [owner, claim] of claims) {
      if (id === owner) continue;
      const entry = city.movements[claim.path.entry]!,
        exit = city.movements[claim.path.exit]!;
      if (exit.toLane === lane && position - length < claim.prefix) return false;
      if (
        entry.toLane === lane &&
        progress(owner, claim.path) - profile(owner).lengthM <
          entry.lengthM + city.lanes[lane]!.lengthM
      )
        return false;
    }
    return true;
  }

  function allowsMovement(id: number, movement: CMovement) {
    if (!allowsLane(id, movement.toLane, 0, profile(id).lengthM)) return false;
    for (const [owner, claim] of claims) {
      if (id === owner) continue;
      const p = progress(owner, claim.path) - profile(owner).lengthM;
      for (const idx of [claim.path.entry, claim.path.exit]) {
        const protectedMove = city.movements[idx]!,
          i = protectedMove.conflicts.indexOf(movement.idx);
        if (i < 0) continue;
        const offset =
          idx === claim.path.entry
            ? 0
            : city.movements[claim.path.entry]!.lengthM +
              city.lanes[protectedMove.fromLane]!.lengthM;
        if (p < offset + protectedMove.conflictZones[i]![1]) return false;
      }
    }
    return true;
  }

  function secure(id: number, entry: CMovement) {
    if (claims.has(id) || !candidates[entry.idx]!.length || !options.available(id)) return;
    const route = vehicles.route[id];
    if (!route || vehicles.state[id] !== DRIVING || vehicles.lane[id] !== entry.fromLane) return;
    const own = profile(id),
      compact = city.lanes[entry.toLane]!;
    const next = options.nextMovement(id, compact.idx, vehicles.routeStep[id]! + 1);
    const path = candidates[entry.idx]!.find((p) => p.exit === next);
    if (!path || Math.abs(vehicles.position[id]! - path.stop) > params.idm.minGapM + 1) return;
    const exit = city.movements[next]!,
      receiver = city.lanes[exit.toLane]!;
    const clear = path.end + own.lengthM + params.idm.minGapM;
    const exitOffset = entry.lengthM + compact.lengthM + exit.lengthM;
    const prefix = Math.max(own.lengthM + params.idm.minGapM, clear - exitOffset);
    if (clear <= entry.lengthM + compact.lengthM || prefix > receiver.lengthM) return;
    if (!allowsMovement(id, entry) || !allowsMovement(id, exit)) return;
    const fields = [-entry.idx - 1, compact.idx, -exit.idx - 1];
    if (fields.some((field) => vehicles.first(field) !== -1)) return;
    for (let ahead = vehicles.first(entry.fromLane); ahead !== -1; ahead = vehicles.next[ahead]!) {
      if (ahead === id) break;
      return;
    }
    const tail = vehicles.last(receiver.idx);
    if (tail !== -1 && vehicles.position[tail]! - profile(tail).lengthM < prefix) return;
    // Existing grants, including holders not yet on their movement, have priority.
    const relevant = new Set([
      ...compact.in,
      ...receiver.in,
      ...entry.conflicts,
      ...exit.conflicts,
    ]);
    for (const idx of relevant) {
      const m = city.movements[idx]!;
      if (vehicles.first(-idx - 1) !== -1) return;
      for (let other = vehicles.first(m.fromLane); other !== -1; other = vehicles.next[other]!)
        if (other !== id && options.grants[other] === idx) return;
      const rear = vehicles.last(m.toLane);
      if (
        (entry.conflicts.includes(idx) || exit.conflicts.includes(idx)) &&
        rear !== -1 &&
        m.lengthM + vehicles.position[rear]! - profile(rear).lengthM < m.lengthM
      )
        return;
    }
    const cap =
      Math.min(
        city.lanes[entry.fromLane]!.speedLimitMps,
        compact.speedLimitMps,
        receiver.speedLimitMps,
      ) * vehicles.speedFactor[id]!;
    const desired = Math.min(cap, own.maxSpeedMps),
      distance = clear - progress(id, path);
    const smallestGap = exitOffset + prefix - clear;
    let duration = Infinity;
    // Below this speed acceleration has a positive lower bound even against a stationary tail.
    // Allow a restart at each ordinary grant; no future vehicle motion is borrowed.
    for (let n = 1; n <= 8; n++) {
      const speed = (desired * n) / 16,
        a = idmAcceleration(own.idm, speed, desired, 0, smallestGap);
      if (a > 0) duration = Math.min(duration, distance / speed + (2 * speed) / a + 4 * params.dtS);
    }
    const horizon = Math.min(greenRemaining(entry), greenRemaining(exit));
    if (!Number.isFinite(duration) || duration >= horizon) return;
    claims.set(id, { path, route, prefix, clear, expires: timeS + duration });
  }

  return {
    secure,
    allowsMovement,
    allowsLane,
    held: (id: number) => claims.has(id),
    cancel: (id: number) => {
      claims.delete(id);
    },
    update(nowS: number) {
      timeS = nowS;
      for (const [id, claim] of claims) {
        const p = progress(id, claim.path);
        const compact = city.movements[claim.path.entry]!.toLane;
        if (
          vehicles.state[id] !== DRIVING ||
          vehicles.route[id] !== claim.route ||
          p >= claim.clear ||
          nowS >= claim.expires ||
          (vehicles.lane[id] === compact && vehicles.movement[id] !== claim.path.exit) ||
          (p < 0 && (!options.available(id) || vehicles.movement[id] !== claim.path.entry))
        )
          claims.delete(id);
      }
    },
  };
}
