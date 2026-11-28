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
import {
  runwayIntersectionAreas,
  type AirsideGraph,
  type AirsideRunwayC,
  type AirsideStandC,
  type RunwayIntersectionArea,
} from '../network/airside';
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
  codeSpanLimitM,
  type AircraftClass,
  type AircraftType,
  type FixedWingPerformance,
  type HelicopterPerformance,
} from '../schema/aircraft';
import {
  airborneAttitude,
  aircraftPath,
  approachProfile,
  goAroundAttitude,
  groundAttitude,
  HELICOPTER_PAD_CLEARANCE_M,
  helicopterLandingProfile,
  helicopterTakeoffProfile,
  hoverTaxiProfile,
  lineUpAttitude,
  pushbackProfile,
  takeoffProfile,
  taxiEntrySpeedMps,
  taxiProfile,
  towProfile,
  type AircraftMotionProfile,
  type AircraftPath,
  type AircraftPose,
  type AircraftVisualPose,
} from './aircraft-motion';
import type { RunwayConfiguration } from './runway-configuration';

// TASK-298: aircraft on the airside (docs/architecture.md section 8, "Aircraft"). Aircraft move
// along legs: a ground leg follows graph arcs (taxi, pushback, tow) under three rules that keep
// bodies apart; an air leg is a TASK-306 profile (approach and landing roll, take-off and climb).
// - Claims: a moving aircraft holds the stretch of its leg from its tail less a margin to its
//   nose plus its braking distance and the margin, as intervals of edges and the nodes inside;
//   no two aircraft's claims share an edge interval or a node, so a follower keeps two margins
//   behind and a crossing aircraft waits a margin short of the junction.
// - Order (TASK-312, in place of TASK-298's whole-route direction locks and TASK-299's whole-route
//   admission): when a movement is admitted (a departure or tow at its request, an arrival before
//   it appears) its swept path is compared with every other aircraft's remaining path. Where the
//   bodies would touch, the one admitted first passes first: the newcomer stops one sample short
//   of the conflict until the other is past it (on a stretch both follow each other on, until the
//   other is in ahead of it, the claims keeping them apart from there). One order for every
//   conflict means no ring of aircraft can wait on each other; an aircraft waited for ignores the
//   margins of those waiting, which stand clear of its path. An arrival appears only when the
//   conflicts before its tail is off the runway are passed; a re-routed departure is ordered anew.
//   TASK-329: an aircraft that has started never waits for one that has not: starting, it goes
//   before the departures and tows still at their stands, and it does not start (it waits at its
//   stand or in the air) while it would wait for a queued arrival or an aircraft parked in its way.
//   A ring of waits that still closes (through those parked in the way) is broken after 60 s.
//   TASK-330: a queued arrival that cannot reach where it meets a departure or tow before that
//   aircraft is past does not hold it at its stand: the starter goes before it.
//   TASK-363 (switch T363=pk, on by default; T363= turns it off): a queued arrival whose way to its stand passes an
//   aircraft parked across it steps out of the landing order until the way is clear; queued
//   arrivals to one end keep the order in which they were first sequenced.
//   TASK-330: arrivals are spaced on final (2.5 NM or the wake pair); one appears behind an
//   arrival ahead to the same runway when that one will be clear of its way off the runway by its
//   landing commitment, not only once it is.
//   Edges an aircraft will use are still marked with its direction: routes avoid running against
//   them where they can.
// - Runways: one aircraft holds each runway it uses and each intersection area its path reaches.
//   The runway is released on vacating; an area is released once the aircraft's tail clears it.
//   Ground aircraft stop at the holding position until granted.
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
/** TASK-330 (fix 4): how far a rounded bend may run inside the drawn centre line. */
const CORNER_CUT_M = 3;
/** Without a mapped holding position, aircraft hold this far short of the runway node. */
const HOLD_FALLBACK_M = 75;
/** After a push the nose stands this far past the stand's lead-in root. */
const PUSH_CLEAR_M = 10;
const TUG_S = 20;
/** Boarding complete and tug attached. Give the bridge time to stow before moving off stand. */
const pushbackPreparationS: Record<AircraftClass, number> = {
  double_decker: 10,
  widebody: 8,
  narrowbody: 6,
  regional_jet: 6,
  propeller: 5,
  private: 5,
  helicopter: 0,
};
const LINEUP_S = 5;
const FULL_LENGTH_M = 60;
/** With no full-length entry or intersection departure, a backtrack of at most this far along the
 * runway is taken before a longer one. */
const BACKTRACK_M = 1000;
/** TASK-352: a departure lining up this far past where the one ahead of it started its roll
 * departs from an intermediate part of the runway (ICAO Doc 4444, 5.8.3.2). */
const INTERMEDIATE_M = 150;
/** TASK-360 rule 1: an intersection take-off leaves 15 % of its take-off run spare in the runway
 * ahead. The run (`need`: the roll and 3 s at rotation speed) is about the distance to 35 ft, and
 * certification's all-engines take-off distance is 115 % of it (CS-25.113(a)(2), 14 CFR
 * 25.113(a)(2)); the declared distance from an intermediate holding position must cover it. */
const INTERSECTION_FACTOR = 1.15;
/** TASK-360 rule 1: picking its entry, a departure counts this many metres of taxi route for each
 * other departure planned to that entry and not yet lined up (the controller assigns another
 * intermediate holding position when one is queued: CAP 493, Section 2, Chapter 1, 14.2). */
const ENTRY_QUEUE_M = 300;
/** TASK-360 rule 3: in a multiple line-up the rear aircraft's nose stays this far behind the front
 * aircraft's tail. CAP 493 (Section 2, Chapter 1, 10F) asks for particular care with the jet blast
 * of preceding departures in multiple line-ups and sets no distance; 200 m is our choice. */
const MULTI_LINEUP_M = 200;
/** TASK-360 rule switches, read when a fleet is created (the gate ladder's variants): the env
 * T360=<letters>, i intersection take-offs by performance, r line-up behind a passing roll, m
 * multiple line-ups, a rule 1 also on runways that cross others; i, r and m by default, T360=
 * (empty) for the line-up choice before them. */
function t360Rules() {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  const rules = env?.T360 ?? 'irm';
  return {
    T360I: rules.includes('i'),
    T360R: rules.includes('r'),
    T360M: rules.includes('m'),
    T360A: rules.includes('a'),
  };
}
/** TASK-363 rule switches, read when a fleet is created (the gate ladder's variants): the env
 * T363=<letters>, p a queued arrival that cannot reach its stand past an aircraft parked across
 * its way steps out of the landing order, k queued arrivals to one end keep their places in the
 * approach sequence. Both on by default (owner 2026-11-27: Heathrow days up, go-arounds 51 to 71
 * accepted); T363= turns them off. */
function t363Rules() {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  const rules = env?.T363 ?? 'pk';
  return { T363P: rules.includes('p'), T363K: rules.includes('k') };
}
/** TASK-382 rule switch, read when a fleet is created: the env T382=<letters>, r a tow's route
 * keeps off the taxiways arrivals leave the runway by. */
function t382Rules() {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  const rules = env?.T382 ?? '';
  return { T382R: rules.includes('r'), T382S: rules.includes('s') };
}
/** An arrival claims its runway this long before its threshold, or goes around. */
const DECISION_S = 30;
/** Spare time around runway bookings and grants. */
const RUNWAY_BUFFER_S = 20;
/** TASK-312: an arrival's own window is padded by this much: from its decision point to its
 * tail off the runway, about 90 s from one landing to the next as at a busy runway (the
 * grants of departures and crossings keep RUNWAY_BUFFER_S). */
const ARRIVAL_PAD_S = 5;
/** TASK-330 landing booking: on a runway that crosses no other, a landing books its runway from
 * this long before its threshold (not DECISION_S), and the runway must be clear by then. */
const CLEAR_BEFORE_S = 5;
const RETRY_S = 5;
/** TASK-358: a helicopter below this height (the low bodies of the pushback sweep check) on or
 * near a helipad is kept clear of aircraft on the ground, and they of it. */
const HELI_CLEAR_M = 20;
/** TASK-329: a ring of waits lasting this long is broken. */
const RING_S = 60;
/** TASK-330 progressive order: a conflict is ordered only once one of the two aircraft is
 * within this distance of it along its route; later ones as the aircraft move. */
const ORDER_HORIZON_M = 300;
/** TASK-330: one landing to the next on a runway end, and the time a starter keeps in hand
 * against a queued arrival it goes before. */
const LANDING_GAP_S = 90;
const HORIZON_S = 120;
/** TASK-330 Phase 1e: how near its way off a ground aircraft is ordered at an arrival's release. */
const EXIT_NEAR_M = 200;
/** TASK-330 Phase 1e step 2: how far a landing aircraft's tail is past a crossing before it goes. */
const CROSS_BEHIND_M = 60;
/** An aircraft waiting this long at a hold gets a gap between arrivals. */
const RUNWAY_GAP_WAIT_S = 30;
/** TASK-330: radar spacing on final, threshold to threshold: the minimum, and the wake pairs
 * (ICAO Doc 4444; leader category, then follower's) where longer. */
const NM = 1852;
const FINAL_SPACING_M = 2.5 * NM;
type Wake = 'super' | 'heavy' | 'medium' | 'light';
const wakeSpacingNm: Partial<Record<Wake, Partial<Record<Wake, number>>>> = {
  super: { heavy: 6, medium: 7, light: 8 },
  heavy: { heavy: 4, medium: 5, light: 6 },
  medium: { light: 5 },
};
const wakeOf = (type: AircraftType): Wake =>
  type.id === 'A388'
    ? 'super'
    : type.class === 'double_decker' || type.class === 'widebody'
      ? 'heavy'
      : type.class === 'private'
        ? 'light'
        : 'medium';
/** Swept bodies are sampled for the order at most this far apart (bodies are 15 m and more
 * long): a wait stops one sample short. */
const SAMPLE_M = 6;
const WAIT_SHORT_M = 0.5;
/** TASK-320: a parked aircraft's last metre on the stand line in front of its centre, so its
 * heading there is the line's; and how far off the stand heading a line counts as on it. */
const STAND_MARGIN_M = 1;
const STRAIGHT_RAD = (0.5 * Math.PI) / 180;
/** TASK-320: a parked body's clearance from an apron service road's edge, and how far back along
 * the stand's line its stop may move to keep it. */
const ROAD_CLEAR_M = 1;
const STOP_BACK_M = 20;
const STUCK_S = 900;
/** TASK-330 departure flow: on a runway that crosses no other, departures line up behind a
 * rolling departure and take off once it is past the runway end and the wake time behind it has
 * run; this many seconds between rolls where no wake time applies. */
const DEP_SEP_S = 75;
/** Routes avoid edges where an aircraft parked at a stand stands in the way. */
const PARKED_FACTOR = 50;
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
  'ready-for-pushback',
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
  /** Start of bridge retraction, in simulation seconds, while ready for pushback. */
  pushbackReadySinceS?: number;
  enginesRunning: boolean;
  onRunway: boolean;
  airborne: boolean;
  gearDown: boolean;
  /** Render-only pose. Physical positions and reservations use the fields above. */
  visual?: AircraftVisualPose;
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

export type AircraftEvent = {
  timeS: number;
  id: number;
} & (
  | { kind: 'landed' | 'parked' | 'off-block' | 'departed' | 'towed' | 'go-around' }
  | { kind: 'returned'; stand: number }
);

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
  uses: RunwayUse[];
  areas: AreaSpan[];
  /** The tail passing it releases the runway; Infinity: the take-off releases it. */
  vacateM: number;
  granted: boolean;
  released: boolean;
  /** TASK-301: the mapped holding position it stops at (-1: none) and that node's station; its
   * stop bar is off from the grant until the tail passes the node. */
  hold: number;
  holdNodeM: number;
}

interface RunwayUse {
  resource: number;
  /** Aircraft centre station at release. */
  clearM: number;
}

interface AreaSpan {
  resource: number;
  fromM: number;
  toM: number;
}

interface BookedUse extends RunwayUse {
  clearS: number;
}

interface Leg {
  mode: 'taxi' | 'pushback' | 'tow';
  pushStand?: number;
  path: AircraftPath;
  tightTurnStations: number[];
  pieces: Piece[];
  /** Path ranges on a runway. */
  runwayRanges: [number, number, number][];
  endM: number;
  gates: Gate[];
  crossings: { crossing: number; stationM: number }[];
  /** TASK-312: the station of its centre at its start (half its aircraft's length). */
  startM: number;
}

/** The aircraft's centre stays short of `atM` on `leg` until `pred` has passed `predM` on
 * `predLeg`. */
interface Wait {
  leg: Leg;
  atM: number;
  pred: Craft;
  predLeg: Leg;
  predM: number;
}

/** A movement ordered but not started: a departure or tow at its stand, an arrival in the queue. */
interface Admission {
  legs: Leg[];
  /** Departures and tows: what follows the legs; arrivals: the landing. */
  next: Next[];
  landing?: Landing;
}

interface Landing {
  exitU: number;
  leg: Leg;
  /** Pieces of the leg up to the vacating point and the aircraft's length past it. */
  vacateM: number;
  exitSpeedMps: number;
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
  /** TASK-358: a helicopter coming down to a pad: seconds into its descent at which it would go
   * below HELI_CLEAR_M; it hovers there (`decided` false) until its way down is clear. */
  holdS?: number;
  /** TASK-330: committed, waiting for a runway still held by an aircraft predicted clear in time. */
  claimPending?: boolean;
}

type Next =
  | { kind: 'park'; stand: number }
  | { kind: 'return'; stand: number }
  | { kind: 'rest' }
  | { kind: 'taxi'; leg: Leg; pauseS: number }
  | {
      kind: 'takeoff';
      end: number;
      lineUpU: number;
      pauseS: number;
      /** TASK-360: where it enters the runway (station from `end`), and how it departs. */
      entryU: number;
      how: LineUpKind;
    };
type LineUpKind = 'full' | 'intersection' | 'backtrack';

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
  pushbackReadySinceS?: number;
  /** TASK-344: the reason its latest start try was refused, and when. */
  startWhy?: string;
  startWhyS?: number;
  /** TASK-363: the reason its latest release try (a queued arrival) was refused (counters). */
  releaseWhy?: string;
  admission: Admission | null;
  /** Its place in the order of admission (0: none yet). */
  rank: number;
  /** TASK-363: a queued arrival's place in its end's approach sequence: its rank when first
   * ordered, kept while it steps out of the landing order. */
  seqRank?: number;
  waits: Wait[];
  towing: boolean;
  retryS: number;
  stillSinceS: number;
  arrivalBooking: { fromS: number; uses: BookedUse[] } | null;
  runwayClaims: RunwayUse[];
  /** Swept body of a pushback, reserved until the tug stops on the taxiway. */
  pushSweep?: Body[];
  /** Waiting at a hold for a runway window, since when, and the occupancy asked for. */
  runwayWait?: { gate: Gate; sinceS: number; checkedAtS: number; uses: BookedUse[] };
  /** TASK-360: a granted departure's take-off roll and its tail off the runway (predicted, then
   * actual), and, lined up behind another lined-up departure (rule 3), that one's id. */
  departRollS?: number;
  departClearS?: number;
  multiFront?: number;
  departHow?: LineUpKind;
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
  areas?: number[];
}

const bodyParts = [
  [0, 0.5, 0.05],
  [0.02, 0.1, 0.5],
  [-0.43, 0.06, 1 / 6],
] as const;

function bodyAt(craft: Pick<Craft, 'lengthM' | 'type'>, position: Vec2, heading: number): Body {
  return {
    ...position,
    c: Math.cos(heading),
    s: Math.sin(heading),
    length: craft.lengthM,
    span: craft.type.spanM,
  };
}

/** The union of fuselage, wing and tail rectangles, with 1.5 m (`padM`) for sweep sampling. */
function bodiesTouch(a: Body, b: Body, padM = 1.5) {
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
      const al = lengthA * a.length + padM;
      const aw = spanA * a.span + padM;
      const bl = lengthB * b.length + padM;
      const bw = spanB * b.span + padM;
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
 * tangent at most 45% of either, and no turn within `startM` of the start or `endM` of the end),
 * and map stations of the raw line onto the rounded one. */
function rounded(raw: Vec2[], radiusM: number, startM = 0, endM = 0) {
  const points: Vec2[] = [raw[0]!];
  const rawBreaks = [0];
  const breaks: { index: number }[] = [{ index: 0 }];
  const tightChords: number[] = [];
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
    // TASK-330 (fix 4): a gentle bend is taken on the widest arc that keeps within
    // CORNER_CUT_M of the drawn line (and fits the segments), not at the minimum radius: a
    // smooth exit or curve drawn as short straight pieces is run at the speed its curve allows.
    const widest = Math.max(radiusM, CORNER_CUT_M / (1 / Math.cos(half) - 1));
    const tangent = Math.min(
      widest * Math.tan(half),
      0.45 * Math.min(before, after),
      rawStations[i]! - startM,
      rawStations.at(-1)! - endM - rawStations[i]!,
    );
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
    // When a sweep step is longer than the turn radius, it can skip much of the rotation.
    // Sample each chord's heading so a wing or tail swinging through that gap counts too.
    if (radius < SAMPLE_M)
      for (let j = points.length - steps - 1; j < points.length - 1; j++) tightChords.push(j);
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
  const tightTurnStations = tightChords.map((i) => (stations[i]! + stations[i + 1]!) / 2);
  return { path, map, tightTurnStations };
}

/** TASK-320: a line that ends at a stand's stop ends on the stand's line (through the stop on
 * its heading), at the stop moved `shiftM` along it, straight for `straightM`. Where the line's
 * last straight stretch on that heading is too short, its end is replaced by an alignment
 * segment: from the line a turning radius before, to a point `straightM` plus a turning radius
 * back from the stop on the stand's line, and on to the stop. Segment bounds (stations of the raw
 * line) past the cut are scaled onto the new end. */
function alignEnd(
  raw: Vec2[],
  bounds: [number, number][],
  heading: number,
  straightM: number,
  radiusM: number,
  shiftM: number,
) {
  const stations = cumulativeLengths(raw);
  const total = stations.at(-1)!;
  const mapped = raw.at(-1)!;
  const ux = Math.cos(heading),
    uy = Math.sin(heading);
  const stop = { x: mapped.x + shiftM * ux, y: mapped.y + shiftM * uy };
  let i = raw.length - 1;
  while (
    i > 0 &&
    deflection(Math.atan2(mapped.y - raw[i - 1]!.y, mapped.x - raw[i - 1]!.x), heading) <
      STRAIGHT_RAD
  )
    i--;
  if (total - stations[i]! + shiftM >= straightM) {
    if (shiftM >= 0) return { raw: shiftM > 0 ? [...raw, stop] : raw, bounds };
    const end = total + shiftM;
    return {
      raw: slice(raw, stations, 0, end),
      bounds: bounds.map(([a, b]) => [Math.min(a, end), Math.min(b, end)] as [number, number]),
    };
  }
  const backM = straightM + radiusM;
  const cutM = Math.max(0, total + Math.min(0, shiftM) - backM - radiusM);
  const join = { x: stop.x - backM * ux, y: stop.y - backM * uy };
  const line = [...(cutM > 0 ? slice(raw, stations, 0, cutM) : [raw[0]!]), join, stop];
  const scale = (cumulativeLengths(line).at(-1)! - cutM) / (total - cutM);
  const map = (m: number) => (m <= cutM ? m : cutM + (m - cutM) * scale);
  return { raw: line, bounds: bounds.map(([a, b]) => [map(a), map(b)] as [number, number]) };
}

/** The same at the start: a line that starts at a stand's stop (a pushback). */
function alignStart(
  raw: Vec2[],
  bounds: [number, number][],
  heading: number,
  straightM: number,
  radiusM: number,
  shiftM: number,
) {
  const total = cumulativeLengths(raw).at(-1)!;
  const flip = (b: [number, number][], length: number) =>
    b.map(([x, y]) => [length - y, length - x] as [number, number]).reverse();
  const end = alignEnd(raw.toReversed(), flip(bounds, total), heading, straightM, radiusM, shiftM);
  return {
    raw: end.raw.toReversed(),
    bounds: flip(end.bounds, cumulativeLengths(end.raw).at(-1)!),
  };
}

export function createAircraftFleet(graph: AirsideGraph, seed: number) {
  const { T360I, T360R, T360M, T360A } = t360Rules();
  const { T363P, T363K } = t363Rules();
  const { T382R, T382S } = t382Rules();
  /** TASK-382: edges arrivals have left the runway by, up to their tail clear of it. */
  const wayOff = new Uint8Array(graph.edges.length);
  const random = createRandom(seed).derive('aircraft');
  const crafts: Craft[] = [];
  const queue: number[] = [];
  const events: AircraftEvent[] = [];
  const counts = { landed: 0, departed: 0, towed: 0, goArounds: 0 };
  const margin = (graph.maxSpanM || 36) / 2 + 12;
  const intersectionAreas = runwayIntersectionAreas(graph, margin);
  const areasByRunway = graph.runways.map((r) =>
    intersectionAreas.filter((area) => area.runways.includes(r.idx)),
  );
  const runwayOccupant = new Int32Array(graph.runways.length + intersectionAreas.length).fill(-1);
  /** TASK-330: the landing booking (from CLEAR_BEFORE_S, with a deferred claim) and the departure
   * flow (line-up behind a rolling departure, take-off by wake time) apply only on runways that
   * cross no other runway. */
  const independent = (r: number) => (areasByRunway[r]?.length ?? 0) === 0;
  const leadS = (r: number) => (independent(r) ? CLEAR_BEFORE_S : DECISION_S);
  const runwayClearS = new Float64Array(runwayOccupant.length);
  const standOccupant = new Int32Array(graph.stands.length).fill(-1);
  const standBound = new Int32Array(graph.stands.length).fill(-1);
  const helipadOccupant = new Int32Array(graph.helipads.length).fill(-1);
  const edgeLocks: { id: number; dir: number }[][] = graph.edges.map(() => []);
  const crossingClosed = new Uint8Array(graph.crossings.length);
  const edgeBoxes = graph.edges.map((edge) => boxOf(edge.line));
  const runwayBoxes = graph.runways.map((runway) => boxOf(runway.line));
  /** Per edge, found when first needed: its stretches (edge stations) on a runway's pavement,
   * within half the runway's width of its line and between its ends. */
  const pavementOf: ([number, number, number][] | undefined)[] = [];
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
  /** The time of the previous step. */
  let lastStepS = 0;
  let admitted = 0;
  let ringS = -Infinity;
  /** TASK-339: seconds aircraft have stood in a wait on a parked aircraft with no admission. */
  let parkedBlockS = 0;
  /** TASK-340: since when each ring of waits (by its members' ids) has stood. */
  let ringSince = new Map<string, number>();
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
      admission: null,
      rank: 0,
      waits: [],
      towing: false,
      retryS: -Infinity,
      stillSinceS: 0,
      arrivalBooking: null,
      runwayClaims: [],
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
  /** Return contacts reached by the grant, including the rest of a contact that runs past
   * its nominal end. A backtrack within one grant holds the area across both passes. */
  function areaSpan(
    area: RunwayIntersectionArea,
    path: AircraftPath,
    fromM: number,
    toM: number,
  ): AreaSpan | null {
    let first = Infinity;
    let last = -Infinity;
    for (let i = 1; i < path.points.length; i++) {
      const start = path.stationsM[i - 1]!;
      const end = path.stationsM[i]!;
      if (end < fromM || end <= start) continue;
      if (start > toM && start > last + 1e-6) break;
      const a = path.points[i - 1]!;
      const b = path.points[i]!;
      const length = end - start;
      let lo = Math.max(0, (fromM - start) / length);
      let hi = 1;
      for (const { axis, min, max } of area.bands) {
        const at = (a.x - area.pos.x) * axis.x + (a.y - area.pos.y) * axis.y;
        const delta = (b.x - a.x) * axis.x + (b.y - a.y) * axis.y;
        if (Math.abs(delta) < 1e-9) {
          if (at < min || at > max) hi = -1;
        } else {
          const u = (min - at) / delta;
          const v = (max - at) / delta;
          lo = Math.max(lo, Math.min(u, v));
          hi = Math.min(hi, Math.max(u, v));
        }
        if (lo > hi) break;
      }
      if (lo <= hi) {
        const enter = start + lo * length;
        if (enter > toM && enter > last + 1e-6) break;
        first = Math.min(first, enter);
        last = start + hi * length;
      }
    }
    return first <= last ? { resource: area.idx, fromM: first, toM: last } : null;
  }

  function addUse(uses: RunwayUse[], resource: number, clearM: number) {
    const use = uses.find((u) => u.resource === resource);
    if (use) use.clearM = Math.max(use.clearM, clearM);
    else uses.push({ resource, clearM });
  }

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

  /** TASK-320: how far a type's stop moves along its stand's heading (negative: back) so that
   * its parked body keeps `ROAD_CLEAR_M` clear of the apron service roads across the stand's
   * line: the least move, within the paved room ahead or `STOP_BACK_M` back, whose body clears
   * every road there and stands in no taxiway's way (TASK-312's rule). None (0) where the body
   * is clear already or no move clears it. */
  const stopShifts = new Map<string, number>();
  function stopShift(craft: Craft, stand: AirsideStandC) {
    const key = standKey(craft.type.id, stand.idx);
    const known = stopShifts.get(key);
    if (known !== undefined) return known;
    const length = craft.lengthM;
    const clear = (shiftM: number) =>
      stand.roadBandsM.every(
        ([from, to]) => to < -shiftM - ROAD_CLEAR_M || from > length - shiftM + ROAD_CLEAR_M,
      );
    let shift = 0;
    if (!clear(0)) {
      const options = stand.roadBandsM
        .flatMap(([from, to]) => [length + ROAD_CLEAR_M - from + 0.01, -(to + ROAD_CLEAR_M + 0.01)])
        .filter((m) => m <= stand.aheadM && m >= -STOP_BACK_M && clear(m))
        .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
      const ux = Math.cos(stand.heading),
        uy = Math.sin(stand.heading);
      shift =
        options.find((m) => {
          const back = length / 2 - m;
          const centre = { x: stand.pos.x - back * ux, y: stand.pos.y - back * uy };
          return !blocksTaxiway(craft, bodyAt(craft, centre, stand.heading));
        }) ?? 0;
    }
    stopShifts.set(key, shift);
    return shift;
  }

  /** The stand whose stop a segment on its lead-in ends (or starts) at. */
  function stopStand(segment: Segment, atEnd: boolean) {
    const stand = segment.edge >= 0 ? graph.stands[graph.edges[segment.edge]!.stand] : undefined;
    return stand && (atEnd ? segment.endNode : segment.startNode) === stand.stop ? stand : null;
  }

  /** TASK-338: where a taxiway or lead-in edge runs on a runway's pavement (sampled every 2 m). */
  function pavement(edgeIdx: number) {
    const cached = pavementOf[edgeIdx];
    if (cached) return cached;
    const found: [number, number, number][] = [];
    const edge = graph.edges[edgeIdx]!;
    const box = edgeBoxes[edgeIdx]!;
    if (edge.kind !== 'runway')
      for (const runway of graph.runways) {
        const reachM = runway.widthM / 2;
        const near = runwayBoxes[runway.idx]!;
        if (
          box.minX > near.maxX + reachM ||
          box.maxX < near.minX - reachM ||
          box.minY > near.maxY + reachM ||
          box.maxY < near.minY - reachM
        )
          continue;
        let from = -1;
        let last = 0;
        for (let m = 0; ; m = Math.min(edge.lengthM, m + 2)) {
          const at = nearestOnPolyline(runway.line, pointAtDistance(edge.line, edge.cumulative, m));
          const on = at.away <= reachM && at.along > 0 && at.along < runway.lengthM;
          if (on && from < 0) from = m;
          if (!on && from >= 0) {
            found.push([from, last, runway.idx]);
            from = -1;
          }
          last = m;
          if (m >= edge.lengthM) break;
        }
        if (from >= 0) found.push([from, edge.lengthM, runway.idx]);
      }
    pavementOf[edgeIdx] = found;
    return found;
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
    const turnM = craft.type.performance.kind === 'fixedWing' ? radius(craft) : 5;
    // TASK-320: at a stand's stop the leg runs straight on the stand heading for half the length
    // and a margin, so the parked aircraft (and a pushback's start) stands on the stand's pose.
    const straightM = craft.lengthM / 2 + STAND_MARGIN_M;
    const endStand = stopStand(segments.at(-1)!, true);
    const startStand = stopStand(segments[0]!, false);
    let line = { raw, bounds };
    if (endStand)
      line = alignEnd(
        line.raw,
        line.bounds,
        endStand.heading,
        straightM,
        turnM,
        stopShift(craft, endStand),
      );
    if (startStand)
      line = alignStart(
        line.raw,
        line.bounds,
        startStand.heading,
        straightM,
        turnM,
        stopShift(craft, startStand),
      );
    const { path, map, tightTurnStations } = rounded(
      line.raw,
      turnM,
      startStand ? straightM : 0,
      endStand ? straightM : 0,
    );
    const pieces: Piece[] = [];
    const runwayRanges: Leg['runwayRanges'] = [];
    const onPavement: Leg['runwayRanges'] = [];
    segments.forEach((segment, i) => {
      const [a, b] = line.bounds[i]!;
      const startM = map(a),
        endM = map(b);
      if (segment.runway < 0 && segment.edge >= 0) {
        const lo = Math.min(segment.fromE, segment.toE);
        const hi = Math.max(segment.fromE, segment.toE);
        const raw = (e: number) =>
          a +
          ((b - a) * Math.abs(e - segment.fromE)) / (Math.abs(segment.toE - segment.fromE) || 1);
        for (const [p, q, runway] of pavement(segment.edge)) {
          const from = Math.max(p, lo);
          const to = Math.min(q, hi);
          if (to <= from) continue;
          const x = map(raw(from));
          const y = map(raw(to));
          onPavement.push([Math.min(x, y), Math.max(x, y), runway]);
        }
      }
      if (segment.runway >= 0) {
        const last = runwayRanges.at(-1);
        if (last && last[2] === segment.runway && last[1] >= startM - 1e-6) last[1] = endM;
        else runwayRanges.push([startM, endM, segment.runway]);
      }
      for (const [node, station, adjacent] of [
        [segment.startNode, startM, segments[i - 1]],
        [segment.endNode, endM, segments[i + 1]],
      ] as const)
        if (node >= 0) {
          const alongRunway = segment.runway >= 0 ? segment.runway : (adjacent?.runway ?? -1);
          for (const runway of graph.nodes[node]!.runways)
            if (alongRunway < 0 || alongRunway === runway)
              runwayRanges.push([station, station, runway]);
        }
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
    // TASK-338: a taxiway stretch on a runway's pavement is on that runway (its gate holds it),
    // where it lies more than HOLD_FALLBACK_M from the ranges the leg has by its runway pieces
    // and nodes. Such a stretch is an OSM taxiway drawn along the runway, or one through a node
    // beside a runway node but not joined to it (Heathrow N1/N2E at the 27L end). Nearer ones are
    // covered by the gate there; a rapid exit drawn tangent to the centreline is left alone.
    const ranges = runwayRanges.slice();
    for (const r of onPavement)
      if (
        !ranges.some(
          ([from, to, runway]) =>
            runway === r[2] && from - HOLD_FALLBACK_M <= r[1] && to + HOLD_FALLBACK_M >= r[0],
        )
      )
        runwayRanges.push(r);
    let crossings: Leg['crossings'] | undefined;
    return {
      mode,
      path,
      tightTurnStations,
      pieces,
      runwayRanges: runwayRanges.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      endM: path.lengthM - craft.lengthM / 2,
      gates: [],
      startM: craft.lengthM / 2,
      // Found when the leg is driven: most legs built are only costed or tried.
      get crossings() {
        return (crossings ??= crossingsOn(path));
      },
    };
  }

  /** Holding positions on a leg: a gate before every runway its pieces reach from a taxiway,
   * at the mapped hold within 300 m before it, else `HOLD_FALLBACK_M` short of the runway node;
   * released past the next hold beyond (or the fallback distance past the runway node). */
  /** TASK-330: per code, an aircraft of the widest type of that code (built once). */
  const widestByCode = new Map<number, Craft | null>();
  function widestOfCode(code: number) {
    if (!widestByCode.has(code)) {
      const type = aircraftTypes
        .filter((t) => t.class !== 'helicopter' && t.spanM <= codeSpanLimitM[aircraftCodes[code]!])
        .sort((a, b) => b.spanM - a.spanM || b.lengthM - a.lengthM)[0];
      const made = type ? newCraft(type.id) : null;
      widestByCode.set(code, typeof made === 'string' ? null : made);
    }
    return widestByCode.get(code)!;
  }
  /** TASK-330: a stop short of a runway moved back, 2 m at a time (at most 150 m), until the
   * body standing there is clear of the widest type the runway takes rolling on its centreline:
   * a mapped holding position too close for a large type is not waited at. */
  function clearHold(craft: Craft, leg: Leg, runway: number, holdM: number) {
    const r = graph.runways[runway]!;
    const roller = widestOfCode(r.maxCode);
    if (!roller) return holdM;
    const heading = r.ends[0]!.heading;
    let m = holdM;
    for (let back = 0; back <= 150 && m > craft.lengthM / 2; back += 2, m -= 2) {
      const pose = poseAt(leg, m);
      const body = bodyAt(craft, pose.position, pose.headingRad);
      const near = nearestOnPolyline(r.line, pose.position);
      if (!bodiesTouch(body, bodyAt(roller, near.point, heading))) return m;
    }
    return holdM;
  }

  /** TASK-360 rule 1: whether an aircraft holding short of its line-up on `runway` at the end of
   * `leg` (at the mapped hold or the fallback, moved back as `clearHold` does) still stands in the
   * way of the widest type rolling on the centreline: a shallow entry (Heathrow 27R's A5, drawn
   * 16 degrees off the runway) whose hold is too close is not an entry for an intersection
   * take-off. */
  function lineUpHoldTouches(craft: Craft, leg: Leg, runway: number) {
    const range = leg.runwayRanges.findLast((r) => r[2] === runway);
    const roller = widestOfCode(graph.runways[runway]!.maxCode);
    if (!range || !roller) return false;
    const [entryM] = range;
    const half = craft.lengthM / 2;
    const before = leg.pieces.findLast(
      ({ endM, endNode }) =>
        endM < entryM && endM >= entryM - 300 && holdAt.get(endNode)?.runway === runway,
    );
    const m = clearHold(
      craft,
      leg,
      runway,
      Math.max(half, (before?.endM ?? entryM - HOLD_FALLBACK_M) - half),
    );
    const r = graph.runways[runway]!;
    const pose = poseAt(leg, m);
    const near = nearestOnPolyline(r.line, pose.position);
    return bodiesTouch(
      bodyAt(craft, pose.position, pose.headingRad),
      bodyAt(roller, near.point, r.ends[0]!.heading),
    );
  }

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
      const holdM = clearHold(
        craft,
        leg,
        runway,
        Math.max(half, (before?.endM ?? entryM - HOLD_FALLBACK_M) - half),
      );
      const vacateM =
        leaveM >= leg.endM && runway === departureRunway
          ? Infinity
          : Math.min(leg.endM - half, after?.endM ?? leaveM + HOLD_FALLBACK_M);
      const previous = leg.gates.at(-1);
      // If the next stop lies inside the preceding clearance, grant both stretches together.
      if (previous && holdM <= previous.vacateM + half) {
        previous.vacateM = Math.max(previous.vacateM, vacateM);
        addUse(previous.uses, runway, vacateM + half);
      } else {
        const granted = entryM <= half && runway === arrivalRunway;
        leg.gates.push({
          holdM: granted ? -Infinity : holdM,
          uses: [{ resource: runway, clearM: vacateM + half }],
          areas: [],
          vacateM,
          granted,
          released: false,
          hold: before && !granted ? holdAt.get(before.endNode)!.idx : -1,
          holdNodeM: before?.endM ?? entryM - HOLD_FALLBACK_M,
        });
      }
    }
    const gates = leg.gates.splice(0);
    for (const gate of gates) {
      const endM = gate.vacateM + half;
      const areas = new Set(gate.uses.flatMap(({ resource }) => areasByRunway[resource]!));
      for (const area of areas) {
        const span = areaSpan(area, leg.path, Math.max(gate.holdM, 0), endM);
        if (!span) continue;
        gate.areas.push(span);
        const clearM = Math.min(span.toM + half, endM === Infinity ? Infinity : leg.endM);
        addUse(gate.uses, span.resource, clearM);
        gate.vacateM = Math.max(gate.vacateM, clearM - half);
      }
      const previous = leg.gates.at(-1);
      if (previous && gate.holdM <= previous.vacateM + half) {
        previous.vacateM = Math.max(previous.vacateM, gate.vacateM);
        previous.areas.push(...gate.areas);
        for (const use of gate.uses) addUse(previous.uses, use.resource, use.clearM);
      } else {
        leg.gates.push(gate);
      }
    }
  }

  // ----- Locks and claims.
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
    // Nodes from the tail on: the margin behind is for followers on the same edges, and
    // crossing traffic is ordered by its swept path (TASK-312).
    const nodeLo =
      craft.mode === 'ground' || craft.mode === 'parked'
        ? Math.max(lo, craft.stationM - craft.lengthM / 2)
        : lo;
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
        if (node >= 0 && !isRunwayNode(node) && nodeLo <= m && m <= hi)
          craft.claimedNodes.push(node);
    }
  }

  /** The first leg station in (fromM, toM] where another aircraft's claim begins. */
  function firstConflict(craft: Craft, leg: Leg, fromM: number, toM: number, ignore?: Set<Craft>) {
    let best = Infinity;
    // An aircraft ordered after this one stays clear of its path (TASK-312): its margins do not
    // close it.
    const others = crafts.filter(
      (o) =>
        o !== craft &&
        o.claimed.length + o.claimedNodes.length &&
        !ignore?.has(o) &&
        !o.waits.some((w) => w.pred === craft && !passed(w)),
    );
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

  function sweepBody(craft: Craft, leg: Leg, m: number) {
    const { points, stationsM } = leg.path;
    const heading =
      headingAtDistance(points, stationsM, m) + (leg.mode === 'pushback' ? Math.PI : 0);
    return bodyAt(craft, pointAtDistance(points, stationsM, m), heading);
  }

  function sweep(craft: Craft, leg: Leg, fromM = craft.lengthM / 2, spacingM = 2) {
    const count = Math.max(1, Math.ceil((leg.endM - fromM) / spacingM));
    return Array.from({ length: count + 1 }, (_, i) =>
      sweepBody(craft, leg, fromM + (i / count) * (leg.endM - fromM)),
    );
  }

  const sweepCache = new WeakMap<Leg, Map<string, SweepPoint[]>>();
  /** Each swept leg's box of body centres. */
  const sweepBox = new WeakMap<Leg, { minX: number; minY: number; maxX: number; maxY: number }>();
  const standEnvelopes = new Map<string, { parked: Body; push: Body[] }>();
  const standKey = (typeId: string, stand: number) => `${typeId}/${stand}`;
  const cellM = Math.max(40, graph.maxSpanM + 15);
  const cell = (x: number, y: number) => `${x},${y}`;

  function sweptLeg(craft: Craft, leg: Leg) {
    const cached = sweepCache.get(leg);
    if (cached) return cached;
    const buckets = new Map<string, SweepPoint[]>();
    const start = craft.lengthM / 2;
    const track = sweep(craft, leg, start, SAMPLE_M);
    const areas = leg.gates.flatMap((gate) => gate.areas);
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
        ...(areas.length > 0 && {
          areas: areas.flatMap(({ resource, fromM, toM }) =>
            stationM >= fromM && stationM <= toM ? [resource] : [],
          ),
        }),
      };
      const bucket = buckets.get(key);
      if (bucket) bucket.push(point);
      else buckets.set(key, [point]);
    }
    sweepCache.set(leg, buckets);
    sweepBox.set(leg, boxOf(track));
    return buckets;
  }

  // ----- Order (TASK-312; the header comment).
  /** A leg from a station on: the rest of a movement, or one about to be admitted. */
  interface Span {
    leg: Leg;
    fromM: number;
  }
  interface Conflict {
    leg: Leg;
    b1: number;
    b2: number;
    other: Craft;
    otherLeg: Leg;
    x1: number;
    x2: number;
    /** Following on the same arcs: the claims keep them apart once in order. */
    follow: boolean;
  }

  /** The rest of an aircraft's movement: its current leg from where it is and the legs after it,
   * an approach's taxi leg, or the legs of its admission. */
  function remaining(craft: Craft): Span[] {
    if (craft.mode === 'parked' || craft.mode === 'queued')
      return craft.admission?.legs.map((leg) => ({ leg, fromM: 0 })) ?? [];
    if (craft.mode !== 'ground' && craft.air?.kind !== 'approach') return [];
    const later = craft.next.flatMap((n) => (n.kind === 'taxi' ? [{ leg: n.leg, fromM: 0 }] : []));
    return craft.mode === 'ground'
      ? [{ leg: craft.leg!, fromM: craft.stationM - 1 }, ...later]
      : later;
  }
  function stillUses(craft: Craft, leg: Leg) {
    if (craft.mode === 'parked' || craft.mode === 'queued')
      return !!craft.admission?.legs.includes(leg);
    if (craft.mode === 'ground' && craft.leg === leg) return true;
    if (craft.mode !== 'ground' && craft.air?.kind !== 'approach') return false;
    return craft.next.some((n) => n.kind === 'taxi' && n.leg === leg);
  }
  /** A wait with `predM` Infinity lasts while the other is on that leg or parked at its end. */
  const passed = ({ pred, predLeg, predM }: Wait) =>
    pred.type.performance.kind === 'helicopter'
      ? !heliActive(pred)
      : predM === Infinity
        ? !(pred.leg === predLeg && (pred.mode === 'parked' || pred.mode === 'ground')) &&
          !stillUses(pred, predLeg)
        : pred.mode === 'ground' && pred.leg === predLeg
          ? pred.stationM > predM
          : !stillUses(pred, predLeg);
  /** The station on `leg` its centre stays short of while an aircraft before it has to pass;
   * `passing`: leaving out those it goes before as it starts. */
  function waitCap(craft: Craft, leg: Leg, passing?: Set<Craft>) {
    let cap = Infinity;
    for (const wait of craft.waits)
      if (wait.leg === leg && wait.atM < cap && !passed(wait) && !passing?.has(wait.pred))
        cap = wait.atM;
    return cap;
  }

  // TASK-329: an aircraft that has started (left its stand, appeared on approach) never waits for
  // one that has not. Starting, a departure, tow or arrival goes before the departures and tows
  // ordered before it that are still at their stands: they wait for it instead. It does not start
  // while it would still wait for an arrival in the queue or for an aircraft parked in its way: it
  // waits at its stand or in the air. Started aircraft are thus in the order they started, and
  // those not started follow in the order of admission.
  const unstarted = (craft: Craft) => craft.mode === 'queued' || craft.mode === 'parked';
  /** The departures and tows at their stands that `craft`, starting, goes before: not those whose
   * parked body is in its way. */
  const passing = (craft: Craft) =>
    new Set(
      craft.waits.flatMap((w) =>
        w.pred.mode === 'parked' &&
        !passed(w) &&
        !craft.waits.some((v) => v.pred === w.pred && v.predM === Infinity && !passed(v))
          ? [w.pred]
          : [],
      ),
    );
  /** TASK-330: whether a queued arrival cannot be where it meets a departure or tow's legs before
   * that aircraft, starting now, is past: the arrival lands `LANDING_GAP_S` after each arrival
   * queued before it for its runway end, flies the final at approach speed and taxis at straight
   * speed; the starter pushes at push speed, waits for its tug and taxis at turn speed, with
   * `HORIZON_S` to spare. Such an arrival does not hold the starter at its stand: the starter goes
   * before it, and the arrival is ordered after it as one at its stand is (`passing`). */
  function beyondHorizon(craft: Craft, legs: Leg[], arrival: Craft) {
    const request = arrival.request;
    if (request?.kind !== 'arrival') return false;
    let ahead = 0;
    for (const id of queue) {
      if (id === arrival.id) break;
      const other = crafts[id - 1]!;
      if (
        other.request?.kind === 'arrival' &&
        other.runway === arrival.runway &&
        other.request.end === request.end
      )
        ahead++;
    }
    const inbound = fixedWing(arrival);
    const landS = ahead * LANDING_GAP_S + FINAL_M / inbound.approachSpeedMps;
    const landing = arrival.admission!.landing!.leg;
    const byLanding = horizonMeets.get(legs) ?? new WeakMap<Leg, number[]>();
    horizonMeets.set(legs, byLanding);
    let spare = byLanding.get(landing);
    if (!spare) {
      const own = fixedWing(craft);
      const speed = (leg: Leg) =>
        leg.mode === 'pushback'
          ? own.pushbackSpeedMps
          : leg.mode === 'tow'
            ? own.towSpeedMps
            : own.taxiTurnMps;
      spare = conflicts(
        craft,
        legs.map((leg) => ({ leg, fromM: 0 })),
        arrival,
      ).map((c) => {
        let pastS = 0;
        for (const leg of legs) {
          const toM = leg === c.leg ? Math.min(leg.endM, c.b2 + craft.lengthM) : leg.endM;
          pastS += (toM - leg.startM) / speed(leg) + (leg.mode === 'pushback' ? TUG_S : 0);
          if (leg === c.leg) break;
        }
        return c.x1 / inbound.taxiStraightMps - pastS - HORIZON_S;
      });
      byLanding.set(landing, spare);
    }
    return spare.every((s) => landS + s >= 0);
  }
  /** Per starter's legs and arrival's landing leg: for each place they meet, the arrival's taxi
   * time to it less the starter's time past it and `HORIZON_S`. */
  const horizonMeets = new WeakMap<Leg[], WeakMap<Leg, number[]>>();
  /** TASK-330 (5): whether a tow's legs meet the way off the runway of an arrival on final or of
   * the next arrival to appear on an end. */
  function towWaitsForArrival(craft: Craft, legs: Leg[]) {
    const own = legs.map((leg) => ({ leg, fromM: 0 }));
    const heads = new Set<number>();
    for (const other of crafts) {
      let landingLeg: Leg | undefined;
      if (other.air?.kind === 'approach' && other.next[0]?.kind === 'taxi')
        landingLeg = other.next[0].leg;
      else if (
        other.mode === 'queued' &&
        other.request?.kind === 'arrival' &&
        other.admission &&
        // TASK-330: not for one already ordered to wait for this tow; it is not released before it.
        !other.waits.some((w) => w.pred === craft && !passed(w))
      ) {
        const key = endKey(other.runway, other.request.end);
        if (
          heads.has(key) ||
          queue.find((id) => {
            const q = crafts[id - 1]!;
            return q.request?.kind === 'arrival' && endKey(q.runway, q.request.end) === key;
          }) !== other.id
        )
          continue;
        heads.add(key);
        landingLeg = other.admission.landing?.leg;
      }
      if (!landingLeg) continue;
      const safeM = safeOf(other, landingLeg);
      if (conflicts(craft, own, other).some((c) => c.otherLeg === landingLeg && c.x1 < safeM))
        return true;
    }
    return false;
  }
  /** Whether it would still wait for an aircraft not started. */
  const waitsForUnstarted = (craft: Craft, pass: Set<Craft>) =>
    craft.waits.some((w) => unstarted(w.pred) && !pass.has(w.pred) && !passed(w));
  /** The waits by which those it passes give way to it; null if one cannot (its push starts
   * inside the conflict): it does not start then. */
  function yieldsTo(craft: Craft, pass: Set<Craft>) {
    const found: [Craft, Wait[]][] = [];
    for (const other of pass) {
      const waits = yieldWaits(craft, other);
      if (!waits) return null;
      found.push([other, waits]);
    }
    return found;
  }
  /** The waits by which `other` gives way to `craft` where their remaining movements meet; null
   * if it can no longer stop short of one. */
  function yieldWaits(craft: Craft, other: Craft, anyGrant = true) {
    const waits: Wait[] = [];
    for (const c of conflicts(craft, remaining(craft), other)) {
      const atM = c.x1 - SAMPLE_M;
      if (inside(other, c.otherLeg, atM) || !canWaitAt(other, c.otherLeg, atM)) return null;
      // TASK-330 Phase 1e: a landing aircraft never waits short of where its tail is off.
      if (
        c.otherLeg.gates[0]?.holdM === -Infinity &&
        other.mode !== 'queued' &&
        atM < safeOf(other, c.otherLeg)
      )
        return null;
      // One holding a runway grant does not stop short of it for another.
      // (TASK-330 Phase 1e, at landing commitment: only a grant covering the stop, which
      // canWaitAt has checked.)
      if (
        anyGrant &&
        other.mode === 'ground' &&
        other.leg!.gates.some((g) => g.granted && !g.released)
      )
        return null;
      const predM = c.follow ? c.b1 + craft.lengthM : c.b2 + SAMPLE_M;
      waits.push({ leg: c.otherLeg, atM, pred: craft, predLeg: c.leg, predM });
    }
    return waits;
  }
  /** Whether an aircraft is already past `atM` on `leg`: moving, or parked with its body there. */
  const inside = (other: Craft, leg: Leg, atM: number) =>
    other.mode === 'ground'
      ? other.leg === leg && other.stationM >= atM
      : other.mode === 'parked' && leg === other.admission?.legs[0] && atM <= leg.startM;
  /** `check`: whether the new waits are checked for a ring first (see commitOrder). */
  function giveWay(craft: Craft, other: Craft, waits: Wait[], check = true) {
    craft.waits = craft.waits.filter((w) => w.pred !== other);
    commitOrder(craft, { mine: [], theirs: waits.map((wait) => ({ owner: other, wait })) }, check);
  }

  /** Rings of waits can still close through the waits for an aircraft parked in the way and
   * through re-routes. Most open again as an aircraft not started passes the others at its start;
   * one that has lasted RING_S is broken where an aircraft can give way to the one waiting for
   * it: one not started first (it waits at its stand or in the air), else the one admitted last.
   * One that has started gives way only to another that has. */
  function breakRings() {
    const preds = new Map<Craft, Craft[]>();
    for (const c of crafts)
      if (c.mode !== 'done')
        preds.set(c, [
          ...new Set(
            c.waits.flatMap((w) => (w.pred.mode !== 'done' && !passed(w) ? [w.pred] : [])),
          ),
        ]);
    const state = new Map<Craft, 1 | 2>();
    const stack: Craft[] = [];
    /** The first ring reached from `c`, depth first. */
    const visit = (c: Craft): Craft[] | null => {
      state.set(c, 1);
      stack.push(c);
      for (const p of preds.get(c)!) {
        const seen = state.get(p);
        if (seen === 1) return stack.slice(stack.indexOf(p));
        const ring = seen ? null : visit(p);
        if (ring) return ring;
      }
      stack.pop();
      state.set(c, 2);
      return null;
    };
    // TASK-340: every ring, each with its own timer (rings found later keep apart from those
    // found first: their members are not searched again).
    const rings: Craft[][] = [];
    for (const c of preds.keys()) {
      if (state.has(c)) continue;
      stack.length = 0;
      const ring = visit(c);
      if (!ring) continue;
      rings.push(ring);
      for (const m of stack) state.set(m, 2);
    }
    const since = new Map<string, number>();
    for (const ring of rings) {
      const key = ring
        .map((c) => c.id)
        .sort((a, b) => a - b)
        .join(',');
      since.set(key, ringSince.get(key) ?? nowS);
      if (!late.ringKeys.has(key)) {
        late.ringKeys.add(key);
        late.rings++;
      }
      if (nowS - since.get(key)! >= RING_S) breakRing(ring, key);
    }
    ringSince = since;
  }
  function breakRing(ring: Craft[], key: string) {
    let best: { craft: Craft; other: Craft; waits: Wait[] } | null = null;
    for (const [i, craft] of ring.entries()) {
      const other = ring[(i + 1) % ring.length]!;
      if (craft.waits.some((w) => w.pred === other && w.predM === Infinity && !passed(w))) continue;
      if (!unstarted(other) && unstarted(craft)) continue;
      if (
        best &&
        (unstarted(best.other) && !unstarted(other)
          ? true
          : unstarted(best.other) === unstarted(other) && best.other.rank >= other.rank)
      )
        continue;
      const waits = yieldWaits(craft, other);
      if (waits) best = { craft, other, waits };
    }
    if (best) {
      giveWay(best.craft, best.other, best.waits, false);
      late.ringsBroken++;
    } else if (!late.deadKeys.has(key)) {
      late.deadKeys.add(key);
      late.deadlocks++;
    }
  }

  /** How two swept bodies meet: not (0), in conflict (1), or following on the same arcs (2). */
  function sweepsMeet(leg: Leg, a: SweepPoint, route: Leg, b: SweepPoint) {
    if (
      (a.runway >= 0 && a.runway === b.runway) ||
      a.areas?.some((area) => b.areas?.includes(area))
    )
      return 0;
    let follow = false;
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
      follow = (u === v && a.dir === b.dir) || toA === fromB || toB === fromA;
    }
    return bodiesTouch(a.body, b.body) ? (follow ? 2 : 1) : 0;
  }

  const tightTurnBodies = new WeakMap<Leg, { m: number; body: Body }[]>();

  /** Refine the ordinary wait only if the body at that stop is in the way of a tight turn.
   * The moving body's heading is constant on each short chord, even between sweep samples. */
  function clearTurnWait(
    craft: Craft,
    leg: Leg,
    firstM: number,
    other: Craft,
    route: Leg,
    fromM: number,
    toM: number,
  ) {
    if (!route.tightTurnStations.length) return firstM;
    let stopM = firstM - SAMPLE_M - WAIT_SHORT_M;
    if (stopM < leg.startM) return firstM;
    let turns = tightTurnBodies.get(route);
    if (!turns) {
      turns = route.tightTurnStations
        .filter((m) => m >= route.startM && m <= route.endM)
        .map((m) => ({ m, body: sweepBody(other, route, m) }));
      tightTurnBodies.set(route, turns);
    }
    const relevant = turns.filter(({ m }) => m >= fromM && m <= toM);
    if (!relevant.length) return firstM;
    const touches = (m: number) => {
      const body = sweepBody(craft, leg, m);
      // A tight chord is shorter than 0.53 m. This covers the distance from its midpoint.
      return relevant.some((turn) => bodiesTouch(body, turn.body, 0.27));
    };
    if (!touches(stopM)) return firstM;
    do stopM -= 1;
    while (stopM >= leg.startM && touches(stopM));
    return stopM + SAMPLE_M + WAIT_SHORT_M;
  }

  /** Where the swept bodies of `own` meet another aircraft's remaining movement: stretches of
   * own stations (gaps of up to 10 m joined) with the other's stations they meet, in conflict or
   * following on the same arcs. */
  function conflicts(craft: Craft, own: Span[], other: Craft) {
    const found: Conflict[] = [];
    const theirs = remaining(other);
    if (!theirs.length) return found;
    // TASK-342: an aircraft on the ground stands where it is, between two samples of its sweep
    // (whose first is up to a sample ahead of it): its body there is sampled too, so a wait is
    // short of the body of one standing at a hold whose wing reaches into another lane.
    const mineNow = craft.mode === 'ground' ? standingPoint(craft) : null;
    const theirNow = other.mode === 'ground' ? standingPoint(other) : null;
    for (const { leg, fromM } of own) {
      const incoming = sweptLeg(craft, leg);
      const box = sweepBox.get(leg)!;
      for (const { leg: route, fromM: passedM } of theirs) {
        const occupied = sweptLeg(other, route);
        const near = sweepBox.get(route)!;
        if (
          near.minX > box.maxX + cellM ||
          near.maxX < box.minX - cellM ||
          near.minY > box.maxY + cellM ||
          near.maxY < box.minY - cellM
        )
          continue;
        const touching = [new Map<number, [number, number]>(), new Map<number, [number, number]>()];
        const record = (a: SweepPoint, b: SweepPoint) => {
          const meet = sweepsMeet(leg, a, route, b);
          if (!meet) return;
          const map = touching[meet - 1]!;
          const range = map.get(a.stationM);
          if (!range) map.set(a.stationM, [b.stationM, b.stationM]);
          else {
            range[0] = Math.min(range[0], b.stationM);
            range[1] = Math.max(range[1], b.stationM);
          }
        };
        for (const bucket of incoming.values()) {
          const { body } = bucket[0]!;
          const x = Math.floor(body.x / cellM);
          const y = Math.floor(body.y / cellM);
          for (let i = x - 1; i <= x + 1; i++)
            for (let j = y - 1; j <= y + 1; j++) {
              const slice = occupied.get(cell(i, j));
              if (!slice) continue;
              for (const a of bucket) {
                if (a.stationM < fromM) continue;
                for (const b of slice) if (b.stationM >= passedM) record(a, b);
              }
            }
        }
        // Each one's body where it stands, against the other's sweep (and body).
        const ownNow = mineNow && leg === craft.leg ? mineNow : null;
        const otherNow = theirNow && route === other.leg ? theirNow : null;
        if (ownNow) {
          for (const b of near3(occupied, ownNow)) if (b.stationM >= passedM) record(ownNow, b);
          if (otherNow) record(ownNow, otherNow);
        }
        if (otherNow)
          for (const a of near3(incoming, otherNow)) if (a.stationM >= fromM) record(a, otherNow);
        const firstPairConflict = found.length;
        touching.forEach((map, kind) => {
          let current: Conflict | undefined;
          for (const m of [...map.keys()].sort((p, q) => p - q)) {
            const [lo, hi] = map.get(m)!;
            if (current && m - current.b2 <= 10) {
              current.b2 = m;
              current.x1 = Math.min(current.x1, lo);
              current.x2 = Math.max(current.x2, hi);
            } else {
              current = {
                leg,
                b1: m,
                b2: m,
                other,
                otherLeg: route,
                x1: lo,
                x2: hi,
                follow: !!kind,
              };
              found.push(current);
            }
          }
        });
        for (let i = firstPairConflict; i < found.length; i++) {
          const c = found[i]!;
          if (c.follow) continue;
          const b1 = clearTurnWait(
            craft,
            leg,
            c.b1,
            other,
            route,
            Math.max(passedM, c.x1 - SAMPLE_M),
            c.x2 + SAMPLE_M,
          );
          c.x1 = clearTurnWait(
            other,
            route,
            c.x1,
            craft,
            leg,
            Math.max(fromM, c.b1 - SAMPLE_M),
            c.b2 + SAMPLE_M,
          );
          c.b1 = b1;
        }
      }
    }
    return found;
  }

  /** TASK-342: an aircraft on the ground as a sweep point: its body where it stands on its leg. */
  function standingPoint(craft: Craft): SweepPoint | null {
    const leg = craft.leg;
    if (!leg) return null;
    const m = craft.stationM;
    const { points, stationsM } = leg.path;
    const heading =
      headingAtDistance(points, stationsM, m) + (leg.mode === 'pushback' ? Math.PI : 0);
    const body = bodyAt(craft, pointAtDistance(points, stationsM, m), heading);
    const piece = leg.pieces.find((p) => p.startM <= m && p.endM >= m);
    const areas = leg.gates.flatMap((gate) => gate.areas);
    return {
      body,
      stationM: m,
      edge: piece ? piece.edge : -1,
      dir: piece && piece.toE < piece.fromE ? -1 : 1,
      runway: leg.runwayRanges.find(([from, to]) => m >= from && m <= to)?.[2] ?? -1,
      ...(areas.length > 0 && {
        areas: areas.flatMap(({ resource, fromM, toM }) =>
          m >= fromM && m <= toM ? [resource] : [],
        ),
      }),
    };
  }
  /** The sweep points in the cells around a point. */
  function* near3(buckets: Map<string, SweepPoint[]>, point: SweepPoint) {
    const x = Math.floor(point.body.x / cellM);
    const y = Math.floor(point.body.y / cellM);
    for (let i = x - 1; i <= x + 1; i++)
      for (let j = y - 1; j <= y + 1; j++) yield* buckets.get(cell(i, j)) ?? [];
  }

  let replacing: { next: Leg; target: Leg } | null = null;
  /** Whether an aircraft can still stop with its centre short of `m` on `leg`: not past it within
   * its braking distance, and not on a runway it has been granted. Aircraft not yet moving can. */
  function canWaitAt(craft: Craft, leg: Leg, m: number) {
    if (craft.mode === 'parked' || craft.mode === 'queued') return true;
    const half = craft.lengthM / 2;
    if (
      leg.gates.some(
        (g) => g.granted && !g.released && m >= g.holdM - 1 && m <= g.vacateM + half + 5,
      )
    )
      return false;
    if (craft.mode !== 'ground') return true;
    // The way to it along its legs (a re-routed leg takes the place of the one it replaces).
    if (leg === replacing?.next) leg = replacing.target;
    let aheadM = m - craft.stationM;
    if (leg !== craft.leg) {
      aheadM = craft.leg!.endM - craft.stationM;
      for (const next of craft.next) {
        if (next.kind !== 'taxi') break;
        aheadM += (next.leg === leg ? m : next.leg.endM) - next.leg.startM;
        if (next.leg === leg) break;
      }
    }
    const brake = craft.speedMps ** 2 / (2 * fixedWing(craft).brakingDecelerationMps2);
    return aheadM >= brake + Math.min(5, 2 * craft.speedMps);
  }

  /** Orders a movement through its conflicts with the other aircraft's remaining movements by
   * their admission (the header comment): the one admitted first passes first. On a stretch both
   * follow each other on, the later one enters once the first is in ahead of it. Null where an
   * aircraft would have to wait where it can no longer stop. */
  /** TASK-330: the distance along `spans` from their start to station `m` of `leg` (Infinity if
   * the leg is not among them). */
  function along(spans: Span[], leg: Leg, m: number) {
    let d = 0;
    for (const span of spans) {
      if (span.leg === leg) return d + Math.max(0, m - span.fromM);
      d += Math.max(0, span.leg.endM - span.fromM);
    }
    return Infinity;
  }
  /** TASK-330: whether a conflict is near enough to either aircraft to be ordered now. */
  const nearEnough = (own: Span[], c: Conflict, theirs: Span[]) =>
    along(own, c.leg, c.b1) <= ORDER_HORIZON_M ||
    along(theirs, c.otherLeg, c.x1) <= ORDER_HORIZON_M;

  function order(craft: Craft, own: Span[], stop?: Leg | null) {
    const mine: Wait[] = [];
    const theirs: { owner: Craft; wait: Wait }[] = [];
    for (const other of crafts) {
      if (other === craft || other.mode === 'done') continue;
      // TASK-358: a helicopter at a pad, or low on its way onto or off one: wait short of it
      // until it has climbed clear.
      if (other.type.performance.kind === 'helicopter') {
        const bodies = heliActive(other) ? heliFootprint(other) : null;
        const at = bodies && bodyConflict(craft, own, bodies);
        if (!at) continue;
        if (!canWaitAt(craft, at.leg, at.m - SAMPLE_M)) return null;
        mine.push({
          leg: at.leg,
          atM: at.m - SAMPLE_M,
          pred: other,
          predLeg: other.leg!,
          predM: Infinity,
        });
        continue;
      }
      const otherSpans = remaining(other);
      // An aircraft parked in the way (at a stand, TASK-339 a tow's rest point): wait short of it
      // until it has left.
      if (other.mode === 'parked' && !other.admission && other.pose) {
        const at = parkedConflict(craft, own, other);
        if (!at) continue;
        if (!canWaitAt(craft, at.leg, at.m - SAMPLE_M)) return null;
        mine.push({
          leg: at.leg,
          atM: at.m - SAMPLE_M,
          pred: other,
          predLeg: other.leg!,
          predM: Infinity,
        });
        continue;
      }
      // Whoever waits for this one to leave its stand gives way to its leaving.
      const yields = other.waits.some(
        (w) => w.pred === craft && w.predM === Infinity && !passed(w),
      );
      // A re-routed aircraft, moving, goes before those not started.
      const first = craft.mode === 'ground' && unstarted(other);
      // TASK-363 (`T363K`): two queued arrivals to one runway end go in their approach sequence
      // (`seqRank`), which an arrival keeps while it steps out of the landing order.
      const sequenced =
        T363K &&
        craft.mode === 'queued' &&
        other.mode === 'queued' &&
        craft.seqRank !== undefined &&
        other.seqRank !== undefined &&
        craft.runway === other.runway &&
        craft.request?.kind === 'arrival' &&
        other.request?.kind === 'arrival' &&
        craft.request.end === other.request.end;
      let parker: Craft | null | undefined;
      for (const c of conflicts(craft, own, other)) {
        if (!nearEnough(own, c, otherSpans)) {
          late.deferred++;
          continue;
        }
        const byRank = sequenced
          ? other.seqRank! < craft.seqRank!
          : other.rank < craft.rank && !yields && !first;
        const otherCanWait =
          !inside(other, c.otherLeg, c.x1 - SAMPLE_M) &&
          canWaitAt(other, c.otherLeg, c.x1 - SAMPLE_M);
        // TASK-339: one whose movement ends with its body in the other's way goes second where it
        // can still stop short. One not started does not start behind one that can no longer.
        if (parker === undefined) parker = parkerOf(craft, own, other, otherSpans, stop);
        if (parker === other && !otherCanWait && unstarted(craft)) {
          late.parkRefused++;
          return null;
        }
        const goesSecond =
          parker === other
            ? !otherCanWait && byRank
            : parker === craft
              ? canWaitAt(craft, c.leg, c.b1 - SAMPLE_M) || byRank
              : byRank;
        if (parker && goesSecond === byRank) late.parkKept++;
        else if (parker) late.parkRuled++;
        if (goesSecond) {
          const atM = c.b1 - SAMPLE_M;
          if (!canWaitAt(craft, c.leg, atM)) return null;
          let predM = c.follow ? c.x1 + other.lengthM : c.x2 + SAMPLE_M;
          // TASK-330 (fix 3): an arrival behind another on the same way off the runway needs only
          // room to stop with its tail clear of it: the leader's tail a margin past the nose of
          // one standing at the safe point (both legs start at the exit's hand-over point, so a
          // station on the leader's leg is the same place as one on its own leg less half their
          // difference in length).
          if (
            craft.mode === 'queued' &&
            own[0]?.leg === c.leg &&
            c.leg.gates[0]?.holdM === -Infinity &&
            c.otherLeg.gates[0]?.holdM === -Infinity &&
            c.b1 < safeOf(craft, c.leg)
          )
            predM = Math.min(predM, safeOf(craft, c.leg) + margin + other.lengthM);
          mine.push({ leg: c.leg, atM, pred: other, predLeg: c.otherLeg, predM });
        } else {
          // A re-routed aircraft keeps its place before those admitted after it.
          const atM = c.x1 - SAMPLE_M;
          if (inside(other, c.otherLeg, atM) || !canWaitAt(other, c.otherLeg, atM)) return null;
          const predM = c.follow ? c.b1 + craft.lengthM : c.b2 + SAMPLE_M;
          theirs.push({
            owner: other,
            wait: { leg: c.otherLeg, atM, pred: craft, predLeg: c.leg, predM },
          });
        }
      }
    }
    return { mine, theirs };
  }

  /** TASK-344: start refusals by reason: tries refused and the seconds until the next try. */
  const startRefusals: Record<string, { n: number; s: number }> = {};
  function chargeStart(craft: Craft, timeS: number) {
    if (craft.startWhy === undefined) return;
    startRefusals[craft.startWhy]!.s += timeS - craft.startWhyS!;
    const log = craft.request?.kind === 'tow' ? towOf.get(craft.id) : undefined;
    if (log)
      log.refusals[craft.startWhy] = (log.refusals[craft.startWhy] ?? 0) + timeS - craft.startWhyS!;
    craft.startWhy = undefined;
  }
  function refuseStart(craft: Craft, why: string, timeS: number) {
    (startRefusals[why] ??= { n: 0, s: 0 }).n++;
    craft.startWhy = why;
    craft.startWhyS = timeS;
  }
  /** TASK-330 Phase 1d / TASK-339: counters of the progressive order and the parked-blocker rules. */
  const late = {
    deferred: 0,
    decided: 0,
    flipped: 0,
    held: 0,
    forced: 0,
    rings: 0,
    ringsBroken: 0,
    blockedReroutes: 0,
    blockedTries: 0,
    parkRuled: 0,
    parkKept: 0,
    parkRefused: 0,
    startRefused: 0,
    startHeld: 0,
    avoidPlans: 0,
    deadlocks: 0,
    chainsOpened: 0,
    releaseHeld: 0,
    ringKeys: new Set<string>(),
    deadKeys: new Set<string>(),
  };
  /** TASK-352: go-arounds by cause, and seconds the head of each end's arrival queue is held, by
   * cause (behaviour-neutral counters the bench reports). */
  const arrivalWhy = {
    goAround: {} as Record<string, number>,
    release: {} as Record<string, number>,
    /** TASK-363: seconds queued arrivals were held out of the landing order, by stand. */
    steppedOut: {} as Record<string, number>,
  };
  /** TASK-382: each tow, from its request to its parking (behaviour-neutral counter): start
   * refusals by reason, seconds standing still on the ground by what it waits for and where, and
   * seconds the head of an arrival queue was refused naming it, with those arrivals. */
  interface TowLog {
    registration: string;
    typeId: string;
    from: string;
    to: string;
    requestS: number;
    startS?: number;
    parkS?: number;
    refusals: Record<string, number>;
    stillS: Record<string, number>;
    heldHeadS: number;
    heldWhy: Record<string, number>;
    heldArrivals: string[];
  }
  const towLogs: TowLog[] = [];
  const towOf = new Map<number, TowLog>();
  /** TASK-382: the aircraft `roleOf` last described (the blocker a refusal names). */
  let roleSeen: Craft | null = null;
  let releaseWhy = '';
  let commitWhy = '';
  /** TASK-360 counters: take-offs by type and how they lined up; line-ups granted ahead of a
   * rolling departure's start (rule 2) and behind a lined-up one (rule 3); and arrivals held
   * while a multiple line-up holds their runway: seconds the head of an end's queue was refused
   * its window, and landing commitments that found the runway held. */
  const departureCounts = {
    takeoffsByType: {} as Record<string, Record<LineUpKind, number>>,
    lineUpsAheadOfRoll: 0,
    multiLineUps: 0,
    arrivalHeldByMultiS: 0,
    landingsHeldByMulti: 0,
  };
  const multiOn = (runway: number) =>
    crafts.some(
      (c) =>
        c.runway === runway &&
        c.multiFront !== undefined &&
        c.mode !== 'air' &&
        c.runwayClaims.length > 0,
    );
  let gapBy = '';
  /** What an aircraft is doing, for those counters. */
  function roleOf(p: Craft) {
    roleSeen = p;
    if (p.mode === 'queued') return 'queued';
    if (p.mode === 'air') return p.air?.kind ?? 'air';
    if (p.mode === 'parked') return p.request ? `parked-${p.request.kind}` : 'parked';
    if (p.mode === 'waiting') return 'lined-up';
    const role = p.towing
      ? 'tow'
      : p.next.some((n) => n.kind === 'takeoff')
        ? 'departure'
        : 'arrival';
    return `${role}-${p.speedMps > 0.3 ? 'moving' : 'still'}`;
  }
  /** TASK-352: what a ground aircraft standing still waits for (for those counters). */
  function holdOf(p: Craft) {
    if (p.mode !== 'ground' || p.speedMps > 0.3) return '';
    const w = p.waits.find((v) => v.leg === p.leg && p.stationM >= v.atM - 2 && !passed(v));
    if (w) return `<${roleOf(w.pred)}${w.predM === Infinity ? ':body' : ''}`;
    if (p.leg!.gates.some((g) => !g.granted && g.holdM > -Infinity && g.holdM <= p.stationM + 40))
      return '<gate';
    return '<claim';
  }
  /** Whether `from` waits, directly or through others, for `to`. */
  function waitsOn(from: Craft, to: Craft) {
    const seen = new Set<Craft>([from]);
    const queue = [from];
    while (queue.length) {
      const c = queue.pop()!;
      for (const w of c.waits) {
        if (passed(w) || w.pred.mode === 'done') continue;
        if (w.pred === to) return true;
        if (!seen.has(w.pred)) {
          seen.add(w.pred);
          queue.push(w.pred);
        }
      }
    }
    return false;
  }
  /** TASK-340: a chain of waits from `from` to `to` (each member waits for the next), or null. */
  function chainOf(from: Craft, to: Craft, skip?: (c: Craft, p: Craft) => boolean) {
    const parent = new Map<Craft, Craft | null>([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const c = queue.shift()!;
      for (const w of c.waits) {
        const p = w.pred;
        if (passed(w) || p.mode === 'done' || parent.has(p) || skip?.(c, p)) continue;
        parent.set(p, c);
        if (p === to) {
          const chain = [p];
          for (let q = c; q; q = parent.get(q)!) chain.unshift(q);
          return chain;
        }
        queue.push(p);
      }
    }
    return null;
  }
  /** TASK-340: before `loser` is ordered to wait for `winner` where `winner` already waits,
   * through others, for `loser` (the order would close a ring of waits), the chain is opened
   * where a member that can still stop short gives way to the one it waits for: of two moving
   * aircraft, the one waiting gets to go first. Each link turned round must close no ring of its
   * own, and never leaves an aircraft waiting for one that is to come to rest across its way
   * (TASK-339). Whether no chain is left (the flips are made only then). `skip`: links left out. */
  function openChain(winner: Craft, loser: Craft, skip?: (c: Craft, p: Craft) => boolean) {
    const flips: [Craft, Craft, Wait[]][] = [];
    const flipped = new Set<string>();
    const gone = (c: Craft, p: Craft) => flipped.has(`${c.id}>${p.id}`) || !!skip?.(c, p);
    for (let tries = 0; tries < 4; tries++) {
      const chain = chainOf(winner, loser, gone);
      if (!chain) {
        for (const [u, v, waits] of flips) giveWay(u, v, waits, false);
        return true;
      }
      let best: { u: Craft; v: Craft; waits: Wait[] } | null = null;
      for (let i = 0; i + 1 < chain.length; i++) {
        const u = chain[i]!;
        const v = chain[i + 1]!;
        // Only between moving aircraft; never an aircraft parked in the way, nor a landing.
        if (u.mode !== 'ground' || v.mode !== 'ground') continue;
        if (u.waits.some((w) => w.pred === v && w.predM === Infinity && !passed(w))) continue;
        if (flipped.has(`${v.id}>${u.id}`)) continue;
        if (parkerOf(u, remaining(u), v, remaining(v)) === u) continue;
        // Turned round, v waits for u: no chain from u back to v may remain.
        flipped.add(`${u.id}>${v.id}`);
        const rings = chainOf(u, v, gone);
        flipped.delete(`${u.id}>${v.id}`);
        if (rings) continue;
        const waits = yieldWaits(u, v);
        if (!waits?.length) continue;
        if (best && best.v.rank >= v.rank) continue;
        best = { u, v, waits };
      }
      if (!best) break;
      flipped.add(`${best.u.id}>${best.v.id}`);
      flips.push([best.u, best.v, best.waits]);
    }
    return false;
  }
  /** Seconds until an aircraft reaches station `m` of `leg` along `spans`. */
  function etaS(craft: Craft, spans: Span[], leg: Leg, m: number) {
    const d = along(spans, leg, m);
    if (craft.mode === 'ground') return d / Math.max(3, craft.speedMps);
    if (craft.mode === 'air' && craft.air)
      return (
        Math.max(0, craft.air.startS + craft.air.profile.durationS - nowS) +
        d / fixedWing(craft).taxiTurnMps
      );
    return Infinity;
  }
  /** The waits that order `loser` after `winner` through these conflicts (from `winner`'s side:
   * `c.leg` is the winner's); null if the loser can no longer stop short of one. */
  function laterWaits(winner: Craft, loser: Craft, list: Conflict[]) {
    const waits: Wait[] = [];
    for (const c of list) {
      const atM = c.x1 - SAMPLE_M;
      if (inside(loser, c.otherLeg, atM) || !canWaitAt(loser, c.otherLeg, atM)) return null;
      // TASK-330 Phase 1e: never short of where a landing aircraft's tail is off the runway.
      if (
        c.otherLeg.gates[0]?.holdM === -Infinity &&
        loser.mode !== 'queued' &&
        atM < safeOf(loser, c.otherLeg)
      )
        return null;
      const predM = c.follow ? c.b1 + winner.lengthM : c.b2 + SAMPLE_M;
      waits.push({ leg: c.otherLeg, atM, pred: winner, predLeg: c.leg, predM });
    }
    return waits;
  }
  /** TASK-330 Phase 1d: orders, as aircraft move, the conflicts of their remaining routes that
   * have come within the horizon and are not yet ordered. A pair already ordered keeps its
   * direction. Otherwise the one that cannot stop short goes first; else a started one before one
   * not started; else the one that reaches it first (ties by admission). A direction that would
   * close a ring of waits is not taken; if both would, it is left open while both can still stop. */
  function extendOrder() {
    for (const craft of crafts) {
      if (craft.mode !== 'ground') continue;
      const own = remaining(craft);
      for (const other of crafts) {
        if (other === craft || other.mode === 'done') continue;
        if (other.type.performance.kind === 'helicopter') {
          // TASK-358: a helicopter at a pad, or low on its way onto or off one, now within the
          // horizon: wait short of it until it has climbed clear. A wait on one whose footprint
          // has since left its way (the low part of a landing, once on the pad) lapses.
          const bodies = heliActive(other) ? heliFootprint(other) : null;
          const at = bodies && bodyConflict(craft, own, bodies);
          const waiting = craft.waits.some((w) => w.pred === other && !passed(w));
          if (waiting && !at) craft.waits = craft.waits.filter((w) => w.pred !== other);
          else if (
            !waiting &&
            at &&
            along(own, at.leg, at.m) <= ORDER_HORIZON_M &&
            canWaitAt(craft, at.leg, at.m - SAMPLE_M)
          ) {
            craft.waits.push({
              leg: at.leg,
              atM: at.m - SAMPLE_M,
              pred: other,
              predLeg: other.leg!,
              predM: Infinity,
            });
            late.decided++;
          }
          continue;
        }
        if (other.mode === 'parked' && other.pose) {
          // An aircraft parked in the way, now within the horizon: wait short of it until it has
          // left (with a request or not).
          const at = craft.waits.some((w) => w.pred === other && w.predM === Infinity && !passed(w))
            ? null
            : parkedConflict(craft, own, other);
          if (
            at &&
            along(own, at.leg, at.m) <= ORDER_HORIZON_M &&
            canWaitAt(craft, at.leg, at.m - SAMPLE_M)
          ) {
            craft.waits.push({
              leg: at.leg,
              atM: at.m - SAMPLE_M,
              pred: other,
              predLeg: other.leg!,
              predM: Infinity,
            });
            late.decided++;
          }
          if (!other.admission) continue;
        }
        const theirs = remaining(other);
        if (!theirs.length) continue;
        const near = conflicts(craft, own, other).filter((c) => nearEnough(own, c, theirs));
        if (!near.length) continue;
        // A conflict on a pair of legs the two are already ordered on is covered. TASK-340: not
        // while a ring is building, that is, while the one waiting also waits for the other
        // through others, and the waits on those legs do not cover it (they end short of it or
        // begin past it): once they are passed it would be ordered where the one waiting may
        // already be past its last place to stop, the other then waiting for it. Nor deeper
        // behind one that is to come to rest across its way (TASK-339).
        const covers = (w: Wait, atM: number, predM: number, follow: boolean) =>
          w.atM <= atM + 1 && (follow || w.predM >= predM - 1);
        const covered = (c: Conflict, from: Craft, to: Craft, leg: Leg, toLeg: Leg) => {
          const ws = from.waits.filter(
            (w) => w.pred === to && w.leg === leg && w.predLeg === toLeg && !passed(w),
          );
          if (!ws.length) return false;
          const [atM, predM] =
            from === craft
              ? [c.b1 - SAMPLE_M, c.x2 + SAMPLE_M]
              : [c.x1 - SAMPLE_M, c.b2 + SAMPLE_M];
          if (ws.some((w) => covers(w, atM, predM, c.follow))) return true;
          // A wait further on along the waiter's way does not cover a crossing conflict before it
          // (once that wait is passed, the waiter may already be in it): that one is ordered now,
          // in the pair's direction, while the waiter can still stop short. (On a stretch they
          // follow each other on, the leader's progress moves the conflict's start.)
          const before = !c.follow && !ws.some((w) => w.atM <= atM + 1);
          if (!before && !chainOf(from, to, (u, p) => u === from && p === to)) return true;
          return parkerOf(to, remaining(to), from, remaining(from)) === to;
        };
        const open = near.filter(
          (c) =>
            !covered(c, craft, other, c.leg, c.otherLeg) &&
            !covered(c, other, craft, c.otherLeg, c.leg),
        );
        if (!open.length) continue;
        // From the other's side the same conflicts read the other way round.
        const flip = (c: Conflict): Conflict => ({
          leg: c.otherLeg,
          b1: c.x1,
          b2: c.x2,
          other: craft,
          otherLeg: c.leg,
          x1: c.b1,
          x2: c.b2,
          follow: c.follow,
        });
        const craftFirst = () => laterWaits(craft, other, open);
        const otherFirst = () => laterWaits(other, craft, open.map(flip));
        const ordered = craft.waits.some((w) => w.pred === other && !passed(w))
          ? 'other'
          : other.waits.some((w) => w.pred === craft && !passed(w))
            ? 'craft'
            : null;
        const a = craftFirst();
        const b = otherFirst();
        let choice: 'craft' | 'other' | null = ordered;
        // TASK-339: as the pair is first ordered, one whose movement ends with its body in the
        // other's way goes second where it can still stop short (and that closes no ring).
        const parker = ordered ? null : parkerOf(craft, own, other, theirs);
        if (parker === other && a && !waitsOn(craft, other)) choice = 'craft';
        else if (parker === craft && b && !waitsOn(other, craft)) choice = 'other';
        if (parker) late[choice ? 'parkRuled' : 'parkKept']++;
        if (!choice) {
          if (!a && !b) continue;
          if (!a) choice = 'other';
          else if (!b) choice = 'craft';
          else if (unstarted(other) !== unstarted(craft))
            choice = unstarted(other) ? 'craft' : 'other';
          else {
            const ec = Math.min(...open.map((c) => etaS(craft, own, c.leg, c.b1)));
            const eo = Math.min(...open.map((c) => etaS(other, theirs, c.otherLeg, c.x1)));
            choice = ec < eo || (ec === eo && craft.rank < other.rank) ? 'craft' : 'other';
          }
          // Not the direction that closes a ring of waits.
          const closes = (first: Craft, after: Craft) => waitsOn(first, after);
          const bad = choice === 'craft' ? closes(craft, other) : closes(other, craft);
          if (bad) {
            const alt = choice === 'craft' ? 'other' : 'craft';
            const altOk = alt === 'craft' ? a && !closes(craft, other) : b && !closes(other, craft);
            if (altOk) {
              choice = alt;
              late.flipped++;
            } else if (
              // TASK-340: the chain that would close a ring is opened while its members can still
              // stop short; for either direction where both are possible.
              openChain(
                ...((choice === 'craft' ? [craft, other] : [other, craft]) as [Craft, Craft]),
              )
            ) {
              late.chainsOpened++;
            } else if (
              a &&
              b &&
              openChain(...((alt === 'craft' ? [craft, other] : [other, craft]) as [Craft, Craft]))
            ) {
              choice = alt;
              late.chainsOpened++;
            } else if (a && b) {
              late.held++;
              continue;
            } else late.forced++;
          }
        }
        const waits = choice === 'craft' ? a : b;
        if (!waits) continue;
        late.decided++;
        commitOrder(
          craft,
          {
            mine: [],
            theirs: waits.map((wait) => ({ owner: choice === 'craft' ? other : craft, wait })),
          },
          false,
        );
      }
    }
  }

  /** The first own station whose swept body touches a parked aircraft's body. */
  function parkedConflict(craft: Craft, own: Span[], other: Craft) {
    return bodyConflict(craft, own, bodyAt(other, other.pose!.position, other.pose!.headingRad));
  }
  /** The first own station whose swept body touches `body` (or one of `body`). */
  function bodyConflict(craft: Craft, own: Span[], body: Body | Body[]) {
    const bodies = Array.isArray(body) ? body : [body];
    for (const { leg, fromM } of own) {
      const box = sweepBox.get(leg) ?? (sweptLeg(craft, leg), sweepBox.get(leg)!);
      const near = bodies.filter((b) => {
        const reach = Math.max(b.length, b.span) + cellM;
        return (
          b.x >= box.minX - reach &&
          b.x <= box.maxX + reach &&
          b.y >= box.minY - reach &&
          b.y <= box.maxY + reach
        );
      });
      if (!near.length) continue;
      let first = Infinity;
      for (const bucket of sweptLeg(craft, leg).values())
        for (const a of bucket)
          if (
            a.stationM >= fromM &&
            a.stationM < first &&
            near.some((b) => bodiesTouch(a.body, b, 0))
          )
            first = a.stationM;
      if (first < Infinity) return { leg, m: first };
    }
    return null;
  }

  // ----- TASK-358: helicopters at helipads and aircraft on the ground. A helicopter on a pad, or
  // below HELI_CLEAR_M on its way onto or off one, is a body in the way for the fixed-wing order,
  // as one parked (TASK-339): they wait short of it until it has climbed clear. A helicopter does
  // not start its departure or hover-taxi, nor come down from its hover point on a landing, while
  // a fixed-wing body stands in that way or one moving cannot stop short of it; those that can
  // are ordered to wait.
  /** Where a helicopter is, or is to be, below HELI_CLEAR_M on its pad and its way onto or off
   * it (bodies a sample apart): the low part of its landing or departure (its requested one when
   * parked), a hover-taxi's whole way. Null for one with none (cruise, departed). */
  function heliFootprint(h: Craft): Body[] | null {
    const p = h.type.performance;
    if (p.kind !== 'helicopter' || !h.pose) return null;
    const runM =
      ((HELI_CLEAR_M - HELICOPTER_PAD_CLEARANCE_M) * p.transitionSpeedMps) / p.verticalClimbMps;
    const off = (from: Vec2, heading: number, m: number) => ({
      x: from.x + m * Math.cos(heading),
      y: from.y + m * Math.sin(heading),
    });
    const way = (a: Vec2, b: Vec2) => {
      const lengthM = Math.hypot(b.x - a.x, b.y - a.y);
      const heading = lengthM > 0 ? Math.atan2(b.y - a.y, b.x - a.x) : h.pose!.headingRad;
      const n = Math.max(1, Math.ceil(lengthM / SAMPLE_M));
      return Array.from({ length: n + 1 }, (_, i) =>
        bodyAt(h, { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, heading),
      );
    };
    if (h.mode === 'parked') {
      const pad = h.pose.position;
      const r = h.request;
      if (r?.kind === 'helicopter-departure') return way(pad, off(pad, r.heading, runM));
      if (r?.kind === 'hover') return way(pad, graph.helipads[r.helipad]!.pos);
      return [bodyAt(h, pad, h.pose.headingRad)];
    }
    if (h.mode !== 'air' || h.air?.kind !== 'helicopter') return null;
    const { points } = h.air.path;
    const from = points[0]!;
    const to = points.at(-1)!;
    if (h.next[0]?.kind === 'rest') {
      if (h.pose.phase === 'hover-taxi') return way(h.pose.position, to);
      return way(off(to, Math.atan2(to.y - from.y, to.x - from.x), -runM), to);
    }
    if (h.pose.heightM >= HELI_CLEAR_M) return null;
    return way(from, off(from, Math.atan2(to.y - from.y, to.x - from.x), runM));
  }
  /** Whether fixed-wing aircraft keep clear of a helicopter's footprint: one on a pad, coming
   * down past its hover point or hover-taxiing, or climbing off a pad below HELI_CLEAR_M. */
  function heliActive(h: Craft) {
    if (!h.pose) return false;
    if (h.mode === 'parked') return h.helipad >= 0;
    if (h.mode !== 'air' || h.air?.kind !== 'helicopter') return false;
    return h.next[0]?.kind === 'rest' ? h.air.decided : h.pose.heightM < HELI_CLEAR_M;
  }
  /** Whether a helicopter may start its departure or hover-taxi, or come down from its hover
   * point: no fixed-wing body (low) touches its footprint and none moving there that has not
   * been ordered behind it is past its last place to stop. Those that can stop short are
   * ordered to wait for it (until it has climbed clear). Those already waiting for it (they
   * wait short of its pad) do not hold it, or neither would move. */
  function heliClear(h: Craft) {
    const bodies = heliFootprint(h)!;
    const waits: { owner: Craft; wait: Wait }[] = [];
    for (const other of crafts) {
      if (other === h || other.mode === 'done' || other.type.performance.kind === 'helicopter')
        continue;
      if (other.waits.some((w) => w.pred === h && !passed(w))) continue;
      const pose = other.pose;
      if (pose && pose.heightM < HELI_CLEAR_M) {
        const body = bodyAt(other, pose.position, pose.headingRad);
        if (bodies.some((b) => bodiesTouch(b, body))) return false;
      }
      const own = remaining(other);
      const at = own.length ? bodyConflict(other, own, bodies) : null;
      if (!at) continue;
      const atM = at.m - SAMPLE_M;
      if (inside(other, at.leg, atM) || !canWaitAt(other, at.leg, atM)) return false;
      waits.push({
        owner: other,
        wait: { leg: at.leg, atM, pred: h, predLeg: h.leg!, predM: Infinity },
      });
    }
    commitOrder(h, { mine: [], theirs: waits }, false);
    return true;
  }

  /** TASK-339: the leg at whose end an aircraft's movement ends parked (a stand, or a tow's rest
   * point), or null: it leaves by a runway, or has no movement on the ground planned. */
  function stopLeg(craft: Craft): Leg | null {
    if (craft.mode === 'parked') {
      const a = craft.admission;
      return a && (a.next[0]?.kind === 'park' || a.next[0]?.kind === 'rest')
        ? a.legs.at(-1)!
        : null;
    }
    if (craft.mode !== 'ground') return null;
    let leg = craft.leg!;
    for (const n of craft.next) {
      if (n.kind === 'taxi') leg = n.leg;
      else return n.kind === 'park' || n.kind === 'rest' || n.kind === 'return' ? leg : null;
    }
    return null;
  }
  /** Its body where it comes to rest at the end of `leg` (as `park` places it). */
  const stopBodies = new WeakMap<Leg, Body>();
  function stopBody(craft: Craft, leg: Leg) {
    let body = stopBodies.get(leg);
    if (!body) {
      const pose = poseAt(leg, Math.max(0, leg.endM));
      body = bodyAt(craft, pose.position, pose.headingRad);
      stopBodies.set(leg, body);
    }
    return body;
  }
  /** Aircraft not yet on the ground at their airport: landing ordering stays as it is. */
  const landingSide = (craft: Craft) =>
    craft.mode === 'queued' || craft.mode === 'air' || craft.mode === 'waiting';
  /** TASK-339: of two aircraft whose remaining movements meet, the one whose movement ends parked
   * or at rest with its body in the other's remaining way (and not the other way round): it goes
   * second, as once there it would stay until it moves again. Not for an arrival not yet on the
   * ground, nor for one parked in the way of an aircraft not yet started (that one does not start
   * while it stands there). `stop`: `craft`'s stop leg where it is not yet admitted. */
  function parkerOf(
    craft: Craft,
    own: Span[],
    other: Craft,
    theirs: Span[],
    stop?: Leg | null,
  ): Craft | null {
    if (landingSide(craft) || landingSide(other) || !theirs.length) return null;
    const mine = stop === undefined ? stopLeg(craft) : stop;
    const their = stopLeg(other);
    if (!mine && !their) return null;
    const iBlock =
      !!mine && !unstarted(other) && !!bodyConflict(other, theirs, stopBody(craft, mine));
    const theyBlock = !!their && !!bodyConflict(craft, own, stopBody(other, their));
    return iBlock === theyBlock ? null : iBlock ? craft : other;
  }

  /** TASK-340: a landing aircraft's wait on its way off the runway (short of where its tail is
   * off) for one that is to stop at a runway hold not yet granted, with its body there in that
   * way, lasts until that one's tail is past its hold (passing the conflict alone, it could stop
   * there and stand in the landing aircraft's way). */
  function holdClear(owner: Craft, w: Wait) {
    if (w.predM === Infinity || w.leg.gates[0]?.holdM !== -Infinity) return;
    if (w.atM >= safeOf(owner, w.leg)) return;
    const pred = w.pred;
    for (const g of w.predLeg.gates) {
      if (g.granted || g.holdM === -Infinity || g.holdM + pred.lengthM / 2 <= w.predM) continue;
      if (pred.mode === 'ground' && pred.leg === w.predLeg && pred.stationM > g.holdM) continue;
      const pose = poseAt(w.predLeg, g.holdM);
      const at = bodyConflict(
        owner,
        [{ leg: w.leg, fromM: 0 }],
        bodyAt(pred, pose.position, pose.headingRad),
      );
      if (at && at.m < safeOf(owner, w.leg))
        w.predM = Math.max(w.predM, g.holdM + pred.lengthM / 2 + SAMPLE_M);
    }
  }
  /** `check` (TASK-340): a wait between two moving aircraft (or one moving and an arrival in the
   * air) that would close a ring of waits first opens the chain behind it where a member can
   * still give way. The progressive order checks its own waits, and ring breaking needs none. */
  function commitOrder(craft: Craft, decided: NonNullable<ReturnType<typeof order>>, check = true) {
    if (check) {
      const pairs = new Set<string>();
      for (const [owner, pred] of [
        ...decided.mine.map((w) => [craft, w.pred] as const),
        ...decided.theirs.map(({ owner, wait }) => [owner, wait.pred] as const),
      ]) {
        if (owner.mode !== 'ground' || (pred.mode !== 'ground' && pred.mode !== 'air')) continue;
        if (pairs.has(`${owner.id}>${pred.id}`)) continue;
        pairs.add(`${owner.id}>${pred.id}`);
        if (waitsOn(pred, owner)) openChain(pred, owner);
      }
    }
    for (const w of decided.mine) holdClear(craft, w);
    craft.waits.push(...decided.mine);
    for (const { owner, wait } of decided.theirs) {
      holdClear(owner, wait);
      owner.waits.push(wait);
      // A moving aircraft gives up what it claimed beyond its new stop.
      if (owner.mode === 'ground' && owner.leg === wait.leg) {
        const half = owner.lengthM / 2;
        owner.claimHi = Math.min(owner.claimHi, Math.max(owner.stationM + half, wait.atM + half));
        publish(owner);
      }
    }
  }

  /** Drops a movement ordered but not started: the waits of others behind it lapse with it. */
  function dropAdmission(craft: Craft) {
    craft.admission = null;
    craft.waits = [];
  }

  /** The station of an arrival's exit leg from which it may wait: its tail off the runway. */
  function safeOf(craft: Craft, leg: Leg) {
    const landing = leg.gates.find((g) => g.holdM === -Infinity);
    return (landing?.vacateM ?? 0) + craft.lengthM / 2 + 5;
  }

  function sweepClear(craft: Craft, path: Body[]) {
    for (const other of crafts) {
      if (other === craft || other.mode === 'done') continue;
      // One ordered after it stands clear of its path by the order's own test (TASK-312).
      if (other.waits.some((w) => w.pred === craft && !passed(w))) continue;
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
      const push = buildLeg(craft, 'pushback', pushSegments);
      push.pushStand = craft.stand;
      best = {
        legs: [push, buildLeg(craft, mode, taxiSegments)],
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
    const edge = arcEdge(arc);
    if (graph.edges[edge]!.kind === 'runway') return 1000;
    const dir = arcForward(arc) ? 1 : -1;
    const flow = flowFactor?.[arc] ?? 1;
    // TASK-382 (`T382R`): a tow's route keeps off the taxiways arrivals leave the runway by, as
    // off a parked aircraft (ICAO Doc 9476 SMGCS: towing routes are planned clear of the runway
    // exits in use; Doc 4444 7.6: aerodrome control keeps the way off clear for landing traffic).
    const blocked =
      parkedInTheWay(craft, edge) ||
      (avoiding.length > 0 && avoidedOn(craft, edge)) ||
      (T382R && wayOff[edge] === 1 && (craft.towing || craft.request?.kind === 'tow'))
        ? PARKED_FACTOR
        : 1;
    return edgeLocks[edge]!.some((l) => l.id !== craft.id && l.dir === -dir)
      ? 3 * flow * blocked
      : flow * blocked;
  }

  /** TASK-312: aircraft parked near each edge (by the box of its line), and whether one of them
   * stands in the way of a type taxiing along it, by edge, parked aircraft and type. */
  const parkedNear = new Map<number, Craft[]>();
  const inTheWay = new Map<string, boolean>();
  function noteParked(craft: Craft) {
    const { position } = craft.pose!;
    const reach = Math.max(craft.lengthM, craft.type.spanM) / 2 + graph.maxSpanM / 2 + 10;
    for (const edge of graph.edges) {
      if (edge.kind === 'lead_in' || edge.kind === 'runway') continue;
      const box = edgeBoxes[edge.idx]!;
      if (
        position.x < box.minX - reach ||
        position.x > box.maxX + reach ||
        position.y < box.minY - reach ||
        position.y > box.maxY + reach
      )
        continue;
      const list = parkedNear.get(edge.idx);
      if (list) list.push(craft);
      else parkedNear.set(edge.idx, [craft]);
    }
  }
  /** TASK-339: aircraft standing still in the way of a parked one's next movement, waiting for it
   * to leave; while it plans, its route keeps off their bodies as off parked ones. */
  let avoiding: Craft[] = [];
  const avoidHits = new Map<number, boolean>();
  function avoidedOn(craft: Craft, edgeIdx: number) {
    let hit = avoidHits.get(edgeIdx);
    if (hit !== undefined) return hit;
    const edge = graph.edges[edgeIdx]!;
    hit = false;
    for (const other of avoiding) {
      const body = bodyAt(other, other.pose!.position, other.pose!.headingRad);
      const reach = Math.max(other.lengthM, other.type.spanM) / 2 + graph.maxSpanM / 2 + 10;
      const box = edgeBoxes[edgeIdx]!;
      if (
        body.x < box.minX - reach ||
        body.x > box.maxX + reach ||
        body.y < box.minY - reach ||
        body.y > box.maxY + reach
      )
        continue;
      for (let m = 0; m <= edge.lengthM && !hit; m += 4) {
        const at = pointAtDistance(edge.line, edge.cumulative, m);
        const heading = headingAtDistance(edge.line, edge.cumulative, m);
        hit = bodiesTouch(body, bodyAt(craft, at, heading), 0);
      }
      if (hit) break;
    }
    avoidHits.set(edgeIdx, hit);
    return hit;
  }
  function parkedInTheWay(craft: Craft, edgeIdx: number) {
    const list = parkedNear.get(edgeIdx);
    if (!list) return false;
    const edge = graph.edges[edgeIdx]!;
    for (let i = list.length - 1; i >= 0; i--) {
      const other = list[i]!;
      if (other.mode !== 'parked') {
        list.splice(i, 1);
        continue;
      }
      if (other === craft) continue;
      const key = `${edgeIdx}/${other.id}/${other.stillSinceS}/${craft.type.id}`;
      let hit = inTheWay.get(key);
      if (hit === undefined) {
        const body = bodyAt(other, other.pose!.position, other.pose!.headingRad);
        hit = false;
        for (let m = 0; m <= edge.lengthM && !hit; m += 4) {
          const at = pointAtDistance(edge.line, edge.cumulative, m);
          const heading = headingAtDistance(edge.line, edge.cumulative, m);
          hit = bodiesTouch(body, bodyAt(craft, at, heading), 0);
        }
        inTheWay.set(key, hit);
      }
      if (hit) return true;
    }
    return false;
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
    // On a runway that crosses no other, as rules 2 and 3 (and TASK-330's line-up behind a roll):
    // on Boston's crossing runways the rule changed a dozen take-offs a day and the day lost
    // (mean delay +14 % on two seeds, more go-arounds by arrival-side holds); `a` lifts it.
    const idep = T360I && (T360A || independent(runway.idx));
    // Full-length entries first; then backtracks of up to BACKTRACK_M along the runway; then
    // intersection departures with a quarter of the take-off run to spare (TASK-312), before a
    // longer backtrack would hold the runway for minutes. TASK-360 rule 1: intersection
    // take-offs with INTERSECTION_FACTOR of the run to spare, and with them the full-length
    // entries, are one choice made by the route (`departurePlan`), before any backtrack, which
    // holds the runway for the whole line-up (TASK-352: intersections make the most of runway
    // capacity, SKYbrary "Intersection Take-off"; Heathrow 27R's end is a dead end, and its
    // backtracks set the gap between take-offs at about 110 s).
    const ranked: {
      rank: number;
      goal: number;
      after: () => Segment[];
      lineUpU: number;
      entryU: number;
      how: LineUpKind;
    }[] = [];
    for (const { node, u, i } of nodes) {
      const full = u <= thresholdU + 1e-6;
      const goal = runwayArc(runway, i, towardEnd1);
      const lineUpU = u + Math.max(craft.lengthM / 2, p.minTurnRadiusM) + 5;
      const spare = full ? 1 : idep ? INTERSECTION_FACTOR : 1.25;
      if (goal < 0 || runway.lengthM - lineUpU < need * spare) continue;
      if (arcsFrom(graph, node).length < 2) continue;
      ranked.push({
        rank: full ? 0 : idep ? 1 : 2,
        goal,
        lineUpU,
        entryU: u,
        // Counted as an intersection take-off past INTERMEDIATE_M from the threshold (Heathrow
        // 27R's first entry, 86 m from its dead end, is its full-length one).
        how: u <= thresholdU + INTERMEDIATE_M ? 'full' : 'intersection',
        after: () => [runwaySegment(runway, end, u, lineUpU)],
      });
    }
    for (const { u, i } of nodes) {
      if (u < reach + craft.lengthM / 2) continue;
      const goal = runwayArc(runway, i, !towardEnd1);
      if (goal < 0 || runway.lengthM - reach < need) continue;
      const { line, cumulative } = runwayLine(runway, end);
      const q = pointAtDistance(line, cumulative, reach);
      const heading = (runway.ends[end]!.heading + Math.PI) % (2 * Math.PI);
      ranked.push({
        rank: u - reach <= BACKTRACK_M ? (idep ? 2 : 1) : 3,
        goal,
        lineUpU: reach,
        entryU: u,
        how: 'backtrack',
        after: () => [
          runwaySegment(runway, end, u, reach),
          freeSegment([q, ...balloon(q, heading, p.minTurnRadiusM)], runway.idx),
        ],
      });
    }
    // TASK-360 rule 1: where an intersection take-off fits, the full-length entries join that
    // choice; where none fits, the full-length entry is taken as before.
    if (idep && ranked.some((o) => o.rank === 1))
      for (const o of ranked) if (o.rank === 0) o.rank = 1;
    // A stable sort keeps the station order within a rank.
    const options = ranked.sort((a, b) => a.rank - b.rank);
    return options;
  }

  /** TASK-360 rule 1: other departures planned to enter `runway` from `end` at `entryU` that have
   * not lined up yet. */
  function queuedAtEntry(craft: Craft, runway: number, end: number, entryU: number) {
    let n = 0;
    for (const o of crafts) {
      if (o === craft || o.runway !== runway || (o.mode !== 'ground' && o.mode !== 'parked'))
        continue;
      const t = (o.mode === 'parked' ? (o.admission?.next ?? []) : o.next).find(
        (x) => x.kind === 'takeoff',
      );
      if (t?.kind !== 'takeoff' || t.end !== end || Math.abs(t.entryU - entryU) > 1) continue;
      if (o.mode === 'ground' && o.leg!.gates.some((g) => g.vacateM === Infinity && g.granted))
        continue;
      n++;
    }
    return n;
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

  function addAirUses(uses: RunwayUse[], air: Air, offsetM: number, half: number) {
    const endM = air.kind === 'approach' ? air.path.lengthM : air.clearM + margin;
    for (const area of areasByRunway[air.runway]!) {
      const span = areaSpan(area, air.path, 0, endM);
      if (span) addUse(uses, area.idx, offsetM + span.toM + half);
    }
  }

  function claimRunways(craft: Craft, uses: BookedUse[]) {
    for (const { resource, clearM, clearS } of uses) {
      // TASK-330 Phase 1e step 2: a crossing behind a landing aircraft shares the runway with it;
      // the later clearing time stands.
      if (runwayOccupant[resource] === -1) runwayClearS[resource] = clearS;
      else runwayClearS[resource] = Math.max(runwayClearS[resource]!, clearS);
      runwayOccupant[resource] = craft.id;
      addUse(craft.runwayClaims, resource, clearM);
    }
  }

  function releaseRunways(craft: Craft, stationM: number) {
    for (let i = craft.runwayClaims.length - 1; i >= 0; i--) {
      const { resource, clearM } = craft.runwayClaims[i]!;
      if (stationM + 1e-6 < clearM) continue;
      craft.runwayClaims.splice(i, 1);
      if (runwayOccupant[resource] !== craft.id) continue;
      // Another aircraft still on it (one sharing it) holds it on.
      const still = crafts.find(
        (o) => o !== craft && o.runwayClaims.some((use) => use.resource === resource),
      );
      runwayOccupant[resource] = still ? still.id : -1;
    }
  }

  // ----- TASK-330 departure flow.
  /** A line-up on a runway end: where it enters and where it stands (stations from `end`), and
   * half the length of the aircraft lining up. */
  type LineUp = { end: number; lineUpU: number; entryU: number; halfM: number };
  /** A departure that has started its roll, its tail well clear of its line-up point, from the
   * same end as a line-up at `lineUp` and no further down the runway than that line-up (so it
   * rolls away from it, not toward it). TASK-360 rule 2: or one further down the runway whose
   * tail is already `margin` past the nose of the line-up and its entry (a following aircraft
   * may line up behind a departing aircraft once it has passed the entry: a conditional clearance
   * in respect of the aircraft ahead in the departure sequence, CAP 493, Section 2, Chapter 1,
   * 13.3 and 14). */
  function rollingAway(o: Craft, lineUp: LineUp) {
    if (o.mode !== 'air' || o.air?.kind !== 'takeoff' || o.end !== lineUp.end) return false;
    const fromU = graph.runways[o.runway]!.lengthM - o.air.clearM;
    if (o.stationM >= o.lengthM + margin && lineUp.lineUpU <= fromU + 1) return true;
    return T360R && fromU + o.stationM - o.lengthM / 2 > noseU(lineUp) + margin;
  }
  /** TASK-360: the furthest station from its end a line-up reaches (its nose lined up, or its
   * entry for a backtrack). */
  const noseU = (lineUp: LineUp) => Math.max(lineUp.lineUpU, lineUp.entryU) + lineUp.halfM;
  /** TASK-360: where a departure holding its runway stands or will stand lined up: lined up, or
   * lining up with its grant. Null for any other aircraft. */
  function lineUpOf(o: Craft): LineUp | null {
    const halfM = o.lengthM / 2;
    if (o.mode === 'waiting') {
      const u = graph.runways[o.runway]!.lengthM - o.air!.clearM;
      return { end: o.end, lineUpU: u, entryU: u, halfM };
    }
    if (o.mode !== 'ground') return null;
    const next = o.next.find((n) => n.kind === 'takeoff');
    if (next?.kind !== 'takeoff') return null;
    if (!o.leg!.gates.some((g) => g.vacateM === Infinity && g.granted)) return null;
    return { end: next.end, lineUpU: next.lineUpU, entryU: next.entryU, halfM };
  }
  /** TASK-360 rule 3, multiple line-ups: a line-up whose nose stays MULTI_LINEUP_M behind the
   * tail of a departure lined up (or lining up) ahead of it from the same end (line-up
   * instructions may be issued to more than one aircraft at different points on the same runway:
   * CAP 493, Section 2, Chapter 1, 14.1; ICAO Doc 7030, 6.5.4; the front one takes off first). */
  function linedUpAhead(o: Craft, lineUp: LineUp) {
    const front = lineUpOf(o);
    return (
      T360M &&
      !!front &&
      front.end === lineUp.end &&
      noseU(lineUp) + MULTI_LINEUP_M <= front.lineUpU - front.halfM
    );
  }
  /** The last take-off roll on each runway: who, when, and the runway it had ahead (`clearM`). */
  const lastTakeoff: ({ craft: Craft; startS: number; clearM: number } | undefined)[] = [];
  const wakeRank = { light: 0, medium: 1, heavy: 2, super: 3 };
  /** Seconds between the take-off rolls of `leader` (with `leaderClearM` of runway ahead) and
   * `follower` (with `followerClearM`) on one runway. TASK-352 / TASK-360 rule 1: a follower with
   * a wake interval behind its leader that lines up more than INTERMEDIATE_M past where the
   * leader started its roll keeps a minute more (ICAO Doc 4444, 5.8.3.2: 3 minutes instead of 2
   * from an intermediate part of the same runway). */
  function departureGapS(
    leader: Craft,
    leaderClearM: number,
    follower: Craft,
    followerClearM: number,
  ) {
    const a = wakeRank[wakeOf(leader.type)];
    const b = wakeRank[wakeOf(follower.type)];
    const intermediate = T360I && a > b && leaderClearM - followerClearM > INTERMEDIATE_M;
    return (a === 3 && b < 3 ? 180 : a > b ? 120 : DEP_SEP_S) + (intermediate ? 60 : 0);
  }
  /** A lined-up departure waits while another departure on its runway still holds it (not yet
   * past the far end) and for the wake time behind the last take-off roll. TASK-360 rule 3: and
   * while one lined up (or lining up) ahead of it from the same end has not taken off. */
  function takeoffHeld(craft: Craft, timeS: number) {
    const myU = graph.runways[craft.runway]!.lengthM - craft.air!.clearM;
    for (const o of crafts) {
      if (o === craft || o.runway !== craft.runway || !o.runwayClaims.length) continue;
      if (o.mode === 'air' && o.air?.kind === 'takeoff') return true;
      if (T360M) {
        const ahead = lineUpOf(o);
        if (ahead && ahead.end === craft.end && ahead.lineUpU > myU) return true;
      }
    }
    const last = lastTakeoff[craft.runway];
    return (
      !!last &&
      timeS - last.startS < departureGapS(last.craft, last.clearM, craft, craft.air!.clearM)
    );
  }
  /** TASK-360: which rule let the last fitting line-up share its runway (counters). */
  let sharedBy: 'roll' | 'multi' | '' = '';

  /** Whether holders and arrivals' bookings leave all these resources free for the movement. */
  function bookingFits(
    uses: BookedUse[],
    fromS: number,
    bufferS: number,
    except: number,
    crossing?: { at: Vec2; halfM: number },
    lineUp?: LineUp,
  ) {
    sharedBy = '';
    for (const use of uses) {
      const { resource, clearS } = use;
      const occupant = runwayOccupant[resource]!;
      // TASK-330 Phase 1e step 2: a crossing goes behind a landing aircraft whose tail is past it.
      // TASK-330: a departure lines up behind one that has started its roll.
      const behind = (id: number) =>
        (!!lineUp && rollingAway(crafts[id - 1]!, lineUp)) ||
        (!!crossing &&
          resource < graph.runways.length &&
          landedPast(crafts[id - 1]!, resource, crossing));
      if (
        occupant !== -1 &&
        occupant !== except &&
        (fromS <= nowS || runwayClearS[resource]! > fromS)
      ) {
        if (lineUp && (T360R || T360M)) {
          // TASK-360: every aircraft holding the runway is rolling away beyond the line-up
          // (rule 2) or lined up ahead of it (rule 3), not only the last to claim it. TASK-365:
          // at most two lined up at once (one ahead of this one): CAP 493's multiple line-ups
          // are a pair at two points, and a third behind them stood in the second's way.
          let ahead = 0;
          for (const o of crafts) {
            if (o.id === except || !o.runwayClaims.some((u) => u.resource === resource)) continue;
            if (rollingAway(o, lineUp)) {
              const fromU = graph.runways[o.runway]!.lengthM - o.air!.clearM;
              if (lineUp.lineUpU > fromU + 1 && sharedBy !== 'multi') sharedBy = 'roll';
            } else if (linedUpAhead(o, lineUp) && ++ahead < 2) sharedBy = 'multi';
            else return false;
          }
        } else if (!behind(occupant)) return false;
      }
      for (const other of crafts) {
        const booking = other.arrivalBooking;
        if (
          other.id !== except &&
          booking &&
          booking.uses.some(
            (u) => u.resource === resource && booking.fromS < clearS + bufferS && u.clearS > fromS,
          ) &&
          !behind(other.id)
        )
          return false;
      }
    }
    return true;
  }

  /** TASK-330 Phase 1e step 2: whether a landing aircraft on `runway` has its tail a margin past
   * a crossing at `at` (half the crossing aircraft's span `halfM` each side), rolling away from it. */
  function landedPast(lander: Craft, runway: number, crossing: { at: Vec2; halfM: number }) {
    if (lander.runway !== runway || !lander.pose) return false;
    const landing =
      (lander.mode === 'air' && lander.air?.kind === 'approach' && lander.air.touched) ||
      (lander.mode === 'ground' && lander.leg?.gates[0]?.holdM === -Infinity);
    if (!landing) return false;
    const r = graph.runways[runway]!;
    const t = r.ends[lander.end]!.stationM;
    const fromThreshold = (p: Vec2) => Math.abs(nearestOnPolyline(r.line, p).along - t);
    return (
      fromThreshold(lander.pose.position) - lander.lengthM / 2 >
      fromThreshold(crossing.at) + crossing.halfM + CROSS_BEHIND_M
    );
  }

  /** An arrival is ordered against the ground movements first (with its first usable landing),
   * and appears once its stand is clear, every conflict before its tail is off the runway is
   * passed or ordered after it, and its runway window is free. */
  /** Arrivals leave a runway gap for an aircraft that has waited at one of its holds: one only
   * appears when its window starts that aircraft's occupancy (and the buffers) after the last
   * window booked before it (TASK-312: crossings and departures between arrivals). */
  function leavesGap(uses: BookedUse[], fromS: number) {
    for (const { resource } of uses) {
      let needS = 0;
      let by: Craft | null = null;
      for (const other of crafts) {
        const wait = other.runwayWait;
        if (!wait || other.mode !== 'ground' || nowS - wait.sinceS < RUNWAY_GAP_WAIT_S) continue;
        const use = wait.uses.find((use) => use.resource === resource);
        const bufS = 2 * RUNWAY_BUFFER_S;
        if (use && use.clearS - wait.checkedAtS + bufS > needS) {
          needS = use.clearS - wait.checkedAtS + bufS;
          by = other;
        }
      }
      if (!needS) continue;
      let lastS = runwayOccupant[resource] === -1 ? nowS : Math.max(nowS, runwayClearS[resource]!);
      for (const other of crafts) {
        const use = other.arrivalBooking?.uses.find((use) => use.resource === resource);
        if (use) lastS = Math.max(lastS, use.clearS);
      }
      if (fromS < lastS + needS) {
        gapBy = `${by ? roleOf(by) : '?'}:${Math.round(needS / 10) * 10}s`;
        return false;
      }
    }
    return true;
  }

  /** An aircraft on the ground in the way off the runway of `craft` by `leg` (before its tail is
   * off) that cannot give way to it there; `standing`: only one standing still. */
  function exitBlocker(craft: Craft, leg: Leg, standing: boolean) {
    const safeM = safeOf(craft, leg);
    for (const o of crafts) {
      if (o === craft || o.mode !== 'ground') continue;
      if (standing && o.speedMps > 0.5) continue;
      // A landed aircraft moving off by its exit is judged at commitment; one standing is not.
      const landed = o.leg!.gates[0]?.holdM === -Infinity && o.runway === craft.runway;
      if (landed && o.speedMps > 0.5) continue;
      if (o.waits.some((w) => w.pred === craft && !passed(w))) continue;
      const meets = conflicts(craft, [{ leg, fromM: 0 }], o).some((c) => c.b1 - SAMPLE_M < safeM);
      if (meets && !yieldWaits(craft, o)) return o;
    }
    return null;
  }

  function trySpawnArrival(
    craft: Craft,
    request: Extract<Request, { kind: 'arrival' }>,
    timeS: number,
  ) {
    const runway = graph.runways[craft.runway]!;
    const refuse = (why: string) => {
      releaseWhy = why;
      return false;
    };
    if (runways.restricted && !arrivalOpen[endKey(runway.idx, request.end)])
      return refuse('closed');
    if (standOccupant[request.stand] !== -1) return refuse('stand');
    if (pushBlocksStand(craft, request.stand)) return refuse('push');
    // TASK-363 (`T363P`): an arrival that cannot reach its stand while an aircraft stands parked
    // across its way in, with no movement admitted or requested, steps out of the landing order:
    // it is not ordered (or its order is dropped), so the arrivals behind it are not ordered to
    // wait for it and land first; it keeps its place in the approach sequence (`T363K`) and is
    // ordered once the way is clear. ICAO Doc 4444, 6.5.6.1.1 (the approach sequence facilitates
    // the arrival of the maximum number of aircraft with the least average delay) and 6.5.6.1.4
    // (an aircraft that holds for reasons of its own is re-sequenced so that others may land).
    if (T363P && craft.admission && behindParked(craft.waits)) {
      stepOut(craft);
      return refuse('behindParked');
    }
    if (!craft.admission) {
      let blocked = false;
      for (const option of landings(craft, runway, request.end, request.stand)) {
        const landing = option();
        if (!landing) continue;
        craft.rank = ++admitted;
        const decided = order(craft, [{ leg: landing.leg, fromM: 0 }]);
        if (!decided) continue;
        if (T363P && behindParked(decided.mine)) {
          craft.seqRank ??= craft.rank;
          blocked = true;
          continue;
        }
        craft.seqRank ??= craft.rank;
        commitOrder(craft, decided);
        craft.admission = { legs: [landing.leg], next: [], landing };
        if (T382R || T382S) {
          const safeM = safeOf(craft, landing.leg);
          for (const p of landing.leg.pieces)
            if (p.startM < safeM && graph.edges[p.edge]!.kind !== 'runway') wayOff[p.edge] = 1;
        }
        break;
      }
      if (!craft.admission) return blocked ? refuse('behindParked') : 'unordered';
    }
    const landing = craft.admission.landing!;
    const pass = passing(craft);
    // TASK-330: an arrival ahead on final to the same runway does not keep it from appearing as
    // long as it will be clear of the way off the runway by this one's landing commitment; it is
    // spaced on final from it instead.
    const leg = landing.leg;
    const safeM = safeOf(craft, leg);
    // TASK-330 Phase 1e step 1: the way off the runway is ordered at landing commitment. It does
    // not appear while an aircraft stands in its way off that could not give way there.
    const blocker = exitBlocker(craft, leg, false);
    if (blocker) {
      return refuse(`exit:${roleOf(blocker)}${holdOf(blocker)}`);
    }
    const unstartedWait = craft.waits.find(
      (w) => unstarted(w.pred) && !pass.has(w.pred) && !passed(w),
    );
    if (unstartedWait) {
      const p = unstartedWait.pred;
      const sameEnd =
        p.request?.kind === 'arrival' && p.runway === craft.runway && p.request.end === request.end;
      const where =
        p.mode !== 'queued'
          ? ''
          : !sameEnd
            ? ':otherEnd'
            : queue.indexOf(p.id) < queue.indexOf(craft.id)
              ? ':ahead'
              : `:behind${p.admission ? '' : ':unadmitted'}${p.rank < craft.rank ? ':lowerRank' : ''}>${(p.releaseWhy ?? '?').split('>').at(-1)}`;
      return refuse(`unstarted:${roleOf(p)}${where}`);
    }
    const air = approachAir(craft, landing, timeS);
    const thresholdS = timeS + air.thresholdM / fixedWing(craft).approachSpeedMps;
    if (!spacedOnFinal(craft, thresholdS)) return refuse('spacing');

    const exitS = timeS + air.profile.durationS;
    const taxi = taxiProfile(landing.leg.path, fixedWing(craft), {
      startStationM: craft.lengthM / 2,
      startSpeedMps: landing.exitSpeedMps,
      stopStationM: landing.leg.endM,
    });
    const fromS = thresholdS - leadS(craft.runway) - ARRIVAL_PAD_S;
    const half = craft.lengthM / 2;
    const offsetM = air.path.lengthM - half;
    const uses = landing.leg.gates[0]!.uses.map((use) => ({
      ...use,
      clearM: use.clearM + offsetM,
    }));
    addAirUses(uses, air, 0, half);
    const booking = uses.map((use) => ({
      ...use,
      clearS:
        ARRIVAL_PAD_S +
        (use.clearM <= air.path.lengthM
          ? timeS + timeTo(air.profile, use.clearM)
          : exitS + timeTo(taxi, use.clearM - offsetM)),
    }));
    if (!bookingFits(booking, fromS, 0, craft.id)) {
      // TASK-352 (counters): who holds or books a resource in its window.
      let who = '?';
      for (const use of booking) {
        const occ = runwayOccupant[use.resource]!;
        if (
          occ !== -1 &&
          occ !== craft.id &&
          (fromS <= nowS || runwayClearS[use.resource]! > fromS)
        ) {
          who = `occ:${roleOf(crafts[occ - 1]!)}`;
          break;
        }
        const other = crafts.find(
          (o) =>
            o.id !== craft.id &&
            o.arrivalBooking?.uses.some(
              (u) =>
                u.resource === use.resource &&
                o.arrivalBooking!.fromS < use.clearS &&
                u.clearS > fromS,
            ),
        );
        if (other) {
          who = `booked:${roleOf(other)}`;
          break;
        }
      }
      return refuse(`booking:${who}`);
    }
    if (!leavesGap(booking, fromS)) return refuse(`gap:${gapBy}`);
    const given = yieldsTo(craft, pass);
    if (!given) return refuse('yield');
    // TASK-330 Phase 1e: ground aircraft about to enter its way off the runway (within
    // EXIT_NEAR_M of where they would meet it, before its tail is off) wait for it from now; those
    // further off are ordered as they come near.
    for (const o of crafts) {
      if (o === craft || o.mode !== 'ground') continue;
      if (o.waits.some((w) => w.pred === craft && !passed(w))) continue;
      const near = conflicts(craft, [{ leg, fromM: 0 }], o).filter(
        (c) => c.b1 - SAMPLE_M < safeM && along(remaining(o), c.otherLeg, c.x1) <= EXIT_NEAR_M,
      );
      if (!near.length) continue;
      const waits = yieldWaits(craft, o);
      if (waits) given.push([o, waits]);
    }
    // TASK-340: not while its waits would leave one moving on the ground waiting for it where it
    // is to park with its body across that one's way (TASK-339), nor close a ring of waits
    // through it (one that would wait for it already has it waiting, through others, for
    // itself) that cannot be opened: it stays queued (once airborne it could give way to none).
    // TASK-340 (as TASK-339 for a departure at its stand): nor while one moving on the ground is
    // to come to rest with its body across its way in (it would park in its way after it
    // appears, and could give way to it no more).
    if (restersAcross(craft, [leg]).some((o) => o.mode === 'ground')) return refuse('resters');
    // Nor while it is to park with its body across the way of one moving on the ground that has
    // not yet passed there (TASK-339: that one would wait there until it leaves again).
    const stopped = stopBody(craft, leg);
    for (const o of crafts)
      if (
        o.mode === 'ground' &&
        !o.waits.some((w) => w.pred === craft && w.predM === Infinity) &&
        bodyConflict(o, remaining(o), stopped)
      )
        return refuse(`parksAcross:${roleOf(o)}`);
    for (const [other] of given) {
      if (other.mode !== 'ground') continue;
      if (bodyConflict(other, remaining(other), stopBody(craft, leg)))
        return refuse(`parksAcross:${roleOf(other)}`);
      const direct = (c: Craft, p: Craft) => c === craft && p === other;
      if (chainOf(craft, other, direct) && !openChain(craft, other, direct)) {
        late.releaseHeld++;
        return refuse(`chain:${roleOf(other)}`);
      }
    }
    for (const [other, waits] of given) giveWay(craft, other, waits);
    craft.mode = 'air';
    craft.air = air;
    craft.arrivalBooking = { fromS, uses: booking };
    craft.next = [
      { kind: 'taxi', leg: landing.leg, pauseS: 0 },
      { kind: 'park', stand: request.stand },
    ];
    craft.stand = request.stand;
    standBound[request.stand] = craft.id;
    craft.request = null;
    craft.admission = null;
    return true;
  }

  /** TASK-330: whether an arrival crossing the threshold at `thresholdS` keeps its spacing on
   * final from the arrivals on approach to the same runway, at the follower's approach speed. */
  function spacedOnFinal(craft: Craft, thresholdS: number) {
    for (const other of crafts) {
      if (other === craft || other.air?.kind !== 'approach' || other.runway !== craft.runway)
        continue;
      const otherS = other.arrivalBooking!.fromS + leadS(other.runway) + ARRIVAL_PAD_S;
      const [leader, follower] = otherS <= thresholdS ? [other, craft] : [craft, other];
      const nm = wakeSpacingNm[wakeOf(leader.type)]?.[wakeOf(follower.type)] ?? 0;
      const gapS = Math.max(FINAL_SPACING_M, nm * NM) / fixedWing(follower).approachSpeedMps;
      if (Math.abs(thresholdS - otherS) < gapS) return false;
    }
    return true;
  }

  /** TASK-330 Phase 1e: when an arrival ahead, committed to the same way off, has its tail past
   * `pastM` on its own leg (Infinity: not before it stops), by its exit speed profile. */
  function leaderPastS(leader: Craft, leg: Leg, pastM: number) {
    if (pastM > leg.endM - leader.lengthM / 2 || waitCap(leader, leg) < pastM) return Infinity;
    // Nor one standing (it is likely to stand on), unless already past.
    if (leader.mode === 'ground' && leader.stationM < pastM && leader.speedMps < 0.5)
      return Infinity;
    // Nor while a runway hold before that point is not granted (it may stop there for long).
    if (leg.gates.some((g) => g.holdM > -Infinity && g.holdM < pastM && !g.granted))
      return Infinity;
    const p = fixedWing(leader);
    if (leader.mode === 'ground') {
      if (leader.stationM >= pastM) return nowS;
      const profile = taxiProfile(leg.path, p, {
        startStationM: leader.stationM,
        startSpeedMps: leader.speedMps,
        stopStationM: leg.endM,
      });
      return nowS + timeTo(profile, pastM);
    }
    const air = leader.air!;
    const profile = taxiProfile(leg.path, p, {
      startStationM: leader.lengthM / 2,
      startSpeedMps: air.profile.sample(air.profile.durationS).speedMps,
      stopStationM: leg.endM,
    });
    return air.startS + air.profile.durationS + timeTo(profile, pastM);
  }

  /** TASK-330 Phase 1e step 1: at landing commitment the way off the runway is ordered. Before
   * its tail is off, an arrival ahead on the same way off must be past by the time this one
   * gets there (its exit speed profile); a ground aircraft that can still stop short gives way;
   * anything else and it goes around. Beyond that it holds on the taxiway, clear of the runway. */
  function commitLanding(craft: Craft) {
    const next = craft.next[0];
    if (next?.kind !== 'taxi') throw new Error('An arrival has no reserved exit');
    const { leg } = next;
    const safeM = safeOf(craft, leg);
    const air = craft.air!;
    const exitS = air.startS + air.profile.durationS;
    const pastM = leg.gates[0]!.vacateM + craft.lengthM + margin;
    const yielding = new Map<Craft, Wait[]>();
    const leaving = new Set<Craft>();
    // A wait set at admission whose conflict, by now, lies beyond the safe point (the other has
    // gone on) is set again where the conflict now begins.
    const ownSpans = [{ leg, fromM: 0 }];
    for (const p of new Set(
      craft.waits
        .filter(
          (w) =>
            w.leg === leg &&
            w.atM < safeM &&
            !passed(w) &&
            w.pred.mode === 'ground' &&
            w.predM < Infinity,
        )
        .map((w) => w.pred),
    )) {
      const now = conflicts(craft, ownSpans, p);
      if (!now.length || now.some((c) => c.b1 - SAMPLE_M < safeM)) continue;
      craft.waits = craft.waits.filter((w) => w.pred !== p);
      for (const c of now)
        craft.waits.push({
          leg: c.leg,
          atM: c.b1 - SAMPLE_M,
          pred: p,
          predLeg: c.otherLeg,
          predM: c.follow ? c.x1 + p.lengthM : c.x2 + SAMPLE_M,
        });
    }
    for (const w of craft.waits) {
      if (w.leg !== leg || w.atM >= safeM || passed(w)) continue;
      const p = w.pred;
      if (yielding.has(p) || leaving.has(p)) continue;
      const own =
        p.mode === 'ground'
          ? p.leg
          : p.air?.kind === 'approach' && p.air.decided && p.next[0]?.kind === 'taxi'
            ? p.next[0].leg
            : null;
      if (
        own === w.predLeg &&
        p.runway === craft.runway &&
        own.gates[0]?.holdM === -Infinity &&
        leaderPastS(p, own, Math.max(w.predM, pastM + p.lengthM / 2)) <= exitS
      ) {
        leaving.add(p);
        continue;
      }
      const waits = p.mode === 'ground' ? yieldWaits(craft, p, false) : null;
      if (!waits) {
        commitWhy = `wait:${roleOf(p)}${holdOf(p)}`;
        return false;
      }
      yielding.set(p, waits);
    }
    // Ground aircraft whose way meets this stretch and that are not ordered with it yet (their
    // conflict was beyond the horizon) are ordered now: they give way if they can still stop.
    const own = [{ leg, fromM: 0 }];
    for (const o of crafts) {
      if (o === craft || o.mode !== 'ground' || yielding.has(o) || leaving.has(o)) continue;
      if (o.waits.some((w) => w.pred === craft && !passed(w))) continue;
      const near = conflicts(craft, own, o).filter((c) => c.b1 - SAMPLE_M < safeM);
      if (!near.length) continue;
      const waits = yieldWaits(craft, o);
      if (!waits) {
        commitWhy = `late:${roleOf(o)}`;
        return false;
      }
      yielding.set(o, waits);
    }
    let cap = Infinity;
    let capBy: Craft | null = null;
    for (const w of craft.waits)
      if (
        w.leg === leg &&
        w.atM < cap &&
        !passed(w) &&
        !yielding.has(w.pred) &&
        !leaving.has(w.pred)
      ) {
        cap = w.atM;
        capBy = w.pred;
      }
    if (cap < safeM) {
      commitWhy = `cap:${capBy ? roleOf(capBy) : '?'}`;
      return false;
    }
    // Room to stop with its tail off the runway (its safe point and its nose beyond).
    const want = Math.min(leg.path.lengthM, safeM + craft.lengthM / 2, cap + craft.lengthM / 2);
    // Arrivals ahead leaving by the same way off in time: their claims there do not count.
    const exitEdge = (l: Leg) => l.pieces.find((q) => graph.edges[q.edge]!.kind !== 'runway')?.edge;
    for (const o of crafts) {
      if (o === craft || leaving.has(o) || o.runway !== craft.runway) continue;
      const own =
        o.mode === 'ground'
          ? o.leg
          : o.air?.kind === 'approach' && o.air.decided && o.next[0]?.kind === 'taxi'
            ? o.next[0].leg
            : null;
      if (!own || own.gates[0]?.holdM !== -Infinity || exitEdge(own) !== exitEdge(leg)) continue;
      if (leaderPastS(o, own, pastM + o.lengthM / 2) <= exitS) leaving.add(o);
    }
    const ignore = new Set([...yielding.keys(), ...leaving]);
    // Ground aircraft whose claims reach into that stretch give way if they can still stop.
    for (
      let tries = 0;
      tries < 4 && firstConflict(craft, leg, 0, want, ignore) < Infinity;
      tries++
    ) {
      const blockers = crafts.filter(
        (o) =>
          o !== craft &&
          !ignore.has(o) &&
          o.mode === 'ground' &&
          o.claimed.some((k) => leg.pieces.some((q) => q.edge === k.edge && q.startM <= want)),
      );
      let moved = false;
      for (const o of blockers) {
        const waits = yieldWaits(craft, o);
        if (!waits?.length) continue;
        yielding.set(o, waits);
        ignore.add(o);
        moved = true;
      }
      if (!moved) break;
    }
    if (firstConflict(craft, leg, 0, want, ignore) < Infinity) {
      const holder = crafts.find(
        (o) =>
          o !== craft &&
          !ignore.has(o) &&
          o.claimed.some((k) => leg.pieces.some((q) => q.edge === k.edge && q.startM <= want)),
      );
      commitWhy = `claim:${holder ? roleOf(holder) : '?'}`;
      return false;
    }
    if (pushBlocksStand(craft, craft.stand)) {
      commitWhy = 'push';
      return false;
    }
    for (const [other, waits] of yielding) giveWay(craft, other, waits);
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
    // A carry-in appears in place, so its parked pose must be clear now and throughout any
    // pushback already underway, including a tow that has released its origin stand.
    const pose = poseAt(leg, leg.endM);
    if (!sweepClear(craft, [bodyAt(craft, pose.position, pose.headingRad)]))
      return { ok: false, reason: 'parked position is not clear' };
    crafts.push(craft);
    park(craft, leg, stand, timeS);
    return { ok: true, id: craft.id };
  }

  function park(craft: Craft, leg: Leg, stand: number, timeS: number) {
    const towLog = craft.towing ? towOf.get(craft.id) : undefined;
    if (towLog) {
      towLog.parkS = timeS;
      towOf.delete(craft.id);
    }
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
    // TASK-339: a tow at its rest point (no stand) is in the way as one at a stand is.
    if (stand < 0 && craft.type.performance.kind !== 'fixedWing') return;
    noteParked(craft);
    // Those whose way it now stands in wait until it leaves again: moving, or ordered and not
    // started (TASK-329: they do not start while it is there).
    for (const other of crafts) {
      if (other === craft) continue;
      if (other.mode !== 'ground' && other.mode !== 'air' && !other.admission) continue;
      const own = remaining(other);
      if (!own.length) continue;
      const at = parkedConflict(other, own, craft);
      if (at && canWaitAt(other, at.leg, at.m - SAMPLE_M))
        other.waits.push({
          leg: at.leg,
          atM: at.m - SAMPLE_M,
          pred: craft,
          predLeg: leg,
          predM: Infinity,
        });
    }
  }

  function poseOnLeg(craft: Craft, leg: Leg, speedMps: number): AircraftPose {
    return poseAt(leg, craft.stationM, speedMps);
  }
  function poseAt(leg: Leg, stationM: number, speedMps = 0): AircraftPose {
    const { points, stationsM } = leg.path;
    const m = Math.max(0, Math.min(stationM, leg.path.lengthM));
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
    const log: TowLog = {
      registration: craft.registration,
      typeId: craft.type.id,
      from:
        craft.stand >= 0
          ? (graph.stands[craft.stand]!.ref ?? graph.stands[craft.stand]!.id)
          : 'rest',
      to: stand >= 0 ? (graph.stands[stand]!.ref ?? graph.stands[stand]!.id) : `node ${node}`,
      requestS: nowS,
      refusals: {},
      stillS: {},
      heldHeadS: 0,
      heldWhy: {},
      heldArrivals: [],
    };
    towLogs.push(log);
    towOf.set(craft.id, log);
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
    type Plan = { legs: Leg[]; cost: number; lineUpU: number; entryU: number; how: LineUpKind };
    let best: Plan | null = null;
    // TASK-360 rule 1: of the entries its run fits (full length or intersection), the one
    // nearest its taxi route (the route's cost without the runway arc it lines up on), counting
    // ENTRY_QUEUE_M for each other departure planned there and not lined up yet. An aircraft
    // whose route passes an intermediate entry does not taxi on to the end.
    let nearest: (Plan & { score: number }) | null = null;
    for (const option of lineUps(craft, runway, end)) {
      if (nearest && option.rank > 1) break;
      const legs = legsFromStand(
        craft,
        'taxi',
        (a) => a === option.goal,
        -1,
        (arcs) => [...arcs.slice(0, -1).map((a) => arcSegment(a)), ...option.after()],
        findRoute,
      );
      if (!legs) continue;
      const plan = { ...legs, lineUpU: option.lineUpU, entryU: option.entryU, how: option.how };
      // TASK-312: a way to the line-up that taxis along a runway holds it for minutes; a later
      // option (an intersection departure, say) that reaches the runway by taxiways is better.
      const last = legs.legs.at(-1)!;
      const alongRunway = last.pieces.some((p) => graph.edges[p.edge]!.kind === 'runway');
      if (option.rank === 1 && T360I && findRoute === route && !alongRunway) {
        if (lineUpHoldTouches(craft, last, runway.idx)) continue;
        const score =
          legs.cost -
          graph.edges[arcEdge(option.goal)]!.lengthM * 4 * oppositeFactor(craft, option.goal) +
          ENTRY_QUEUE_M * queuedAtEntry(craft, runway.idx, end, option.entryU);
        if (!nearest || score < nearest.score) nearest = { ...plan, score };
        continue;
      }
      if (!alongRunway) return plan;
      best ??= plan;
    }
    return nearest ?? best;
  }

  /** TASK-312: whether a type parked at a stand would stand in the way of one like it taxiing
   * past on a taxiway or taxilane (sampled every 4 m along each edge near it): such a stand does
   * not take that type (Zurich's H11 to H14 stand 26 to 29 m from taxiway P's centreline). A
   * larger aircraft passing one parked there waits for it (`order`). */
  function blocksTaxiway(craft: Craft, body: Body) {
    const reachM = Math.max(craft.lengthM, craft.type.spanM) + 10;
    for (const edge of graph.edges) {
      if (edge.kind === 'lead_in' || edge.kind === 'runway' || edge.maxCode < craft.code) continue;
      const box = boxOf(edge.line);
      if (
        box.minX > body.x + reachM ||
        box.maxX < body.x - reachM ||
        box.minY > body.y + reachM ||
        box.maxY < body.y - reachM
      )
        continue;
      for (let m = 0; m <= edge.lengthM; m += 4) {
        const at = pointAtDistance(edge.line, edge.cumulative, m);
        if (Math.hypot(at.x - body.x, at.y - body.y) > reachM) continue;
        const heading = headingAtDistance(edge.line, edge.cumulative, m);
        if (bodiesTouch(body, bodyAt(craft, at, heading), 0)) return true;
      }
    }
    return false;
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
      const body = bodyAt(craft, parked.position, parked.headingRad);
      if (blocksTaxiway(craft, body)) return Infinity;
      const push = outboundPlan.legs[0]!;
      standEnvelopes.set(standKey(typeId, stand), {
        parked: body,
        push: push.mode === 'pushback' ? sweep(craft, push) : [],
      });
      return landing.leg.endM + outboundPlan.legs.reduce((m, leg) => m + leg.endM, 0);
    }
    return Infinity;
  }

  /** TASK-339: whether a departure or tow not started would wait, beyond its pushback, for an
   * aircraft parked or at rest across its way with no movement planned (it would stand in the
   * way until that one leaves). A wait on its pushback keeps it at its stand anyway. */
  function refuseBehindParked(waits: Wait[], legs: Leg[]) {
    const block = waits.some(
      (w) =>
        w.predM === Infinity &&
        // TASK-358: or a helicopter coming down onto a pad there.
        (w.pred.mode === 'parked' || (w.pred.mode === 'air' && w.pred.next[0]?.kind === 'rest')) &&
        !w.pred.admission &&
        !w.pred.request &&
        !(w.leg === legs[0] && legs[0].mode === 'pushback') &&
        !passed(w),
    );
    if (block) late.startRefused++;
    return block;
  }

  /** TASK-382: whether `legs` meet the way off the runway (to its tail clear of it) of an
   * arrival ordered to land, queued or on approach. */
  function meetsWayOff(craft: Craft, legs: Leg[]) {
    const own = legs.map((leg) => ({ leg, fromM: 0 }));
    return crafts.some((o) => {
      const leg =
        o.mode === 'queued'
          ? o.admission?.landing?.leg
          : o.mode === 'air' && o.air?.kind === 'approach' && o.next[0]?.kind === 'taxi'
            ? o.next[0].leg
            : undefined;
      // One that waits for this tow (it would not appear before the tow has gone) does not
      // hold it: neither would move.
      if (!leg || o.waits.some((w) => w.pred === craft && !passed(w))) return false;
      const safeM = safeOf(o, leg);
      return conflicts(craft, own, o).some((c) => c.otherLeg === leg && c.x1 - SAMPLE_M < safeM);
    });
  }
  /** TASK-363: a queued arrival's order is dropped, and with it the waits of others on it (they
   * would hold again once it is ordered anew, after them). */
  function stepOut(craft: Craft) {
    dropAdmission(craft);
    for (const o of crafts) if (o.waits.length) o.waits = o.waits.filter((w) => w.pred !== craft);
  }
  /** TASK-363: whether a queued arrival would wait for an aircraft parked or at rest across its
   * way with no movement admitted or requested. */
  function behindParked(waits: Wait[]) {
    return waits.some(
      (w) =>
        w.predM === Infinity &&
        w.pred.mode === 'parked' &&
        !w.pred.admission &&
        !w.pred.request &&
        !passed(w),
    );
  }

  /** TASK-339: whether an aircraft moving on the ground, or TASK-340 on approach (and not ordered
   * after `craft`), is to come to rest with its body across `craft`'s legs beyond its pushback. */
  /** TASK-340: the leg at whose end an aircraft moving on the ground or on approach comes to
   * rest, or null. */
  function restLeg(other: Craft): Leg | null {
    if (other.mode === 'ground') return stopLeg(other);
    if (other.mode !== 'air' || other.air?.kind !== 'approach') return null;
    let stop: Leg | null = null;
    for (const n of other.next) {
      if (n.kind === 'taxi') stop = n.leg;
      else return n.kind === 'park' || n.kind === 'rest' ? stop : null;
    }
    return null;
  }
  function restingAcross(craft: Craft, legs: Leg[]) {
    const found = restersAcross(craft, legs, true);
    if (found.length) late.startHeld++;
    return found.length > 0;
  }
  /** Those aircraft (`first`: the first only). */
  function restersAcross(craft: Craft, legs: Leg[], first = false) {
    const found: Craft[] = [];
    const spans = legs.flatMap((leg, i) =>
      i === 0 && leg.mode === 'pushback' ? [] : [{ leg, fromM: 0 }],
    );
    for (const other of crafts) {
      if (other === craft) continue;
      const stop = restLeg(other);
      if (!stop || other.waits.some((w) => w.pred === craft && !passed(w))) continue;
      if (bodyConflict(craft, spans, stopBody(other, stop))) {
        found.push(other);
        if (first) break;
      }
    }
    return found;
  }

  /** Orders a parked aircraft's departure or tow at its request, and starts it once nothing
   * ordered before it is still to pass where it pushes or first moves. */
  function tryStart(craft: Craft, timeS: number) {
    craft.pushbackReadySinceS ??= timeS;
    if (timeS - craft.pushbackReadySinceS < pushbackPreparationS[craft.type.class]) return;
    if (timeS - craft.retryS < RETRY_S) return;
    craft.retryS = timeS;
    chargeStart(craft, timeS);
    const towing = craft.request?.kind === 'tow';
    const why = startOnce(craft, timeS);
    if (why) refuseStart(craft, craft.request?.kind === 'tow' ? `tow ${why}` : why, timeS);
    else if (towing && towOf.get(craft.id)) towOf.get(craft.id)!.startS = timeS;
  }
  /** TASK-344: what the first unpassed wait matching `test` waits for (a refusal's detail). */
  function blockerKind(craft: Craft, test: (w: Wait) => boolean) {
    const w = craft.waits.find((v) => test(v) && !passed(v));
    if (!w) return 'none';
    const p = w.pred;
    const what = p.mode === 'parked' ? (p.request?.kind ?? 'idle') : p.mode;
    return `${what}${w.predM === Infinity ? ':body' : ''}`;
  }
  /** One start try: null once started, else the reason it was refused (TASK-344). */
  function startOnce(craft: Craft, timeS: number): string | null {
    if (craft.request!.kind === 'departure' && runways.restricted) {
      retargetDeparture(craft);
      if (!runways.departures.has(endKey(craft.runway, craft.end))) return 'runwayClosed';
    }
    const request = craft.request!;
    if (!craft.admission) {
      let planned: ReturnType<typeof plan>;
      // TASK-339: those that wait for it to leave from where they stand in its way: its route
      // keeps off them where it can (they cannot give way to it).
      avoiding = crafts.filter(
        (o) =>
          o.mode === 'ground' &&
          o.speedMps === 0 &&
          o.waits.some((w) => w.pred === craft && w.predM === Infinity && !passed(w)),
      );
      if (avoiding.length) late.avoidPlans++;
      try {
        planned = plan();
      } finally {
        avoiding = [];
        avoidHits.clear();
      }
      if (!planned) return 'noPlan';
      const { legs } = planned;
      for (const leg of legs.slice(0, -1)) addGates(craft, leg, -1);
      craft.rank = ++admitted;
      const stop = planned.next[0]!.kind === 'takeoff' ? null : legs.at(-1)!;
      const decided = order(
        craft,
        legs.map((leg) => ({ leg, fromM: 0 })),
        stop,
      );
      if (!decided) return 'order';
      // TASK-339: not while its way passes an aircraft parked or at rest across it with no
      // movement planned; it plans again on a later try.
      if (refuseBehindParked(decided.mine, legs)) return 'behindParked';
      // TASK-382 (`T382S`): a tow does not start while its way meets the way off of an arrival
      // ordered to land (Doc 4444 7.6 and 7.10: landing traffic has the way off; Doc 9476 SMGCS:
      // towing is started when its route is clear); it plans again on a later try.
      if (T382S && request.kind === 'tow' && meetsWayOff(craft, legs)) return 'wayOff';
      commitOrder(craft, decided);
      craft.admission = { legs, next: planned.next };
    }
    function plan(): { legs: Leg[]; next: Next[]; lineUpU?: number } | null {
      let planned: { legs: Leg[]; next: Next[]; lineUpU?: number } | null = null;
      if (request.kind === 'departure') {
        const runway = graph.runways[craft.runway]!;
        const departure = departurePlan(craft, runway, request.end);
        if (departure) {
          addGates(craft, departure.legs.at(-1)!, runway.idx);
          planned = {
            legs: departure.legs,
            next: [
              {
                kind: 'takeoff',
                end: request.end,
                lineUpU: departure.lineUpU,
                pauseS: LINEUP_S,
                entryU: departure.entryU,
                how: departure.how,
              },
            ],
          };
        }
      } else if (request.kind === 'tow') {
        const legs = towLegs(craft, request.stand, request.node);
        if (legs) {
          addGates(craft, legs.legs.at(-1)!, -1);
          planned = {
            legs: legs.legs,
            next: [request.stand >= 0 ? { kind: 'park', stand: request.stand } : { kind: 'rest' }],
          };
        }
      }
      return planned;
    }
    const { legs } = craft.admission;
    // TASK-339: nor once ordered, when an aircraft has since parked or come to rest across its
    // way: its movement is dropped and planned again on a later try.
    if (refuseBehindParked(craft.waits, legs)) {
      dropAdmission(craft);
      return 'behindParkedDropped';
    }
    // Nor while one still moving is to come to rest across its way: it waits at its stand.
    if (restingAcross(craft, legs)) return 'restingAcross';
    const first = legs[0]!;
    const half = craft.lengthM / 2;
    const pass = passing(craft);
    const queued = new Set(
      craft.waits.flatMap((w) => (w.pred.mode === 'queued' && !passed(w) ? [w.pred] : [])),
    );
    for (const arrival of queued) if (beyondHorizon(craft, legs, arrival)) pass.add(arrival);
    if (
      first.mode === 'pushback'
        ? waitCap(craft, first, pass) < Infinity
        : waitCap(craft, first, pass) <= half + 1
    )
      return `firstLegWait:${blockerKind(craft, (w) => w.leg === first && !pass.has(w.pred))}`;
    if (waitsForUnstarted(craft, pass))
      return `unstarted:${blockerKind(craft, (w) => unstarted(w.pred) && !pass.has(w.pred))}`;
    // TASK-330 (5): a tow keeps its stand while an arrival on final, or the next to appear, would
    // meet its way before that arrival's tail is off the runway.
    if (request.kind === 'tow' && towWaitsForArrival(craft, legs)) return 'towArrival';
    // The first leg must be claimable from where the aircraft stands.
    if (firstConflict(craft, first, half, half + craft.lengthM / 2 + margin) < Infinity)
      return 'firstConflict';
    const push = first.mode === 'pushback' ? sweep(craft, first) : undefined;
    if (push && !sweepClear(craft, push)) return 'sweep';
    const given = yieldsTo(craft, pass);
    if (!given) return 'yield';
    craft.pushSweep = push;
    for (const [other, waits] of given) giveWay(craft, other, waits);
    for (const leg of legs) lock(craft, leg, 0, leg.pieces.length);
    if (craft.stand >= 0) standOccupant[craft.stand] = -1;
    if (request.kind === 'tow') craft.stand = request.stand;
    craft.request = null;
    craft.pushbackReadySinceS = undefined;
    // A departure's tug disconnects and its engines start after the push; a tow's stays on.
    const pauseS = first.mode === 'pushback' && request.kind === 'departure' ? TUG_S : 0;
    craft.towing = request.kind === 'tow';
    craft.next = [
      ...legs.slice(1).map((leg): Next => ({ kind: 'taxi', leg, pauseS })),
      ...craft.admission.next,
    ];
    craft.admission = null;
    setLeg(craft, first, timeS);
    if (request.kind === 'departure') events.push({ timeS, id: craft.id, kind: 'off-block' });
    return null;
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
      const profile = helicopterLandingProfile(path, p);
      // TASK-358: the hover point, where its height comes down to HELI_CLEAR_M.
      let [lo, hi] = [0, profile.durationS];
      while (hi - lo > 0.05) {
        const mid = (lo + hi) / 2;
        if (profile.sample(mid).heightM > HELI_CLEAR_M) lo = mid;
        else hi = mid;
      }
      craft.air = {
        kind: 'helicopter',
        profile,
        path,
        startS: timeS,
        crossings: [],
        runway: -1,
        thresholdM: 0,
        touchdownM: 0,
        clearM: 0,
        decided: false,
        touched: true,
        holdS: lo,
      };
      craft.mode = 'air';
      craft.helipad = request.helipad;
      helipadOccupant[request.helipad] = craft.id;
      craft.request = null;
      craft.next = [{ kind: 'rest' }];
      return;
    }
    if (craft.mode !== 'parked' || !request) return;
    // TASK-358: not while its way off the pad is not clear of aircraft on the ground.
    if (timeS - craft.retryS < RETRY_S) return;
    if (!heliClear(craft)) {
      craft.retryS = timeS;
      return;
    }
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
      craft.seqRank = undefined;
      dropAdmission(craft);
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
      dropAdmission(craft);
      return;
    }
  }

  function atDepartureHold(craft: Craft) {
    const gate = craft.leg!.gates.find((g) => !g.granted);
    return (
      gate?.vacateM === Infinity && craft.speedMps === 0 && craft.stationM >= gate.holdM - 0.01
    );
  }

  /** Whether a departure is bound for a closed end and can taxi elsewhere. */
  function needsReroute(craft: Craft) {
    if (craft.mode !== 'ground') return false;
    const takeoff = craft.next.find((n) => n.kind === 'takeoff');
    return (
      !!takeoff &&
      !runways.departures.has(endKey(craft.runway, takeoff.end)) &&
      (runways.departures.size > 0 || atDepartureHold(craft))
    );
  }

  /** Re-routes a taxiing departure to a departure end of the target configuration: its taxi leg
   * is kept up to a node it can still turn at and continues from there to the new line-up. A
   * departure holding a runway grant (crossing or lining up) keeps its route until it is clear;
   * one whose new route cannot be ordered yet tries again on the next step. */
  /** TASK-339: re-routing around an aircraft parked in the way, only turns short of this
   * station of the leg. */
  let blockedBefore = Infinity;
  function reroute(craft: Craft, avoid?: Craft) {
    const takeoff = craft.next.findIndex((n) => n.kind === 'takeoff');
    if (takeoff < 0) return false;
    const leg = craft.leg!;
    if (leg.gates.some((g) => g.granted && !g.released)) return false;
    const current = takeoff === 0;
    const held = current && atDepartureHold(craft);
    const before = craft.next[takeoff - 1];
    if (!current && before?.kind !== 'taxi') return false;
    const target = current || before?.kind !== 'taxi' ? leg : before.leg;
    const p = fixedWing(craft);
    const s = current ? craft.stationM : -Infinity;
    const brake = current ? craft.speedMps ** 2 / (2 * p.brakingDecelerationMps2) : 0;
    // While moving, keep the original braking and turning clearance. At a hold, let the
    // replacement path show whether a turn can begin from the aircraft's stopped pose.
    const cuts: number[] = [];
    for (const [k, piece] of target.pieces.entries()) {
      const clearance = held ? 0 : Math.max(brake + 20, 0.5 * (piece.endM - piece.startM));
      if (piece.endNode < 0 || piece.endM - clearance < s) continue;
      // TASK-339: only turns short of the aircraft parked in the way.
      if (avoid && piece.endM > blockedBefore) break;
      cuts.push(k);
      if (!held && !avoid) break;
    }
    const heldPose = held ? poseAt(target, s) : undefined;
    const heldGate = held ? leg.gates.find((gate) => !gate.granted) : undefined;
    if (runways.departures.size || avoid)
      for (const k of cuts) if (rerouteFrom(k, false)) return true;
    if (held && !avoid) for (const k of cuts) if (rerouteFrom(k, true)) return true;
    return false;

    function rerouteFrom(k: number, returning: boolean) {
      const last = target.pieces[k]!;
      const kept = target.pieces
        .slice(0, k + 1)
        .map((piece) =>
          arcSegment(arcOf(piece.edge, piece.toE >= piece.fromE), piece.fromE, piece.toE),
        );
      const query = {
        code: craft.code,
        turnRadiusM: p.minTurnRadiusM,
        from: { arc: arcOf(last.edge, last.toE >= last.fromE) },
        stand: -1,
        factor: (arc: number) => oppositeFactor(craft, arc),
      };
      function replaceTaxi(next: Leg, runway: number) {
        if (heldPose) {
          const { position, headingRad } = poseAt(next, s);
          if (
            Math.hypot(position.x - heldPose.position.x, position.y - heldPose.position.y) > 0.01 ||
            deflection(headingRad, heldPose.headingRad) > 0.01
          )
            return false;
        }
        addGates(craft, next, runway);
        // Runway gates already passed stay passed; one it would have to stop at behind it fails.
        const half = craft.lengthM / 2;
        for (const gate of next.gates)
          if (gate.vacateM < s - half) gate.granted = gate.released = true;
        if (
          heldGate &&
          !next.runwayRanges.some(([entry, exit]) => entry < s + half && exit > s - half)
        ) {
          // Rounding the new turn can move the same hold's station slightly. Keep the
          // established stop and still require a grant before entering the runway.
          const same = next.gates.find(
            (gate) =>
              !gate.granted &&
              gate.uses[0]?.resource === heldGate.uses[0]?.resource &&
              gate.hold === heldGate.hold &&
              Math.abs(gate.holdNodeM - heldGate.holdNodeM) < p.minTurnRadiusM,
          );
          if (same) same.holdM = Math.max(s, same.holdM);
        }
        if (next.gates.some((g) => !g.granted && g.holdM < s - 0.01)) return false;
        const remainingTaxi = [{ leg: next, fromM: current ? s - 1 : 0 }];
        // A parked aircraft's planned pushback can remain pending through a closure.
        // Its current body still occupies the stand even when order() sees its future route.
        if (
          held &&
          crafts.some(
            (other) =>
              other !== craft &&
              other.mode === 'parked' &&
              other.admission &&
              other.stand >= 0 &&
              parkedConflict(craft, remainingTaxi, other),
          )
        )
          return false;
        // A departure at its hold must stay ahead of aircraft already following it there.
        // Other re-routes are ordered as newcomers.
        const rank = craft.rank;
        if (!held) craft.rank = admitted + 1;
        replacing = { next, target };
        const decided = order(craft, remainingTaxi);
        replacing = null;
        if (!decided) {
          craft.rank = rank;
          return false;
        }
        if (!held) admitted++;
        craft.waits = craft.waits.filter((w) => w.leg !== target);
        commitOrder(craft, decided);
        for (const piece of target.pieces.slice(k + 1))
          if (piece.locked) unlock(craft, piece.edge, piece.toE >= piece.fromE ? 1 : -1);
        for (let i = 0; i <= k; i++) next.pieces[i]!.locked = target.pieces[i]!.locked;
        lock(craft, next, k + 1, next.pieces.length);
        sweepCache.delete(target);
        if (current) {
          craft.leg = next;
          craft.plan = null;
          craft.claimHi = Math.max(Math.min(craft.claimHi, last.endM), s + half);
          craft.runwayWait = undefined;
          publish(craft);
        } else
          craft.next[takeoff - 1] = {
            kind: 'taxi',
            pauseS: before?.kind === 'taxi' ? before.pauseS : 0,
            leg: next,
          };
        return true;
      }

      if (!returning) {
        const takeoffNext = craft.next[takeoff] as Extract<Next, { kind: 'takeoff' }>;
        const keys = avoid ? [endKey(craft.runway, takeoffNext.end)] : [...runways.departures];
        for (const key of keys) {
          const runway = graph.runways[key >> 1]!;
          if (runway.maxCode < craft.code) continue;
          for (const option of lineUps(craft, runway, key & 1)) {
            const route = routeAirside(graph, {
              ...query,
              goal: (a) => a === option.goal,
            });
            if (!route) continue;
            const next = buildLeg(craft, 'taxi', [
              ...kept,
              ...route.arcs.slice(0, -1).map((a) => arcSegment(a)),
              ...option.after(),
            ]);
            if (avoid && parkedConflict(craft, [{ leg: next, fromM: current ? s : 0 }], avoid))
              continue;
            if (!replaceTaxi(next, runway.idx)) continue;
            craft.next[takeoff] = {
              kind: 'takeoff',
              end: key & 1,
              lineUpU: option.lineUpU,
              pauseS: LINEUP_S,
              entryU: option.entryU,
              how: option.how,
            };
            craft.runway = runway.idx;
            craft.end = key & 1;
            return true;
          }
        }
        return false;
      }
      // At a closed hold with no departure route, taxi back to the original stand if possible.
      const stands = [
        ...(craft.stand >= 0 ? [craft.stand] : []),
        ...graph.stands.map(({ idx }) => idx).filter((i) => i !== craft.stand),
      ];
      for (const stand of stands) {
        if (standCheck(craft, stand)) continue;
        const route = routeAirside(graph, { ...query, goal: standGoal(stand), stand });
        if (!route) continue;
        const next = buildLeg(craft, 'taxi', [
          ...kept,
          ...route.arcs.map((arc) => arcSegment(arc)),
        ]);
        if (
          blocksTaxiway(
            craft,
            bodyAt(craft, poseAt(next, next.endM).position, graph.stands[stand]!.heading),
          )
        )
          continue;
        if (!replaceTaxi(next, -1)) continue;
        standBound[stand] = craft.id;
        craft.next[takeoff] = { kind: 'return', stand };
        return true;
      }
      return false;
    }
  }

  /** TASK-339: a taxiing departure ordered to wait for an aircraft parked or at rest across its way
   * with no movement planned re-routes around it while a turn short of it is still ahead. */
  function rerouteParked() {
    for (const craft of crafts) {
      if (craft.mode !== 'ground') continue;
      const takeoff = craft.next.findIndex((n) => n.kind === 'takeoff');
      if (takeoff < 0) continue;
      const before = craft.next[takeoff - 1];
      const target = takeoff === 0 ? craft.leg! : before?.kind === 'taxi' ? before.leg : null;
      if (!target) continue;
      const w = craft.waits.find(
        (w) =>
          w.predM === Infinity &&
          w.leg === target &&
          w.pred.mode === 'parked' &&
          !w.pred.admission &&
          !w.pred.request &&
          !passed(w),
      );
      if (!w || (target === craft.leg && w.atM - craft.stationM < 20)) continue;
      late.blockedTries++;
      blockedBefore = w.atM;
      if (reroute(craft, w.pred)) late.blockedReroutes++;
      blockedBefore = Infinity;
    }
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
      if (!needsReroute(craft) || nowS - craft.retryS < RETRY_S) continue;
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
    let elapsed = timeS - air.startS;
    // TASK-358: a helicopter coming down to a pad hovers at its hover point until its way down
    // is clear of aircraft on the ground.
    let hovering = false;
    if (air.holdS !== undefined && !air.decided && elapsed >= air.holdS) {
      if (timeS - craft.retryS >= RETRY_S) {
        air.decided = heliClear(craft);
        if (!air.decided) craft.retryS = timeS;
      }
      if (!air.decided) {
        air.startS = timeS - air.holdS;
        elapsed = air.holdS;
        hovering = true;
      }
    }
    const sampled = air.profile.sample(elapsed);
    const pose = hovering ? { ...sampled, speedMps: 0 } : sampled;
    craft.pose = pose;
    craft.stationM = pose.stationM;
    craft.speedMps = pose.speedMps;
    releaseRunways(craft, pose.stationM);
    if (air.kind === 'approach') {
      const thresholdS = air.startS + air.thresholdM / fixedWing(craft).approachSpeedMps;
      if (!air.decided && timeS >= thresholdS - DECISION_S) {
        air.decided = true;
        const booking = craft.arrivalBooking!;
        const foreign = ({ resource }: BookedUse) =>
          runwayOccupant[resource] !== -1 && runwayOccupant[resource] !== craft.id;
        const held = booking.uses.some(foreign);
        // TASK-330 landing booking: an occupant predicted off the runway before the threshold
        // does not force a go-around; the claim waits until it is off.
        const clearsInTime =
          independent(craft.runway) &&
          booking.uses.every(
            (use) => !foreign(use) || runwayClearS[use.resource]! <= thresholdS - CLEAR_BEFORE_S,
          );
        if (held && T360M && multiOn(craft.runway)) departureCounts.landingsHeldByMulti++;
        commitWhy = '';
        if ((held && !clearsInTime) || !commitLanding(craft)) {
          const by = booking.uses.find(foreign);
          const why =
            held && !clearsInTime
              ? `runwayHeld:${by ? roleOf(crafts[runwayOccupant[by.resource]! - 1]!) : '?'}`
              : `commit:${commitWhy}`;
          arrivalWhy.goAround[why] = (arrivalWhy.goAround[why] ?? 0) + 1;
          return goAround(craft, timeS);
        }
        if (held) air.claimPending = true;
        else claimRunways(craft, booking.uses);
      } else if (air.claimPending) {
        const booking = craft.arrivalBooking!;
        const held = booking.uses.some(
          ({ resource }) =>
            runwayOccupant[resource] !== -1 && runwayOccupant[resource] !== craft.id,
        );
        if (!held) {
          air.claimPending = false;
          claimRunways(craft, booking.uses);
        } else if (timeS >= thresholdS - CLEAR_BEFORE_S) {
          const by = booking.uses.find(
            ({ resource }) =>
              runwayOccupant[resource] !== -1 && runwayOccupant[resource] !== craft.id,
          );
          const why = `lateClear:${by ? roleOf(crafts[runwayOccupant[by.resource]! - 1]!) : '?'}`;
          arrivalWhy.goAround[why] = (arrivalWhy.goAround[why] ?? 0) + 1;
          return goAround(craft, timeS);
        }
      }
      if (!air.touched && pose.stationM >= air.touchdownM) {
        air.touched = true;
        events.push({ timeS, id: craft.id, kind: 'landed' });
        counts.landed++;
      }
    }
    if (elapsed < air.profile.durationS) return;
    // The air leg is over.
    if (air.kind === 'approach') {
      const next = craft.next.shift();
      if (next?.kind !== 'taxi') throw new Error('An arrival ends its roll-out without a taxi leg');
      craft.air = null;
      craft.arrivalBooking = null;
      for (const use of craft.runwayClaims) use.clearM -= air.path.lengthM - next.leg.startM;
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
      craft.seqRank = undefined;
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
    const arrival = craft.air!;
    const initialAttitude = arrival.profile.attitudeAt!(timeS - arrival.startS, pose);
    // A go-around climbs straight ahead at approach speed and the type's climb gradient.
    const profile: AircraftMotionProfile = {
      durationS: path.lengthM / p.approachSpeedMps,
      attitudeAt: (elapsedS, pose) => ({
        ...goAroundAttitude(elapsedS, initialAttitude, p.climbGradient),
        heightM: pose.heightM,
      }),
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
    craft.waits = [];
    craft.arrivalBooking = null;
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
    const s = craft.stationM;
    const v = craft.speedMps;
    const brake = (v * v) / (2 * p.brakingDecelerationMps2);
    // Its order: short of the first conflict an aircraft before it has still to pass, and short
    // of the end where the next leg starts at one.
    if (craft.waits.length) craft.waits = craft.waits.filter((w) => !passed(w));
    let cap = waitCap(craft, leg);
    // The next leg starts where this one ends, its stations before its start lying on this one.
    const following = craft.next[0];
    if (following?.kind === 'taxi') {
      const behind = waitCap(craft, following.leg) - following.leg.startM;
      if (behind <= 1) cap = Math.min(cap, leg.endM + Math.min(0, behind) - 0.5);
    }
    const capHi = Math.min(leg.path.lengthM, cap + half);
    // Standing at a hold, an aircraft keeps its body and 10 m ahead only: its margin would close
    // a junction that another aircraft's path crosses.
    const held = leg.gates.find((g) => !g.granted)?.holdM ?? Infinity;
    if (v === 0 && held <= s + 0.01) craft.claimHi = Math.min(craft.claimHi, s + half + 10);
    // Extend claims ahead before they bind.
    else if (craft.claimHi < s + half + brake + margin + 20 && craft.claimHi < capHi) {
      const target = Math.min(capHi, s + half + brake + margin + 80);
      const conflict = firstConflict(craft, leg, craft.claimHi, target);
      craft.claimHi = Math.max(craft.claimHi, Math.min(target, conflict));
    }
    craft.claimLo = Math.max(craft.claimLo, s - half - margin);
    publish(craft);
    // Runway gates: ask when near the hold with the way to it claimed (first in line there), and
    // nothing ordered before it still to pass before it is off the runway again.
    for (const gate of leg.gates) {
      if (gate.granted) continue;
      if (s + brake + 35 < gate.holdM || craft.claimHi < Math.min(gate.holdM, s) + half - 0.5)
        break;
      if (cap < Infinity && cap <= gate.vacateM + half + 5) break;
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
      const booking =
        gate.vacateM === Infinity && next?.kind === 'takeoff'
          ? departureBooking(craft, leg, gate, next, timeS)
          : gate.uses.map((use) => ({
              ...use,
              clearS: timeS + (use.clearM - s) / (p.taxiStraightMps * 0.6) + RUNWAY_BUFFER_S,
            }));
      const range = leg.runwayRanges.find(([from]) => from >= gate.holdM);
      const crossingAt =
        gate.vacateM < Infinity && range
          ? {
              at: poseAt(leg, (range[0] + range[1]) / 2).position,
              halfM: craft.type.spanM / 2,
            }
          : undefined;
      // TASK-330 departure flow: a departure lines up behind one that has started its roll.
      const lineUp =
        independent(craft.runway) && gate.vacateM === Infinity && next?.kind === 'takeoff'
          ? { ...next, halfM: craft.lengthM / 2 }
          : undefined;
      if (!bookingFits(booking, timeS, RUNWAY_BUFFER_S, craft.id, crossingAt, lineUp)) {
        const sinceS = craft.runwayWait?.gate === gate ? craft.runwayWait.sinceS : timeS;
        craft.runwayWait = { gate, sinceS, checkedAtS: timeS, uses: booking };
      } else {
        craft.runwayWait = undefined;
        gate.granted = true;
        craft.claimHi = Math.max(through, craft.claimHi);
        publish(craft);
        claimRunways(craft, booking);
        if (gate.vacateM === Infinity && next?.kind === 'takeoff') {
          craft.departRollS = bookedRoll.rollS;
          craft.departClearS = bookedRoll.clearS;
          if (lineUp && sharedBy === 'multi') {
            departureCounts.multiLineUps++;
            craft.multiFront = crafts.find(
              (o) => o.id !== craft.id && o.runway === craft.runway && linedUpAhead(o, lineUp),
            )?.id;
          } else if (lineUp && sharedBy === 'roll') departureCounts.lineUpsAheadOfRoll++;
        }
      }
      break;
    }
    let stop = leg.endM;
    const gate = leg.gates.find((g) => !g.granted);
    if (gate) stop = Math.min(stop, gate.holdM);
    // Claims end at the leg's end, where the next leg takes over, or at its order's stop.
    if (craft.claimHi < capHi - 1e-6) stop = Math.min(stop, craft.claimHi - margin - half);
    stop = Math.max(Math.min(stop, cap - WAIT_SHORT_M), s);
    // A stop moved back by a new order is still within braking reach (canWaitAt), and so is a
    // stop on a re-routed leg, whose plan the re-route dropped while moving (TASK-320: Zurich
    // after the 21:00 concept switch).
    if (craft.plan ? stop < craft.planStop - 0.01 : v > 0 && stop < s + brake) {
      stop = Math.max(stop, Math.min(leg.endM, s + brake + 0.05));
      craft.plan = null;
    }
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
    releaseRunways(craft, pose.stationM);
    for (const g of leg.gates) if (g.granted && !g.released && tail >= g.vacateM) g.released = true;
    if (craft.stationM >= leg.endM - 1e-6 && craft.speedMps === 0) finishLeg(craft, timeS);
  }

  /** TASK-360: the take-off roll and runway clear time of the last departure booking. */
  let bookedRoll = { rollS: 0, clearS: 0 };
  function departureBooking(
    craft: Craft,
    leg: Leg,
    gate: Gate,
    next: Extract<Next, { kind: 'takeoff' }>,
    timeS: number,
  ) {
    const p = fixedWing(craft);
    const taxiS = (stationM: number) => (stationM - craft.stationM) / (0.5 * p.taxiTurnMps) + 10;
    const air = takeoffAir(craft, next.end, next.lineUpU, 0);
    const uses = gate.uses.map((use) => ({
      ...use,
      clearM: use.clearM === Infinity ? leg.endM + air.clearM : use.clearM,
    }));
    addAirUses(uses, air, leg.endM, craft.lengthM / 2);
    const readyS = timeS + taxiS(leg.endM) + next.pauseS;
    let rollS = readyS;
    if ((T360R || T360M) && independent(craft.runway)) {
      // TASK-360: lined up behind a departure (rolling or lined up ahead), it rolls once that one
      // is off the runway and the gap behind its roll has run; so too after the last take-off
      // (`takeoffHeld`, on a runway that crosses no other).
      const last = lastTakeoff[craft.runway];
      if (last && last.craft !== craft)
        rollS = Math.max(
          rollS,
          last.startS + departureGapS(last.craft, last.clearM, craft, air.clearM),
        );
      const runway = graph.runways[craft.runway]!;
      for (const o of crafts) {
        if (o === craft || o.runway !== craft.runway || !o.runwayClaims.length) continue;
        const ahead =
          o.mode === 'air' && o.air?.kind === 'takeoff'
            ? o.air.clearM
            : lineUpOf(o)?.end === next.end && lineUpOf(o)!.lineUpU > next.lineUpU
              ? runway.lengthM - lineUpOf(o)!.lineUpU
              : -1;
        if (ahead < 0 || o.departRollS === undefined) continue;
        rollS = Math.max(
          rollS,
          o.departClearS ?? timeS,
          o.departRollS + departureGapS(o, ahead, craft, air.clearM),
        );
      }
    }
    bookedRoll = { rollS, clearS: rollS + timeTo(air.profile, air.clearM) };
    const extraS = rollS - readyS;
    return uses.map((use) => ({
      ...use,
      clearS:
        timeS +
        (use.clearM <= leg.endM
          ? taxiS(use.clearM)
          : taxiS(leg.endM) + next.pauseS + extraS + timeTo(air.profile, use.clearM - leg.endM)) +
        5,
    }));
  }

  function finishLeg(craft: Craft, timeS: number) {
    const leg = craft.leg!;
    if (leg.mode === 'pushback') craft.pushSweep = undefined;
    const next = craft.next.shift();
    if (!next) throw new Error(`Aircraft ${craft.registration} finished a leg with nothing next`);
    if (next.kind === 'return') {
      park(craft, leg, next.stand, timeS);
      craft.runway = craft.end = -1;
      events.push({ timeS, id: craft.id, kind: 'returned', stand: next.stand });
    } else if (next.kind === 'park') {
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
      for (const use of craft.runwayClaims) use.clearM -= leg.endM;
      craft.claimed = [];
      craft.claimedNodes = [];
      craft.pauseUntilS = timeS + next.pauseS;
      craft.next = [];
      craft.mode = 'waiting';
      craft.air = takeoffAir(craft, next.end, next.lineUpU, timeS + next.pauseS);
      craft.departHow = next.how;
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
    const dtS = timeS - lastStepS;
    lastStepS = timeS;
    nowS = timeS;
    // Queued arrivals appear in request order when their runway window is free; one that cannot
    // be ordered yet keeps those behind it to the same runway end waiting this step.
    const unordered = new Set<number>();
    const heads = new Set<number>();
    const headOf = new Map<number, number>();
    for (const id of queue) {
      const q = crafts[id - 1]!;
      if (q.request?.kind !== 'arrival') continue;
      const key = endKey(q.runway, q.request.end);
      if (!headOf.has(key)) headOf.set(key, id);
    }
    for (let i = 0; i < queue.length; i++) {
      const craft = crafts[queue[i]! - 1]!;
      const request = craft.request;
      if (request?.kind === 'arrival' && timeS - craft.retryS >= RETRY_S) {
        const key = endKey(craft.runway, request.end);
        if (unordered.has(key)) continue;
        craft.retryS = timeS;
        releaseWhy = '';
        const tried = trySpawnArrival(craft, request, timeS);
        if (tried === 'unordered') unordered.add(key);
        craft.releaseWhy = tried === 'unordered' ? 'unordered' : releaseWhy;
        if (tried !== true && releaseWhy === 'behindParked') {
          const s = graph.stands[request.stand]!;
          const at = `${endName(key)} ${s.ref ?? s.id}`;
          arrivalWhy.steppedOut[at] = (arrivalWhy.steppedOut[at] ?? 0) + RETRY_S;
        }
        // TASK-352: the head of its end's queue, held: RETRY_S to the cause.
        if (tried !== true && !heads.has(key) && headOf.get(key) === craft.id) {
          const why = `${endName(key)} ${tried === 'unordered' ? 'unordered' : releaseWhy || '?'}`;
          const towBy =
            roleSeen?.towing && releaseWhy.includes('tow') ? towOf.get(roleSeen.id) : undefined;
          if (towBy) {
            towBy.heldHeadS += RETRY_S;
            towBy.heldWhy[releaseWhy] = (towBy.heldWhy[releaseWhy] ?? 0) + RETRY_S;
            if (!towBy.heldArrivals.includes(craft.registration))
              towBy.heldArrivals.push(craft.registration);
          }
          arrivalWhy.release[why] = (arrivalWhy.release[why] ?? 0) + RETRY_S;
          if (T360M && releaseWhy.startsWith('booking') && multiOn(craft.runway))
            departureCounts.arrivalHeldByMultiS += RETRY_S;
        }
        heads.add(key);
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
        if (
          timeS >= craft.pauseUntilS &&
          !(independent(craft.runway) && takeoffHeld(craft, timeS))
        ) {
          lastTakeoff[craft.runway] = { craft, startS: timeS, clearM: craft.air!.clearM };
          craft.departRollS = timeS;
          craft.departClearS = timeS + timeTo(craft.air!.profile, craft.air!.clearM);
          craft.multiFront = undefined;
          const how = craft.departHow ?? 'full';
          const byType = (departureCounts.takeoffsByType[craft.type.id] ??= {
            full: 0,
            intersection: 0,
            backtrack: 0,
          });
          byType[how]++;
          craft.mode = 'air';
          craft.air!.startS = timeS;
          stepAir(craft, timeS);
        }
      } else if (craft.mode === 'air') stepAir(craft, timeS);
      if (craft.mode === 'ground') stepGround(craft, timeS);
    }
    // TASK-382: a tow standing still on the ground: by what it waits for and the edge it is on.
    for (const craft of crafts) {
      if (craft.mode !== 'ground' || !craft.towing || craft.speedMps > 0) continue;
      const log = towOf.get(craft.id);
      if (!log) continue;
      const w = craft.waits.find((v) => !passed(v));
      const piece =
        craft.leg!.pieces.find((p) => p.endM >= craft.stationM) ?? craft.leg!.pieces.at(-1)!;
      const e = graph.edges[piece.edge]!;
      const key = `${w ? `${roleOf(w.pred)} ${w.pred.registration}` : craft.runwayWait ? 'runway' : 'none'} @ ${e.id} ${e.kind}${e.ref ? ` ${e.ref}` : ''}`;
      log.stillS[key] = (log.stillS[key] ?? 0) + dtS;
    }
    // TASK-339: time spent standing in a wait on an aircraft parked or at rest with no movement
    // admitted.
    for (const craft of crafts)
      if (
        craft.mode === 'ground' &&
        craft.speedMps === 0 &&
        craft.waits.some(
          (w) =>
            w.predM === Infinity &&
            w.leg === craft.leg &&
            w.pred.mode === 'parked' &&
            !w.pred.admission &&
            craft.stationM >= w.atM - 1 &&
            !passed(w),
        )
      ) {
        parkedBlockS += dtS;
      }
    if (timeS - ringS >= RETRY_S) {
      ringS = timeS;
      extendOrder();
      rerouteParked();
      breakRings();
    }
    settleRunways();
    updateCrossings();
  }

  function stateOf(craft: Craft): AircraftState {
    if (craft.mode === 'parked')
      return craft.pushbackReadySinceS === undefined ? 'parked' : 'ready-for-pushback';
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
      const gearDown = !airborne || pose.heightM < (climbing ? GEAR_CLIMB_M : GEAR_APPROACH_M);
      let visual: AircraftVisualPose = {
        ...pose.position,
        heightM: pose.heightM,
        heading: pose.headingRad,
        pitch: 0,
        roll: 0,
        steering: 0,
        gear: Number(gearDown),
      };
      if (craft.mode === 'air') {
        const { path, profile, startS } = craft.air!;
        const bank = airborneAttitude(path, pose.stationM, pose.speedMps, pose.heightM);
        visual = { ...visual, ...bank, ...profile.attitudeAt?.(nowS - startS, pose) };
      } else if (craft.leg && craft.type.performance.kind === 'fixedWing') {
        const { path, mode, pushStand, endM, startM } = craft.leg;
        const next = craft.next[0];
        // The drawn pose settles into the pose the aircraft parks in (or pushes back from).
        const stopM =
          pushStand !== undefined
            ? startM
            : craft.mode === 'parked' || next?.kind === 'park'
              ? Math.max(0, endM)
              : -1;
        const stop = stopM >= 0 ? poseAt(craft.leg, stopM) : null;
        const ground = groundAttitude(
          path,
          craft.stationM,
          craft.lengthM,
          mode === 'pushback',
          stop ? { pos: stop.position, heading: stop.headingRad, centreM: stopM } : undefined,
        );
        const taxi =
          craft.mode === 'waiting'
            ? lineUpAttitude(ground, craft.air!.path, 1 - (craft.pauseUntilS - nowS) / LINEUP_S)
            : ground;
        visual = { ...visual, ...taxi };
      }
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
        ...(craft.pushbackReadySinceS === undefined
          ? {}
          : { pushbackReadySinceS: craft.pushbackReadySinceS }),
        enginesRunning: craft.mode !== 'parked' && !craft.towing,
        onRunway: onRunway(craft),
        airborne,
        gearDown,
        visual,
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

  /** TASK-316 (read only): the space aircraft movements on the ground may sweep, as bodies
   * (fuselage, wing and tailplane rectangles of `bodyParts`): each parked aircraft's planned
   * pushback from its stand (TASK-299's stand envelope for its type), a push under way, an
   * arrival's lead-in into the stand it is bound for, and each aircraft moving on the ground over
   * its next `aheadM` (bodies in order, `aheadM` their distance ahead). Ground vehicles keep out
   * of it; the fleet itself does not use it. */
  const boundSweeps = new Map<string, Body[]>();
  function movementSpace(aheadM = 150) {
    const spaces: {
      id: number;
      kind: 'push' | 'bound' | 'moving';
      bodies: Body[];
      aheadM?: number[];
    }[] = [];
    for (const craft of crafts) {
      if (craft.mode === 'done' || craft.mode === 'queued') continue;
      if (craft.mode === 'parked' && craft.stand >= 0) {
        const push = standEnvelopes.get(standKey(craft.type.id, craft.stand))?.push;
        if (push?.length) spaces.push({ id: craft.id, kind: 'push', bodies: push });
        continue;
      }
      if (craft.pushSweep) spaces.push({ id: craft.id, kind: 'push', bodies: craft.pushSweep });
      if (
        craft.stand >= 0 &&
        standBound[craft.stand] === craft.id &&
        craft.type.performance.kind === 'fixedWing'
      ) {
        const key = `${craft.id}/${craft.stand}`;
        let bodies = boundSweeps.get(key);
        if (!bodies)
          boundSweeps.set(key, (bodies = sweep(craft, standLeg(craft, craft.stand), 0, 3)));
        spaces.push({ id: craft.id, kind: 'bound', bodies });
      }
      if (craft.mode === 'ground' && craft.leg) {
        const { points, stationsM } = craft.leg.path;
        const from = craft.stationM;
        const to = Math.min(craft.leg.endM, from + aheadM);
        const count = Math.max(1, Math.ceil((to - from) / 3));
        const bodies: Body[] = [];
        const ahead: number[] = [];
        for (let i = 0; i <= count; i++) {
          const m = from + (i / count) * (to - from);
          const heading =
            headingAtDistance(points, stationsM, m) + (craft.leg.mode === 'pushback' ? Math.PI : 0);
          bodies.push(bodyAt(craft, pointAtDistance(points, stationsM, m), heading));
          ahead.push(m - from);
        }
        spaces.push({ id: craft.id, kind: 'moving', bodies, aheadM: ahead });
      }
    }
    return spaces;
  }

  return {
    graph,
    movementSpace,
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
    /** TASK-339: seconds aircraft have stood waiting on a parked aircraft with no admission. */
    parkedBlockS: () => parkedBlockS,
    /** TASK-344: start refusals by reason (tries, seconds), counting refusals still standing. */
    startRefusals() {
      const out = structuredClone(startRefusals);
      for (const craft of crafts)
        if (craft.startWhy !== undefined && craft.mode === 'parked' && craft.request)
          out[craft.startWhy]!.s += nowS - craft.startWhyS!;
      return out;
    },
    /** TASK-330 / TASK-339: counters of the progressive order and the parked-blocker rules. */
    orderCounters: () =>
      Object.fromEntries(Object.entries(late).filter(([, value]) => typeof value === 'number')),
    /** TASK-352: go-arounds by cause; seconds the head of each end's arrival queue was held, by
     * cause. */
    arrivalCauses: () => structuredClone(arrivalWhy),
    /** TASK-382: the tows requested, with their waits and the arrival-queue holds naming them. */
    towLogs: () => structuredClone(towLogs),
    /** TASK-360: departure counters (take-offs by type and line-up, shared line-ups). */
    departureCounts: () => structuredClone(departureCounts),
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
