import { headingAtDistance, nearestOnPolyline, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { RailGraph } from './rail';

export const trainDefaults = {
  sbahn: { headwayS: 240, lengthM: 135, speedMps: 80 / 3.6 },
  mainline: { headwayS: 360, lengthM: 200, speedMps: 100 / 3.6 },
  accelerationMps2: 0.8,
  dwellS: 40,
  carLengthM: 25,
};
export type TrainKind = 'sbahn' | 'mainline';
type Section = { track: number; forward: boolean; startM: number; endM: number };
type Phase = {
  timeS: number;
  durationS: number;
  positionM: number;
  speedMps: number;
  acceleration: number;
};
export interface TrainRoute {
  terminal?: number;
  turnaroundS?: number;
  id: string;
  from: number;
  to: number;
  kind: TrainKind;
  sections: Section[];
  lengthM: number;
  stops: { platform: string; name: string; positionM: number; arrivalS: number }[];
  phases: Phase[];
  durationS: number;
  occupancy: { track: number; enterS: number; exitS: number }[];
}
export interface TrainTimetable {
  routes: TrainRoute[];
  periodS: number;
  departures: { route: number; timeS: number; requestedS: number }[];
  unused: string[];
  hash: string;
}
export interface TrainTrackPose extends Vec2 {
  heading: number;
  track: number;
  trackM: number;
}
export interface TrainCar extends TrainTrackPose {
  lengthM: number;
  front: TrainTrackPose;
  rear: TrainTrackPose;
}
export interface TrainPose {
  id: string;
  route: number;
  kind: TrainKind;
  positionM: number;
  speedMps: number;
  centre: Vec2;
  cars: TrainCar[];
  occupied: number[];
  next: string;
}

function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Untagged paired running lines use the right-hand track in the local y-south frame. */
function directions(rail: RailGraph) {
  return rail.tracks.map((t) => {
    if (t.preferredDirection && t.preferredDirection !== 'both') return t.preferredDirection;
    if (t.service || t.lengthM < 25) return 'both';
    const p = pointAtDistance(t.line, t.cumulative, t.lengthM / 2);
    const heading = headingAtDistance(t.line, t.cumulative, t.lengthM / 2);
    let nearest = 12,
      side = 0;

    for (const other of rail.tracks) {
      if (
        other === t ||
        other.service ||
        other.layer !== t.layer ||
        other.kind !== t.kind ||
        other.lengthM < 25
      )
        continue;

      const q = nearestOnPolyline(other.line, p);
      if (q.away < 2 || q.away >= nearest || q.along < 1 || q.along > other.lengthM - 1) continue;
      const angle = headingAtDistance(other.line, other.cumulative, q.along);
      if (Math.abs(Math.cos(angle - heading)) < 0.97) continue;
      nearest = q.away;
      side = Math.cos(heading) * (q.point.y - p.y) - Math.sin(heading) * (q.point.x - p.x);
    }
    return side > 0 ? 'backward' : side < 0 ? 'forward' : 'both';
  });
}

function routesFor(rail: RailGraph): TrainRoute[] {
  const allowed = directions(rail);
  const adjacency = new Map<string, number[]>();
  for (const c of rail.connections) {
    const key = `${c.node}/${c.from}`;
    const list = adjacency.get(key) ?? [];
    list.push(c.to);
    adjacency.set(key, list);
  }

  const routes: TrainRoute[] = [];
  for (const origin of rail.nodes.filter((n) => n.boundary)) {
    // Dijkstra over oriented sections, never a node-only search (which could reverse at a switch).
    const queue: {
      track: number;
      forward: boolean;
      cost: number;
      path: { track: number; forward: boolean }[];
    }[] = [];
    const push = (
      track: number,
      node: number,
      cost: number,
      path: { track: number; forward: boolean }[],
    ) => {
      const t = rail.tracks[track]!,
        forward = t.fromNode === node;
      if (
        t.kind === 'tram' ||
        (t.preferredDirection &&
          t.preferredDirection !== 'both' &&
          t.preferredDirection !== (forward ? 'forward' : 'backward'))
      )
        return;
      if (path.some((s) => s.track === track)) return;
      queue.push({
        track,
        forward,
        cost:
          cost +
          t.lengthM *
            (allowed[track] !== 'both' && allowed[track] !== (forward ? 'forward' : 'backward')
              ? 100
              : 1) +
          (t.service ? 100000 : 0),
        path: [...path, { track, forward }],
      });
    };
    for (const i of origin.tracks) push(i, origin.idx, 0, []);
    const seen = new Set<string>();
    let terminalRoute: TrainRoute | undefined,
      through = false;
    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost || a.track - b.track);
      const step = queue.shift()!,
        key = `${step.track}/${step.forward}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const t = rail.tracks[step.track]!,
        node = step.forward ? t.toNode : t.fromNode;
      if (
        node !== origin.idx &&
        (rail.nodes[node]!.boundary || rail.nodes[node]!.kind === 'buffer_stop')
      ) {
        const wrong = step.path.reduce(
          (sum, s) =>
            sum +
            (allowed[s.track] !== 'both' &&
            allowed[s.track] !== (s.forward ? 'forward' : 'backward')
              ? rail.tracks[s.track]!.lengthM
              : 0),
          0,
        );
        const total = step.path.reduce((sum, s) => sum + rail.tracks[s.track]!.lengthM, 0);
        if (wrong > total * 0.15) continue;
        let lengthM = 0;
        const sections = step.path.map((s) => {
          const startM = lengthM;
          lengthM += rail.tracks[s.track]!.lengthM;
          return { ...s, startM, endM: lengthM };
        });
        const stops = rail.platforms
          .filter(
            (p) =>
              p.mode === 'rail' &&
              p.station &&
              sections.some((s) => p.tracks.includes(rail.tracks[s.track]!.id)),
          )
          .map((p) => {
            const points =
              p.shape.kind === 'point'
                ? [p.shape.pos]
                : p.shape.kind === 'line'
                  ? p.shape.line
                  : p.shape.ring.slice(0, -1);
            const centre = {
              x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
              y: (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2,
            };
            const candidates = sections
              .filter((s) => p.tracks.includes(rail.tracks[s.track]!.id))
              .map((s) => {
                const track = rail.tracks[s.track]!,
                  q = nearestOnPolyline(track.line, centre);
                return {
                  away: q.away,
                  positionM: s.startM + (s.forward ? q.along : track.lengthM - q.along),
                };
              })
              .sort((a, b) => a.away - b.away);
            return {
              platform: p.id,
              name: p.name,
              positionM: candidates[0]!.positionM,
              arrivalS: 0,
            };
          })
          .sort((a, b) => a.positionM - b.positionM);
        const kind = stops.length ? 'sbahn' : 'mainline';
        const route: TrainRoute = {
          id: `train:${origin.id}>${rail.nodes[node]!.id}`,
          from: origin.idx,
          to: node,
          kind,
          sections,
          lengthM,
          stops,
          phases: [],
          durationS: 0,
          occupancy: [],
        };
        if (rail.nodes[node]!.kind === 'buffer_stop') {
          if (
            lengthM <= trainDefaults[kind].lengthM ||
            step.path.some(
              (s) =>
                rail.tracks[s.track]!.preferredDirection &&
                rail.tracks[s.track]!.preferredDirection !== 'both',
            )
          )
            continue;
          route.terminal = node;
          route.to = origin.idx;
          if (!terminalRoute) {
            motion(rail, route);
            terminalRoute = route;
          }
          continue;
        }
        motion(rail, route);
        through = true;
        routes.push(route);
        break;
      }
      for (const next of adjacency.get(`${node}/${step.track}`) ?? [])
        push(next, node, step.cost, step.path);
    }
    if (!through && terminalRoute) routes.push(terminalRoute);
  }
  const used = new Set<string>();
  const throughRoutes = routes.filter((r) => r.terminal === undefined);
  const services = throughRoutes.length ? throughRoutes : routes;
  return services
    .sort(
      (a, b) =>
        Number(b.kind === 'sbahn') - Number(a.kind === 'sbahn') ||
        b.lengthM - a.lengthM ||
        a.id.localeCompare(b.id),
    )
    .filter((r) => {
      if (r.sections.some((s) => used.has(`${s.track}/${s.forward}`))) return false;
      for (const s of r.sections) used.add(`${s.track}/${s.forward}`);
      return true;
    });
}

function motion(rail: RailGraph, route: TrainRoute) {
  const defaults = trainDefaults[route.kind],
    half = defaults.lengthM / 2,
    a = trainDefaults.accelerationMps2;
  const endM = route.terminal === undefined ? route.lengthM + half : route.lengthM - half;
  const marks = [
    ...new Set([
      -half,
      endM,
      ...route.sections.flatMap((s) => [s.startM, s.endM]),
      ...route.stops.map((s) => s.positionM),
    ]),
  ]
    .filter((p) => p <= endM)
    .sort((a, b) => a - b);
  const limit = (s: Section) => rail.tracks[s.track]!.maxSpeedMps ?? defaults.speedMps;
  const speeds = marks.map((p) =>
    (route.terminal !== undefined && p === endM) || route.stops.some((s) => s.positionM === p)
      ? 0
      : Math.min(
          ...route.sections.filter((s) => p >= s.startM && p <= s.endM).map(limit),
          p < 0
            ? limit(route.sections[0]!)
            : p > route.lengthM
              ? limit(route.sections.at(-1)!)
              : Infinity,
        ),
  );
  for (let i = 1; i < marks.length; i++)
    speeds[i] = Math.min(
      speeds[i]!,
      Math.sqrt(speeds[i - 1]! ** 2 + 2 * a * (marks[i]! - marks[i - 1]!)),
    );
  for (let i = marks.length - 2; i >= 0; i--)
    speeds[i] = Math.min(
      speeds[i]!,
      Math.sqrt(speeds[i + 1]! ** 2 + 2 * a * (marks[i + 1]! - marks[i]!)),
    );
  let timeS = 0;
  const add = (positionM: number, speedMps: number, acceleration: number, durationS: number) => {
    if (durationS > 1e-9) {
      route.phases.push({ timeS, durationS, positionM, speedMps, acceleration });
      timeS += durationS;
    }
  };
  for (let i = 0; i < marks.length - 1; i++) {
    const x = marks[i]!,
      end = marks[i + 1]!,
      u = speeds[i]!,
      v = speeds[i + 1]!;
    const stop = route.stops.find((s) => s.positionM === x);
    if (stop) {
      stop.arrivalS = timeS;
      add(x, 0, 0, trainDefaults.dwellS);
    }
    const section =
      route.sections.find((s) => (x + end) / 2 >= s.startM && (x + end) / 2 <= s.endM) ??
      (x < 0 ? route.sections[0]! : route.sections.at(-1)!);
    const peak = Math.min(limit(section), Math.sqrt(a * (end - x) + (u * u + v * v) / 2));
    const up = Math.max(0, (peak * peak - u * u) / (2 * a)),
      down = Math.max(0, (peak * peak - v * v) / (2 * a));
    add(x, u, a, (peak - u) / a);
    add(x + up, peak, 0, Math.max(0, end - x - up - down) / peak);
    add(end - down, peak, -a, (peak - v) / a);
  }
  if (route.terminal !== undefined) {
    const outward = [...route.phases];
    route.turnaroundS = timeS;
    add(endM, 0, 0, trainDefaults.dwellS);
    for (const p of outward.reverse()) {
      const at = p.positionM + p.speedMps * p.durationS + 0.5 * p.acceleration * p.durationS ** 2;
      add(at, -(p.speedMps + p.acceleration * p.durationS), p.acceleration, p.durationS);
    }
  }
  route.durationS = timeS;
  if (route.terminal !== undefined)
    route.stops.push(
      ...route.stops.map((s) => ({ ...s, arrivalS: timeS - s.arrivalS - trainDefaults.dwellS })),
    );
  route.stops.sort((a, b) => a.arrivalS - b.arrivalS);
  route.occupancy = route.sections.map((s) => ({
    track: s.track,
    enterS: timeAt(route, s.startM - half),
    exitS:
      route.terminal !== undefined
        ? timeS - timeAt(route, s.startM - half)
        : timeAt(route, s.endM + half, true),
  }));
}

function timeAt(route: TrainRoute, positionM: number, last = false) {
  const outward = route.phases.filter(
    (p) => route.turnaroundS === undefined || p.timeS < route.turnaroundS,
  );
  const phases = last ? [...outward].reverse() : outward;
  for (const p of phases) {
    const end = p.positionM + p.speedMps * p.durationS + 0.5 * p.acceleration * p.durationS ** 2;
    if (positionM < p.positionM - 1e-7 || positionM > end + 1e-7) continue;
    if (p.speedMps === 0 && p.acceleration === 0) return p.timeS + (last ? p.durationS : 0);
    const speed = Math.sqrt(
      Math.max(0, p.speedMps ** 2 + 2 * p.acceleration * (positionM - p.positionM)),
    );
    return (
      p.timeS +
      (Math.abs(p.acceleration) > 0
        ? (speed - p.speedMps) / p.acceleration
        : (positionM - p.positionM) / p.speedMps)
    );
  }
  throw Error(`Position outside train motion: ${positionM}`);
}

/** A periodic reservation table includes the entire body and both sides of the cycle seam.
 * A conflicting departure waits outside the map; no in-map waiting or frame history is needed. */
export function buildTimetable(rail: RailGraph): TrainTimetable {
  const routes = routesFor(rail);
  let periodS = 720;
  let departures: TrainTimetable['departures'];
  for (;;) {
    departures = [];
    const reservations: { enter: number; exit: number }[][] = rail.tracks.map(() => []);
    const requests = routes
      .flatMap((r, route) => {
        const headway = trainDefaults[r.kind].headwayS,
          offset = parseInt(hash(r.id), 16) % headway;
        return Array.from({ length: 720 / headway }, (_, i) => ({
          route,
          requestedS: offset + i * headway,
        }));
      })
      .sort((a, b) => a.requestedS - b.requestedS || a.route - b.route);
    let fits = true;
    for (const request of requests) {
      const route = routes[request.route]!;
      let start = request.requestedS;
      for (;;) {
        let next = start;
        for (const block of route.occupancy) {
          if (block.exitS - block.enterS >= periodS) {
            next = Infinity;
            break;
          }
          const enter = start + block.enterS,
            exit = start + block.exitS;
          for (const other of reservations[block.track]!) {
            const cycle = Math.floor((enter - other.enter) / periodS);
            for (const k of [cycle - 1, cycle, cycle + 1])
              if (
                enter < other.exit + k * periodS + 0.01 &&
                exit > other.enter + k * periodS - 0.01
              )
                next = Math.max(next, other.exit + k * periodS + 0.02 - block.enterS);
          }
        }
        if (next === start) break;
        start = next;
        if (start >= periodS) {
          fits = false;
          break;
        }
      }
      if (!fits) break;
      departures.push({ ...request, timeS: start });
      for (const block of route.occupancy)
        reservations[block.track]!.push({ enter: start + block.enterS, exit: start + block.exitS });
    }
    if (fits) break;
    periodS += 720;
  }
  const used = new Set(routes.flatMap((r) => r.sections.map((s) => s.track)));
  const table = {
    routes,
    periodS,
    departures,
    unused: rail.tracks.filter((t) => !used.has(t.idx)).map((t) => t.id),
  };
  return { ...table, hash: hash(JSON.stringify(table)) };
}
const cache = new WeakMap<RailGraph, TrainTimetable>();
export function trainTimetable(rail: RailGraph) {
  let table = cache.get(rail);
  if (!table) {
    table = buildTimetable(rail);
    cache.set(rail, table);
  }
  return table;
}

export function trainPoint(rail: RailGraph, route: TrainRoute, positionM: number): TrainTrackPose {
  const s =
    route.sections.find((s) => positionM >= s.startM && positionM <= s.endM) ??
    (positionM < 0 ? route.sections[0]! : route.sections.at(-1)!);
  const t = rail.tracks[s.track]!,
    along = Math.max(0, Math.min(t.lengthM, positionM - s.startM));
  const trackM = s.forward ? along : t.lengthM - along;
  const p = pointAtDistance(t.line, t.cumulative, trackM);
  const heading = headingAtDistance(t.line, t.cumulative, trackM) + (s.forward ? 0 : Math.PI);
  // Ends outside the imported map extend tangentially; cars enter and leave without piling up.
  const extra =
    positionM < 0 ? positionM : positionM > route.lengthM ? positionM - route.lengthM : 0;
  return {
    x: p.x + Math.cos(heading) * extra,
    y: p.y + Math.sin(heading) * extra,
    heading,
    track: s.track,
    trackM,
  };
}

export function trainsAt(rail: RailGraph, table: TrainTimetable, timeS: number): TrainPose[] {
  const result: TrainPose[] = [];
  for (const departure of table.departures) {
    const route = table.routes[departure.route]!,
      cycle = Math.floor((timeS - departure.timeS) / table.periodS);
    for (let k = cycle; k >= cycle - Math.ceil(route.durationS / table.periodS); k--) {
      const age = timeS - departure.timeS - k * table.periodS;
      if (age < 0 || age >= route.durationS) continue;
      const phase = route.phases.find((p) => age >= p.timeS && age < p.timeS + p.durationS)!;
      const dt = age - phase.timeS,
        positionM = phase.positionM + phase.speedMps * dt + 0.5 * phase.acceleration * dt * dt;
      const length = trainDefaults[route.kind].lengthM,
        count = Math.ceil(length / trainDefaults.carLengthM),
        pitch = length / count;
      const occupied = route.sections
        .filter((s) => positionM + length / 2 > s.startM && positionM - length / 2 < s.endM)
        .map((s) => s.track);
      const reverse =
        route.turnaroundS !== undefined && age >= route.turnaroundS + trainDefaults.dwellS;
      const cars = Array.from({ length: count }, (_, i) => {
        const at = positionM + (reverse ? -1 : 1) * (length / 2 - pitch * (i + 0.5));
        const from = Math.max(0, at - pitch / 2),
          to = Math.min(route.lengthM, at + pitch / 2);
        if (to - from <= 0.7) return null;
        const middle = (from + to) / 2;
        const p = trainPoint(rail, route, middle),
          front = trainPoint(rail, route, middle + (to - from) * 0.4),
          rear = trainPoint(rail, route, middle - (to - from) * 0.4);
        return {
          ...p,
          front,
          rear,
          heading: Math.atan2(front.y - rear.y, front.x - rear.x) + (reverse ? Math.PI : 0),
          lengthM: to - from - 0.7,
        };
      }).filter((car): car is TrainCar => car !== null);
      result.push({
        id: `${route.id}/${departure.requestedS}/${k}`,
        route: departure.route,
        kind: route.kind,
        positionM,
        speedMps: Math.abs(phase.speedMps + phase.acceleration * dt),
        centre: trainPoint(rail, route, positionM),
        cars,
        occupied,
        next:
          route.stops.find((s) => age < s.arrivalS + trainDefaults.dwellS)?.name ??
          (route.terminal !== undefined && !reverse ? 'Terminal' : 'Exit'),
      });
    }
  }
  return result;
}

export function trainCensus(rail: RailGraph, table = trainTimetable(rail)) {
  const rate = (route: number) =>
    (table.departures.filter((d) => d.route === route).length * 3600) / table.periodS;
  return {
    hash: table.hash,
    periodS: table.periodS,
    routes: table.routes.map((r, i) => ({
      id: r.id,
      from: rail.nodes[r.from]!.id,
      to: rail.nodes[r.to]!.id,
      kind: r.kind,
      terminal: r.terminal === undefined ? undefined : rail.nodes[r.terminal]!.id,
      sections: r.sections.map((s) => rail.tracks[s.track]!.id),
      perHour: rate(i),
      stops: r.stops.map((s) => s.platform),
      departures: table.departures
        .filter((d) => d.route === i)
        .map((d) => ({ offsetS: d.timeS, waitS: d.timeS - d.requestedS })),
    })),
    perHour: Object.fromEntries(
      (['sbahn', 'mainline'] as const).map((kind) => [
        kind,
        table.routes.reduce((sum, r, i) => sum + (r.kind === kind ? rate(i) : 0), 0),
      ]),
    ),
    stopsPerHour: table.routes.reduce((sum, r, i) => sum + r.stops.length * rate(i), 0),
    usedSections: rail.tracks.length - table.unused.length,
    unusedSections: table.unused,
    crossings: rail.crossings
      .filter((c) => rail.tracks[c.track]!.kind !== 'tram')
      .map((c) => {
        let perHour = 0,
          occupiedSPerHour = 0;
        table.routes.forEach((r, i) => {
          const s = r.sections.find((s) => s.track === c.track);
          if (!s) return;
          const at = s.startM + (s.forward ? c.trackM : rail.tracks[c.track]!.lengthM - c.trackM),
            half = trainDefaults[r.kind].lengthM / 2;
          const terminal = r.terminal !== undefined,
            end = r.lengthM - half;
          const events = terminal && at + half < end ? 2 : 1;
          perHour += events * rate(i);
          const occupied =
            terminal && at + half >= end
              ? r.durationS - 2 * timeAt(r, at - half)
              : events * (timeAt(r, at + half, true) - timeAt(r, at - half));
          occupiedSPerHour += occupied * rate(i);
        });
        return {
          road: c.roadId,
          track: rail.tracks[c.track]!.id,
          pos: c.pos,
          perHour,
          occupiedSPerHour,
        };
      }),
  };
}
