import { createRandom } from '../geo/random';
import {
  boxOf,
  cumulativeLengths,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  polylineNearest,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { AirsideGraph, AirsideRunwayC } from '../network/airside';
import {
  arcEdge,
  arcEnd,
  arcForward,
  arcOf,
  arcsFrom,
  arcStartHeading,
  arcEndHeading,
  deflection,
  reverseArc,
  routeAirside,
  createAirsideRouteFinder,
  turnAllowed,
  type AirsideRouteQuery,
} from '../routing/airside';
import {
  aircraftCode,
  aircraftCodes,
  aircraftTypes,
  type AircraftType,
  type FixedWingPerformance,
  type HelicopterPerformance,
} from '../schema/aircraft';
import {
  aircraftPath,
  approachProfile,
  helicopterLandingProfile,
  helicopterTakeoffProfile,
  hoverTaxiProfile,
  pushbackProfile,
  takeoffProfile,
  taxiEntrySpeedMps,
  taxiProfile,
  towProfile,
  type AircraftMotionProfile,
  type AircraftPath,
  type AircraftPose,
} from './aircraft-motion';
import type { RunwayConfiguration } from './runway-configuration';

// TASK-298: aircraft on the airside (docs/architecture.md section 8, "Aircraft"). Aircraft move
// along legs: a ground leg follows graph arcs (taxi, pushback, tow) under three rules that keep
// bodies apart; an air leg is a TASK-306 profile (approach and landing roll, take-off and climb).
// - Claims: a moving aircraft holds the stretch of its leg from its tail less a margin to its
//   nose plus its braking distance and the margin, as intervals of edges and the nodes inside;
//   no two aircraft's claims share an edge interval or a node, so a follower keeps two margins
//   behind and a crossing aircraft waits a margin short of the junction.
// - Direction locks: before it moves from a stand (or on from a runway exit) an aircraft locks
//   every edge of its leg in its direction of travel; an edge locked one way is closed the other
//   way, so two aircraft never meet head-on. Locks are released as the tail passes.
// - Runways: one aircraft holds a runway (and every runway sharing its nodes) from line-up or 30 s
//   before an arrival's threshold until it vacates (its tail past the exit's holding position, or
//   a departure past the far end). Ground aircraft stop at the holding position until granted.
//   Arrivals book their runway window when they appear about 10 km out; a departure or a crossing
//   is granted only if it clears before the next booking; an arrival finding its runway held 30 s
//   out goes around and joins the arrival queue again.

const FINAL_M = 10_000;
const CLIMB_OUT_M = 10_000;
/** Published steep approaches by aerodrome (AIP): London City's 5.5-degree glide path. */
const steepApproachDeg: Record<string, number> = { EGLC: 5.5 };
const GLIDE_DEG = 3;
/** A landing hands over to taxi this far before its exit node. */
const HANDOVER_M = 40;
/** Without a mapped holding position, aircraft hold this far short of the runway node. */
const HOLD_FALLBACK_M = 75;
/** After a push the nose stands this far past the stand's lead-in root. */
const PUSH_CLEAR_M = 10;
const TUG_S = 20;
const LINEUP_S = 5;
const FULL_LENGTH_M = 60;
/** An arrival claims its runway this long before its threshold, or goes around. */
const DECISION_S = 30;
/** Spare time around runway bookings and grants. */
const RUNWAY_BUFFER_S = 20;
const RETRY_S = 5;
const PRIORITY_WAIT_S = 120;
const STUCK_S = 900;
/** A road crossing is closed while an aircraft below this height is within the larger of 150 m
 * and 25 s of it, until its tail is 10 m past. */
const CROSSING_HEIGHT_M = 100;
/** Gear: down on the ground, on approach below 600 m, and on climb-out below 150 m. */
const GEAR_APPROACH_M = 600;
const GEAR_CLIMB_M = 150;
/** Cost factor of a parallel taxiway arc against the runway configuration's flow. */
const FLOW_FACTOR = 3;

export const aircraftStates = [
  'approach',
  'flare',
  'landing-roll',
  'go-around',
  'taxi',
  'holding',
  'line-up',
  'takeoff-roll',
  'rotation',
  'climb',
  'parked',
  'pushback',
  'tow',
  'hover-taxi',
  'vertical-climb',
  'helicopter-climb',
  'helicopter-approach',
  'vertical-descent',
] as const;
export type AircraftState = (typeof aircraftStates)[number];

/** What TASK-299 and TASK-301 read of each aircraft. */
export interface AircraftPoseSnapshot {
  id: number;
  registration: string;
  typeId: string;
  x: number;
  y: number;
  heightM: number;
  heading: number;
  speedMps: number;
  state: AircraftState;
  enginesRunning: boolean;
  onRunway: boolean;
  airborne: boolean;
  gearDown: boolean;
  /** The stand it stands at or is bound for; the runway end it uses. */
  stand: string | null;
  runwayEnd: string | null;
  /** Airside edges ahead of it on its current and planned legs. */
  route: number[];
}

/** TASK-300: the runway configuration: the ends open for arrivals and departures and, during a
 * change, the configuration it changes to and the closed ends still in use. */
export interface RunwaySnapshot {
  configuration: string | null;
  arrivalEnds: string[];
  departureEnds: string[];
  switching: {
    to: string | null;
    sinceS: number;
    closingEnds: string[];
    rerouted: number;
  } | null;
}

export interface RunwayTransition {
  fromId: string | null;
  toId: string | null;
  startS: number;
  /** When the new configuration opened: its closed ends were clear. */
  openS: number;
  /** Taxiing departures re-routed to the new departure ends. */
  rerouted: number;
}

/** TASK-301: the airfield's light state, by compiled index. */
export interface AirfieldSnapshot {
  /** Per runway, the end (0 or 1) arrivals and departures use, or -1. */
  arrivalEnds: number[];
  departureEnds: number[];
  /** Holding positions an aircraft is cleared past: their stop bars are off. */
  clearedHolds: number[];
  glideSlopeDeg: number;
  /** TASK-300: the runway configuration and any change in progress, once one is set. */
  runways?: RunwaySnapshot;
}

export interface AircraftEvent {
  timeS: number;
  id: number;
  kind: 'landed' | 'parked' | 'off-block' | 'departed' | 'towed' | 'go-around';
}

export type AircraftResult = { ok: true; id: number } | { ok: false; reason: string };

export interface AircraftMetrics {
  active: number;
  queuedArrivals: number;
  landed: number;
  departed: number;
  towed: number;
  goArounds: number;
  /** Aircraft that have stood still for 15 minutes away from a stand. */
  stuck: number;
  /** Completed runway configuration changes and the departures they re-routed. */
  reconfigurations: number;
  rerouted: number;
}

interface Piece {
  edge: number;
  /** Edge stations at the piece's start and end, in travel order. */
  fromE: number;
  toE: number;
  startM: number;
  endM: number;
  startNode: number;
  endNode: number;
  locked: boolean;
}

interface Gate {
  /** The centre's stop while not granted. */
  holdM: number;
  runway: number;
  /** The tail passing it releases the runway; Infinity: the take-off releases it. */
  vacateM: number;
  granted: boolean;
  released: boolean;
  /** Seconds from the grant until it clears, as estimated at the grant. */
  occupancyS: number;
  /** TASK-301: the mapped holding position it stops at (-1: none) and that node's station; its
   * stop bar is off from the grant until the tail passes the node. */
  hold: number;
  holdNodeM: number;
}

interface Leg {
  mode: 'taxi' | 'pushback' | 'tow';
  path: AircraftPath;
  pieces: Piece[];
  /** Path ranges on a runway. */
  runwayRanges: [number, number, number][];
  endM: number;
  gates: Gate[];
  crossings: { crossing: number; stationM: number }[];
}

interface Air {
  kind: 'approach' | 'takeoff' | 'go-around' | 'helicopter';
  profile: AircraftMotionProfile;
  path: AircraftPath;
  startS: number;
  crossings: { crossing: number; stationM: number }[];
  runway: number;
  /** Approach: path stations of the threshold and the touchdown; take-off: of the far end. */
  thresholdM: number;
  touchdownM: number;
  clearM: number;
  decided: boolean;
  touched: boolean;
}

type Next =
  | { kind: 'park'; stand: number }
  | { kind: 'rest' }
  | { kind: 'taxi'; leg: Leg; pauseS: number }
  | { kind: 'takeoff'; end: number; lineUpU: number; pauseS: number };

interface Craft {
  id: number;
  type: AircraftType;
  code: number;
  lengthM: number;
  registration: string;
  stand: number;
  helipad: number;
  runway: number;
  end: number;
  mode: 'queued' | 'air' | 'ground' | 'parked' | 'waiting' | 'done';
  air: Air | null;
  leg: Leg | null;
  /** Ground motion: the plan sampled from `planS`, its stop, and the sampled state. */
  plan: AircraftMotionProfile | null;
  planS: number;
  planStop: number;
  stationM: number;
  speedMps: number;
  pose: AircraftPose | null;
  claimLo: number;
  claimHi: number;
  claimed: { edge: number; lo: number; hi: number }[];
  claimedNodes: number[];
  locks: { edge: number; dir: number }[];
  next: Next[];
  /** A pause (tug, line-up) ends at this time. */
  pauseUntilS: number;
  request: Request | null;
  requestedS: number;
  pendingLegs?: Leg[];
  towing: boolean;
  retryS: number;
  stillSinceS: number;
  bookingFromS: number;
  bookingToS: number;
  /** Swept body of a pushback, reserved until the tug stops on the taxiway. */
  pushSweep?: Body[];
}

interface Body {
  x: number;
  y: number;
  c: number;
  s: number;
  length: number;
  span: number;
}

interface SweepPoint {
  body: Body;
  stationM: number;
  edge: number;
  dir: number;
  runway: number;
}

const bodyParts = [
  [0, 0.5, 0.05],
  [0.02, 0.1, 0.5],
  [-0.43, 0.06, 1 / 6],
] as const;

function bodyAt(craft: Craft, position: Vec2, heading: number): Body {
  return {
    ...position,
    c: Math.cos(heading),
    s: Math.sin(heading),
    length: craft.lengthM,
    span: craft.type.spanM,
  };
}

/** The union of fuselage, wing and tail rectangles, with 1.5 m for sweep sampling. */
function bodiesTouch(a: Body, b: Body) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const reach = (Math.max(a.length, a.span) + Math.max(b.length, b.span)) / 2 + 4;
  if (dx * dx + dy * dy > reach * reach) return false;
  const c = a.c * b.c + a.s * b.s;
  const s = a.c * b.s - a.s * b.c;
  const ac = Math.abs(c);
  const as = Math.abs(s);
  const x = dx * a.c + dy * a.s;
  const y = -dx * a.s + dy * a.c;
  for (const [offsetA, lengthA, spanA] of bodyParts)
    for (const [offsetB, lengthB, spanB] of bodyParts) {
      const u = x - offsetA * a.length + c * offsetB * b.length;
      const v = y + s * offsetB * b.length;
      const al = lengthA * a.length + 1.5;
      const aw = spanA * a.span + 1.5;
      const bl = lengthB * b.length + 1.5;
      const bw = spanB * b.span + 1.5;
      if (
        Math.abs(u) <= al + ac * bl + as * bw &&
        Math.abs(v) <= aw + as * bl + ac * bw &&
        Math.abs(u * c + v * s) <= bl + ac * al + as * aw &&
        Math.abs(-u * s + v * c) <= bw + as * al + ac * aw
      )
        return true;
    }
  return false;
}

type Request =
  | { kind: 'arrival'; end: number; stand: number }
  | { kind: 'departure'; end: number }
  | { kind: 'tow'; stand: number; node: number }
  | { kind: 'helicopter-arrival'; helipad: number; heading: number }
  | { kind: 'helicopter-departure'; heading: number }
  | { kind: 'hover'; helipad: number };

const balloonReach = (radiusM: number) => (1 + Math.sqrt(3)) * radiusM;

/** A reversing loop (right 60, left 300, right 60 degrees at one radius) from `start` heading
 * `heading`: it reaches (1 + sqrt 3) R ahead and comes back to `start` heading the other way. */
function balloon(start: Vec2, heading: number, radiusM: number) {
  const points: Vec2[] = [];
  let x = start.x,
    y = start.y,
    h = heading;
  const arc = (sweep: number) => {
    const steps = Math.ceil(Math.abs(sweep) / (Math.PI / 36));
    const dh = sweep / steps;
    const chord = 2 * radiusM * Math.sin(Math.abs(dh) / 2);
    for (let i = 0; i < steps; i++) {
      x += chord * Math.cos(h + dh / 2);
      y += chord * Math.sin(h + dh / 2);
      h += dh;
      points.push({ x, y });
    }
  };
  // The local frame has y south, so a turn to the left decreases the heading.
  arc(Math.PI / 3);
  arc((-5 * Math.PI) / 3);
  arc(Math.PI / 3);
  points[points.length - 1] = { ...start };
  return points;
}

/** Points of a polyline between two stations. */
function slice(
  points: readonly Vec2[],
  cumulative: Float64Array,
  fromM: number,
  toM: number,
): Vec2[] {
  if (fromM > toM) return slice(points, cumulative, toM, fromM).reverse();
  const result = [pointAtDistance(points, cumulative, fromM)];
  for (let i = 0; i < points.length; i++)
    if (cumulative[i]! > fromM && cumulative[i]! < toM) result.push(points[i]!);
  result.push(pointAtDistance(points, cumulative, toM));
  return result;
}

interface Segment {
  points: Vec2[];
  edge: number;
  fromE: number;
  toE: number;
  startNode: number;
  endNode: number;
  runway: number;
}

/** Round each corner with the aircraft's turning radius where its segments leave room (the
 * tangent at most 45% of either), and map stations of the raw line onto the rounded one. */
function rounded(raw: Vec2[], radiusM: number) {
  const points: Vec2[] = [raw[0]!];
  const rawBreaks = [0];
  const breaks: { index: number }[] = [{ index: 0 }];
  const rawStations = cumulativeLengths(raw);
  for (let i = 1; i < raw.length - 1; i++) {
    const a = raw[i - 1]!,
      b = raw[i]!,
      c = raw[i + 1]!;
    const before = Math.hypot(b.x - a.x, b.y - a.y);
    const after = Math.hypot(c.x - b.x, c.y - b.y);
    const ux = (b.x - a.x) / before,
      uy = (b.y - a.y) / before,
      vx = (c.x - b.x) / after,
      vy = (c.y - b.y) / after;
    const sweep = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const half = Math.abs(sweep) / 2;
    const tangent = Math.min(radiusM * Math.tan(half), 0.45 * Math.min(before, after));
    if (half < (1.5 * Math.PI) / 180 || half > (85 * Math.PI) / 180 || tangent < 0.5) {
      points.push(b);
      rawBreaks.push(rawStations[i]!);
      breaks.push({ index: points.length - 1 });
      continue;
    }
    const radius = tangent / Math.tan(half);
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
    const entry = { x: b.x - tangent * ux, y: b.y - tangent * uy };
    points.push(entry);
    rawBreaks.push(rawStations[i]! - tangent);
    breaks.push({ index: points.length - 1 });
    const sign = Math.sign(sweep);
    for (let k = 1; k < steps; k++) {
      const angle = (sweep * k) / steps;
      const along = radius * sign * Math.sin(angle);
      const across = radius * sign * 2 * Math.sin(angle / 2) ** 2;
      points.push({ x: entry.x + along * ux - across * uy, y: entry.y + along * uy + across * ux });
    }
    points.push({ x: b.x + tangent * vx, y: b.y + tangent * vy });
    rawBreaks.push(rawStations[i]! + tangent);
    breaks.push({ index: points.length - 1 });
  }
  points.push(raw.at(-1)!);
  rawBreaks.push(rawStations.at(-1)!);
  breaks.push({ index: points.length - 1 });
  const path = aircraftPath(points);
  const stations = cumulativeLengths(points);
  const mapped = breaks.map((b) => stations[b.index]!);
  const map = (rawM: number) => {
    let i = 1;
    while (i < rawBreaks.length - 1 && rawBreaks[i]! < rawM) i++;
    const span = rawBreaks[i]! - rawBreaks[i - 1]!;
    const t = span > 0 ? (rawM - rawBreaks[i - 1]!) / span : 0;
    return mapped[i - 1]! + Math.max(0, Math.min(1, t)) * (mapped[i]! - mapped[i - 1]!);
  };
  return { path, map };
}

export function createAircraftFleet(graph: AirsideGraph, seed: number) {
  const random = createRandom(seed).derive('aircraft');
  const crafts: Craft[] = [];
  const queue: number[] = [];
  const events: AircraftEvent[] = [];
  const counts = { landed: 0, departed: 0, towed: 0, goArounds: 0 };
  const runwayOccupant = new Int32Array(graph.runways.length).fill(-1);
  const runwayClearS = new Float64Array(graph.runways.length);
  const standOccupant = new Int32Array(graph.stands.length).fill(-1);
  const standBound = new Int32Array(graph.stands.length).fill(-1);
  const helipadOccupant = new Int32Array(graph.helipads.length).fill(-1);
  const edgeLocks: { id: number; dir: number }[][] = graph.edges.map(() => []);
  const crossingClosed = new Uint8Array(graph.crossings.length);
  const margin = (graph.maxSpanM || 36) / 2 + 12;
  const holdAt = new Map(graph.holds.map((h) => [h.node, h]));
  const glideRad = ((steepApproachDeg[graph.icao ?? ''] ?? GLIDE_DEG) * Math.PI) / 180;
  /** TASK-301: the glide slope the airfield's PAPI units are set to. */
  const glideDeg = steepApproachDeg[graph.icao ?? ''] ?? GLIDE_DEG;
  /** TASK-301: per runway, the end arrivals and the end departures use (-1: none), as the
   * operations set them or as the latest requests name them; the airfield lights follow them. */
  const arrivalEnd = new Int8Array(graph.runways.length).fill(-1);
  const departureEnd = new Int8Array(graph.runways.length).fill(-1);
  const prefix = graph.icao?.startsWith('EG')
    ? 'G-'
    : graph.icao?.startsWith('LS')
      ? 'HB-'
      : graph.icao?.startsWith('K')
        ? 'N'
        : '';
  let nowS = 0;
  const endKey = (runway: number, end: number) => runway * 2 + end;
  const arrivalOpen = new Uint8Array(graph.runways.length * 2);
  const departureOpen = new Uint8Array(graph.runways.length * 2);
  let flowFactor: Float64Array | null = null;
  const runways = {
    restricted: false,
    active: null as RunwayConfiguration | null,
    target: null as RunwayConfiguration | null,
    arrivals: new Set<number>(),
    departures: new Set<number>(),
    transition: null as {
      fromId: string | null;
      startS: number;
      closing: Set<number>;
      rerouted: Set<number>;
    } | null,
    transitions: [] as RunwayTransition[],
  };

  const fixedWing = (craft: Craft) => craft.type.performance as FixedWingPerformance;
  const radius = (craft: Craft) => fixedWing(craft).minTurnRadiusM;
  const isRunwayNode = (node: number) => node >= 0 && graph.nodes[node]!.runways.length > 0;

  function registration(id: number) {
    const letters = Array.from({ length: 4 }, (_, i) =>
      String.fromCharCode(65 + Math.floor(random.derive(id * 4 + i).next() * 26)),
    ).join('');
    return prefix === 'N' ? `N${100 + id}${letters.slice(0, 2)}` : `${prefix}${letters}`;
  }

  function newCraft(typeId: string): Craft | string {
    const type = aircraftTypes.find((t) => t.id === typeId);
    if (!type) return `unknown aircraft type ${typeId}`;
    const code = aircraftCode(type);
    const id = crafts.length + 1;
    const craft: Craft = {
      id,
      type,
      code: code ? aircraftCodes.indexOf(code) : -1,
      lengthM: type.lengthM,
      registration: registration(id),
      stand: -1,
      helipad: -1,
      runway: -1,
      end: -1,
      mode: 'queued',
      air: null,
      leg: null,
      plan: null,
      planS: 0,
      planStop: 0,
      stationM: 0,
      speedMps: 0,
      pose: null,
      claimLo: 0,
      claimHi: 0,
      claimed: [],
      claimedNodes: [],
      locks: [],
      next: [],
      pauseUntilS: 0,
      request: null,
      requestedS: nowS,
      towing: false,
      retryS: -Infinity,
      stillSinceS: 0,
      bookingFromS: Infinity,
      bookingToS: -Infinity,
    };
    return craft;
  }

  // ----- Runway geometry, in stations `u` from one end along its centreline.
  function runwayLine(runway: AirsideRunwayC, end: number) {
    const line = end === 0 ? runway.line : runway.line.toReversed();
    return { line, cumulative: cumulativeLengths(line) };
  }
  const fromEnd = (runway: AirsideRunwayC, end: number, stationM: number) =>
    end === 0 ? stationM : runway.lengthM - stationM;
  /** Runway nodes in order from `end`, with their stations from it. */
  function runwayNodes(runway: AirsideRunwayC, end: number) {
    const nodes = runway.nodes.map((node, i) => ({
      node,
      u: fromEnd(runway, end, runway.stationsM[i]!),
      i,
    }));
    return end === 0 ? nodes : nodes.reverse();
  }
  /** The runway arc leaving node `i` of the runway's node list toward (+1) or away from (-1)
   * `ends[1]`. */
  function runwayArc(runway: AirsideRunwayC, i: number, towardEnd1: boolean) {
    const edge = runway.edges[towardEnd1 ? i : i - 1];
    if (edge === undefined) return -1;
    const e = graph.edges[edge]!;
    const from = runway.nodes[i]!;
    return arcOf(edge, e.from === from);
  }
  const runwayInterlocks = graph.runways.map(({ idx, nodes }) => {
    const set = new Set([idx]);
    for (const node of nodes) for (const r of graph.nodes[node]!.runways) set.add(r);
    return [...set].sort((a, b) => a - b);
  });
  const runwaysAt = (runway: number) => runwayInterlocks[runway]!;

  // ----- Legs.
  function arcSegment(arc: number, fromE?: number, toE?: number): Segment {
    const edge = graph.edges[arcEdge(arc)]!;
    const forward = arcForward(arc);
    const a = fromE ?? (forward ? 0 : edge.lengthM);
    const b = toE ?? (forward ? edge.lengthM : 0);
    return {
      points: slice(edge.line, edge.cumulative, a, b),
      edge: edge.idx,
      fromE: a,
      toE: b,
      startNode: a === 0 ? edge.from : a === edge.lengthM ? edge.to : -1,
      endNode: b === 0 ? edge.from : b === edge.lengthM ? edge.to : -1,
      runway: edge.runway,
    };
  }
  function runwaySegment(runway: AirsideRunwayC, end: number, fromU: number, toU: number) {
    const { line, cumulative } = runwayLine(runway, end);
    return {
      points: slice(line, cumulative, fromU, toU),
      edge: -1,
      fromE: 0,
      toE: 0,
      startNode: -1,
      endNode: -1,
      runway: runway.idx,
    } satisfies Segment;
  }
  function freeSegment(points: Vec2[], runway: number): Segment {
    return { points, edge: -1, fromE: 0, toE: 0, startNode: -1, endNode: -1, runway };
  }

  function buildLeg(craft: Craft, mode: Leg['mode'], segments: Segment[]): Leg {
    const raw: Vec2[] = [];
    const bounds: [number, number][] = [];
    let at = 0;
    for (const segment of segments) {
      const points = raw.length ? segment.points.slice(1) : segment.points;
      const start = at;
      for (const p of points) {
        const last = raw.at(-1);
        if (last) at += Math.hypot(p.x - last.x, p.y - last.y);
        if (!last || p.x !== last.x || p.y !== last.y) raw.push(p);
      }
      bounds.push([start, at]);
    }
    const { path, map } = rounded(
      raw,
      craft.type.performance.kind === 'fixedWing' ? radius(craft) : 5,
    );
    const pieces: Piece[] = [];
    const runwayRanges: Leg['runwayRanges'] = [];
    segments.forEach((segment, i) => {
      const [a, b] = bounds[i]!;
      const startM = map(a),
        endM = map(b);
      if (segment.runway >= 0) {
        const last = runwayRanges.at(-1);
        if (last && last[2] === segment.runway && last[1] >= startM - 1e-6) last[1] = endM;
        else runwayRanges.push([startM, endM, segment.runway]);
      }
      for (const [node, station] of [
        [segment.startNode, startM],
        [segment.endNode, endM],
      ] as const)
        if (node >= 0)
          for (const runway of graph.nodes[node]!.runways)
            runwayRanges.push([station, station, runway]);
      if (segment.edge >= 0 && endM > startM)
        pieces.push({
          edge: segment.edge,
          fromE: segment.fromE,
          toE: segment.toE,
          startM,
          endM,
          startNode: segment.startNode,
          endNode: segment.endNode,
          locked: false,
        });
    });
    let crossings: Leg['crossings'] | undefined;
    return {
      mode,
      path,
      pieces,
      runwayRanges: runwayRanges.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      endM: path.lengthM - craft.lengthM / 2,
      gates: [],
      // Found when the leg is driven: most legs built are only costed or tried.
      get crossings() {
        return (crossings ??= crossingsOn(path));
      },
    };
  }

  /** Holding positions on a leg: a gate before every runway its pieces reach from a taxiway,
   * at the mapped hold within 300 m before it, else `HOLD_FALLBACK_M` short of the runway node;
   * released past the next hold beyond (or the fallback distance past the runway node). */
  function addGates(craft: Craft, leg: Leg, departureRunway: number, arrivalRunway = -1) {
    const half = craft.lengthM / 2;
    const { pieces } = leg;
    for (const [entryM, leaveM, runway] of leg.runwayRanges) {
      const before = pieces.findLast(
        ({ endM, endNode }) =>
          endM < entryM && endM >= entryM - 300 && holdAt.get(endNode)?.runway === runway,
      );
      const after = pieces.find(
        ({ endM, endNode }) =>
          endM > leaveM && endM <= leaveM + 300 && holdAt.get(endNode)?.runway === runway,
      );
      const holdM = Math.max(half, (before?.endM ?? entryM - HOLD_FALLBACK_M) - half);
      const vacateM =
        leaveM >= leg.endM && runway === departureRunway
          ? Infinity
          : Math.min(leg.endM - half, after?.endM ?? leaveM + HOLD_FALLBACK_M);
      const previous = leg.gates.findLast((gate) => runwaysAt(gate.runway).includes(runway));
      if (previous && holdM <= previous.vacateM + half) {
        previous.vacateM = Math.max(previous.vacateM, vacateM);
      } else {
        const granted = entryM <= half && runwaysAt(runway).includes(arrivalRunway);
        leg.gates.push({
          holdM: granted ? -Infinity : holdM,
          runway,
          vacateM,
          granted,
          released: false,
          occupancyS: 0,
          hold: before && !granted ? holdAt.get(before.endNode)!.idx : -1,
          holdNodeM: before?.endM ?? entryM - HOLD_FALLBACK_M,
        });
      }
    }
  }

  // ----- Locks and claims.
  function lockable(craft: Craft, leg: Leg, from: number, to: number) {
    for (let i = from; i < to; i++) {
      const piece = leg.pieces[i]!;
      if (graph.edges[piece.edge]!.kind === 'runway') continue;
      const dir = piece.toE >= piece.fromE ? 1 : -1;
      if (edgeLocks[piece.edge]!.some((l) => l.id !== craft.id && l.dir === -dir)) return false;
    }
    return true;
  }
  function lock(craft: Craft, leg: Leg, from: number, to: number) {
    for (let i = from; i < to; i++) {
      const piece = leg.pieces[i]!;
      if (graph.edges[piece.edge]!.kind === 'runway') continue;
      const dir = piece.toE >= piece.fromE ? 1 : -1;
      edgeLocks[piece.edge]!.push({ id: craft.id, dir });
      craft.locks.push({ edge: piece.edge, dir });
      piece.locked = true;
    }
  }
  function unlock(craft: Craft, edge: number, dir: number) {
    const list = edgeLocks[edge]!;
    const at = list.findIndex((l) => l.id === craft.id && l.dir === dir);
    if (at >= 0) list.splice(at, 1);
    const own = craft.locks.findIndex((l) => l.edge === edge && l.dir === dir);
    if (own >= 0) craft.locks.splice(own, 1);
  }
  function unlockAll(craft: Craft) {
    for (const { edge, dir } of craft.locks.slice()) unlock(craft, edge, dir);
  }
  /** A leg station's position on its piece's edge. */
  const edgeStation = (p: Piece, m: number) =>
    p.fromE + ((m - p.startM) / (p.endM - p.startM || 1)) * (p.toE - p.fromE);
  const pieceStation = (p: Piece, e: number) =>
    p.startM + ((e - p.fromE) / (p.toE - p.fromE || 1)) * (p.endM - p.startM);

  function publish(craft: Craft) {
    craft.claimed = [];
    craft.claimedNodes = [];
    const leg = craft.leg;
    if (!leg) return;
    const { claimLo: lo, claimHi: hi } = craft;
    for (const p of leg.pieces) {
      if (p.endM < lo || p.startM > hi) continue;
      if (graph.edges[p.edge]!.kind === 'runway') continue;
      const a = edgeStation(p, Math.max(lo, p.startM)),
        b = edgeStation(p, Math.min(hi, p.endM));
      craft.claimed.push({ edge: p.edge, lo: Math.min(a, b), hi: Math.max(a, b) });
      for (const [node, m] of [
        [p.startNode, p.startM],
        [p.endNode, p.endM],
      ] as const)
        if (node >= 0 && !isRunwayNode(node) && lo <= m && m <= hi) craft.claimedNodes.push(node);
    }
  }

  /** The first leg station in (fromM, toM] where another aircraft's claim begins. */
  function firstConflict(craft: Craft, leg: Leg, fromM: number, toM: number) {
    let best = Infinity;
    const others = crafts.filter((o) => o !== craft && o.claimed.length + o.claimedNodes.length);
    if (!others.length) return best;
    for (const p of leg.pieces) {
      if (p.endM <= fromM || p.startM > toM) continue;
      if (graph.edges[p.edge]!.kind === 'runway') continue;
      for (const [node, m] of [
        [p.startNode, p.startM],
        [p.endNode, p.endM],
      ] as const)
        if (node >= 0 && m > fromM && m <= toM && !isRunwayNode(node))
          if (others.some((o) => o.claimedNodes.includes(node))) best = Math.min(best, m - 0.01);
      const a = edgeStation(p, Math.max(fromM, p.startM)),
        b = edgeStation(p, Math.min(toM, p.endM));
      const lo = Math.min(a, b),
        hi = Math.max(a, b);
      const forward = p.toE >= p.fromE;
      for (const o of others)
        for (const c of o.claimed)
          if (c.edge === p.edge && c.lo <= hi && c.hi >= lo) {
            const e = forward ? Math.max(lo, c.lo) : Math.min(hi, c.hi);
            best = Math.min(best, Math.max(fromM, pieceStation(p, e) - 0.01));
          }
      if (best < Infinity && best <= p.endM) return best;
    }
    return best;
  }

  /** Claims of an aircraft standing still: its body; of a moving one, with margins. */
  function claimBody(craft: Craft) {
    const half = craft.lengthM / 2;
    craft.claimLo = craft.stationM - half;
    craft.claimHi = craft.stationM + half;
    publish(craft);
  }
  function startClaims(craft: Craft) {
    const leg = craft.leg!;
    const half = craft.lengthM / 2;
    craft.claimLo = craft.stationM - half - margin;
    const want = craft.stationM + half + margin;
    craft.claimHi = Math.max(
      craft.stationM + half,
      Math.min(want, firstConflict(craft, leg, craft.stationM, want)),
    );
    publish(craft);
  }

  function sweep(craft: Craft, leg: Leg, fromM = craft.lengthM / 2, spacingM = 2) {
    const { points, stationsM } = leg.path;
    const count = Math.max(1, Math.ceil((leg.endM - fromM) / spacingM));
    return Array.from({ length: count + 1 }, (_, i) => {
      const m = fromM + (i / count) * (leg.endM - fromM);
      const heading =
        headingAtDistance(points, stationsM, m) + (leg.mode === 'pushback' ? Math.PI : 0);
      return bodyAt(craft, pointAtDistance(points, stationsM, m), heading);
    });
  }

  const sweepCache = new WeakMap<Leg, Map<string, SweepPoint[]>>();
  const standEnvelopes = new Map<string, { parked: Body; push: Body[] }>();
  const standKey = (typeId: string, stand: number) => `${typeId}/${stand}`;
  const cellM = Math.max(40, graph.maxSpanM + 15);
  const cell = (x: number, y: number) => `${x},${y}`;

  function sweptLeg(craft: Craft, leg: Leg) {
    const cached = sweepCache.get(leg);
    if (cached) return cached;
    const buckets = new Map<string, SweepPoint[]>();
    const start = craft.lengthM / 2;
    const track = sweep(craft, leg, start);
    let cursor = 0;
    for (const [i, body] of track.entries()) {
      const stationM = start + (i / (track.length - 1)) * (leg.endM - start);
      while (cursor < leg.pieces.length - 1 && leg.pieces[cursor]!.endM < stationM) cursor++;
      const piece = leg.pieces[cursor];
      const runway =
        leg.runwayRanges.find(([from, to]) => stationM >= from && stationM <= to)?.[2] ?? -1;
      const key = cell(Math.floor(body.x / cellM), Math.floor(body.y / cellM));
      const point = {
        body,
        stationM,
        edge: piece && piece.startM <= stationM && piece.endM >= stationM ? piece.edge : -1,
        dir: piece && piece.toE < piece.fromE ? -1 : 1,
        runway,
      };
      const bucket = buckets.get(key);
      if (bucket) bucket.push(point);
      else buckets.set(key, [point]);
    }
    sweepCache.set(leg, buckets);
    return buckets;
  }

  /** Crossing or converging sweeps take turns. Shared, same-direction taxi arcs use the
   * following-distance claims, and runway arcs use the runway's own reservation. */
  function surfaceClear(
    craft: Craft,
    legs: Leg[],
    lookAheadS = 0,
    startingGround = false,
    admit = false,
    /** Own sweep points before this station are behind the aircraft (a re-route). */
    fromM = 0,
  ) {
    for (const other of crafts) {
      if (other === craft) continue;
      const hasPriority =
        admit &&
        other.pendingLegs &&
        nowS - other.requestedS >= PRIORITY_WAIT_S &&
        (other.requestedS < craft.requestedS ||
          (other.requestedS === craft.requestedS && other.id < craft.id));
      if (!hasPriority && other.mode !== 'ground' && other.air?.kind !== 'approach') continue;
      const routes = hasPriority
        ? other.pendingLegs!.slice()
        : other.next.flatMap((next) => (next.kind === 'taxi' ? [next.leg] : []));
      if (other.mode === 'ground') routes.unshift(other.leg!);
      let startAfterS = 0;
      const untilDecisionS =
        startingGround && other.air?.kind === 'approach' && !other.air.decided
          ? other.air.startS +
            other.air.thresholdM / fixedWing(other).approachSpeedMps -
            DECISION_S -
            nowS
          : 0;
      // A start may pass ahead of an arrival's exit only where no runway hold lies before the
      // conflict: held there, it would still stand in the way when the arrival lands.
      let gatedBefore = false;
      for (const leg of legs) {
        const gateM: number = gatedBefore
          ? -Infinity
          : (leg.gates.find((g) => !g.granted)?.holdM ?? Infinity);
        gatedBefore ||= gateM < Infinity;
        const own = fixedWing(craft);
        const ownSpeed =
          leg.mode === 'pushback'
            ? own.pushbackSpeedMps
            : leg.mode === 'tow'
              ? own.towSpeedMps
              : own.taxiStraightMps * 0.65;
        const incoming = sweptLeg(craft, leg);
        for (const route of routes) {
          const occupied = sweptLeg(other, route);
          const current = other.mode === 'ground' && route === other.leg;
          const speed = fixedWing(other);
          const travel =
            route.mode === 'pushback'
              ? speed.pushbackSpeedMps
              : route.mode === 'tow'
                ? speed.towSpeedMps
                : 0.65 * speed.taxiStraightMps;
          // An aircraft standing still is taken to stay; one short of a runway it has not been
          // granted stops at its hold.
          const holdM = current ? (route.gates.find((g) => !g.granted)?.holdM ?? Infinity) : 0;
          const moving = other.speedMps >= 0.5 ? Math.max(0, lookAheadS - 15) * travel : 0;
          const passed = current
            ? Math.min(other.stationM + moving, Math.max(other.stationM, holdM)) - 2
            : 0;
          if (passed > route.endM) continue;
          for (const bucket of incoming.values()) {
            const { body } = bucket[0]!;
            const x = Math.floor(body.x / cellM);
            const y = Math.floor(body.y / cellM);
            for (let i = x - 1; i <= x + 1; i++)
              for (let j = y - 1; j <= y + 1; j++) {
                const slice = occupied.get(cell(i, j));
                if (!slice) continue;
                for (const a of bucket)
                  for (const b of slice) {
                    if (b.stationM < passed || a.stationM < fromM) continue;
                    if (
                      a.stationM + craft.lengthM < gateM &&
                      untilDecisionS > startAfterS + (a.stationM + craft.lengthM) / ownSpeed + 25
                    )
                      continue;
                    if (a.runway >= 0 && b.runway >= 0 && runwaysAt(a.runway).includes(b.runway))
                      continue;
                    if (
                      leg.mode !== 'pushback' &&
                      route.mode !== 'pushback' &&
                      a.edge >= 0 &&
                      b.edge >= 0 &&
                      a.body.c * b.body.c + a.body.s * b.body.s > 0.9
                    ) {
                      const u = graph.edges[a.edge]!;
                      const v = graph.edges[b.edge]!;
                      const fromA = a.dir === 1 ? u.from : u.to;
                      const toA = a.dir === 1 ? u.to : u.from;
                      const fromB = b.dir === 1 ? v.from : v.to;
                      const toB = b.dir === 1 ? v.to : v.from;
                      if ((u === v && a.dir === b.dir) || toA === fromB || toB === fromA) continue;
                    }
                    if (bodiesTouch(a.body, b.body)) return false;
                  }
              }
          }
        }
        startAfterS += leg.endM / ownSpeed + (leg.mode === 'pushback' ? TUG_S : 0);
      }
    }
    return true;
  }

  function sweepClear(craft: Craft, path: Body[]) {
    for (const other of crafts) {
      if (other === craft || other.mode === 'done') continue;
      if (other.pushSweep?.some((body) => path.some((p) => bodiesTouch(p, body)))) return false;
      if (other.pose && other.pose.heightM < 20) {
        const body = bodyAt(other, other.pose.position, other.pose.headingRad);
        if (path.some((p) => bodiesTouch(p, body))) return false;
      }
    }
    return true;
  }

  function pushBlocksStand(craft: Craft, stand: number) {
    const sweeps = crafts.flatMap((other) => (other === craft ? [] : (other.pushSweep ?? [])));
    if (!sweeps.length) return false;
    return sweep(craft, standLeg(craft, stand)).some((p) =>
      sweeps.some((body) => bodiesTouch(p, body)),
    );
  }

  // ----- Starting legs.
  const route = (query: AirsideRouteQuery) => routeAirside(graph, query);
  let standRoute: ReturnType<typeof createAirsideRouteFinder> | undefined;

  function setLeg(craft: Craft, leg: Leg, timeS: number, speedMps = 0, claimed = false) {
    craft.leg = leg;
    craft.mode = 'ground';
    craft.stationM = craft.lengthM / 2;
    craft.speedMps = speedMps;
    craft.plan = null;
    craft.planS = timeS;
    craft.stillSinceS = timeS;
    if (!claimed) startClaims(craft);
  }

  /** The departure or tow legs from where a parked aircraft stands to the goal: a pushback
   * onto the straightest arc at its lead-in root, then the leg from there; or, where its
   * position continues forward, the leg alone. */
  function legsFromStand(
    craft: Craft,
    mode: 'taxi' | 'tow',
    goal: (arc: number) => boolean,
    stand: number,
    tail: (arcs: number[]) => Segment[],
    findRoute = route,
  ) {
    const leg = craft.leg!;
    const lastPiece = leg.pieces.at(-1);
    const half = craft.lengthM / 2;
    const query = {
      code: craft.code,
      turnRadiusM: radius(craft),
      goal,
      stand,
      factor: (arc: number) => oppositeFactor(craft, arc),
    };
    // Forward from where it stands (a drive-through stand, a hangar node).
    if (lastPiece && lastPiece.endNode >= 0) {
      const at = graph.edges[lastPiece.edge]!;
      const arc = arcOf(at.idx, lastPiece.toE >= lastPiece.fromE);
      const route = findRoute({ ...query, from: { arc } });
      if (route) {
        const behind = Math.min(craft.lengthM, at.lengthM);
        const start = arcSegment(arc, arcForward(arc) ? at.lengthM - behind : behind);
        return { legs: [buildLeg(craft, mode, [start, ...tail(route.arcs)])], cost: route.cost };
      }
    }
    const parked = craft.stand >= 0 ? graph.stands[craft.stand]! : null;
    if (!parked) return null;
    // Pushback: the lead-in from the stop back to its root.
    const pushArcs: number[] = [];
    let node = parked.stop;
    for (const e of parked.leadIn.toReversed()) {
      const edge = graph.edges[e]!;
      const forward = edge.from === node;
      pushArcs.push(arcOf(e, forward));
      node = forward ? edge.to : edge.from;
    }
    const root = parked.root;
    const pushHeading = arcEndHeading(graph, pushArcs.at(-1)!, radius(craft));
    const backs = arcsFrom(graph, root)
      .filter((arc) => {
        const edge = graph.edges[arcEdge(arc)]!;
        return edge.kind !== 'runway' && edge.kind !== 'lead_in' && edge.maxCode >= craft.code;
      })
      .map((arc) => ({ arc, turn: deflection(pushHeading, arcStartHeading(graph, arc)) }))
      .sort((a, b) => a.turn - b.turn || a.arc - b.arc);
    let best: { legs: Leg[]; cost: number } | null = null;
    for (const { arc } of backs) {
      const back = straightOn(craft, arc, half + PUSH_CLEAR_M + craft.lengthM);
      if (!back) continue;
      const route = findRoute({ ...query, from: { arc: reverseArc(back.arcs[0]!) } });
      if (!route) continue;
      // The return over the pushed stretch is part of the leg.
      const returnArcs = back.arcs.toReversed().map(reverseArc);
      const cost = route.cost + back.lengthM * 2;
      if (best && best.cost <= cost) continue;
      const pushSegments = [
        ...pushArcs.map((a) => arcSegment(a)),
        ...back.arcs.map((a, i) =>
          i === back.arcs.length - 1 ? arcSegment(a, undefined, back.endE) : arcSegment(a),
        ),
      ];
      const taxiSegments = [
        ...returnArcs.map((a, i) => (i === 0 ? arcSegment(a, back.endE) : arcSegment(a))),
        ...tail(route.arcs),
      ];
      best = {
        legs: [buildLeg(craft, 'pushback', pushSegments), buildLeg(craft, mode, taxiSegments)],
        cost,
      };
    }
    return best;
  }

  /** Arcs going straight on from `arc` (taking the least deflection at each node) until
   * `lengthM` is covered, and the edge station where that length ends on the last. */
  function straightOn(craft: Craft, arc: number, lengthM: number) {
    const arcs = [arc];
    let covered = graph.edges[arcEdge(arc)]!.lengthM;
    while (covered < lengthM) {
      const last = arcs.at(-1)!;
      const next = arcsFrom(graph, arcEnd(graph, last))
        .filter((b) => {
          const edge = graph.edges[arcEdge(b)]!;
          return (
            b !== reverseArc(last) &&
            edge.kind !== 'runway' &&
            edge.kind !== 'lead_in' &&
            edge.maxCode >= craft.code &&
            !arcs.some((a) => arcEdge(a) === arcEdge(b))
          );
        })
        .map((b) => ({
          b,
          turn: deflection(arcEndHeading(graph, last), arcStartHeading(graph, b)),
        }))
        .sort((x, y) => x.turn - y.turn || x.b - y.b)[0];
      if (!next || next.turn > Math.PI / 4) return null;
      arcs.push(next.b);
      covered += graph.edges[arcEdge(next.b)]!.lengthM;
    }
    const lastArc = arcs.at(-1)!;
    const edge = graph.edges[arcEdge(lastArc)]!;
    const into = edge.lengthM - (covered - lengthM);
    return {
      arcs,
      lengthM,
      endE: arcForward(lastArc) ? into : edge.lengthM - into,
    };
  }

  /** Routes avoid edges another aircraft has locked the other way, and taxiing against the
   * configuration's flow, where they can. */
  function oppositeFactor(craft: Craft, arc: number) {
    if (graph.edges[arcEdge(arc)]!.kind === 'runway') return 1000;
    const dir = arcForward(arc) ? 1 : -1;
    const flow = flowFactor?.[arc] ?? 1;
    return edgeLocks[arcEdge(arc)]!.some((l) => l.id !== craft.id && l.dir === -dir)
      ? 3 * flow
      : flow;
  }

  // ----- Line-up and take-off.
  /** Where a departure from `end` lines up: at the first runway node from that end up to its
   * threshold that a taxi route turns onto in the take-off direction; else, a backtrack: onto
   * the runway toward the end at the nearest node beyond, along it, and round a reversing loop
   * at the end. Returns the goal arc and the segments after the route. */
  function lineUps(craft: Craft, runway: AirsideRunwayC, end: number) {
    const p = fixedWing(craft);
    const nodes = runwayNodes(runway, end);
    // An entry within FULL_LENGTH_M of the end lines up for a full-length departure, even past a
    // threshold at the end itself (Zurich 32's entry 11 m in).
    const thresholdU = Math.max(
      fromEnd(runway, end, runway.ends[end]!.thresholdM),
      Math.min(FULL_LENGTH_M, runway.lengthM / 2),
    );
    const towardEnd1 = end === 0;
    const reach = balloonReach(p.minTurnRadiusM);
    const need = p.takeoffRollM + p.rotationSpeedMps * 3;
    const options: { goal: number; after: () => Segment[]; lineUpU: number }[] = [];
    for (const { node, u, i } of nodes) {
      if (u > thresholdU + 1e-6) break;
      const goal = runwayArc(runway, i, towardEnd1);
      const lineUpU = u + Math.max(craft.lengthM / 2, p.minTurnRadiusM) + 5;
      if (goal < 0 || runway.lengthM - lineUpU < need || arcsFrom(graph, node).length < 2) continue;
      options.push({ goal, lineUpU, after: () => [runwaySegment(runway, end, u, lineUpU)] });
    }
    for (const { u, i } of nodes) {
      if (u < reach + craft.lengthM / 2) continue;
      const goal = runwayArc(runway, i, !towardEnd1);
      if (goal < 0 || runway.lengthM - reach < need) continue;
      const { line, cumulative } = runwayLine(runway, end);
      const q = pointAtDistance(line, cumulative, reach);
      const heading = (runway.ends[end]!.heading + Math.PI) % (2 * Math.PI);
      options.push({
        goal,
        lineUpU: reach,
        after: () => [
          runwaySegment(runway, end, u, reach),
          freeSegment([q, ...balloon(q, heading, p.minTurnRadiusM)], runway.idx),
        ],
      });
    }
    return options;
  }

  function takeoffAir(craft: Craft, end: number, lineUpU: number, timeS: number): Air {
    const runway = graph.runways[craft.runway]!;
    const { line, cumulative } = runwayLine(runway, end);
    const points = slice(line, cumulative, lineUpU, runway.lengthM);
    const heading = runway.ends[end]!.heading;
    const last = points.at(-1)!;
    points.push({
      x: last.x + CLIMB_OUT_M * Math.cos(heading),
      y: last.y + CLIMB_OUT_M * Math.sin(heading),
    });
    const path = aircraftPath(points);
    return {
      kind: 'takeoff',
      profile: takeoffProfile(path, fixedWing(craft)),
      path,
      startS: timeS,
      crossings: crossingsOn(path),
      runway: craft.runway,
      thresholdM: 0,
      touchdownM: 0,
      clearM: runway.lengthM - lineUpU,
      decided: true,
      touched: true,
    };
  }

  /** Seconds from the start of a take-off until it passes `stationM`. */
  function timeTo(profile: AircraftMotionProfile, stationM: number) {
    let t = 0;
    while (t < profile.durationS && profile.sample(t).stationM < stationM) t += 1;
    return t;
  }

  /** Road crossings within 15 m of a path, with their stations along it. */
  function crossingsOn(path: AircraftPath) {
    if (!graph.crossings.length) return [];
    const { minX, minY, maxX, maxY } = boxOf(path.points);
    const candidates = graph.crossings.filter(
      ({ pos }) =>
        pos.x >= minX - 15 && pos.x <= maxX + 15 && pos.y >= minY - 15 && pos.y <= maxY + 15,
    );
    const nearest =
      candidates.length > 4
        ? polylineNearest(path.points)
        : (pos: Vec2) => nearestOnPolyline(path.points, pos);
    return candidates.flatMap((c) => {
      const near = nearest(c.pos);
      return near.away < 15 ? [{ crossing: c.idx, stationM: near.along }] : [];
    });
  }

  // ----- Arrivals.
  /** The approach path to `end`: 10 km of extended centreline, the threshold, and the runway to
   * `toU` (stations from the end). */
  function approachPath(runway: AirsideRunwayC, end: number, toU: number) {
    const { line, cumulative } = runwayLine(runway, end);
    const thresholdU = fromEnd(runway, end, runway.ends[end]!.thresholdM);
    const points = slice(line, cumulative, thresholdU, toU);
    const heading = runway.ends[end]!.heading;
    const start = {
      x: points[0]!.x - FINAL_M * Math.cos(heading),
      y: points[0]!.y - FINAL_M * Math.sin(heading),
    };
    return { path: aircraftPath([start, ...points]), thresholdU };
  }

  interface Landing {
    exitU: number;
    leg: Leg;
    /** Pieces of the leg up to the vacating point and the aircraft's length past it. */
    vacateM: number;
    exitSpeedMps: number;
  }

  /** The landings on `end` to `stand`, in order of preference: forward exits from the first
   * usable (its node at least the landing roll and the handover beyond touchdown), then a
   * backtrack from a reversing loop at the far end. */
  function landings(
    craft: Craft,
    runway: AirsideRunwayC,
    end: number,
    stand: number,
    findRoute = route,
  ) {
    const p = fixedWing(craft);
    const nodes = runwayNodes(runway, end);
    const thresholdU = fromEnd(runway, end, runway.ends[end]!.thresholdM);
    const aimU = thresholdU + aimingM(runway, end);
    const towardEnd1 = end === 0;
    const goal = standGoal(stand);
    const half = craft.lengthM / 2;
    const result: (() => Landing | null)[] = [];
    const finish = (exitU: number, segments: Segment[]): Landing | null => {
      const leg = buildLeg(craft, 'taxi', segments);
      addGates(craft, leg, -1, runway.idx);
      const vacateM = leg.gates[0]!.vacateM;
      const exitSpeedMps = Math.min(
        p.taxiStraightMps,
        taxiEntrySpeedMps(leg.path, p, {
          startStationM: half,
          stopStationM: Math.min(leg.endM, vacateM + half + 5),
        }),
      );
      return { exitU, leg, vacateM, exitSpeedMps };
    };
    for (const { u, i } of nodes) {
      if (u - HANDOVER_M < aimU + p.landingRollM || i === 0 || i === runway.nodes.length - 1)
        continue;
      const inArc = runwayArc(runway, i, !towardEnd1);
      if (inArc < 0) continue;
      const arriving = reverseArc(inArc);
      result.push(() => {
        const route = findRoute({
          code: craft.code,
          turnRadiusM: p.minTurnRadiusM,
          from: { arc: arriving },
          goal,
          stand,
          exitRunway: true,
          factor: (arc) => oppositeFactor(craft, arc),
        });
        if (!route) return null;
        return finish(u - HANDOVER_M, [
          runwaySegment(runway, end, u - HANDOVER_M - half, u),
          ...route.arcs.map((a) => arcSegment(a)),
        ]);
      });
    }
    // Backtrack: roll out to the loop at the far end and taxi back along the runway.
    const reach = balloonReach(p.minTurnRadiusM);
    const qU = runway.lengthM - reach;
    const last = nodes.findLast(({ u }) => u <= qU);
    if (last && qU - aimU >= p.landingRollM) {
      result.push(() => {
        const { line, cumulative } = runwayLine(runway, end);
        const q = pointAtDistance(line, cumulative, qU);
        // After the loop it runs back toward the landing end on the arc ending at `last`.
        const behind = towardEnd1
          ? runwayArc(runway, last.i + 1, false)
          : runwayArc(runway, last.i - 1, true);
        if (behind < 0) return null;
        const route = findRoute({
          code: craft.code,
          turnRadiusM: p.minTurnRadiusM,
          from: { arc: behind },
          goal,
          stand,
          factor: (arc) => oppositeFactor(craft, arc),
        });
        if (!route) return null;
        return finish(qU, [
          runwaySegment(runway, end, qU - half, qU),
          freeSegment([q, ...balloon(q, runway.ends[end]!.heading, p.minTurnRadiusM)], runway.idx),
          runwaySegment(runway, end, qU, last.u),
          ...route.arcs.map((a) => arcSegment(a)),
        ]);
      });
    }
    return result;
  }

  /** ICAO aiming point: 300 m past the threshold, or a fifth of the landing distance if less. */
  function aimingM(runway: AirsideRunwayC, end: number) {
    const thresholdU = fromEnd(runway, end, runway.ends[end]!.thresholdM);
    return Math.min(300, 0.2 * (runway.lengthM - thresholdU));
  }

  function standGoal(stand: number) {
    const s = graph.stands[stand]!;
    const last = s.leadIn.at(-1)!;
    const edge = graph.edges[last]!;
    const arc = arcOf(last, edge.to === s.stop);
    return (a: number) => a === arc;
  }

  function approachAir(craft: Craft, landing: Landing, timeS: number): Air {
    const runway = graph.runways[craft.runway]!;
    const { path } = approachPath(runway, craft.end, landing.exitU);
    const thresholdM = FINAL_M;
    const touchdownM = FINAL_M + aimingM(runway, craft.end);
    const profile = approachProfile(path, fixedWing(craft), {
      aimingStationM: touchdownM,
      glideAngleRad: glideRad,
      exitStationM: path.lengthM,
      exitSpeedMps: landing.exitSpeedMps,
    });
    return {
      kind: 'approach',
      profile,
      path,
      startS: timeS,
      crossings: crossingsOn(path),
      runway: craft.runway,
      thresholdM,
      touchdownM,
      clearM: 0,
      decided: false,
      touched: false,
    };
  }

  /** Whether a runway window is free of other aircraft: the runway's holder (any, for a window
   * starting now; else one predicted to clear after its start) and arrivals' bookings. */
  function bookingFits(runway: number, fromS: number, toS: number, except: number) {
    for (const r of runwaysAt(runway)) {
      const occupant = runwayOccupant[r]!;
      if (occupant !== -1 && occupant !== except && (fromS <= nowS || runwayClearS[r]! > fromS))
        return false;
      for (const other of crafts)
        if (
          other.id !== except &&
          other.mode === 'air' &&
          other.air?.kind === 'approach' &&
          runwaysAt(other.runway).includes(r) &&
          other.bookingFromS < toS &&
          other.bookingToS > fromS
        )
          return false;
    }
    return true;
  }

  function trySpawnArrival(
    craft: Craft,
    request: Extract<Request, { kind: 'arrival' }>,
    timeS: number,
  ) {
    const runway = graph.runways[craft.runway]!;
    if (runways.restricted && !arrivalOpen[endKey(runway.idx, request.end)]) return false;
    if (standOccupant[request.stand] !== -1 || pushBlocksStand(craft, request.stand)) return false;
    for (const option of landings(craft, runway, request.end, request.stand)) {
      const landing = option();
      if (!landing) continue;
      const air = approachAir(craft, landing, timeS);
      craft.pendingLegs ??= [landing.leg];
      // Nothing may taxi against the exit when the arrival appears: it would meet it head-on.
      if (
        !lockable(craft, landing.leg, 0, landing.leg.pieces.length) ||
        !surfaceClear(
          craft,
          [landing.leg],
          air.thresholdM / fixedWing(craft).approachSpeedMps - DECISION_S,
          false,
          true,
        )
      )
        continue;
      const thresholdS = timeS + air.thresholdM / fixedWing(craft).approachSpeedMps;
      const exitS = timeS + air.profile.durationS;
      const taxi = taxiProfile(landing.leg.path, fixedWing(craft), {
        startStationM: craft.lengthM / 2,
        startSpeedMps: landing.exitSpeedMps,
        stopStationM: landing.leg.endM,
      });
      const vacateS = exitS + timeTo(taxi, landing.vacateM + craft.lengthM / 2);
      const fromS = thresholdS - DECISION_S - RUNWAY_BUFFER_S;
      if (!bookingFits(craft.runway, fromS, vacateS + RUNWAY_BUFFER_S, craft.id)) return false;
      craft.mode = 'air';
      craft.air = air;
      craft.bookingFromS = fromS;
      craft.bookingToS = vacateS + RUNWAY_BUFFER_S;
      craft.next = [
        { kind: 'taxi', leg: landing.leg, pauseS: 0 },
        { kind: 'park', stand: request.stand },
      ];
      craft.stand = request.stand;
      standBound[request.stand] = craft.id;
      craft.request = null;
      craft.pendingLegs = undefined;
      return true;
    }
    return false;
  }

  function commitLanding(craft: Craft) {
    const next = craft.next[0];
    if (next?.kind !== 'taxi') throw new Error('An arrival has no reserved exit');
    const { leg } = next;
    const want = Math.min(leg.path.lengthM, leg.gates[0]!.vacateM + craft.lengthM + margin);
    // Others' moving paths count from where they will be when it turns off the runway.
    const air = craft.air!;
    const exitInS = air.startS + air.profile.durationS - nowS;
    if (
      !lockable(craft, leg, 0, leg.pieces.length) ||
      !surfaceClear(craft, [leg], exitInS) ||
      firstConflict(craft, leg, 0, want) < Infinity ||
      pushBlocksStand(craft, craft.stand)
    )
      return false;
    lock(craft, leg, 0, leg.pieces.length);
    craft.leg = leg;
    craft.claimLo = 0;
    craft.claimHi = want;
    publish(craft);
    return true;
  }

  // ----- Requests.
  function requestArrival(input: {
    typeId: string;
    runwayEnd: string;
    stand: string;
  }): AircraftResult {
    const craft = newCraft(input.typeId);
    if (typeof craft === 'string') return { ok: false, reason: craft };
    if (craft.type.performance.kind !== 'fixedWing')
      return { ok: false, reason: 'a helicopter lands on a helipad' };
    const found = findEnd(input.runwayEnd);
    if (!found) return { ok: false, reason: `no runway end ${input.runwayEnd}` };
    const stand = graph.index.stand.get(input.stand);
    if (stand === undefined) return { ok: false, reason: `no stand ${input.stand}` };
    const check = standCheck(craft, stand);
    if (check) return { ok: false, reason: check };
    craft.runway = found.runway;
    craft.end = found.end;
    if (!landings(craft, graph.runways[found.runway]!, found.end, stand).some((o) => o()))
      return { ok: false, reason: `no landing on ${input.runwayEnd} reaches stand ${input.stand}` };
    craft.request = { kind: 'arrival', end: found.end, stand };
    if (!runways.restricted) arrivalEnd[found.runway] = found.end;
    crafts.push(craft);
    standBound[stand] = craft.id;
    craft.stand = stand;
    queue.push(craft.id);
    return { ok: true, id: craft.id };
  }

  /** Whether an aircraft can leave a stand: pushed onto an arc at its root that it may use, from
   * which it can turn on through the root onto another. */
  function standExit(craft: Craft, stand: number) {
    const s = graph.stands[stand]!;
    const open = (arc: number) => {
      const edge = graph.edges[arcEdge(arc)]!;
      return edge.kind !== 'lead_in' && edge.kind !== 'runway' && edge.maxCode >= craft.code;
    };
    const arcs = arcsFrom(graph, s.root).filter(open);
    return arcs.some((back) =>
      arcs.some((on) => on !== back && turnAllowed(graph, reverseArc(back), on, radius(craft))),
    );
  }

  function standCheck(craft: Craft, stand: number) {
    const s = graph.stands[stand]!;
    if (s.maxCode < craft.code)
      return `stand ${s.ref ?? s.id} admits code ${aircraftCodes[s.maxCode] ?? 'none'}`;
    if (!standExit(craft, stand))
      return `no way out of stand ${s.ref ?? s.id} for code ${aircraftCodes[craft.code]}`;
    if (standOccupant[stand] !== -1 || (standBound[stand] !== -1 && standBound[stand] !== craft.id))
      return `stand ${s.ref ?? s.id} is taken`;
    return null;
  }

  function findEnd(designator: string) {
    for (const runway of graph.runways)
      for (const end of [0, 1] as const)
        if (runway.ends[end].designator === designator) return { runway: runway.idx, end };
    return null;
  }

  function standLeg(craft: Craft, stand: number) {
    const s = graph.stands[stand]!;
    let node = s.root;
    const segments = s.leadIn.map((e) => {
      const edge = graph.edges[e]!;
      const forward = edge.from === node;
      node = forward ? edge.to : edge.from;
      return arcSegment(arcOf(e, forward));
    });
    return buildLeg(craft, 'taxi', segments);
  }

  function spawnParked(input: { typeId: string; stand: string }, timeS = nowS): AircraftResult {
    const craft = newCraft(input.typeId);
    if (typeof craft === 'string') return { ok: false, reason: craft };
    if (craft.type.performance.kind !== 'fixedWing')
      return { ok: false, reason: 'a helicopter parks on a helipad' };
    const stand = graph.index.stand.get(input.stand);
    if (stand === undefined) return { ok: false, reason: `no stand ${input.stand}` };
    const check = standCheck(craft, stand);
    if (check) return { ok: false, reason: check };
    const leg = standLeg(craft, stand);
    crafts.push(craft);
    park(craft, leg, stand, timeS);
    return { ok: true, id: craft.id };
  }

  function park(craft: Craft, leg: Leg, stand: number, timeS: number) {
    craft.leg = leg;
    craft.mode = 'parked';
    craft.towing = false;
    craft.stand = stand;
    craft.stationM = Math.max(0, leg.endM);
    craft.speedMps = 0;
    craft.plan = null;
    craft.pose = poseOnLeg(craft, leg, 0);
    craft.stillSinceS = timeS;
    if (stand >= 0) {
      standOccupant[stand] = craft.id;
      standBound[stand] = -1;
    }
    unlockAll(craft);
    claimBody(craft);
  }

  function poseOnLeg(craft: Craft, leg: Leg, speedMps: number): AircraftPose {
    const { points, stationsM } = leg.path;
    const m = Math.max(0, Math.min(craft.stationM, leg.path.lengthM));
    const position = pointAtDistance(points, stationsM, m);
    const ahead = pointAtDistance(points, stationsM, Math.min(leg.path.lengthM, m + 0.5));
    const behind = pointAtDistance(points, stationsM, Math.max(0, m - 0.5));
    let heading = Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
    if (leg.mode === 'pushback') heading += heading > 0 ? -Math.PI : Math.PI;
    return { position, headingRad: heading, stationM: m, heightM: 0, speedMps, phase: leg.mode };
  }

  function requestDeparture(id: number, runwayEnd: string): AircraftResult {
    const craft = crafts[id - 1];
    if (!craft || craft.mode !== 'parked' || craft.request)
      return { ok: false, reason: 'not a parked aircraft' };
    if (craft.type.performance.kind !== 'fixedWing')
      return { ok: false, reason: 'a helicopter departs from a helipad' };
    const found = findEnd(runwayEnd);
    if (!found) return { ok: false, reason: `no runway end ${runwayEnd}` };
    craft.request = { kind: 'departure', end: found.end };
    if (!runways.restricted) departureEnd[found.runway] = found.end;
    craft.requestedS = nowS;
    craft.runway = found.runway;
    craft.end = found.end;
    craft.retryS = -Infinity;
    return { ok: true, id };
  }

  function requestTow(
    id: number,
    target: { stand: string } | { node: number } | { hangar: number },
  ): AircraftResult {
    const craft = crafts[id - 1];
    if (!craft || craft.mode !== 'parked' || craft.request)
      return { ok: false, reason: 'not a parked aircraft' };
    if (craft.type.performance.kind !== 'fixedWing')
      return { ok: false, reason: 'helicopters hover-taxi' };
    let stand = -1,
      node = -1;
    if ('stand' in target) {
      stand = graph.index.stand.get(target.stand) ?? -1;
      if (stand < 0) return { ok: false, reason: `no stand ${target.stand}` };
      const check = standCheck(craft, stand);
      if (check) return { ok: false, reason: check };
    } else node = 'node' in target ? target.node : (graph.hangars[target.hangar]?.node ?? -1);
    if (stand < 0 && node < 0) return { ok: false, reason: 'no tow target' };
    if (!towLegs(craft, stand, node)) return { ok: false, reason: 'no route to tow target' };
    if (stand >= 0) standBound[stand] = craft.id;
    craft.request = { kind: 'tow', stand, node };
    craft.requestedS = nowS;
    craft.retryS = -Infinity;
    return { ok: true, id };
  }

  function towLegs(craft: Craft, stand: number, node: number) {
    const goal = stand >= 0 ? standGoal(stand) : (arc: number) => arcEnd(graph, arc) === node;
    return legsFromStand(craft, 'tow', goal, stand, (arcs) => arcs.map((a) => arcSegment(a)));
  }

  function departurePlan(craft: Craft, runway: AirsideRunwayC, end: number, findRoute = route) {
    for (const option of lineUps(craft, runway, end)) {
      const legs = legsFromStand(
        craft,
        'taxi',
        (a) => a === option.goal,
        -1,
        (arcs) => [...arcs.slice(0, -1).map((a) => arcSegment(a)), ...option.after()],
        findRoute,
      );
      if (legs) return { ...legs, lineUpU: option.lineUpU };
    }
    return null;
  }

  /** A stand must have both a landing route and a pushback/taxi route for the selected ends. */
  function standTurnCost(stand: number, typeId: string, arrivalEnd: string, departureEnd: string) {
    const craft = newCraft(typeId);
    if (typeof craft === 'string' || craft.code < 0) return Infinity;
    if (graph.stands[stand]!.maxCode < craft.code || !standExit(craft, stand)) return Infinity;
    const arrival = findEnd(arrivalEnd);
    const departure = findEnd(departureEnd);
    if (!arrival || !departure) return Infinity;
    const inbound = graph.runways[arrival.runway]!;
    const outbound = graph.runways[departure.runway]!;
    if (Math.min(inbound.maxCode, outbound.maxCode) < craft.code) return Infinity;
    craft.stand = stand;
    craft.leg = standLeg(craft, stand);
    const findRoute = (standRoute ??= createAirsideRouteFinder(graph));
    const outboundPlan = departurePlan(craft, outbound, departure.end, findRoute);
    if (!outboundPlan) return Infinity;
    for (const option of landings(craft, inbound, arrival.end, stand, findRoute)) {
      const landing = option();
      if (!landing) continue;
      craft.stationM = craft.leg.endM;
      const parked = poseOnLeg(craft, craft.leg, 0);
      const push = outboundPlan.legs[0]!;
      standEnvelopes.set(standKey(typeId, stand), {
        parked: bodyAt(craft, parked.position, parked.headingRad),
        push: push.mode === 'pushback' ? sweep(craft, push) : [],
      });
      return landing.leg.endM + outboundPlan.legs.reduce((m, leg) => m + leg.endM, 0);
    }
    return Infinity;
  }

  /** Starts a parked aircraft's departure or tow once its legs can be locked. */
  function tryStart(craft: Craft, timeS: number) {
    if (timeS - craft.retryS < RETRY_S) return;
    craft.retryS = timeS;
    if (craft.request!.kind === 'departure' && runways.restricted) {
      retargetDeparture(craft);
      if (!runways.departures.has(endKey(craft.runway, craft.end))) return;
    }
    const request = craft.request!;
    let plan: { legs: Leg[]; cost: number; next: Next[] } | null = null;
    if (request.kind === 'departure') {
      const runway = graph.runways[craft.runway]!;
      const departure = departurePlan(craft, runway, request.end);
      if (departure) {
        addGates(craft, departure.legs.at(-1)!, runway.idx);
        plan = {
          ...departure,
          next: [
            { kind: 'takeoff', end: request.end, lineUpU: departure.lineUpU, pauseS: LINEUP_S },
          ],
        };
      }
    } else if (request.kind === 'tow') {
      const legs = towLegs(craft, request.stand, request.node);
      if (legs) {
        addGates(craft, legs.legs.at(-1)!, -1);
        plan = {
          ...legs,
          next: [request.stand >= 0 ? { kind: 'park', stand: request.stand } : { kind: 'rest' }],
        };
      }
    }
    if (!plan) return;
    const { legs } = plan;
    for (const leg of legs.slice(0, -1)) addGates(craft, leg, -1);
    craft.pendingLegs = legs;
    if (!legs.every((leg) => lockable(craft, leg, 0, leg.pieces.length))) return;
    if (!surfaceClear(craft, legs, 0, true, true)) return;
    // The first leg must be claimable from where the aircraft stands.
    const first = legs[0]!;
    const half = craft.lengthM / 2;
    if (firstConflict(craft, first, half, half + craft.lengthM / 2 + margin) < Infinity) return;
    if (first.mode === 'pushback') {
      const push = sweep(craft, first);
      if (!sweepClear(craft, push)) return;
      for (const other of crafts) {
        if (other === craft || other.stand < 0 || standBound[other.stand] !== other.id) continue;
        if (other.mode === 'queued') continue;
        if (
          sweep(other, standLeg(other, other.stand)).some((p) =>
            push.some((body) => bodiesTouch(p, body)),
          )
        )
          return;
      }
      craft.pushSweep = push;
    }
    for (const leg of legs) lock(craft, leg, 0, leg.pieces.length);
    if (craft.stand >= 0) standOccupant[craft.stand] = -1;
    if (request.kind === 'tow') craft.stand = request.stand;
    craft.request = null;
    craft.pendingLegs = undefined;
    // A departure's tug disconnects and its engines start after the push; a tow's stays on.
    const pauseS = first.mode === 'pushback' && request.kind === 'departure' ? TUG_S : 0;
    craft.towing = request.kind === 'tow';
    craft.next = [
      ...legs.slice(1).map((leg): Next => ({ kind: 'taxi', leg, pauseS })),
      ...plan.next,
    ];
    setLeg(craft, first, timeS);
    if (request.kind === 'departure') events.push({ timeS, id: craft.id, kind: 'off-block' });
  }

  // ----- Helicopters.
  function requestHelicopterArrival(input: {
    typeId: string;
    helipad: string;
    headingRad: number;
  }): AircraftResult {
    const craft = newCraft(input.typeId);
    if (typeof craft === 'string') return { ok: false, reason: craft };
    if (craft.type.performance.kind !== 'helicopter')
      return { ok: false, reason: 'not a helicopter' };
    const helipad = graph.helipads.findIndex((h) => h.id === input.helipad);
    if (helipad < 0) return { ok: false, reason: `no helipad ${input.helipad}` };
    crafts.push(craft);
    craft.request = { kind: 'helicopter-arrival', helipad, heading: input.headingRad };
    queue.push(craft.id);
    return { ok: true, id: craft.id };
  }
  function requestHelicopterDeparture(id: number, headingRad: number): AircraftResult {
    const craft = crafts[id - 1];
    if (!craft || craft.mode !== 'parked' || craft.helipad < 0)
      return { ok: false, reason: 'not a parked helicopter' };
    craft.request = { kind: 'helicopter-departure', heading: headingRad };
    return { ok: true, id };
  }
  function spawnHelicopterParked(typeId: string, helipad: string, timeS: number): AircraftResult {
    const craft = newCraft(typeId);
    if (typeof craft === 'string') return { ok: false, reason: craft };
    if (craft.type.performance.kind !== 'helicopter')
      return { ok: false, reason: 'not a helicopter' };
    const pad = graph.helipads.findIndex(({ id }) => id === helipad);
    if (pad < 0 || helipadOccupant[pad] !== -1) return { ok: false, reason: 'helipad unavailable' };
    craft.helipad = pad;
    craft.mode = 'parked';
    craft.stillSinceS = timeS;
    craft.pose = {
      position: graph.helipads[pad]!.pos,
      headingRad: 0,
      stationM: 0,
      heightM: 0,
      speedMps: 0,
      phase: 'hover-taxi',
    };
    crafts.push(craft);
    helipadOccupant[pad] = craft.id;
    return { ok: true, id: craft.id };
  }
  function requestHoverTaxi(id: number, helipad: string): AircraftResult {
    const craft = crafts[id - 1];
    const target = graph.helipads.findIndex((h) => h.id === helipad);
    if (!craft || craft.mode !== 'parked' || craft.helipad < 0 || target < 0)
      return { ok: false, reason: 'not a parked helicopter or no such helipad' };
    if (helipadOccupant[target] !== -1) return { ok: false, reason: 'helipad taken' };
    craft.request = { kind: 'hover', helipad: target };
    return { ok: true, id };
  }
  function helicopterStep(craft: Craft, timeS: number) {
    const request = craft.request;
    const p = craft.type.performance as HelicopterPerformance;
    if (craft.mode === 'queued' && request?.kind === 'helicopter-arrival') {
      if (helipadOccupant[request.helipad] !== -1) return;
      const pad = graph.helipads[request.helipad]!.pos;
      const start = {
        x: pad.x - FINAL_M * Math.cos(request.heading),
        y: pad.y - FINAL_M * Math.sin(request.heading),
      };
      const path = aircraftPath([start, pad]);
      craft.air = {
        kind: 'helicopter',
        profile: helicopterLandingProfile(path, p),
        path,
        startS: timeS,
        crossings: [],
        runway: -1,
        thresholdM: 0,
        touchdownM: 0,
        clearM: 0,
        decided: true,
        touched: true,
      };
      craft.mode = 'air';
      craft.helipad = request.helipad;
      helipadOccupant[request.helipad] = craft.id;
      craft.request = null;
      craft.next = [{ kind: 'rest' }];
      return;
    }
    if (craft.mode !== 'parked' || !request) return;
    const pad = graph.helipads[craft.helipad]!.pos;
    if (request.kind === 'helicopter-departure') {
      events.push({ timeS, id: craft.id, kind: 'off-block' });
      const end = {
        x: pad.x + FINAL_M * Math.cos(request.heading),
        y: pad.y + FINAL_M * Math.sin(request.heading),
      };
      const path = aircraftPath([pad, end]);
      craft.air = {
        kind: 'helicopter',
        profile: helicopterTakeoffProfile(path, p),
        path,
        startS: timeS,
        crossings: [],
        runway: -1,
        thresholdM: 0,
        touchdownM: 0,
        clearM: 0,
        decided: true,
        touched: true,
      };
      craft.mode = 'air';
      helipadOccupant[craft.helipad] = -1;
      craft.helipad = -1;
      craft.next = [];
    } else if (request.kind === 'hover') {
      const to = graph.helipads[request.helipad]!.pos;
      const path = aircraftPath([pad, to]);
      craft.air = {
        kind: 'helicopter',
        profile: hoverTaxiProfile(path, p),
        path,
        startS: timeS,
        crossings: [],
        runway: -1,
        thresholdM: 0,
        touchdownM: 0,
        clearM: 0,
        decided: true,
        touched: true,
      };
      craft.mode = 'air';
      helipadOccupant[craft.helipad] = -1;
      helipadOccupant[request.helipad] = craft.id;
      craft.helipad = request.helipad;
      craft.next = [{ kind: 'rest' }];
    }
    craft.request = null;
  }

  // ----- Runway configurations (TASK-300; docs/architecture.md section 8, "Runway
  // configurations"). Until a configuration is set every end is open. A change closes the ends the
  // new configuration drops at once: no approach appears and no departure lines up there, while
  // approaches already on final land and aircraft on the runway complete. Queued arrivals and
  // waiting departures take an end of the new configuration, and taxiing departures re-route to
  // it. The new ends open when nothing uses a closed end any more.
  function resolveEnds(designators: readonly string[]) {
    const keys = new Set<number>();
    for (const designator of designators) {
      const found = findEnd(designator);
      if (!found) throw new Error(`no runway end ${designator}`);
      keys.add(endKey(found.runway, found.end));
    }
    return keys;
  }
  const endName = (key: number) => graph.runways[key >> 1]!.ends[key & 1]!.designator;

  /** Taxiways parallel to an active runway (within 15 degrees and 400 m of its centreline) prefer
   * the direction toward the departure threshold, against the direction of operation. */
  function flowFactors(ends: Set<number>) {
    if (!ends.size) return null;
    const votes = new Int8Array(graph.edges.length);
    const limit = Math.sin((15 * Math.PI) / 180);
    for (const edge of graph.edges) {
      if (edge.kind !== 'taxiway') continue;
      const a = edge.line[0]!,
        b = edge.line.at(-1)!;
      const direction = Math.atan2(b.y - a.y, b.x - a.x);
      const middle = pointAtDistance(edge.line, edge.cumulative, edge.lengthM / 2);
      for (const key of ends) {
        const runway = graph.runways[key >> 1]!;
        const heading = runway.ends[key & 1]!.heading;
        if (Math.abs(Math.sin(direction - heading)) > limit) continue;
        const near = nearestOnPolyline(runway.line, middle);
        if (near.away > 400 || near.along <= 0 || near.along >= runway.lengthM) continue;
        // Forward along the line with the operation is against the flow.
        votes[edge.idx] = votes[edge.idx]! + (Math.cos(direction - heading) > 0 ? 1 : -1);
      }
    }
    const factors = new Float64Array(graph.edges.length * 2).fill(1);
    for (const edge of graph.edges) {
      const vote = votes[edge.idx]!;
      if (vote) factors[arcOf(edge.idx, vote < 0)] = FLOW_FACTOR;
    }
    return factors;
  }

  function setRunwayConfiguration(configuration: RunwayConfiguration | null, timeS = nowS) {
    const arrivals = resolveEnds(configuration?.arrivalEnds ?? []);
    const departures = resolveEnds(configuration?.departureEnds ?? []);
    flowFactor = flowFactors(new Set([...arrivals, ...departures]));
    if (!runways.restricted) {
      runways.restricted = true;
      for (const key of arrivals) arrivalOpen[key] = 1;
      for (const key of departures) departureOpen[key] = 1;
      runways.active = runways.target = configuration;
      runways.arrivals = arrivals;
      runways.departures = departures;
      lightEnds(configuration);
      return;
    }
    if ((configuration?.id ?? null) === (runways.target?.id ?? null)) return;
    runways.transition ??= {
      fromId: runways.active?.id ?? null,
      startS: timeS,
      closing: new Set(),
      rerouted: new Set(),
    };
    for (let key = 0; key < arrivalOpen.length; key++) {
      if (arrivalOpen[key] && !arrivals.has(key)) {
        arrivalOpen[key] = 0;
        runways.transition.closing.add(key);
      }
      if (departureOpen[key] && !departures.has(key)) {
        departureOpen[key] = 0;
        runways.transition.closing.add(key);
      }
    }
    runways.target = configuration;
    runways.arrivals = arrivals;
    runways.departures = departures;
    for (const craft of crafts) {
      if (craft.request?.kind === 'arrival') retargetArrival(craft);
      else if (craft.request?.kind === 'departure') retargetDeparture(craft);
    }
  }

  /** A queued arrival bound for a closed end takes the first new arrival end that reaches its
   * stand. */
  function retargetArrival(craft: Craft) {
    const request = craft.request;
    if (request?.kind !== 'arrival' || !runways.restricted) return;
    if (runways.arrivals.has(endKey(craft.runway, request.end))) return;
    for (const key of runways.arrivals) {
      const runway = graph.runways[key >> 1]!;
      if (!landings(craft, runway, key & 1, request.stand).some((o) => o())) continue;
      craft.runway = runway.idx;
      craft.end = key & 1;
      craft.request = { ...request, end: key & 1 };
      return;
    }
  }

  function retargetDeparture(craft: Craft) {
    const request = craft.request;
    if (request?.kind !== 'departure' || runways.departures.has(endKey(craft.runway, request.end)))
      return;
    for (const key of runways.departures) {
      if (graph.runways[key >> 1]!.maxCode < craft.code) continue;
      craft.runway = key >> 1;
      craft.end = key & 1;
      craft.request = { ...request, end: key & 1 };
      return;
    }
  }

  /** Whether a taxiing departure is bound for an end the target configuration does not use. */
  function needsReroute(craft: Craft) {
    if (!runways.restricted || craft.mode !== 'ground' || !runways.departures.size) return false;
    const takeoff = craft.next.find((n) => n.kind === 'takeoff');
    return !!takeoff && !runways.departures.has(endKey(craft.runway, takeoff.end));
  }

  /** Re-routes a taxiing departure to a departure end of the target configuration: its taxi leg
   * is kept up to a node it can still turn at and continues from there to the new line-up. A
   * departure holding a runway grant (crossing or lining up) keeps its route until it is clear;
   * one whose new route cannot be locked yet tries again on the next step. */
  function reroute(craft: Craft) {
    const takeoff = craft.next.findIndex((n) => n.kind === 'takeoff');
    const leg = craft.leg!;
    if (leg.gates.some((g) => g.granted && !g.released)) return false;
    const current = takeoff === 0;
    const before = craft.next[takeoff - 1];
    if (!current && before?.kind !== 'taxi') return false;
    const target = current || before?.kind !== 'taxi' ? leg : before.leg;
    const p = fixedWing(craft);
    const s = current ? craft.stationM : -Infinity;
    const brake = current ? craft.speedMps ** 2 / (2 * p.brakingDecelerationMps2) : 0;
    // The kept leg ends at a node far enough ahead that its corner is not yet rounded.
    const k = target.pieces.findIndex(
      (piece) =>
        piece.endNode >= 0 &&
        piece.endM - Math.max(brake + 20, 0.5 * (piece.endM - piece.startM)) >= s,
    );
    if (k < 0) return false;
    const last = target.pieces[k]!;
    const kept = target.pieces
      .slice(0, k + 1)
      .map((piece) =>
        arcSegment(arcOf(piece.edge, piece.toE >= piece.fromE), piece.fromE, piece.toE),
      );
    for (const key of runways.departures) {
      const runway = graph.runways[key >> 1]!;
      if (runway.maxCode < craft.code) continue;
      for (const option of lineUps(craft, runway, key & 1)) {
        const route = routeAirside(graph, {
          code: craft.code,
          turnRadiusM: p.minTurnRadiusM,
          from: { arc: arcOf(last.edge, last.toE >= last.fromE) },
          goal: (a) => a === option.goal,
          stand: -1,
          factor: (arc) => oppositeFactor(craft, arc),
        });
        if (!route) continue;
        const next = buildLeg(craft, 'taxi', [
          ...kept,
          ...route.arcs.slice(0, -1).map((a) => arcSegment(a)),
          ...option.after(),
        ]);
        addGates(craft, next, runway.idx);
        // Runway gates already passed stay passed; one it would have to stop at behind it fails.
        const half = craft.lengthM / 2;
        for (const gate of next.gates)
          if (gate.vacateM < s - half) gate.granted = gate.released = true;
        if (next.gates.some((g) => !g.granted && g.holdM < s - 0.01)) continue;
        if (!lockable(craft, next, k + 1, next.pieces.length)) continue;
        if (!surfaceClear(craft, [next], 0, false, false, s - half)) continue;
        for (const piece of target.pieces.slice(k + 1))
          if (piece.locked) unlock(craft, piece.edge, piece.toE >= piece.fromE ? 1 : -1);
        for (let i = 0; i <= k; i++) next.pieces[i]!.locked = target.pieces[i]!.locked;
        lock(craft, next, k + 1, next.pieces.length);
        sweepCache.delete(target);
        if (current) {
          craft.leg = next;
          craft.plan = null;
          craft.claimHi = Math.min(craft.claimHi, last.endM);
          publish(craft);
        } else
          craft.next[takeoff - 1] = {
            kind: 'taxi',
            pauseS: before?.kind === 'taxi' ? before.pauseS : 0,
            leg: next,
          };
        craft.next[takeoff] = {
          kind: 'takeoff',
          end: key & 1,
          lineUpU: option.lineUpU,
          pauseS: LINEUP_S,
        };
        craft.runway = runway.idx;
        craft.end = key & 1;
        return true;
      }
    }
    return false;
  }

  /** Whether an aircraft still uses a runway end: on approach to it, lined up or rolling on it,
   * climbing out or going around from it (on the new configuration's approach line, for a
   * reversal), or holding a runway grant for it. */
  function usesEnd(craft: Craft, key: number) {
    if (craft.runway < 0 || endKey(craft.runway, craft.end) !== key) return false;
    if (craft.mode === 'waiting' || craft.mode === 'air') return true;
    return craft.mode === 'ground' && craft.leg!.gates.some((g) => g.granted && !g.released);
  }

  /** Re-routes taxiing departures and opens the target configuration once its closed ends are
   * clear. */
  function settleRunways() {
    if (!runways.restricted) return;
    const transition = runways.transition;
    for (const craft of crafts) {
      if (!needsReroute(craft) || nowS - craft.retryS < 1) continue;
      craft.retryS = nowS;
      if (!reroute(craft)) continue;
      // A departure re-routed after the change opened counts toward it.
      const opened = runways.transitions.at(-1);
      if (transition) transition.rerouted.add(craft.id);
      else if (opened) opened.rerouted++;
    }
    if (!transition) return;
    for (const key of transition.closing) if (crafts.some((craft) => usesEnd(craft, key))) return;
    for (const key of runways.arrivals) arrivalOpen[key] = 1;
    for (const key of runways.departures) departureOpen[key] = 1;
    runways.active = runways.target;
    lightEnds(runways.active);
    runways.transitions.push({
      fromId: transition.fromId,
      toId: runways.target?.id ?? null,
      startS: transition.startS,
      openS: nowS,
      rerouted: transition.rerouted.size,
    });
    runways.transition = null;
  }

  /** The airfield lights (TASK-301) show a configuration's ends once it opens. */
  const lightEnds = (configuration: RunwayConfiguration | null) =>
    setActiveEnds({
      arrivalEnds: [...(configuration?.arrivalEnds ?? [])],
      departureEnds: [...(configuration?.departureEnds ?? [])],
    });

  function runwaySnapshot(): RunwaySnapshot | null {
    if (!runways.restricted) return null;
    const open = (flags: Uint8Array) => [...flags.keys()].filter((key) => flags[key]).map(endName);
    const transition = runways.transition;
    return {
      configuration: runways.active?.id ?? null,
      arrivalEnds: open(arrivalOpen),
      departureEnds: open(departureOpen),
      switching: transition
        ? {
            to: runways.target?.id ?? null,
            sinceS: transition.startS,
            closingEnds: [...transition.closing]
              .filter((key) => crafts.some((craft) => usesEnd(craft, key)))
              .map(endName),
            rerouted: transition.rerouted.size,
          }
        : null,
    };
  }

  // ----- Stepping.
  function stepAir(craft: Craft, timeS: number) {
    const air = craft.air!;
    const elapsed = timeS - air.startS;
    const pose = air.profile.sample(elapsed);
    craft.pose = pose;
    craft.stationM = pose.stationM;
    craft.speedMps = pose.speedMps;
    if (air.kind === 'approach') {
      const thresholdS = air.startS + air.thresholdM / fixedWing(craft).approachSpeedMps;
      if (!air.decided && timeS >= thresholdS - DECISION_S) {
        air.decided = true;
        const held = runwaysAt(air.runway).some(
          (r) => runwayOccupant[r] !== -1 && runwayOccupant[r] !== craft.id,
        );
        if (held || !commitLanding(craft)) return goAround(craft, timeS);
        for (const r of runwaysAt(air.runway)) {
          runwayOccupant[r] = craft.id;
          runwayClearS[r] = craft.bookingToS;
        }
      }
      if (!air.touched && pose.stationM >= air.touchdownM) {
        air.touched = true;
        events.push({ timeS, id: craft.id, kind: 'landed' });
        counts.landed++;
      }
    }
    if (air.kind === 'takeoff' && pose.stationM >= air.clearM)
      for (const r of runwaysAt(air.runway))
        if (runwayOccupant[r] === craft.id) runwayOccupant[r] = -1;
    if (elapsed < air.profile.durationS) return;
    // The air leg is over.
    if (air.kind === 'approach') {
      const next = craft.next.shift();
      if (next?.kind !== 'taxi') throw new Error('An arrival ends its roll-out without a taxi leg');
      craft.air = null;
      setLeg(craft, next.leg, timeS, pose.speedMps, true);
      return;
    }
    if (air.kind === 'helicopter' && craft.next[0]?.kind === 'rest') {
      if (pose.phase === 'vertical-descent') {
        events.push({ timeS, id: craft.id, kind: 'landed' });
        counts.landed++;
      }
      events.push({ timeS, id: craft.id, kind: 'parked' });
      craft.next = [];
      craft.air = null;
      craft.mode = 'parked';
      craft.pose = { ...pose, heightM: 0, speedMps: 0 };
      craft.stillSinceS = timeS;
      return;
    }
    if (air.kind === 'go-around') {
      craft.mode = 'queued';
      craft.air = null;
      craft.pose = null;
      craft.request = { kind: 'arrival', end: craft.end, stand: craft.stand };
      retargetArrival(craft);
      queue.push(craft.id);
      return;
    }
    // A take-off or a helicopter departure reaches the end of its climb.
    craft.mode = 'done';
    craft.air = null;
    craft.pose = null;
    events.push({ timeS, id: craft.id, kind: 'departed' });
    counts.departed++;
  }

  function goAround(craft: Craft, timeS: number) {
    const pose = craft.pose!;
    const p = fixedWing(craft);
    const heading = pose.headingRad;
    const start = pose.position;
    const path = aircraftPath([
      start,
      {
        x: start.x + CLIMB_OUT_M * Math.cos(heading),
        y: start.y + CLIMB_OUT_M * Math.sin(heading),
      },
    ]);
    const h0 = pose.heightM;
    // A go-around climbs straight ahead at approach speed and the type's climb gradient.
    const profile: AircraftMotionProfile = {
      durationS: path.lengthM / p.approachSpeedMps,
      sample(elapsedS) {
        const stationM = Math.min(path.lengthM, Math.max(0, elapsedS) * p.approachSpeedMps);
        return {
          stationM,
          heightM: h0 + p.climbGradient * stationM,
          speedMps: p.approachSpeedMps,
          phase: 'climb',
          position: pointAtDistance(path.points, path.stationsM, stationM),
          headingRad: heading,
        };
      },
    };
    craft.air = {
      kind: 'go-around',
      profile,
      path,
      startS: timeS,
      crossings: crossingsOn(path),
      runway: craft.runway,
      thresholdM: 0,
      touchdownM: 0,
      clearM: 0,
      decided: true,
      touched: true,
    };
    craft.next = [];
    craft.bookingFromS = Infinity;
    craft.bookingToS = -Infinity;
    unlockAll(craft);
    craft.claimed = [];
    craft.claimedNodes = [];
    events.push({ timeS, id: craft.id, kind: 'go-around' });
    counts.goArounds++;
  }

  function stepGround(craft: Craft, timeS: number) {
    const leg = craft.leg!;
    const p = fixedWing(craft);
    const half = craft.lengthM / 2;
    if (timeS < craft.pauseUntilS) return;
    // Locks for the rest of the leg, once free.
    const s = craft.stationM;
    const v = craft.speedMps;
    const brake = (v * v) / (2 * p.brakingDecelerationMps2);
    // Standing at a hold or waiting for locks, an aircraft keeps its body and 10 m ahead only:
    // its margin would close a junction that another aircraft's locked leg crosses.
    const held = leg.gates.find((g) => !g.granted)?.holdM ?? Infinity;
    if (v === 0 && held <= s + 0.01) craft.claimHi = Math.min(craft.claimHi, s + half + 10);
    // Extend claims ahead before they bind.
    else if (craft.claimHi < s + half + brake + margin + 20 && craft.claimHi < leg.path.lengthM) {
      const target = Math.min(leg.path.lengthM, s + half + brake + margin + 80);
      const conflict = firstConflict(craft, leg, craft.claimHi, target);
      craft.claimHi = Math.max(craft.claimHi, Math.min(target, conflict));
    }
    craft.claimLo = Math.max(craft.claimLo, s - half - margin);
    publish(craft);
    // Runway gates: ask when near the hold with the way to it claimed (first in line there).
    for (const gate of leg.gates) {
      if (gate.granted) continue;
      if (s + brake + 35 < gate.holdM || craft.claimHi < gate.holdM + half) break;
      const next = craft.next.find((n) => n.kind === 'takeoff');
      // No line-up on an end the runway configuration has not opened.
      if (
        runways.restricted &&
        gate.vacateM === Infinity &&
        next?.kind === 'takeoff' &&
        !departureOpen[endKey(craft.runway, next.end)]
      )
        break;
      const through = Math.min(leg.path.lengthM, gate.vacateM + craft.lengthM + margin);
      if (through > craft.claimHi && firstConflict(craft, leg, craft.claimHi, through) < Infinity)
        break;
      // A departure's grant covers its line-up and the take-off to the far end.
      gate.occupancyS =
        gate.vacateM === Infinity && next?.kind === 'takeoff'
          ? departureOccupancyS(craft, leg, next)
          : (gate.vacateM - s + half) / (p.taxiStraightMps * 0.6) + RUNWAY_BUFFER_S;
      const clearS = timeS + gate.occupancyS;
      if (bookingFits(gate.runway, timeS, clearS + RUNWAY_BUFFER_S, craft.id)) {
        gate.granted = true;
        craft.claimHi = Math.max(through, craft.claimHi);
        publish(craft);
        for (const r of runwaysAt(gate.runway)) {
          runwayOccupant[r] = craft.id;
          runwayClearS[r] = clearS;
        }
      }
      break;
    }
    let stop = leg.endM;
    const gate = leg.gates.find((g) => !g.granted);
    if (gate) stop = Math.min(stop, gate.holdM);
    // Claims end at the leg's end, where the next leg takes over.
    if (craft.claimHi < leg.path.lengthM - 1e-6)
      stop = Math.min(stop, craft.claimHi - margin - half);
    stop = Math.max(stop, s);
    if (
      !craft.plan ||
      stop > craft.planStop + 0.5 ||
      (stop >= leg.endM && craft.planStop < leg.endM)
    ) {
      const options = { startStationM: s, startSpeedMps: v, stopStationM: stop };
      craft.plan =
        leg.mode === 'pushback'
          ? pushbackProfile(leg.path, p, options)
          : leg.mode === 'tow'
            ? towProfile(leg.path, p, options)
            : taxiProfile(leg.path, p, options);
      craft.planS = timeS;
      craft.planStop = stop;
    }
    const pose = craft.plan.sample(timeS - craft.planS);
    craft.stationM = pose.stationM;
    craft.speedMps = pose.speedMps;
    craft.pose = pose;
    if (pose.speedMps > 0.05) craft.stillSinceS = timeS;
    // Release what the tail has passed.
    const tail = craft.stationM - half;
    for (const piece of leg.pieces)
      if (piece.locked && piece.endM <= tail) {
        piece.locked = false;
        unlock(craft, piece.edge, piece.toE >= piece.fromE ? 1 : -1);
      }
    for (const g of leg.gates)
      if (g.granted && !g.released && tail >= g.vacateM) {
        g.released = true;
        for (const r of runwaysAt(g.runway))
          if (runwayOccupant[r] === craft.id) runwayOccupant[r] = -1;
        craft.bookingFromS = Infinity;
        craft.bookingToS = -Infinity;
      }
    if (craft.stationM >= leg.endM - 1e-6 && craft.speedMps === 0) finishLeg(craft, timeS);
  }

  function departureOccupancyS(craft: Craft, leg: Leg, next: Extract<Next, { kind: 'takeoff' }>) {
    const p = fixedWing(craft);
    const lineUpS = (leg.endM - craft.stationM) / (0.5 * p.taxiTurnMps) + 10;
    const air = takeoffAir(craft, next.end, next.lineUpU, 0);
    return lineUpS + next.pauseS + timeTo(air.profile, air.clearM) + 5;
  }

  function finishLeg(craft: Craft, timeS: number) {
    const leg = craft.leg!;
    if (leg.mode === 'pushback') craft.pushSweep = undefined;
    const next = craft.next.shift();
    if (!next) throw new Error(`Aircraft ${craft.registration} finished a leg with nothing next`);
    if (next.kind === 'park') {
      park(craft, leg, next.stand, timeS);
      events.push({ timeS, id: craft.id, kind: leg.mode === 'tow' ? 'towed' : 'parked' });
      if (leg.mode === 'tow') counts.towed++;
    } else if (next.kind === 'rest') {
      park(craft, leg, -1, timeS);
      craft.stand = -1;
      events.push({ timeS, id: craft.id, kind: 'towed' });
      counts.towed++;
    } else if (next.kind === 'taxi') {
      unlockLeg(craft, leg);
      setLeg(craft, next.leg, timeS);
      craft.pauseUntilS = timeS + next.pauseS;
    } else {
      unlockLeg(craft, leg);
      craft.claimed = [];
      craft.claimedNodes = [];
      craft.pauseUntilS = timeS + next.pauseS;
      craft.next = [];
      craft.mode = 'waiting';
      craft.air = takeoffAir(craft, next.end, next.lineUpU, timeS + next.pauseS);
      craft.stand = -1;
    }
  }

  function unlockLeg(craft: Craft, leg: Leg) {
    for (const piece of leg.pieces)
      if (piece.locked) {
        piece.locked = false;
        unlock(craft, piece.edge, piece.toE >= piece.fromE ? 1 : -1);
      }
  }

  function updateCrossings() {
    crossingClosed.fill(0);
    if (!graph.crossings.length) return;
    for (const craft of crafts) {
      const pose = craft.pose;
      if (!pose || craft.mode === 'done' || craft.mode === 'queued' || craft.mode === 'parked')
        continue;
      if (pose.heightM >= CROSSING_HEIGHT_M) continue;
      const list = craft.mode === 'ground' ? craft.leg!.crossings : (craft.air?.crossings ?? []);
      const half = craft.lengthM / 2;
      const s = craft.mode === 'waiting' ? 0 : craft.stationM;
      for (const { crossing, stationM } of list) {
        const ahead = Math.max(150, 25 * craft.speedMps);
        if (s + half >= stationM - ahead && s - half <= stationM + 10) crossingClosed[crossing] = 1;
      }
    }
  }

  function step(timeS: number) {
    nowS = timeS;
    // Queued arrivals appear in request order when their runway window is free.
    for (let i = 0; i < queue.length; i++) {
      const craft = crafts[queue[i]! - 1]!;
      const request = craft.request;
      if (request?.kind === 'arrival' && timeS - craft.retryS >= RETRY_S) {
        craft.retryS = timeS;
        trySpawnArrival(craft, request, timeS);
      } else if (request?.kind === 'helicopter-arrival') helicopterStep(craft, timeS);
      if (craft.mode !== 'queued') queue.splice(i--, 1);
    }
    for (const craft of crafts) {
      if (craft.mode === 'done' || craft.mode === 'queued') continue;
      if (craft.type.performance.kind === 'helicopter') {
        if (craft.mode === 'parked') helicopterStep(craft, timeS);
        if (craft.mode === 'air') stepAir(craft, timeS);
        continue;
      }
      if (craft.mode === 'parked') {
        if (craft.request) tryStart(craft, timeS);
      } else if (craft.mode === 'waiting') {
        if (timeS >= craft.pauseUntilS) {
          craft.mode = 'air';
          craft.air!.startS = timeS;
          stepAir(craft, timeS);
        }
      } else if (craft.mode === 'air') stepAir(craft, timeS);
      if (craft.mode === 'ground') stepGround(craft, timeS);
    }
    settleRunways();
    updateCrossings();
  }

  function stateOf(craft: Craft): AircraftState {
    if (craft.mode === 'parked') return 'parked';
    if (craft.mode === 'waiting') return 'line-up';
    if (craft.mode === 'air') {
      const air = craft.air!;
      if (air.kind === 'go-around') return 'go-around';
      const phase = craft.pose!.phase;
      return phase as AircraftState;
    }
    const leg = craft.leg!;
    if (leg.mode !== 'taxi') return leg.mode;
    const departing = leg.gates.find((g) => g.vacateM === Infinity);
    if (craft.speedMps === 0 && timeSince(craft) > 1) {
      const gate = leg.gates.find((g) => !g.granted);
      if (gate && craft.stationM >= gate.holdM - 1) return 'holding';
    }
    if (departing?.granted && craft.stationM >= departing.holdM - 1) return 'line-up';
    return 'taxi';
  }
  const timeSince = (craft: Craft) => nowS - craft.stillSinceS;

  function onRunway(craft: Craft) {
    if (craft.mode === 'waiting') return true;
    if (craft.mode === 'air') {
      const air = craft.air!;
      const pose = craft.pose!;
      if (air.kind === 'takeoff') return pose.stationM <= air.clearM && pose.heightM < 30;
      if (air.kind === 'approach')
        return pose.stationM >= air.thresholdM - craft.lengthM / 2 && pose.heightM < 30;
      return false;
    }
    if (craft.mode !== 'ground') return false;
    const half = craft.lengthM / 2;
    return craft.leg!.runwayRanges.some(
      ([a, b]) => craft.stationM + half > a && craft.stationM - half < b,
    );
  }

  function snapshot(): AircraftPoseSnapshot[] {
    const result: AircraftPoseSnapshot[] = [];
    for (const craft of crafts) {
      const pose = craft.pose;
      if (!pose || craft.mode === 'done' || craft.mode === 'queued') continue;
      const state = stateOf(craft);
      const airborne = pose.heightM > 0.01;
      const route: number[] = [];
      if (craft.mode === 'ground') {
        for (const piece of craft.leg!.pieces)
          if (piece.endM > craft.stationM && route.at(-1) !== piece.edge) route.push(piece.edge);
      }
      for (const next of craft.next)
        if (next.kind === 'taxi')
          for (const piece of next.leg.pieces)
            if (route.at(-1) !== piece.edge) route.push(piece.edge);
      const climbing = craft.air?.kind === 'takeoff' || craft.air?.kind === 'go-around';
      result.push({
        id: craft.id,
        registration: craft.registration,
        typeId: craft.type.id,
        x: pose.position.x,
        y: pose.position.y,
        heightM: pose.heightM,
        heading: pose.headingRad,
        speedMps: pose.speedMps,
        state,
        enginesRunning: state !== 'parked' && !craft.towing,
        onRunway: onRunway(craft),
        airborne,
        gearDown: !airborne || pose.heightM < (climbing ? GEAR_CLIMB_M : GEAR_APPROACH_M),
        stand: craft.stand >= 0 ? graph.stands[craft.stand]!.id : null,
        runwayEnd:
          craft.runway >= 0 && craft.end >= 0
            ? graph.runways[craft.runway]!.ends[craft.end]!.designator
            : null,
        route,
      });
    }
    return result;
  }

  /** TASK-301: the runway ends in use from now on, by designator; runways not named go unused. */
  function setActiveEnds(ends: { arrivalEnds: string[]; departureEnds: string[] }) {
    arrivalEnd.fill(-1);
    departureEnd.fill(-1);
    for (const [designators, into] of [
      [ends.arrivalEnds, arrivalEnd],
      [ends.departureEnds, departureEnd],
    ] as const)
      for (const designator of designators) {
        const found = findEnd(designator);
        if (found) into[found.runway] = found.end;
      }
  }

  /** TASK-301: what the airfield lights show: the ends in use, and the holding positions whose
   * stop bar is off (an aircraft cleared past it whose tail has not passed it yet). */
  function airfield(): AirfieldSnapshot {
    const clearedHolds: number[] = [];
    for (const craft of crafts) {
      if (craft.mode !== 'ground' || !craft.leg) continue;
      const tail = craft.stationM - craft.lengthM / 2;
      for (const g of craft.leg.gates)
        if (g.granted && g.hold >= 0 && tail < g.holdNodeM && !clearedHolds.includes(g.hold))
          clearedHolds.push(g.hold);
    }
    return {
      arrivalEnds: Array.from(arrivalEnd),
      departureEnds: Array.from(departureEnd),
      clearedHolds: clearedHolds.sort((a, b) => a - b),
      glideSlopeDeg: glideDeg,
      ...(runways.restricted && { runways: runwaySnapshot()! }),
    };
  }

  function metrics(): AircraftMetrics {
    let active = 0,
      stuck = 0;
    for (const craft of crafts) {
      if (craft.mode === 'done' || craft.mode === 'queued') continue;
      active++;
      if (craft.mode === 'ground' && nowS - craft.stillSinceS > STUCK_S) stuck++;
    }
    return {
      active,
      queuedArrivals: queue.length,
      ...counts,
      stuck,
      reconfigurations: runways.transitions.length,
      rerouted: runways.transitions.reduce((n, t) => n + t.rerouted, 0),
    };
  }

  return {
    graph,
    spawnParked,
    spawnHelicopterParked,
    requestArrival,
    requestDeparture,
    requestTow,
    requestHelicopterArrival,
    requestHelicopterDeparture,
    requestHoverTaxi,
    step,
    snapshot,
    airfield,
    setActiveEnds,
    metrics,
    crossingClosed,
    setRunwayConfiguration,
    runwaySnapshot,
    /** Completed runway configuration changes, in order. */
    runwayTransitions: (): readonly RunwayTransition[] => runways.transitions,
    /** Events since the last call. */
    drainEvents: () => events.splice(0),
    /** The aircraft parked at a stand, or -1. */
    standOccupant: (stand: number) => standOccupant[stand]!,
    standReservation: (stand: number) => standBound[stand]!,
    standTurnCost,
    standPairSafe(typeId: string, stand: number, otherId: number, otherStand: number) {
      const own = standEnvelopes.get(standKey(typeId, stand))!;
      const other = crafts[otherId - 1]!;
      const theirs = standEnvelopes.get(standKey(other.type.id, otherStand));
      if (!theirs) {
        if (!other.pose) return true;
        const body = bodyAt(other, other.pose.position, other.pose.headingRad);
        return !bodiesTouch(own.parked, body) && !own.push.some((p) => bodiesTouch(p, body));
      }
      return (
        !bodiesTouch(own.parked, theirs.parked) &&
        !own.push.some((p) => bodiesTouch(p, theirs.parked)) &&
        !theirs.push.some((p) => bodiesTouch(p, own.parked))
      );
    },
    helipadFree: (pad: number) => helipadOccupant[pad] === -1,
    registrationOf: (id: number) => crafts[id - 1]?.registration,
    arrivalLeadS(typeId: string) {
      const performance = aircraftTypes.find(({ id }) => id === typeId)!.performance;
      return performance.kind === 'fixedWing' ? FINAL_M / performance.approachSpeedMps : 0;
    },
    statusOf: (id: number) => {
      const craft = crafts[id - 1];
      return craft?.pose && craft.mode !== 'done' && craft.mode !== 'queued'
        ? stateOf(craft)
        : undefined;
    },
    /** Whether a stand is free and not bound for an arrival or a tow. */
    standFree: (stand: number) => standOccupant[stand] === -1 && standBound[stand] === -1,
    /** A parked aircraft with no request. */
    idle: (id: number) => crafts[id - 1]?.mode === 'parked' && !crafts[id - 1]!.request,
    /** Parked aircraft with no request, with their type and since when they stand. */
    parked: () =>
      crafts
        .filter((c) => c.mode === 'parked' && !c.request)
        .map((c) => ({ id: c.id, typeId: c.type.id, stand: c.stand, sinceS: c.stillSinceS })),
    /** Whether a free stand takes a type: its code, and a way out for it. */
    standAdmits(stand: number, typeId: string) {
      const craft = newCraft(typeId);
      return typeof craft !== 'string' && craft.code >= 0 && !standCheck(craft, stand);
    },
    typeOf: (id: number) => crafts[id - 1]?.type,
    runwayOccupant: (runway: number) => runwayOccupant[runway]!,
    hash(word: (hash: number, value: number) => number, hash: number) {
      hash = word(hash, crafts.length);
      for (const craft of crafts) {
        hash = word(
          hash,
          ['queued', 'air', 'ground', 'parked', 'waiting', 'done'].indexOf(craft.mode),
        );
        if (!craft.pose) continue;
        hash = word(hash, Math.round(craft.pose.position.x * 100));
        hash = word(hash, Math.round(craft.pose.position.y * 100));
        hash = word(hash, Math.round(craft.pose.heightM * 100));
        hash = word(hash, Math.round(craft.speedMps * 100));
      }
      return hash;
    },
  };
}

export type AircraftFleet = ReturnType<typeof createAircraftFleet>;
