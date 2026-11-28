import {
  circularFillet,
  cumulativeLengths,
  headingAtDistance,
  nearestOnPolyline,
  pointAtDistance,
  segmentsIntersect,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import {
  ACCESS_AFTER_M,
  ACCESS_BEFORE_M,
  corridorZones,
  routeLength,
  serviceNetwork,
  serviceRoute,
  turnedPoint,
  type ServiceNetwork,
  type ServicePoint,
  type ServiceStep,
  type ServiceZone,
} from '../network/airside-service';
import type { CompiledCity } from '../network/types';
import { aircraftTypes, type AircraftType } from '../schema/aircraft';
import type { StandKind } from '../schema/airport';
import type { AircraftFleet, AircraftPoseSnapshot } from './aircraft';
import { fixedWingGearStations } from './aircraft-motion';
import type { TurnaroundEvent } from './flight-operations';

// TASK-316: airside ground vehicles. Each turnaround (TASK-299's operations, read through
// `drainTurnarounds`) gets its vehicle set and timeline: baggage trains, a fuel truck or hydrant
// dispenser, a catering truck, apron buses at remote stands and the pushback tug. They come from
// equipment bases on the airside service lanes (`network/airside-service.ts`), park at the stand's
// equipment positions around the parked aircraft and leave before it is ready to push.
//
// Aircraft never see them: the fleet runs unchanged and the vehicles read its snapshot once a
// simulated second. Vehicles give way to aircraft at every stretch of their way that lies in an
// aircraft's corridor (a zone): they enter one only when no aircraft comes and their way beyond
// it is clear, and never stop inside. They give way to each other by following on lanes, one at
// a time through each junction and on each stand's equipment paths.
//
// A stand's equipment positions lie on lines parallel to the parked aircraft: on the starboard
// side catering, the aft and forward baggage trains and fuel from the fuselage outwards, the bus
// on the port side, clear of the fuselage and tailplane in plan (wings and engines stand above
// apron vehicles). A vehicle drives in along its own line from the end facing its access lane
// and out along it to the far end, returning on an outer line beyond all the others, so no way in
// or out crosses another vehicle's position. The tug backs onto the nose, where TASK-314's tug
// is drawn when the push starts; it stays hidden while it pushes (the aircraft layers draw it),
// and drives off from where the push ends before the aircraft taxis.

export const groundVehicleKinds = ['tug', 'baggage', 'fuel', 'hydrant', 'catering', 'bus'] as const;
export type GroundVehicleKind = (typeof groundVehicleKinds)[number];

/** Plan sizes, metres: a baggage tractor without its carts. */
export const groundVehicleSizes: Record<
  GroundVehicleKind,
  { lengthM: number; widthM: number; heightM: number }
> = {
  tug: { lengthM: 3.2, widthM: 2.2, heightM: 1.6 },
  baggage: { lengthM: 2.8, widthM: 1.5, heightM: 1.7 },
  fuel: { lengthM: 10, widthM: 2.5, heightM: 3.2 },
  hydrant: { lengthM: 6.5, widthM: 2.4, heightM: 2.4 },
  catering: { lengthM: 8, widthM: 2.5, heightM: 3.4 },
  bus: { lengthM: 13.5, widthM: 3, heightM: 3.1 },
};
export const baggageCart = { lengthM: 3, widthM: 1.6, heightM: 1.9, gapM: 0.8 };

export interface GroundVehiclePose {
  id: number;
  kind: GroundVehicleKind;
  x: number;
  y: number;
  heading: number;
  speedMps: number;
  /** Baggage carts behind a tractor, nearest first. */
  carts: { x: number; y: number; heading: number }[];
  /** The aircraft a tug pushes or tows (drawn with the aircraft), or -1. */
  attachedTo: number;
  stand: string | null;
}

export type ServiceSlot = 'tug' | 'catering' | 'baggage-aft' | 'baggage-fwd' | 'fuel' | 'bus';

export interface ServiceVisit {
  slot: ServiceSlot;
  kind: GroundVehicleKind;
  /** When the vehicle is due at its position and when it leaves (a tug: when it is due). */
  arriveS: number;
  leaveS: number;
  carts: number;
}

const MIN = 60;
/** Service vehicles are clear of the stand this long before the aircraft is ready to push. */
export const CLEAR_BEFORE_READY_S = 5 * MIN;
const TUG_BEFORE_READY_S = 4 * MIN;
const LONG_TURN_S = 75 * MIN;
const JETS = new Set(['narrowbody', 'widebody', 'double_decker', 'regional_jet']);
const WIDE = new Set(['widebody', 'double_decker']);
const typeById = new Map(aircraftTypes.map((t) => [t.id, t]));

/** A turnaround's vehicle set and timeline: on block at `onBlockS`, ready to push at `readyS`;
 * `arrived` when it landed (passengers and bags come off), `tug` when it leaves by pushback. */
export function turnaroundVisits(
  type: AircraftType,
  standKind: StandKind,
  onBlockS: number,
  readyS: number,
  arrived: boolean,
  tug: boolean,
): ServiceVisit[] {
  if (type.class === 'helicopter') return [];
  const visits: ServiceVisit[] = [];
  const start = onBlockS + MIN;
  const end = readyS - CLEAR_BEFORE_READY_S;
  const span = end - start;
  const long = span > LONG_TURN_S;
  const add = (slot: ServiceSlot, kind: GroundVehicleKind, from: number, to: number, carts = 0) => {
    const arriveS = Math.max(start, from);
    const leaveS = Math.min(end, to);
    if (leaveS - arriveS >= 3 * MIN) visits.push({ slot, kind, arriveS, leaveS, carts });
  };
  if (type.class !== 'private') {
    const carts = WIDE.has(type.class) ? 3 : type.class === 'propeller' ? 1 : 2;
    const slots: ServiceSlot[] = WIDE.has(type.class)
      ? ['baggage-aft', 'baggage-fwd']
      : ['baggage-aft'];
    for (const slot of slots) {
      if (long && arrived) add(slot, 'baggage', start, start + 20 * MIN, carts);
      if (long) add(slot, 'baggage', end - 30 * MIN, end - 2 * MIN, carts);
      else add(slot, 'baggage', arrived ? start : end - 30 * MIN, end - 2 * MIN, carts);
    }
  }
  const hydrant = standKind === 'contact' && JETS.has(type.class) && type.class !== 'regional_jet';
  const fuelFrom = long ? end - 50 * MIN : start + 0.25 * span;
  add('fuel', hydrant ? 'hydrant' : 'fuel', fuelFrom, fuelFrom + Math.min(15 * MIN, 0.4 * span));
  if (JETS.has(type.class)) {
    const from = long ? end - 45 * MIN : start + 0.3 * span;
    add('catering', 'catering', from, from + Math.min(12 * MIN, 0.35 * span));
  }
  if (standKind === 'remote' && type.class !== 'private') {
    if (arrived) add('bus', 'bus', start, start + 5 * MIN);
    add('bus', 'bus', end - 14 * MIN, end - MIN);
  }
  if (tug && type.performance.kind === 'fixedWing')
    visits.push({
      slot: 'tug',
      kind: 'tug',
      arriveS: Math.max(start, readyS - TUG_BEFORE_READY_S),
      leaveS: Infinity,
      carts: 0,
    });
  return visits.sort((a, b) => a.arriveS - b.arriveS || a.slot.localeCompare(b.slot));
}

// ---------------------------------------------------------------------------------------------
// Stand geometry

interface Frame {
  c: Vec2;
  f: Vec2;
  r: Vec2;
}
const at = ({ c, f, r }: Frame, along: number, lateral: number): Vec2 => ({
  x: c.x + f.x * along + r.x * lateral,
  y: c.y + f.y * along + r.y * lateral,
});

/** A plan rectangle: centre, heading, length and width. */
export interface PlanBox {
  x: number;
  y: number;
  heading: number;
  lengthM: number;
  widthM: number;
}

export function boxCorners(box: PlanBox): Vec2[] {
  const c = Math.cos(box.heading),
    s = Math.sin(box.heading);
  const hl = box.lengthM / 2,
    hw = box.widthM / 2;
  return [
    [hl, hw],
    [hl, -hw],
    [-hl, -hw],
    [-hl, hw],
  ].map(([u, v]) => ({ x: box.x + u! * c - v! * s, y: box.y + u! * s + v! * c }));
}

/** The fuselage and the tailplane of an aircraft, as TASK-298's gate checks draw them. */
export function aircraftHull(type: AircraftType, pose: { x: number; y: number; heading: number }) {
  const { lengthM: l, spanM } = type;
  const f = { x: Math.cos(pose.heading), y: Math.sin(pose.heading) };
  const box = (along: number, lengthM: number, widthM: number): PlanBox => ({
    x: pose.x + f.x * along,
    y: pose.y + f.y * along,
    heading: pose.heading,
    lengthM,
    widthM,
  });
  return [box(0, l, 0.1 * l), box(-0.43 * l, 0.12 * l, spanM / 3)];
}

/** The three rectangles of one of the fleet's bodies, with its 1.5 m. */
function bodyBoxes3(body: {
  x: number;
  y: number;
  c: number;
  s: number;
  length: number;
  span: number;
}): PlanBox[] {
  const heading = Math.atan2(body.s, body.c);
  return (
    [
      [0, 0.5, 0.05],
      [0.02, 0.1, 0.5],
      [-0.43, 0.06, 1 / 6],
    ] as const
  ).map(([offset, length, span]) => ({
    x: body.x + body.c * offset * body.length,
    y: body.y + body.s * offset * body.length,
    heading,
    lengthM: 2 * (length * body.length + 1.5),
    widthM: 2 * (span * body.span + 1.5),
  }));
}

/** Distance from a point to a plan box (0 inside). */
export function boxDistance(p: Vec2, box: PlanBox) {
  const dx = p.x - box.x,
    dy = p.y - box.y;
  const c = Math.cos(box.heading),
    s = Math.sin(box.heading);
  const u = Math.max(0, Math.abs(dx * c + dy * s) - box.lengthM / 2);
  const v = Math.max(0, Math.abs(-dx * s + dy * c) - box.widthM / 2);
  return Math.hypot(u, v);
}

/** Whether a segment comes within `margin` of a plan box. */
function segmentNearBox(a: Vec2, b: Vec2, box: PlanBox, margin: number) {
  const grown = boxCorners({
    ...box,
    lengthM: box.lengthM + 2 * margin,
    widthM: box.widthM + 2 * margin,
  });
  const inside = (p: Vec2) => {
    const dx = p.x - box.x,
      dy = p.y - box.y;
    const c = Math.cos(box.heading),
      s = Math.sin(box.heading);
    return (
      Math.abs(dx * c + dy * s) <= box.lengthM / 2 + margin &&
      Math.abs(-dx * s + dy * c) <= box.widthM / 2 + margin
    );
  };
  if (inside(a) || inside(b)) return true;
  for (let i = 0; i < 4; i++)
    if (segmentsIntersect(a, b, grown[i]!, grown[(i + 1) % 4]!)) return true;
  return false;
}

/** Whether two plan boxes overlap (separating axes). */
export function boxesOverlap(a: PlanBox, b: PlanBox) {
  const reach = (Math.hypot(a.lengthM, a.widthM) + Math.hypot(b.lengthM, b.widthM)) / 2;
  if (Math.abs(a.x - b.x) > reach || Math.abs(a.y - b.y) > reach) return false;
  const ca = boxCorners(a),
    cb = boxCorners(b);
  for (const box of [ca, cb])
    for (let i = 0; i < 4; i++) {
      const p = box[i]!,
        q = box[(i + 1) % 4]!;
      const nx = q.y - p.y,
        ny = p.x - q.x;
      let minA = Infinity,
        maxA = -Infinity,
        minB = Infinity,
        maxB = -Infinity;
      for (const v of ca) {
        const d = v.x * nx + v.y * ny;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of cb) {
        const d = v.x * nx + v.y * ny;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA < minB || maxB < minA) return false;
    }
  return true;
}

interface StandWay {
  /** Way in: from the access point to the position; `reverseFrom`: driven backwards from there. */
  entry: Vec2[];
  reverseFrom: number;
  /** Way out: from the position to the merge point. */
  exit: Vec2[];
  spot: PlanBox;
  /** The vehicle's whole plan at its position (a train with its carts). */
  footprint: PlanBox;
  /** Points of `entry` before the stand's near end, and of `exit` after it. */
  lead: number;
  tail: number;
  /** From another lane point: the way to the near end first, beside the aircraft. */
  approach: (p: Vec2) => Vec2[];
  approachOut: (p: Vec2) => Vec2[];
}

function fillet(points: Vec2[], radius: number): Vec2[] {
  if (points.length < 3) return points;
  const out: Vec2[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const round = circularFillet(out.at(-1)!, points[i]!, points[i + 1]!, radius);
    if (round) out.push(...round.points);
    else out.push(points[i]!);
  }
  out.push(points.at(-1)!);
  return out.filter(
    (p, i) => i === 0 || Math.hypot(p.x - out[i - 1]!.x, p.y - out[i - 1]!.y) > 1e-6,
  );
}

/** The equipment positions around a parked aircraft and the ways in and out of each, from the
 * stand's access point `entry` and merge point `merge`. Slots whose way or position meets the
 * aircraft's fuselage or tailplane, or another parked aircraft's, are left out. */
export function standWays(
  type: AircraftType,
  pose: { x: number; y: number; heading: number },
  visits: readonly ServiceVisit[],
  entry: Vec2,
  merge: Vec2,
  others: readonly PlanBox[],
): Map<ServiceSlot, StandWay> {
  const l = type.lengthM;
  const f = { x: Math.cos(pose.heading), y: Math.sin(pose.heading) };
  const frame: Frame = { c: { x: pose.x, y: pose.y }, f, r: { x: -f.y, y: f.x } };
  const w = 0.05 * l;
  const tail = type.spanM / 6;
  const inner = Math.max(w + 1.6, tail + 1.5);
  // The lane side: vehicles drive in from the aircraft's end nearer the access point.
  const local = (p: Vec2) => (p.x - pose.x) * f.x + (p.y - pose.y) * f.y;
  const side = local(entry) < 0 ? -1 : 1;
  const near = side * (l / 2 + 8);
  const far = -near;
  const facing = -side;
  const carts = Math.max(0, ...visits.map((v) => v.carts));
  const train =
    groundVehicleSizes.baggage.lengthM + carts * (baggageCart.lengthM + baggageCart.gapM);
  const width = (slot: ServiceSlot) =>
    slot === 'bus'
      ? groundVehicleSizes.bus.widthM
      : slot.startsWith('baggage')
        ? baggageCart.widthM
        : groundVehicleSizes[slot === 'fuel' ? 'fuel' : slot === 'tug' ? 'tug' : 'catering'].widthM;
  const has = new Set(visits.map((v) => v.slot));
  const kindOf = (slot: ServiceSlot) => visits.find((v) => v.slot === slot)!.kind;
  // Starboard lines, from the fuselage out.
  const lateral = new Map<ServiceSlot, number>();
  let edge = inner;
  for (const slot of ['catering', 'baggage-aft', 'baggage-fwd', 'fuel'] as const) {
    if (!has.has(slot)) continue;
    let centre = edge + width(slot) / 2;
    if (slot === 'fuel') centre = Math.max(centre, 0.28 * type.spanM);
    lateral.set(slot, centre);
    edge = centre + width(slot) / 2 + 1.2;
  }
  // Ways out run forward along each line and back outside all of them, nested: the innermost
  // line turns out farthest and returns outermost, so no two ways out cross.
  const starboard = [...lateral.keys()];
  const nest = (slot: ServiceSlot) =>
    slot === 'bus' ? 0 : starboard.length - 1 - starboard.indexOf(slot);
  const starboardOuter = edge + 3;
  const tugOuter = starboardOuter + Math.max(0, starboard.length - 1) * 3 + 3;
  const busLateral = -(inner + groundVehicleSizes.bus.widthM / 2);
  const portOuter = busLateral - groundVehicleSizes.bus.widthM / 2 - 4.2;
  // Along ranges of each position.
  const range = (slot: ServiceSlot): [number, number] => {
    switch (slot) {
      case 'catering':
        return [0.36 * l - 4, 0.36 * l + 4];
      case 'baggage-aft':
        return [-0.22 * l - train, -0.22 * l];
      case 'baggage-fwd':
        return [0.3 * l - train, 0.3 * l];
      case 'fuel': {
        const length = groundVehicleSizes[kindOf('fuel')].lengthM;
        return [0.12 * l + 1, 0.12 * l + 1 + length];
      }
      case 'bus':
        return [0.25 * l - 6.75, 0.25 * l + 6.75];
      case 'tug':
        return [l / 2 + 0.85, l / 2 + 4.05];
    }
  };
  const hull = aircraftHull(type, pose);
  // An access point beside the aircraft: first along its own line to the near end.
  const across = (p: Vec2) => (p.x - pose.x) * frame.r.x + (p.y - pose.y) * frame.r.y;
  const band = Math.max(w, tail) + 4;
  const approach = (p: Vec2) =>
    Math.abs(across(p)) > band && local(p) * side < l / 2 + 8 ? [at(frame, near, across(p))] : [];
  // Ways out return 6 m beyond the ways in, so the two never run head on.
  const nearOut = near + side * 6;
  const approachOut = (p: Vec2) =>
    Math.abs(across(p)) > band && local(p) * side < l / 2 + 14
      ? [at(frame, nearOut, across(p))]
      : [];
  /** Waypoints from `a` to `b` round the aircraft and the parked hulls about: the shortest way
   * over the corners and sides of a ring outside all positions (a small visibility graph). */
  const ringLateral =
    Math.max(starboardOuter + Math.max(0, starboard.length - 1) * 3, -portOuter) + 4;
  const ringAlong = l / 2 + 14;
  const ring = [
    [ringAlong, ringLateral],
    [0, ringLateral],
    [-ringAlong, ringLateral],
    [-ringAlong, 0],
    [-ringAlong, -ringLateral],
    [0, -ringLateral],
    [ringAlong, -ringLateral],
    [ringAlong, 0],
  ].map(([u, v]) => at(frame, u!, v!));
  function around(a: Vec2, b: Vec2, margin: number): Vec2[] | null {
    const obstacles = [...hull, ...others, ...accepted.map((w) => w.footprint)];
    const ok = (p: Vec2, q: Vec2) => clear([p, q], margin, obstacles);
    if (ok(a, b)) return [];
    const nodes = [a, b, ...ring];
    const cost = nodes.map(() => Infinity);
    const via = nodes.map(() => -1);
    const done = nodes.map(() => false);
    cost[0] = 0;
    for (;;) {
      let i = -1;
      for (let j = 0; j < nodes.length; j++) if (!done[j] && (i < 0 || cost[j]! < cost[i]!)) i = j;
      if (i < 0 || cost[i] === Infinity) return null;
      if (i === 1) break;
      done[i] = true;
      for (let j = 0; j < nodes.length; j++) {
        if (done[j] || j === i) continue;
        const d = Math.hypot(nodes[j]!.x - nodes[i]!.x, nodes[j]!.y - nodes[i]!.y);
        if (cost[i]! + d < cost[j]! && ok(nodes[i]!, nodes[j]!))
          [cost[j], via[j]] = [cost[i]! + d, i];
      }
    }
    const out: Vec2[] = [];
    for (let j = via[1]!; j > 0; j = via[j]!) out.unshift(nodes[j]!);
    return out;
  }
  const clear = (points: readonly Vec2[], margin: number, boxes: readonly PlanBox[]) => {
    for (let i = 1; i < points.length; i++)
      for (const box of boxes)
        if (segmentNearBox(points[i - 1]!, points[i]!, box, margin)) return false;
    return true;
  };
  const ways = new Map<ServiceSlot, StandWay>();
  const accepted: StandWay[] = [];
  // The tug last: its way round the aircraft keeps clear of the positions taken.
  const order: ServiceSlot[] = ['bus', 'baggage-aft', 'fuel', 'catering', 'baggage-fwd', 'tug'];
  for (const slot of order) {
    if (!has.has(slot)) continue;
    const half = width(slot) / 2;
    const [from, to] = range(slot);
    let way: StandWay;
    let candidates: StandWay[] = [];
    if (slot === 'tug') {
      const tugLength = groundVehicleSizes.tug.lengthM;
      const centre = (from + to) / 2;
      const spot = {
        ...at(frame, centre, 0),
        heading: pose.heading,
        lengthM: tugLength,
        widthM: 2.2,
      };
      const back = at(frame, centre + 10, 0);
      const outer = across(entry) >= 0 ? tugOuter : portOuter;
      const pattern = side < 0 ? [at(frame, near, outer), at(frame, centre + 10, outer)] : [];
      const tugIn = (p: Vec2) => around(p, back, 1.9) ?? [...approach(p), ...pattern];
      const tugOut = (p: Vec2) => around(back, p, 1.6) ?? approachOut(p);
      const lead = [entry, ...tugIn(entry)];
      way = {
        entry: [...lead, back, spot],
        reverseFrom: lead.length,
        exit: [],
        spot,
        footprint: spot,
        lead: lead.length,
        tail: 0,
        approach: tugIn,
        approachOut: tugOut,
      };
      candidates = [way];
    } else {
      const y = slot === 'bus' ? busLateral : lateral.get(slot)!;
      const k0 = nest(slot);
      const vehicleLength = slot.startsWith('baggage')
        ? groundVehicleSizes.baggage.lengthM
        : groundVehicleSizes[kindOf(slot)].lengthM;
      // The vehicle faces away from the lane side; a tractor heads its train.
      const centre = facing > 0 ? to - vehicleLength / 2 : from + vehicleLength / 2;
      const heading = facing > 0 ? pose.heading : pose.heading + Math.PI;
      const spot = {
        ...at(frame, centre, y),
        heading,
        lengthM: vehicleLength,
        widthM: width(slot),
      };
      const footprint = {
        ...at(frame, (from + to) / 2, y),
        heading,
        lengthM: to - from,
        widthM: width(slot),
      };
      const start = at(frame, near, y);
      const inWay = (p: Vec2) => around(p, start, half + 0.8) ?? approach(p);
      const entryWay = [entry, ...inWay(entry), start, spot];
      // TASK-350: where the nested way out meets a parked hull (a neighbour's nose), a tighter
      // nest, then a way out round the hulls from just past the position.
      for (let k = k0; k >= 0; k--) {
        const outer = slot === 'bus' ? portOuter : starboardOuter + k * 3;
        const farK = far - side * k * 3;
        const nearK = nearOut + side * k * 3;
        const out = (p: Vec2) =>
          Math.abs(across(p)) > band && local(p) * side < Math.abs(nearK)
            ? [at(frame, nearK, across(p))]
            : [];
        const back = at(frame, nearK, outer);
        const outWay = (p: Vec2) => around(back, p, half + 0.3) ?? out(p);
        candidates.push({
          entry: entryWay,
          reverseFrom: Infinity,
          exit: [spot, at(frame, farK, y), at(frame, farK, outer), back, ...outWay(merge), merge],
          spot,
          footprint,
          lead: 1 + inWay(entry).length,
          tail: 1 + outWay(merge).length,
          approach: inWay,
          approachOut: outWay,
        });
      }
      const past = at(frame, far, y);
      const roundOut = (p: Vec2) => around(past, p, half + 0.3);
      const exitRound = roundOut(merge);
      if (exitRound)
        candidates.push({
          entry: entryWay,
          reverseFrom: Infinity,
          exit: [spot, past, ...exitRound, merge],
          spot,
          footprint,
          lead: 1 + inWay(entry).length,
          tail: 1 + exitRound.length,
          approach: inWay,
          approachOut: (p) => roundOut(p) ?? [],
        });
    }
    const own = [...hull, ...others];
    const fits = (way: StandWay) =>
      clear(way.entry, half + 0.8, own) &&
      clear(way.exit, half + 0.3, own) &&
      !others.some((b) => boxesOverlap(b, way.footprint)) &&
      accepted.every(
        (other) =>
          !boxesOverlap(other.footprint, way.footprint) &&
          clear(way.entry, half + 0.5, [other.footprint]) &&
          clear(way.exit, half + 0.5, [other.footprint]) &&
          clear(other.entry.slice(0, -1), 1.5, [way.footprint]) &&
          clear(other.exit.slice(1), 1.5, [way.footprint]),
      );
    const found = candidates.find(fits);
    const ok = found !== undefined;
    way = found ?? candidates[0]!;
    if (!ok) continue;
    ways.set(slot, way);
    accepted.push(way);
  }
  return ways;
}

// ---------------------------------------------------------------------------------------------
// Paths

const LANE_MPS = 8;
const LINK_MPS = 5;
const STAND_MPS = 4;
const FINAL_MPS = 1.5;
const ACCEL = 1.2;
const DECEL = 2.5;
const GAP_M = 2;
/** Aircraft are read once a simulated second. */
const READ_S = 1;
const LOOK_EVERY_S = 0.5;

interface Element {
  fromS: number;
  toS: number;
  /** A network lane, -(link + 1) a link, or a vehicle's own way (unique, below -1e6). */
  key: number;
  /** The element's own station at `fromS`. */
  offsetM: number;
  speedMps: number;
}

interface NodeHold {
  kind: 'node';
  node: number;
  atS: number;
  untilS: number;
  /** Identifies this passage through the node, even when the path is spliced. */
  occurrence: number;
}

type Hold =
  | NodeHold
  | { kind: 'stand'; stand: number; atS: number; untilS: number }
  | { kind: 'merge'; lane: number; laneM: number; atS: number; untilS: number; wide?: true };

interface PathZone extends ServiceZone {
  samples?: Vec2[];
}

interface Path {
  points: Vec2[];
  cumulative: Float64Array;
  lengthM: number;
  elements: Element[];
  holds: Hold[];
  zones: PathZone[];
  /** Stations driven backwards: [from, to). */
  reverse: [number, number] | null;
  /** The last stretch is a stand approach: slow at the end. */
  finalM: number;
}

class PathBuilder {
  points: Vec2[] = [];
  elements: Element[] = [];
  holds: Hold[] = [];
  zones: PathZone[] = [];
  lengthM = 0;
  reverse: [number, number] | null = null;
  finalM = 0;
  add(
    points: readonly Vec2[],
    key: number,
    offsetM: number,
    speedMps: number,
    zones: readonly ServiceZone[] = [],
  ) {
    const start = this.lengthM;
    const own = cumulativeLengths(points);
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const last = this.points.at(-1);
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) continue;
      this.points.push(p);
    }
    this.lengthM = start + own.at(-1)!;
    if (this.lengthM > start)
      this.elements.push({ fromS: start, toS: this.lengthM, key, offsetM, speedMps });
    for (const z of zones)
      this.zones.push({
        fromM: start + z.fromM - offsetM,
        toM: start + z.toM - offsetM,
        edges: z.edges,
      });
    return start;
  }
  /** Stations `a` to `b` of another path, with its elements, holds and zones. */
  addSlice(path: Path, a: number, b: number) {
    if (b - a < 1e-6) return;
    const start = this.lengthM;
    const shift = (x: number) => start + x - a;
    const inner = path.points.filter((_, i) => path.cumulative[i]! > a && path.cumulative[i]! < b);
    for (const q of [
      pointAtDistance(path.points, path.cumulative, a),
      ...inner,
      pointAtDistance(path.points, path.cumulative, b),
    ]) {
      const last = this.points.at(-1);
      if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 1e-6) this.points.push(q);
    }
    this.lengthM = start + (b - a);
    for (const e of path.elements) {
      if (e.toS <= a || e.fromS >= b) continue;
      const from = Math.max(e.fromS, a);
      this.elements.push({
        ...e,
        fromS: shift(from),
        toS: shift(Math.min(e.toS, b)),
        offsetM: e.offsetM + from - e.fromS,
      });
    }
    for (const h of path.holds)
      if (h.untilS > a && h.atS < b)
        this.holds.push({ ...h, atS: shift(h.atS), untilS: shift(h.untilS) });
    for (const z of path.zones)
      if (z.toM > a && z.fromM < b)
        this.zones.push({
          fromM: shift(Math.max(z.fromM, a)),
          toM: shift(Math.min(z.toM, b)),
          edges: z.edges,
        });
    if (path.reverse && path.reverse[1] > a && path.reverse[0] < b)
      this.reverse = [shift(Math.max(path.reverse[0], a)), shift(Math.min(path.reverse[1], b))];
    if (b >= path.lengthM - 1e-6) this.finalM = path.finalM;
  }
  build(): Path {
    const cumulative = cumulativeLengths(this.points);
    // Rounding may leave the summed length a hair off the points' own.
    const scale = this.lengthM ? cumulative.at(-1)! / this.lengthM : 1;
    const fix = (s: number) => s * scale;
    for (const e of this.elements) [e.fromS, e.toS] = [fix(e.fromS), fix(e.toS)];
    // The two slices around a detour can both retain the same crossing. Keep it reserved
    // until the back clears the later slice.
    const crossings = new Map<number, NodeHold>();
    const holds = this.holds.filter((h) => {
      [h.atS, h.untilS] = [fix(h.atS), fix(h.untilS)];
      if (h.kind !== 'node') return true;
      const first = crossings.get(h.occurrence);
      if (!first) {
        crossings.set(h.occurrence, h);
        return true;
      }
      first.atS = Math.min(first.atS, h.atS);
      first.untilS = Math.max(first.untilS, h.untilS);
      return false;
    });
    const zones = this.zones
      .map((z) => ({ ...z, fromM: fix(z.fromM), toM: fix(z.toM) }))
      .sort((a, b) => a.fromM - b.fromM);
    // Touching zones are one stretch.
    const merged: PathZone[] = [];
    for (const z of zones) {
      const last = merged.at(-1);
      if (last && z.fromM <= last.toM + 0.5) {
        last.toM = Math.max(last.toM, z.toM);
        for (const e of z.edges) if (!last.edges.includes(e)) last.edges.push(e);
      } else merged.push({ ...z, edges: [...z.edges] });
    }
    return {
      points: this.points,
      cumulative,
      lengthM: cumulative.at(-1)!,
      elements: this.elements,
      holds: holds.sort((a, b) => a.atS - b.atS),
      zones: merged,
      reverse: this.reverse && [fix(this.reverse[0]), fix(this.reverse[1])],
      finalM: this.finalM,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// The fleet of ground vehicles

type Visit = ServiceVisit & {
  state: 'planned' | 'sent' | 'done' | 'dropped';
  arrivedS?: number;
  cause?: string;
  retryAtS?: number;
};

interface Turn {
  aircraft: number;
  stand: number;
  type: AircraftType;
  onBlockS: number;
  readyS: number;
  visits: Visit[];
  ways: Map<ServiceSlot, StandWay> | null;
  merge?: ServicePoint;
  /** Where its vehicles leave the lane (TASK-350: before a hull over the stand's own point). */
  access?: ServicePoint;
  gone: boolean;
  /** TASK-356: a tow away announced as the aircraft comes (touchdown about `comingS`): its tug
   * waits at the nose of the pose the fleet has it bound to park in; cleared once it stands
   * there. */
  comingS?: number;
  /** TASK-356: on its stand when the run starts: its tug is placed at the nose at once. */
  atStart?: boolean;
}

interface Vehicle {
  id: number;
  kind: GroundVehicleKind;
  lengthM: number;
  widthM: number;
  carts: number;
  path: Path;
  s: number;
  v: number;
  phase: 'in' | 'serving' | 'out' | 'attached';
  turn: Turn | null;
  visit: Turn['visits'][number] | null;
  committedS: number;
  nodes: Map<number, NodeHold>;
  stand: number;
  pos: Vec2;
  heading: number;
  trail: Vec2[];
  stoppedS: number;
  yieldZone: PathZone | null;
  blockedBy: number;
  detours: number;
  lookS: number;
  lookLimitS: number;
  reason: string;
  lookReason: string;
  lookBlockedBy?: number;
  delayedBy?: string;
  /** When a tug let go of its aircraft: it has the aircraft's 20 s pause to drive clear. */
  detachedS: number;
}

export interface GroundVehicleMetrics {
  turnarounds: number;
  visits: number;
  served: number;
  /** Visits whose vehicle came after it was due, and visits that never reached the stand. */
  late: number;
  missed: number;
  /** Visits left out for want of room at the stand or of a way there. */
  dropped: number;
  active: number;
  peakActive: number;
  /** Times a vehicle held short of a zone an aircraft was coming through. */
  yields: number;
  pushbacks: number;
  /** Pushbacks whose tug was not at the nose when the push started. */
  tugsMissing: number;
  /** Of those, pushes no tug was planned for: a tow away as the aircraft parks (no notice), a
   * departure back at its stand, a stand no tug reaches. */
  unannounced: number;
  /** Vehicles that stood still for 10 minutes away from their position. */
  stuck: number;
  /** Vehicles taken out of the simulation: held off by another for 15 s with no rule to order
   * them, or (`cleared`, the last resort) about to be reached by an aircraft. */
  withdrawn: number;
  cleared: number;
  /** Traffic cycles broken by letting the least urgent vehicle leave the simulation. */
  queueRelief: number;
  /** Visits put back in the dispatch queue after yielding in a traffic cycle. */
  queueRetries: number;
  /** Dropped visits by cause: no room at the stand for the position (`no-room`), no way to the
   * stand (`no-way`), or the cause that stopped the vehicle getting there. */
  droppedBy: Record<string, number>;
  /** One cause per push without a coupled tug, and per tug arriving over 2 min late. */
  missingTugsBy: Record<string, number>;
  lateTugsBy: Record<string, number>;
  /** Late and too-late arrivals for all visits, by their last meaningful delay. */
  lateBy: Record<string, number>;
  /** Vehicles still stopped for at least 10 min, by blocker. */
  queuedBy: Record<string, number>;
}

export interface GroundVehicleSource {
  snapshot(): readonly AircraftPoseSnapshot[];
  drainTurnarounds(): TurnaroundEvent[];
  /** The fleet's movement space (`AircraftFleet.movementSpace`). */
  movementSpace(): ReturnType<AircraftFleet['movementSpace']>;
}

const STUCK_S = 600;
/** TASK-350: a vehicle drives through a parked aircraft's due push space (holding short of it
 * only from this long before the push), as through a zone: pushes start slowly, and one that
 * starts on it sends it off (`clearOut`). */
const CROSS_BEFORE_S = 60;
/** TASK-350: two vehicles holding each other off give way by rule after this long. */
const GIVE_WAY_S = 3;
/** TASK-356: a tug for a tow away as the aircraft parks is at the nose this long before its
 * touchdown, and gives up on an aircraft that has not come this long after it. Once the aircraft
 * stands there the tug stays for its first push, a tow or (none found) the departure. */
const TOW_TUG_BEFORE_S = 3 * MIN;
const COMING_WAIT_S = 30 * MIN;
/** A departure's tug disconnects and the engines start over 20 s (the fleet's pause). */
const TUG_CLEAR_S = 15;
/** How far a vehicle edges over to pass a hull that reaches over its way (`squeezePast`). */
const SQUEEZE_M = [1, 2, 3, 4];
/** TASK-319: an aircraft ready for pushback stands still with its tug coupled. */
const pushing = (state: string) => state === 'ready-for-pushback' || state === 'pushback';
const standing = (state: string) => state === 'parked' || state === 'ready-for-pushback';

function tally(by: Record<string, number>, cause: string) {
  by[cause] = (by[cause] ?? 0) + 1;
}

function travelCause(vehicle: Vehicle) {
  switch (vehicle.reason) {
    case 'zone-closed':
    case 'swept':
    case 'hull':
      return 'aircraft-hold';
    case 'guard':
      return vehicle.blockedBy < 0 ? 'aircraft-hold' : 'lane-queue';
    case 'hold-stand':
      return 'stand-queue';
    case 'zone-exit':
    case 'hold-node':
    case 'hold-merge':
    case 'gap':
    case 'vehicle':
      return 'lane-queue';
    default:
      return 'driving';
  }
}

function delayCause(vehicle: Vehicle) {
  const cause = travelCause(vehicle);
  return cause === 'driving' ? (vehicle.delayedBy ?? vehicle.visit?.cause ?? cause) : cause;
}

export function createGroundVehicles(compiled: CompiledCity, source: GroundVehicleSource) {
  const graph = compiled.airside!;
  const network: ServiceNetwork | null = serviceNetwork(compiled);
  const vehicles: Vehicle[] = [];
  const turns = new Map<number, Turn>();
  const nodeHolder = new Map<number, number>();
  const standHolder = new Map<number, number>();
  let aircraft: readonly AircraftPoseSnapshot[] = [];
  let parkedBoxes: PlanBox[] = [];
  let parkedOwners: AircraftPoseSnapshot[] = [];
  const byId = new Map<number, AircraftPoseSnapshot>();
  const readyOf = new Map<number, number>();
  const towOf = new Map<number, number>();
  /** TASK-356: where an arrival bound for a stand parks (the end of its lead-in), by aircraft. */
  const boundPose = new Map<number, { x: number; y: number; heading: number }>();
  /** The movement space as plan boxes, by aircraft: whether it is due, and its near part. */
  let space: {
    aircraft: number;
    box: PlanBox;
    due: boolean;
    imminent: boolean;
    /** Not a parked aircraft's push still a minute or more off (`CROSS_BEFORE_S`). */
    soon: boolean;
  }[] = [];
  let nextReadS = -Infinity;
  let nextId = 1;
  let nextHold = 1;
  let ownKey = -1e6;
  let nowS = 0;
  const counts = {
    turnarounds: 0,
    visits: 0,
    served: 0,
    late: 0,
    missed: 0,
    dropped: 0,
    peakActive: 0,
    yields: 0,
    pushbacks: 0,
    tugsMissing: 0,
    unannounced: 0,
    withdrawn: 0,
    cleared: 0,
    queueRelief: 0,
    queueRetries: 0,
    droppedBy: {} as Record<string, number>,
    missingTugsBy: {} as Record<string, number>,
    lateTugsBy: {} as Record<string, number>,
    lateBy: {} as Record<string, number>,
  };
  function drop(visit: Visit, reason: string) {
    visit.state = 'dropped';
    visit.cause = reason;
    counts.dropped++;
    tally(counts.droppedBy, reason);
  }
  function dropPendingRetries(turn: Turn | undefined) {
    for (const visit of turn?.visits ?? [])
      if (visit.state === 'planned' && visit.retryAtS !== undefined) drop(visit, visit.cause!);
  }
  const retryDeadline = (turn: Turn, visit: Visit) =>
    visit.kind === 'tug' ? turn.readyS : visit.leaveS - MIN;
  const lastState = new Map<number, string>();
  const tugAt = new Map<number, Vehicle>();
  // A drive-through stop (a node other edges meet) may send its aircraft off forwards: no tug.
  const pushes = graph.stands.map((stand) => graph.nodes[stand.stop]!.edges.length === 1);
  const leadIns = graph.stands.map((stand) => new Set(stand.leadIn));

  const routeCache = new Map<string, ReturnType<typeof serviceRoute>>();
  function route(from: ServicePoint, to: ServicePoint) {
    const key = `${from.lane}:${from.positionM}>${to.lane}:${to.positionM}`;
    if (!routeCache.has(key)) routeCache.set(key, serviceRoute(compiled, network!, from, to));
    return routeCache.get(key)!;
  }

  function addRoute(builder: PathBuilder, steps: NonNullable<ReturnType<typeof serviceRoute>>) {
    for (const step of steps) {
      if (step.kind === 'lane') {
        const lane = compiled.lanes[step.lane]!;
        if (step.toM - step.fromM < 1e-6) continue;
        const points = [
          pointAtDistance(lane.polyline, lane.cumulative, step.fromM),
          ...lane.polyline.filter(
            (_, i) => lane.cumulative[i]! > step.fromM && lane.cumulative[i]! < step.toM,
          ),
          pointAtDistance(lane.polyline, lane.cumulative, step.toM),
        ];
        const zones = (network!.laneZones.get(step.lane) ?? [])
          .filter((z) => z.toM > step.fromM && z.fromM < step.toM)
          .map((z) => ({
            ...z,
            fromM: Math.max(z.fromM, step.fromM),
            toM: Math.min(z.toM, step.toM),
          }));
        builder.add(points, step.lane, step.fromM, Math.min(LANE_MPS, lane.speedLimitMps), zones);
      } else {
        const link = network!.links[step.link]!;
        const start = builder.add(link.polyline, -(link.idx + 1), 0, LINK_MPS, link.zones);
        // Lane ends crowd a junction: its hold starts 6 m before the link and ends 6 m after.
        builder.holds.push({
          kind: 'node',
          node: link.node,
          occurrence: nextHold++,
          atS: Math.max(0, start - 6),
          untilS: builder.lengthM + 6,
        });
      }
    }
  }

  function addOwn(builder: PathBuilder, points: Vec2[], skipStand: number, speed = STAND_MPS) {
    const smooth = fillet(points, 5);
    const cumulative = cumulativeLengths(smooth);
    const skip = skipStand >= 0 ? (e: number) => leadIns[skipStand]!.has(e) : undefined;
    const zones = corridorZones(graph, smooth, cumulative, skip);
    return builder.add(smooth, ownKey--, 0, speed, zones);
  }

  const mergePoint = (access: ServicePoint): ServicePoint => {
    const lane = compiled.lanes[access.lane]!;
    const positionM = Math.min(lane.lengthM, access.positionM + ACCESS_AFTER_M - 7);
    return {
      lane: access.lane,
      positionM,
      pos: pointAtDistance(lane.polyline, lane.cumulative, positionM),
    };
  };

  const bestMerge = (stand: number) => mergePoint(network!.stands[stand]!);
  const turnCache = new Map<string, ServicePoint | null>();
  const turned = (p: ServicePoint) => {
    const key = `${p.lane}:${Math.round(p.positionM)}`;
    if (!turnCache.has(key)) turnCache.set(key, turnedPoint(compiled, network!, p));
    return turnCache.get(key)!;
  };
  const TURN_COST_M = 40;

  /** Turn round off the lane: a loop from one lane point onto the lane the other way. */
  function addTurn(builder: PathBuilder, from: ServicePoint, to: ServicePoint) {
    const lane = compiled.lanes[from.lane]!;
    const h = headingAtDistance(
      lane.polyline,
      lane.cumulative,
      Math.min(from.positionM, lane.lengthM - 1e-3),
    );
    const d = { x: Math.cos(h), y: Math.sin(h) };
    const mid = {
      x: (from.pos.x + to.pos.x) / 2 + d.x * 7,
      y: (from.pos.y + to.pos.y) / 2 + d.y * 7,
    };
    // It crosses into the other lane: it waits before turning until that lane is clear.
    const startS = builder.lengthM;
    addOwn(
      builder,
      [from.pos, { x: from.pos.x + d.x * 3, y: from.pos.y + d.y * 3 }, mid, to.pos],
      -1,
      LINK_MPS,
    );
    builder.holds.push({
      kind: 'merge',
      lane: to.lane,
      laneM: to.positionM,
      atS: startS,
      untilS: builder.lengthM,
      wide: true,
    });
  }

  type DepotWay = { plan: NonNullable<ReturnType<typeof planWay>>; depot: ServicePoint };
  const depotWayCache = new Map<string, DepotWay[]>();
  /** Bases by driven distance, not straight-line distance across the apron. */
  function depotWays(to: ServicePoint) {
    const key = `${to.lane}:${to.positionM}`;
    let ways = depotWayCache.get(key);
    if (!ways) {
      ways = [];
      for (const depot of network!.depots) {
        const plan = planWay(depot, to);
        if (plan) ways.push({ depot, plan });
      }
      ways.sort((a, b) => a.plan.lengthM - b.plan.lengthM);
      depotWayCache.set(key, ways);
    }
    return ways;
  }

  const homeDepots = network?.depots.flatMap((depot) => {
    const other = turned(depot);
    return other ? [depot, other] : [depot];
  });
  /** Head for the base that needs the least driving, from either side of its road. */
  function homeWay(from: ServicePoint) {
    let best: DepotWay | null = null;
    for (const depot of homeDepots!) {
      if (
        best &&
        Math.hypot(from.pos.x - depot.pos.x, from.pos.y - depot.pos.y) >= best.plan.lengthM
      )
        continue;
      const plan = planWay(from, depot, false, false);
      if (plan && (!best || plan.lengthM < best.plan.lengthM)) best = { plan, depot };
    }
    return best;
  }

  /** The cheapest way over the lanes, turning round at the start, before the end, or both
   * where a road has a lane each way; null when there is none. */
  function planWay(from: ServicePoint, to: ServicePoint, endTurn = true, cache = true) {
    const lane = compiled.lanes[to.lane]!;
    const beforeM = to.positionM - 14;
    const before =
      beforeM >= 0
        ? {
            lane: to.lane,
            positionM: beforeM,
            pos: pointAtDistance(lane.polyline, lane.cumulative, beforeM),
          }
        : null;
    const starts = [{ at: from, turn: null as ServicePoint | null }];
    const turnedFrom = turned(from);
    if (turnedFrom) starts.push({ at: turnedFrom, turn: turnedFrom });
    const ends = [{ at: to, turn: null as ServicePoint | null }];
    const turnedBefore = endTurn && before && turned(before);
    if (endTurn && before && turnedBefore) ends.push({ at: turnedBefore, turn: before });
    let best: {
        start: (typeof starts)[number];
        end: (typeof ends)[number];
        steps: ServiceStep[];
      } | null = null,
      bestM = Infinity;
    for (const start of starts)
      for (const end of ends) {
        const steps =
          start.at.lane === end.at.lane && start.at.positionM === end.at.positionM
            ? []
            : cache
              ? route(start.at, end.at)
              : serviceRoute(compiled, network!, start.at, end.at);
        if (!steps) continue;
        const lengthM =
          routeLength(network!, steps) +
          (start.turn ? TURN_COST_M : 0) +
          (end.turn ? TURN_COST_M : 0);
        if (lengthM < bestM) [best, bestM] = [{ start, end, steps }, lengthM];
      }
    return best && { ...best, lengthM: bestM };
  }

  function addWay(
    builder: PathBuilder,
    way: NonNullable<ReturnType<typeof planWay>>,
    from: ServicePoint,
    to: ServicePoint,
  ) {
    if (way.start.turn) addTurn(builder, from, way.start.turn);
    addRoute(builder, way.steps);
    if (way.end.turn) {
      addTurn(builder, way.end.at, way.end.turn);
      addRoute(builder, [
        { kind: 'lane', lane: to.lane, fromM: way.end.turn.positionM, toM: to.positionM },
      ]);
    }
  }

  const entryPaths = new WeakMap<StandWay, Map<ServicePoint, Path>>();
  function inbound(turn: Turn, way: StandWay, { depot, plan }: DepotWay) {
    let paths = entryPaths.get(way);
    if (!paths) entryPaths.set(way, (paths = new Map()));
    const cached = paths.get(depot);
    if (cached) return cached;
    const access = turn.access!;
    const builder = new PathBuilder();
    addWay(builder, plan, depot, access);
    const entryS = builder.lengthM;
    const head = [access.pos, ...way.approach(access.pos)];
    const entry = [...head, ...way.entry.slice(way.lead)];
    const reverseFrom = way.reverseFrom - way.lead + head.length;
    if (reverseFrom < entry.length) {
      addOwn(builder, entry.slice(0, reverseFrom + 1), turn.stand);
      const reverseS = builder.lengthM;
      builder.add(entry.slice(reverseFrom), ownKey--, 0, FINAL_MPS);
      builder.reverse = [reverseS, builder.lengthM];
    } else addOwn(builder, entry, turn.stand);
    builder.finalM = 12;
    builder.holds.push({ kind: 'stand', stand: turn.stand, atS: entryS, untilS: builder.lengthM });
    const path = builder.build();
    paths.set(depot, path);
    return path;
  }

  /** The way from a position (or anywhere off the lanes) back to a base, through `merge`. */
  function outbound(points: Vec2[], merge: ServicePoint, stand: number, holdStand: boolean) {
    const home = homeWay(merge);
    if (!home) return null;
    const builder = new PathBuilder();
    addOwn(builder, points, stand);
    const mergeS = builder.lengthM;
    if (holdStand) builder.holds.push({ kind: 'stand', stand, atS: 0, untilS: mergeS + 2 });
    // It waits for the lane before its body reaches it.
    const lane = compiled.lanes[merge.lane]!;
    const own = cumulativeLengths(builder.points);
    let atS = Math.max(0, mergeS - 3);
    for (let at = 0; at < mergeS; at += 1) {
      const p = pointAtDistance(builder.points, own, at);
      if (nearestOnPolyline(lane.polyline, p).away < lane.widthM / 2 + 3) {
        atS = Math.max(0, at - 1);
        break;
      }
    }
    builder.holds.push({
      kind: 'merge',
      lane: merge.lane,
      laneM: merge.positionM,
      atS,
      untilS: mergeS,
    });
    addWay(builder, home.plan, merge, home.depot);
    return builder.build();
  }

  // ------------------------------------------------------------------ aircraft and the timeline

  function read(timeS: number) {
    aircraft = source.snapshot();
    byId.clear();
    for (const a of aircraft) byId.set(a.id, a);
    parkedBoxes = [];
    parkedOwners = [];
    for (const a of aircraft) {
      if (!standing(a.state)) continue;
      for (const box of aircraftHull(typeById.get(a.typeId)!, a.visual ?? a)) {
        parkedBoxes.push(box);
        parkedOwners.push(a);
      }
    }
    space = movementBoxes(timeS);
    for (const event of source.drainTurnarounds()) {
      if (event.kind === 'off-block') {
        const turn = turns.get(event.id);
        if (turn) turn.gone = true;
        readyOf.delete(event.id);
        towOf.delete(event.id);
        continue;
      }
      // TASK-350: a tow done (on block at its new stand) is no longer due.
      if (event.kind === 'on-block') towOf.delete(event.id);
      const type = typeById.get(event.typeId)!;
      if (event.kind === 'tow-planned') {
        // A tow: the tug comes as for a pushback, couples and stays on to the new stand. One
        // announced as the aircraft comes (TASK-356) waits at the nose before it parks.
        if (!event.arriving) towOf.set(event.id, event.timeS);
        if (!network?.stands[event.stand] || !pushes[event.stand]) continue;
        const tug = {
          slot: 'tug' as const,
          kind: 'tug' as const,
          arriveS: Math.max(
            timeS + MIN,
            event.timeS - (event.arriving ? TOW_TUG_BEFORE_S : TUG_BEFORE_READY_S),
          ),
          leaveS: Infinity,
          carts: 0,
          state: 'planned' as const,
        };
        counts.turnarounds++;
        counts.visits++;
        dropPendingRetries(turns.get(event.id));
        turns.set(event.id, {
          aircraft: event.id,
          stand: event.stand,
          type,
          onBlockS: timeS,
          readyS: event.timeS,
          visits: [tug],
          ways: null,
          gone: false,
          ...(event.arriving && { comingS: event.timeS }),
        });
        continue;
      }
      readyOf.set(event.id, event.readyS);
      if (!network?.stands[event.stand] || type.performance.kind !== 'fixedWing') continue;
      const stand = graph.stands[event.stand]!;
      const visits = turnaroundVisits(
        type,
        stand.kind,
        event.timeS,
        event.readyS,
        event.arrived,
        pushes[event.stand]!,
      ).map((v) => ({ ...v, state: 'planned' as const }));
      counts.turnarounds++;
      counts.visits += visits.length;
      dropPendingRetries(turns.get(event.id));
      turns.set(event.id, {
        aircraft: event.id,
        stand: event.stand,
        type,
        onBlockS: event.timeS,
        readyS: event.readyS,
        visits,
        ways: null,
        gone: false,
        ...(nextReadS === -Infinity && !event.arrived && { atStart: true }),
      });
    }
    for (const turn of turns.values()) {
      if (turn.comingS === undefined) continue;
      const pose = byId.get(turn.aircraft);
      if (pose && standing(pose.state) && pose.stand === graph.stands[turn.stand]!.id)
        turn.comingS = undefined;
    }
    // Pushbacks: attach a waiting tug; count a push its tug missed.
    for (const a of aircraft) {
      const before = lastState.get(a.id);
      lastState.set(a.id, a.state);
      if (a.state === 'tow') towOf.delete(a.id);
      // TASK-319: the tug couples when the aircraft is ready for pushback (or pushes at once).
      if (!pushing(a.state) || (before !== undefined && pushing(before))) continue;
      counts.pushbacks++;
      const tug = tugAt.get(a.id);
      if (tug && tug.phase === 'serving') {
        tug.phase = 'attached';
        tug.v = 0;
      } else {
        counts.tugsMissing++;
        const turn = turns.get(a.id);
        const visit = turn?.visits.find((v) => v.slot === 'tug');
        const unannounced = !turn || turn.gone || !visit;
        if (unannounced) counts.unannounced++;
        tally(
          counts.missingTugsBy,
          unannounced
            ? 'unannounced'
            : tug?.phase === 'in' && tug.visit === visit
              ? delayCause(tug)
              : (visit.cause ?? (visit.state === 'done' ? 'left-position' : 'awaiting-dispatch')),
        );
      }
    }
    for (const id of lastState.keys()) if (!byId.has(id)) lastState.delete(id);
    for (const [id, turn] of turns)
      if (
        turn.comingS !== undefined
          ? timeS > turn.comingS + COMING_WAIT_S
          : turn.gone || !byId.has(id)
      ) {
        if (
          turn.visits.every((v) => v.state === 'done' || v.state === 'dropped') ||
          !byId.has(id)
        ) {
          dropPendingRetries(turn);
          turns.delete(id);
        }
      }
    // A vehicle on its way to a visit that can no longer be served turns back on the lanes.
    for (const vehicle of [...vehicles]) {
      if (vehicle.phase !== 'in' || standHolder.get(vehicle.stand) === vehicle.id) continue;
      const pose = byId.get(vehicle.turn!.aircraft);
      if (pose?.state === 'parked' && timeS < vehicle.visit!.leaveS - MIN) continue;
      if (vehicle.turn!.comingS !== undefined) continue;
      const e = elementOf(vehicle);
      if (!e || e.key < 0 || e.toS > vehicle.path.holds.find((h) => h.kind === 'stand')!.atS + 1e-6)
        continue;
      const lane = compiled.lanes[e.key]!;
      const laneM = Math.min(lane.lengthM, e.offsetM + (vehicle.s - e.fromS));
      const here = { lane: e.key, positionM: laneM, pos: vehicle.pos };
      const home = homeWay(here);
      if (!home) continue;
      const builder = new PathBuilder();
      addWay(builder, home.plan, here, home.depot);
      drop(vehicle.visit!, delayCause(vehicle));
      // A vehicle still at its depot has no return leg to drive.
      if (!builder.points.length) {
        remove(vehicle);
        continue;
      }
      const path = builder.build();
      release(vehicle);
      vehicle.path = path;
      vehicle.detours = 0;
      vehicle.lookS = 0;
      vehicle.s = 0;
      vehicle.phase = 'out';
      vehicle.committedS = path.zones.find((z) => z.fromM <= 0.5)?.toM ?? -1;
    }
    nextReadS = timeS + READ_S;
  }

  /** Whether an aircraft has come to stand over a vehicle (parked onto it). */
  function underHull(vehicle: Vehicle) {
    const boxes = bodyBoxes(vehicle);
    return parkedBoxes.some(
      (hull) =>
        Math.hypot(hull.x - vehicle.pos.x, hull.y - vehicle.pos.y) < hull.lengthM / 2 + 20 &&
        boxes.some((box) => boxesOverlap(box, hull)),
    );
  }

  /** Whether a vehicle stands in space an aircraft movement may sweep: `imminent`, the near part
   * of any aircraft's movement (its own aircraft's too: a coupled tug is part of the aircraft);
   * otherwise any due space of another aircraft. */
  function inSpace(vehicle: Vehicle, imminent: boolean, pushOnly = false) {
    const own = vehicle.turn?.aircraft ?? -1;
    // TASK-356: a tug at the nose its aircraft parks short of (its way into the stand ends there).
    const atNose = vehicle.kind === 'tug' && vehicle.phase === 'serving';
    const boxes = bodyBoxes(vehicle);
    const reach = vehicle.lengthM / 2 + vehicle.carts * 4 + 2;
    return space.some(
      (b) =>
        (imminent
          ? b.imminent &&
            !(b.aircraft === own && (atNose || nowS < vehicle.detachedS + TUG_CLEAR_S))
          : b.aircraft !== own) &&
        Math.abs(b.box.x - vehicle.pos.x) < (b.box.lengthM + b.box.widthM) / 2 + reach &&
        Math.abs(b.box.y - vehicle.pos.y) < (b.box.lengthM + b.box.widthM) / 2 + reach &&
        boxes.some((box) => boxesOverlap(box, b.box)) &&
        (!pushOnly || ['pushback', 'tow'].includes(byId.get(b.aircraft)?.state ?? '')),
    );
  }

  /** The fleet's movement space as plan boxes (TASK-299's body parts, 1.5 m all round). A
   * parked aircraft's planned push is due from 5 minutes before it is ready to push or to be
   * towed; a push under way, an arrival's way into its stand and a moving aircraft's way ahead
   * always are. The near part (the next 3 s, at least 15 m) of a moving aircraft is imminent. */
  function movementBoxes(timeS: number) {
    const boxes: typeof space = [];
    boundPose.clear();
    for (const { id, kind, bodies, aheadM } of source.movementSpace()) {
      const pose = byId.get(id);
      if (kind === 'bound') {
        const end = bodies.at(-1)!;
        boundPose.set(id, { x: end.x, y: end.y, heading: Math.atan2(end.s, end.c) });
      }
      let due = kind !== 'push' || (pose !== undefined && !standing(pose.state));
      let soon = due;
      if (!due && pose) {
        const ready = Math.min(readyOf.get(id) ?? Infinity, towOf.get(id) ?? Infinity);
        due = pose.state === 'ready-for-pushback' || ready <= timeS + CLEAR_BEFORE_READY_S;
        soon = pose.state === 'ready-for-pushback' || ready <= timeS + CROSS_BEFORE_S;
      }
      if (!due) continue;
      const near = Math.max(15, 3 * (pose?.speedMps ?? 0));
      bodies.forEach((body, i) => {
        const imminent =
          (kind === 'moving' && (aheadM?.[i] ?? 0) <= near) ||
          (kind === 'push' && pose !== undefined && !standing(pose.state));
        for (const part of bodyBoxes3(body))
          boxes.push({ aircraft: id, box: part, due, imminent, soon });
      });
    }
    return boxes;
  }

  /** Parked hulls of every aircraft but one, for the stand ways. */
  function parkedHulls(except: number) {
    const boxes: PlanBox[] = [];
    for (const a of aircraft) {
      if (a.id === except || a.heightM > 1) continue;
      const type = typeById.get(a.typeId)!;
      boxes.push(...aircraftHull(type, a.visual ?? a));
    }
    return boxes;
  }

  function dispatch(timeS: number) {
    for (const turn of turns.values()) {
      for (const visit of turn.visits) {
        if (visit.state !== 'planned' || timeS < (visit.retryAtS ?? -Infinity)) continue;
        const access = network!.stands[turn.stand]!;
        const plan = depotWays(turn.access ?? access)[0]?.plan;
        const leadS = (plan?.lengthM ?? 0) / 6 + 60;
        const placed = turn.atStart && visit.slot === 'tug';
        if (timeS < visit.arriveS - leadS && !placed) continue;
        const pose = byId.get(turn.aircraft);
        // TASK-356: the tug for a tow as the aircraft parks goes while it is still in the air,
        // laid out round the pose it is to park in.
        let parkAt: { x: number; y: number; heading: number } | undefined = pose?.visual ?? pose;
        if (turn.comingS !== undefined && plan) {
          parkAt = boundPose.get(turn.aircraft);
          if (!parkAt || !pose?.airborne) {
            visit.cause = 'arrival-not-ready';
            continue;
          }
        } else if (
          !plan ||
          turn.gone ||
          !pose ||
          pose.state !== 'parked' ||
          timeS >= visit.leaveS - MIN
        ) {
          drop(
            visit,
            !plan
              ? 'no-way'
              : (visit.cause ??
                  (timeS >= visit.leaveS - MIN && pose?.state === 'parked'
                    ? 'late'
                    : 'aircraft-left')),
          );
          continue;
        }
        if (!turn.ways) {
          // Ways out join the lane after the access point, where the lane is clear of the hull.
          const hull = aircraftHull(turn.type, parkAt!);
          const lane = compiled.lanes[access.lane]!;
          let merge = mergePoint(access);
          for (
            let at = merge.positionM;
            at <= Math.min(lane.lengthM, access.positionM + 60);
            at += 3
          ) {
            const pos = pointAtDistance(lane.polyline, lane.cumulative, at);
            merge = { lane: access.lane, positionM: at, pos };
            if (hull.every((box) => boxDistance(pos, box) > 6)) break;
          }
          turn.merge = merge;
          // TASK-350: an access point under the hull (a tail over the lane) moves back along
          // the lane to where the lane is clear of it.
          let entry = access;
          for (
            let at = access.positionM;
            at >= Math.max(ACCESS_BEFORE_M, access.positionM - 45);
            at -= 3
          ) {
            const pos = pointAtDistance(lane.polyline, lane.cumulative, at);
            if (hull.every((box) => boxDistance(pos, box) > 6)) {
              entry = at === access.positionM ? access : { lane: access.lane, positionM: at, pos };
              break;
            }
          }
          turn.access = entry;
          turn.ways = standWays(
            turn.type,
            parkAt!,
            turn.visits,
            entry.pos,
            merge.pos,
            parkedHulls(turn.aircraft),
          );
        }
        const way = turn.ways.get(visit.slot);
        if (!way) {
          drop(visit, 'no-room');
          continue;
        }
        const ways = depotWays(turn.access!);
        const first = ways[0];
        if (!first) {
          drop(visit, 'no-way');
          continue;
        }
        if (!placed && timeS < visit.arriveS - first.plan.lengthM / 6 - 60) continue;
        let path: Path | undefined;
        let canReach = false;
        const limitM =
          visit.retryAtS === undefined ? Infinity : (retryDeadline(turn, visit) - timeS - MIN) * 6;
        for (const candidate of ways) {
          // A free base can substitute without sending the vehicle on a long detour.
          if (candidate.plan.lengthM > first.plan.lengthM + 540) break;
          const entry = inbound(turn, way, candidate);
          if (entry.lengthM >= limitM) continue;
          canReach = true;
          if (placed || startClear(entry, visit.kind, visit.carts)) {
            path = entry;
            break;
          }
        }
        if (!path) {
          if (canReach) visit.cause = 'depot-queue';
          else drop(visit, visit.cause!);
          continue;
        }
        visit.state = 'sent';
        spawn(visit.kind, visit.carts, path, turn, visit);
        if (placed) {
          // The first departures of a run: the tug stands at the nose from the start.
          const tug = vehicles.at(-1)!;
          tug.s = path.lengthM;
          place(tug);
          arrive(tug);
        }
      }
    }
  }

  /** Room for a vehicle (with its carts behind) at the start of a path, 1 m all round. */
  function startClear(path: Path, kind: GroundVehicleKind, carts: number) {
    const size = groundVehicleSizes[kind];
    const heading = headingAtDistance(path.points, path.cumulative, 0);
    const back = carts * (baggageCart.lengthM + baggageCart.gapM);
    const p = path.points[0]!;
    const room = {
      x: p.x - (Math.cos(heading) * back) / 2,
      y: p.y - (Math.sin(heading) * back) / 2,
      heading,
      lengthM: size.lengthM + back + 2,
      widthM: size.widthM + 2,
    };
    return !vehicles.some(
      (v) => v.phase !== 'attached' && bodyBoxes(v).some((b) => boxesOverlap(room, b)),
    );
  }

  function spawn(
    kind: GroundVehicleKind,
    carts: number,
    path: Path,
    turn: Turn,
    visit: Vehicle['visit'],
  ) {
    const size = groundVehicleSizes[kind];
    const vehicle: Vehicle = {
      id: nextId++,
      kind,
      lengthM: size.lengthM,
      widthM: size.widthM,
      carts,
      path,
      s: 0,
      v: 0,
      phase: 'in',
      turn,
      visit,
      committedS: -1,
      nodes: new Map(),
      stand: turn.stand,
      pos: path.points[0]!,
      heading: headingAtDistance(path.points, path.cumulative, 0),
      trail: [],
      stoppedS: nowS,
      yieldZone: null,
      blockedBy: -1,
      detours: 0,
      lookS: 0,
      lookLimitS: Infinity,
      reason: '',
      lookReason: '',
      detachedS: -Infinity,
    };
    // A base inside a zone: the vehicle starts committed to it.
    for (const z of path.zones) if (z.fromM <= 0.5) vehicle.committedS = z.toM;
    vehicles.push(vehicle);
    if (kind === 'tug') tugAt.set(turn.aircraft, vehicle);
    counts.peakActive = Math.max(counts.peakActive, vehicles.length);
  }

  // ------------------------------------------------------------------ giving way

  /** Whether an aircraft comes through a zone, or may start to: a moving aircraft near it or
   * routed through it, a parked one about to push at its edge. */
  function zoneClosed(zone: PathZone, path: Path, own = -1) {
    if (!zone.samples) {
      zone.samples = [];
      for (let s = zone.fromM; s < zone.toM + 2; s += 4)
        zone.samples.push(pointAtDistance(path.points, path.cumulative, Math.min(s, zone.toM)));
    }
    for (const a of aircraft) {
      // Its own aircraft, parked, does not hold a vehicle in or out of its stand.
      if (a.heightM > 60 || (a.id === own && standing(a.state))) continue;
      const type = typeById.get(a.typeId)!;
      const radius = Math.max(type.lengthM, type.spanM) / 2;
      let d = Infinity;
      for (const p of zone.samples) d = Math.min(d, Math.hypot(p.x - a.x, p.y - a.y));
      // A parked aircraft starts its push slowly (under 1 m/s2): a vehicle in a zone clears it
      // first; once it moves it closes the zones near it.
      if (a.state === 'parked') continue;
      if (d < radius + 30) return true;
      if (
        d < Math.max(250, 40 * a.speedMps) + radius &&
        a.route.some((e) => zone.edges.includes(e))
      )
        return true;
    }
    return false;
  }

  function holdBlocker(vehicle: Vehicle, hold: Hold) {
    if (hold.kind === 'node') {
      const holder = nodeHolder.get(hold.node);
      return holder === undefined || holder === vehicle.id ? -1 : holder;
    }
    if (hold.kind === 'stand')
      return standFree(vehicle, hold.stand) ? -1 : standHolder.get(hold.stand)!;
    // A merge: nobody on the lane at the point, nor coming within 60 m of it, but for those
    // about to turn off to this stand before the point.
    for (const other of vehicles) {
      if (other === vehicle) continue;
      if (
        other.path.holds.some(
          (h) => h.kind === 'stand' && h.stand === vehicle.stand && h.atS > other.s,
        )
      )
        continue;
      const e = elementOf(other);
      if (!e || e.key !== hold.lane) continue;
      const laneM = e.offsetM + (other.s - e.fromS);
      const reach = other.lengthM / 2 + other.carts * (baggageCart.lengthM + baggageCart.gapM);
      const around = hold.wide ? 15 : 4;
      if (
        laneM + other.lengthM / 2 + around > hold.laneM &&
        laneM - reach < hold.laneM + vehicle.lengthM + around
      )
        return other.id;
      // One coming up the lane, not one standing in a queue behind the point.
      if (laneM > hold.laneM - 60 && laneM < hold.laneM && other.v > 0.5) return other.id;
    }
    return -1;
  }

  /** One mover at a time on a stand's ways; a mover held up for 20 s lets the others go. */
  function standFree(vehicle: Vehicle, stand = vehicle.stand) {
    const holder = standHolder.get(stand);
    if (holder === undefined || holder === vehicle.id) return true;
    const other = vehicles.find((v) => v.id === holder);
    return !other || (other.stoppedS > 0 && nowS - other.stoppedS > 20);
  }

  function acquire(vehicle: Vehicle, hold: Hold) {
    if (hold.kind === 'node') {
      nodeHolder.set(hold.node, vehicle.id);
      vehicle.nodes.set(hold.occurrence, hold);
    } else if (hold.kind === 'stand') standHolder.set(hold.stand, vehicle.id);
  }

  const elementOf = (vehicle: Vehicle) =>
    vehicle.path.elements.find((e) => vehicle.s >= e.fromS && vehicle.s <= e.toS) ?? null;

  /** Occupancy by element key: each vehicle on the elements its front and back stand on. */
  function occupancy() {
    const map = new Map<number, Vehicle[]>();
    for (const vehicle of vehicles) {
      if (vehicle.phase === 'attached' || vehicle.phase === 'serving') continue;
      const keys = new Set<number>();
      const extent = vehicle.lengthM / 2 + vehicle.carts * (baggageCart.lengthM + baggageCart.gapM);
      for (const s of [vehicle.s + vehicle.lengthM / 2, vehicle.s, vehicle.s - extent]) {
        const e = vehicle.path.elements.find((x) => s >= x.fromS && s <= x.toS);
        if (e) keys.add(e.key);
      }
      for (const key of keys) {
        const list = map.get(key);
        if (list) list.push(vehicle);
        else map.set(key, [vehicle]);
      }
    }
    return map;
  }

  /** Free distance ahead of the vehicle's front to the nearest vehicle's back on its way. */
  function gapAhead(vehicle: Vehicle, occupied: Map<number, Vehicle[]>, lookM: number) {
    const front = vehicle.s + vehicle.lengthM / 2;
    let gap = Infinity;
    leader = -1;
    for (const e of vehicle.path.elements) {
      if (e.toS < vehicle.s - vehicle.lengthM) continue;
      if (e.fromS > front + lookM) break;
      if (e.key < -1e5) continue;
      for (const other of occupied.get(e.key) ?? []) {
        if (other === vehicle) continue;
        const oe = other.path.elements.find(
          (x) =>
            x.key === e.key &&
            other.s >= x.fromS - other.lengthM &&
            other.s <= x.toS + other.lengthM,
        );
        if (!oe) continue;
        const otherLocal = oe.offsetM + (other.s - oe.fromS);
        const mine = e.fromS + (otherLocal - e.offsetM);
        if (mine <= vehicle.s) continue;
        const back =
          mine - other.lengthM / 2 - other.carts * (baggageCart.lengthM + baggageCart.gapM);
        if (back - front < gap) [gap, leader] = [back - front, other.id];
      }
    }
    return gap;
  }
  let leader = -1;

  // ------------------------------------------------------------------ motion

  function move(vehicle: Vehicle, dtS: number, occupied: Map<number, Vehicle[]>) {
    vehicle.reason = '';
    vehicle.blockedBy = -1;
    const path = vehicle.path;
    const front = vehicle.s + vehicle.lengthM / 2;
    const brake = (vehicle.v * vehicle.v) / (2 * DECEL) + vehicle.v * dtS + 0.5;
    let stopS = path.lengthM - vehicle.s;
    const look = brake + 25;
    // Gates ahead in order: zones and holds.
    const gates: ({ zone: PathZone; atS: number } | { hold: Hold; atS: number })[] = [];
    for (const zone of path.zones)
      if (zone.toM > vehicle.committedS && zone.fromM > front - 0.01 && zone.fromM < front + look)
        gates.push({ zone, atS: zone.fromM });
    for (const hold of path.holds) {
      if (hold.atS < front - 0.01 || hold.atS > front + look) continue;
      if (hold.kind === 'node' && vehicle.nodes.has(hold.occurrence)) continue;
      if (hold.kind === 'stand' && standHolder.get(hold.stand) === vehicle.id) continue;
      if (hold.atS <= vehicle.committedS) continue;
      gates.push({ hold, atS: hold.atS });
    }
    gates.sort((a, b) => a.atS - b.atS);
    const admission: { atS: number; inside: Hold[]; commitS: number }[] = [];
    for (const gate of gates) {
      let blocker = -1;
      let reason = '';
      let inside: Hold[];
      let commitS = -1;
      if ('zone' in gate) {
        const clearTo = gate.zone.toM + vehicle.lengthM + 3 + vehicle.carts * 4;
        inside = path.holds.filter((h) => h.atS >= gate.atS - 0.01 && h.atS <= clearTo);
        const closed = zoneClosed(gate.zone, path, vehicle.turn?.aircraft ?? -1);
        if (closed) reason = 'zone-closed';
        else {
          for (const hold of inside) {
            blocker = holdBlocker(vehicle, hold);
            if (blocker >= 0) break;
          }
          if (
            blocker < 0 &&
            gapAhead(vehicle, occupied, clearTo - front + 5) <=
              Math.min(clearTo, path.lengthM) - front
          )
            blocker = leader;
          if (blocker >= 0) reason = 'zone-exit';
        }
        commitS = Math.max(gate.zone.toM, ...inside.map((h) => h.atS));
        if (closed && vehicle.yieldZone !== gate.zone) {
          vehicle.yieldZone = gate.zone;
          counts.yields++;
        }
      } else {
        // A junction: only with room beyond it, so nobody holds one while waiting.
        const clearTo = Math.min(
          path.lengthM,
          gate.hold.untilS + vehicle.lengthM + 3 + vehicle.carts * 4,
        );
        blocker = holdBlocker(vehicle, gate.hold);
        if (
          blocker < 0 &&
          gate.hold.kind === 'node' &&
          gapAhead(vehicle, occupied, clearTo - front + 5) <= clearTo - front
        )
          blocker = leader;
        if (blocker >= 0) reason = 'hold-' + gate.hold.kind;
        inside = [gate.hold];
      }
      if (reason) {
        stopS = Math.min(stopS, gate.atS - 0.5 - front);
        vehicle.reason = reason;
        vehicle.blockedBy = blocker;
        break;
      }
      if (front + brake >= gate.atS - 0.5) admission.push({ atS: gate.atS, inside, commitS });
      else break;
    }
    // A parked aircraft over the way (a tail across a service road): drive round its end, or
    // hold short of it. A vehicle's own aircraft has its ways laid round it.
    if (nowS >= vehicle.lookS) {
      vehicle.lookS = nowS + LOOK_EVERY_S;
      const limit = lookAhead(vehicle, look + LOOK_EVERY_S * vehicle.v);
      if (limit === 'detour') return move(vehicle, dtS, occupied);
      vehicle.lookLimitS = vehicle.s + limit;
    }
    if (vehicle.lookLimitS - vehicle.s < stopS) {
      stopS = vehicle.lookLimitS - vehicle.s;
      vehicle.reason = vehicle.lookReason;
      vehicle.blockedBy = vehicle.lookBlockedBy ?? -1;
    }
    const gap = gapAhead(vehicle, occupied, look);
    if (gap - GAP_M < stopS) {
      stopS = gap - GAP_M;
      vehicle.blockedBy = leader;
      vehicle.reason = 'gap';
    }
    finish(vehicle, dtS, stopS);
    // A vehicle halted before a junction by a closer obstacle cannot reserve it.
    for (const { atS, inside, commitS } of admission)
      if (vehicle.s + vehicle.lengthM / 2 > atS - 0.5) {
        for (const hold of inside) acquire(vehicle, hold);
        vehicle.committedS = Math.max(vehicle.committedS, commitS);
      }
  }

  /** Free distance on the vehicle's way before a parked aircraft's hull (round which it may
   * turn off: 'detour') or another vehicle's body; checked every half second. */
  function lookAhead(vehicle: Vehicle, look: number): number | 'detour' {
    let limit = Infinity;
    vehicle.lookReason = '';
    vehicle.lookBlockedBy = -1;
    // TASK-350: its own aircraft's hull too where the way runs on the lanes (a tail over the
    // apron road before the stand's access point).
    // TASK-356: a tug that let go of its aircraft after a tow drives off round it (`detach`).
    const own =
      vehicle.turn && (vehicle.phase !== 'out' || vehicle.detachedS > -Infinity)
        ? vehicle.turn.aircraft
        : -1;
    const nearby: number[] = [];
    for (let k = 0; k < parkedBoxes.length; k++) {
      const box = parkedBoxes[k]!;
      if (Math.hypot(box.x - vehicle.pos.x, box.y - vehicle.pos.y) < look + box.lengthM / 2 + 10)
        nearby.push(k);
    }
    const onLanes = (s: number) =>
      (vehicle.path.elements.find((e) => s >= e.fromS && s <= e.toS)?.key ?? -2e6) > -1e5;
    for (let d = 1; nearby.length && d <= look; d += 1) {
      const box = boxAt(vehicle, d, 0.5);
      if (!box) break;
      const k = nearby.find(
        (k) =>
          (parkedOwners[k]!.id !== own || onLanes(vehicle.s + d)) &&
          boxesOverlap(box, parkedBoxes[k]!),
      );
      if (k === undefined) continue;
      if (detour(vehicle, vehicle.s + d + vehicle.lengthM / 2, parkedOwners[k]!)) return 'detour';
      if (d - 1.5 < limit) vehicle.lookReason = 'hull';
      limit = Math.min(limit, d - 1.5);
      break;
    }
    // Space an aircraft movement may sweep (the fleet's): hold short of it. Its own aircraft's
    // movements are timed against its visit; the tug couples to them.
    const ownAircraft = vehicle.turn?.aircraft ?? -1;
    const here0 = boxAt(vehicle, 0, 0.3)!;
    const reach = look + 60;
    const swept = space.filter(
      (b) =>
        b.aircraft !== ownAircraft &&
        b.soon &&
        Math.abs(b.box.x - vehicle.pos.x) < reach &&
        Math.abs(b.box.y - vehicle.pos.y) < reach &&
        !boxesOverlap(here0, b.box),
    );
    const radius = (b: PlanBox) => Math.hypot(b.lengthM, b.widthM) / 2;
    const radii = swept.map((b) => radius(b.box));
    for (let d = 1; swept.length && d <= look; d += 1) {
      const mine = boxAt(vehicle, d, 0.5);
      if (!mine) break;
      const r = radius(mine);
      const hit = swept.some(
        (b, i) =>
          Math.hypot(b.box.x - mine.x, b.box.y - mine.y) < r + radii[i]! &&
          boxesOverlap(mine, b.box),
      );
      if (hit) {
        if (d - 1.5 < limit) vehicle.lookReason = 'swept';
        limit = Math.min(limit, d - 1.5);
        break;
      }
    }
    // A vehicle standing at its position in the way: hold short of it. Moving vehicles give
    // way to each other by following, junctions, merges and one mover per stand, so no two can
    // wait for each other here.
    // Off the lanes it also holds short of a vehicle standing still in its way.
    const offLane = (elementOf(vehicle)?.key ?? -2e6) < -1e5;
    const others = vehicles.filter(
      (o) =>
        o !== vehicle &&
        (o.phase === 'serving' || (offLane && o.v < 0.1 && o.blockedBy !== vehicle.id)) &&
        Math.hypot(o.pos.x - vehicle.pos.x, o.pos.y - vehicle.pos.y) < look + 30,
    );
    if (others.length) {
      // Those it already touches (a base it starts at) do not hold it.
      const here = boxAt(vehicle, 0, 0.3)!;
      const boxes = others
        .map((o) => ({ o, boxes: bodyBoxes(o) }))
        .filter(({ boxes }) => !boxes.some((b) => boxesOverlap(here, b)));
      for (let d = 1; boxes.length && d <= look; d += 1) {
        const mine = boxAt(vehicle, d, 0.3);
        if (!mine) break;
        const hit = boxes.find(({ boxes }) => boxes.some((box) => boxesOverlap(mine, box)));
        if (hit) {
          if (hit.o.phase === 'serving' && rerouteTug(vehicle)) return 'detour';
          if (d - 1.5 < limit) {
            vehicle.lookReason = 'vehicle';
            vehicle.lookBlockedBy = hit.o.id;
          }
          limit = Math.min(limit, d - 1.5);
          break;
        }
      }
    }
    return limit;
  }

  /** TASK-350: a tug on its way round its aircraft that meets a vehicle at a neighbour's
   * position takes a new way from where it is to the nose, round the parked hulls and every
   * vehicle standing still. */
  function rerouteTug(vehicle: Vehicle) {
    const turn = vehicle.turn;
    const path = vehicle.path;
    if (vehicle.kind !== 'tug' || vehicle.phase !== 'in' || !turn || vehicle.detours >= 4)
      return false;
    if ((elementOf(vehicle)?.key ?? 0) > -1e5) return false;
    if (path.reverse && vehicle.s >= path.reverse[0] - 1) return false;
    const pose = byId.get(turn.aircraft);
    if (!pose || pose.state !== 'parked') return false;
    const still = vehicles
      .filter((o) => o !== vehicle && (o.phase === 'serving' || o.v < 0.1))
      .flatMap((o) => bodyBoxes(o));
    const merge = turn.merge ?? bestMerge(turn.stand);
    const tugVisit = { slot: 'tug', kind: 'tug', arriveS: 0, leaveS: Infinity, carts: 0 } as const;
    const way = standWays(turn.type, pose.visual ?? pose, [tugVisit], vehicle.pos, merge.pos, [
      ...parkedHulls(turn.aircraft),
      ...still,
    ]).get('tug');
    if (!way) return false;
    const builder = new PathBuilder();
    addOwn(builder, way.entry.slice(0, way.reverseFrom + 1), turn.stand);
    const reverseS = builder.lengthM;
    builder.add(way.entry.slice(way.reverseFrom), ownKey--, 0, FINAL_MPS);
    builder.reverse = [reverseS, builder.lengthM];
    builder.finalM = 12;
    builder.holds.push({ kind: 'stand', stand: turn.stand, atS: 0, untilS: builder.lengthM });
    const next = builder.build();
    replacePath(vehicle, next);
    vehicle.s = 0;
    vehicle.detours++;
    vehicle.lookS = 0;
    vehicle.committedS = next.zones.find((z) => z.fromM <= 0.5)?.toM ?? -1;
    return true;
  }

  function finish(vehicle: Vehicle, dtS: number, stopS: number) {
    const path = vehicle.path;
    const e = elementOf(vehicle);
    let limit = e?.speedMps ?? STAND_MPS;
    if (path.reverse && vehicle.s >= path.reverse[0] - 0.01) limit = FINAL_MPS;
    if (path.finalM && vehicle.s > path.lengthM - path.finalM)
      limit = Math.min(limit, FINAL_MPS + 1);
    const target = Math.min(limit, Math.sqrt(2 * DECEL * Math.max(0, stopS)));
    vehicle.v = stopS <= 0.05 ? 0 : Math.min(target, vehicle.v + ACCEL * dtS);
    let advance = stopS <= 0.05 ? Math.max(0, stopS) : Math.min(vehicle.v * dtS, stopS);
    // The last guard: no step that brings its body onto another vehicle's or a parked hull.
    if (advance > 0 && touches(vehicle, advance)) {
      vehicle.reason = 'guard';
      vehicle.blockedBy = guardBy?.id ?? -1;
      advance = 0;
      vehicle.v = 0;
    }
    if (advance > 0) {
      vehicle.s += advance;
      vehicle.stoppedS = 0;
    } else if (!vehicle.stoppedS) vehicle.stoppedS = nowS;
    place(vehicle);
    // Let go of junctions and the stand behind the back.
    const back =
      vehicle.s - vehicle.lengthM / 2 - vehicle.carts * (baggageCart.lengthM + baggageCart.gapM);
    for (const hold of vehicle.nodes.values()) if (back > hold.untilS) releaseNode(vehicle, hold);
    for (const hold of path.holds) {
      if (
        hold.kind === 'stand' &&
        back > hold.untilS &&
        hold.atS === 0 &&
        standHolder.get(hold.stand) === vehicle.id
      )
        standHolder.delete(hold.stand);
    }
  }

  let guardBy: Vehicle | null = null;
  const urgency = (v: Vehicle) => (v.phase !== 'in' ? 0 : v.kind === 'tug' ? 2 : 1);

  /** A queue behind an aircraft may clear on its own. A ring of mutually blocked vehicles
   * cannot: give way with a returning vehicle first, then service, then tugs. */
  function breakQueueCycles() {
    const waiting = new Map<number, Vehicle>();
    for (const v of vehicles)
      if (
        v.phase !== 'serving' &&
        v.phase !== 'attached' &&
        v.blockedBy >= 0 &&
        v.stoppedS > 0 &&
        nowS - v.stoppedS > GIVE_WAY_S
      )
        waiting.set(v.id, v);
    for (const start of waiting.values()) {
      const chain = new Set<number>();
      let v: Vehicle | undefined = start;
      while (v && !chain.has(v.id)) {
        chain.add(v.id);
        v = waiting.get(v.blockedBy);
      }
      if (v) {
        let victim = v;
        let next = waiting.get(v.blockedBy)!;
        while (next !== v) {
          if (
            urgency(next) < urgency(victim) ||
            (urgency(next) === urgency(victim) && next.id > victim.id)
          )
            victim = next;
          next = waiting.get(next.blockedBy)!;
        }
        counts.queueRelief++;
        withdraw(victim, true);
      }
      for (const id of chain) waiting.delete(id);
    }
  }

  function touches(vehicle: Vehicle, advance: number) {
    guardBy = null;
    const next = boxAt(vehicle, advance, 0.05);
    const now = boxAt(vehicle, 0, 0);
    if (!next || !now) return false;
    for (const o of vehicles) {
      if (o === vehicle || o.phase === 'attached') continue;
      if (Math.abs(o.pos.x - vehicle.pos.x) > 40 || Math.abs(o.pos.y - vehicle.pos.y) > 40)
        continue;
      for (const box of bodyBoxes(o))
        if (boxesOverlap(next, box) && !boxesOverlap(now, box)) {
          guardBy = o;
          return true;
        }
    }
    for (const box of parkedBoxes) {
      if (Math.abs(box.x - vehicle.pos.x) > 60 || Math.abs(box.y - vehicle.pos.y) > 60) continue;
      if (boxesOverlap(next, box) && !boxesOverlap(now, box)) return true;
    }
    return false;
  }

  /** A way round the end of a parked aircraft whose hull lies over the vehicle's way from
   * station `blockedS`: round its tail or nose, whichever the way meets, clear of every parked
   * hull; spliced into the vehicle's path. */
  function detour(vehicle: Vehicle, blockedS: number, owner: AircraftPoseSnapshot) {
    if (vehicle.detours >= 4) return false;
    const path = vehicle.path;
    const type = typeById.get(owner.typeId)!;
    const pose = owner.visual ?? owner;
    const hull = aircraftHull(type, pose);
    const margin = vehicle.widthM / 2 + 0.5;
    const blocked = (s: number) => {
      const p = pointAtDistance(path.points, path.cumulative, s);
      return hull.some((box) => boxDistance(p, box) < margin);
    };
    let lastS = blockedS;
    for (let s = blockedS; s < Math.min(path.lengthM, blockedS + 150); s += 1)
      if (blocked(s)) lastS = s;
    const reach = vehicle.lengthM / 2 + vehicle.carts * (baggageCart.lengthM + baggageCart.gapM);
    const fromS = Math.max(vehicle.s + 0.5, blockedS - vehicle.lengthM - 6);
    const toS = lastS + reach + 8;
    if (toS >= path.lengthM - 1) return false;
    if (squeezePast(vehicle, hull, blockedS, lastS, fromS, toS, margin)) return true;
    const f = { x: Math.cos(pose.heading), y: Math.sin(pose.heading) };
    const frame: Frame = { c: { x: pose.x, y: pose.y }, f, r: { x: -f.y, y: f.x } };
    const mid = pointAtDistance(path.points, path.cumulative, (blockedS + lastS) / 2);
    const end = (mid.x - pose.x) * f.x + (mid.y - pose.y) * f.y < 0 ? -1 : 1;
    const out = margin + 4;
    const half = Math.max(0.05 * type.lengthM, type.spanM / 6) + out;
    const start = pointAtDistance(path.points, path.cumulative, fromS);
    const finish = pointAtDistance(path.points, path.cumulative, toS);
    // Keep right of the way round, as on the road: the two directions pass 4 m apart.
    const travel = { x: finish.x - start.x, y: finish.y - start.y };
    const length = Math.hypot(travel.x, travel.y) || 1;
    const right = { x: (-travel.y / length) * 2, y: (travel.x / length) * 2 };
    const corners = [
      at(frame, end * (type.lengthM / 2 + out), half),
      at(frame, end * (type.lengthM / 2 + out), -half),
    ].map((c) => ({ x: c.x + right.x, y: c.y + right.y }));
    const near = (p: Vec2) => Math.hypot(p.x - start.x, p.y - start.y);
    if (near(corners[1]!) < near(corners[0]!)) corners.reverse();
    const points = [start, ...corners, finish];
    for (let i = 1; i < points.length; i++)
      for (const box of parkedBoxes)
        if (segmentNearBox(points[i - 1]!, points[i]!, box, margin - 0.2)) return false;
    const builder = new PathBuilder();
    const from = Math.max(0, vehicle.s - reach - 5);
    builder.addSlice(path, from, fromS);
    addOwn(builder, points, -1);
    builder.addSlice(path, toS, path.lengthM);
    const next = builder.build();
    vehicle.s -= from;
    vehicle.committedS -= from;
    replacePath(vehicle, next);
    vehicle.detours++;
    vehicle.lookS = 0;
    return true;
  }

  /** A hull that reaches a little over the way (a tailplane over a service road, an aircraft
   * parked across it at an angle): edge over to the side away from it, by the least of
   * `SQUEEZE_M` that clears it, and back, where that keeps clear of every parked hull. */
  function squeezePast(
    vehicle: Vehicle,
    hull: PlanBox[],
    blockedS: number,
    lastS: number,
    fromS: number,
    toS: number,
    margin: number,
  ) {
    const path = vehicle.path;
    const inS = blockedS - vehicle.lengthM / 2 - 1;
    if (inS - fromS < 6) return false;
    const outS = lastS + vehicle.lengthM / 2 + 1;
    const mid = pointAtDistance(path.points, path.cumulative, (blockedS + lastS) / 2);
    const h = headingAtDistance(path.points, path.cumulative, (blockedS + lastS) / 2);
    const left = { x: -Math.sin(h), y: Math.cos(h) };
    const centre = hull[0]!;
    const side = (centre.x - mid.x) * left.x + (centre.y - mid.y) * left.y > 0 ? -1 : 1;
    for (const shift of SQUEEZE_M) {
      const points: Vec2[] = [];
      for (let s = fromS; ; s = Math.min(toS, s + 1)) {
        const k = s < inS ? (s - fromS) / (inS - fromS) : s > outS ? (toS - s) / (toS - outS) : 1;
        const p = pointAtDistance(path.points, path.cumulative, s);
        const a = headingAtDistance(path.points, path.cumulative, Math.min(s, path.lengthM - 1e-3));
        const offset = side * shift * Math.min(1, Math.max(0, k));
        points.push({ x: p.x - Math.sin(a) * offset, y: p.y + Math.cos(a) * offset });
        if (s >= toS) break;
      }
      // The whole body clears the hull over the stretch it passes it.
      const clear = points.every(
        (p, i) => fromS + i < inS || hull.every((box) => boxDistance(p, box) >= margin),
      );
      if (!clear) continue;
      let ok = true;
      for (let i = 1; ok && i < points.length; i++)
        for (const box of parkedBoxes)
          if (segmentNearBox(points[i - 1]!, points[i]!, box, margin - 0.2)) {
            ok = false;
            break;
          }
      if (!ok) continue;
      const builder = new PathBuilder();
      const from = Math.max(0, vehicle.s - vehicle.lengthM / 2 - vehicle.carts * 4 - 5);
      builder.addSlice(path, from, fromS);
      addOwn(builder, points, -1);
      builder.addSlice(path, toS, path.lengthM);
      const next = builder.build();
      vehicle.s -= from;
      vehicle.committedS -= from;
      replacePath(vehicle, next);
      vehicle.detours++;
      vehicle.lookS = 0;
      return true;
    }
    return false;
  }

  function place(vehicle: Vehicle) {
    const path = vehicle.path;
    if (path.points.length < 2) {
      vehicle.pos = path.points[0] ?? vehicle.pos;
      return;
    }
    const pos = pointAtDistance(path.points, path.cumulative, vehicle.s);
    let heading = headingAtDistance(
      path.points,
      path.cumulative,
      Math.min(vehicle.s, path.lengthM - 1e-3),
    );
    if (path.reverse && vehicle.s >= path.reverse[0] - 1e-6) heading += Math.PI;
    const last = vehicle.trail.at(-1);
    if (vehicle.carts && (!last || Math.hypot(pos.x - last.x, pos.y - last.y) >= 0.5)) {
      vehicle.trail.push(pos);
      if (vehicle.trail.length > 80) vehicle.trail.shift();
    }
    vehicle.pos = pos;
    vehicle.heading = Math.atan2(Math.sin(heading), Math.cos(heading));
  }

  /** Keep only reservations represented on the spliced way, with their new clearance stations. */
  function replacePath(vehicle: Vehicle, path: Path) {
    for (const [occurrence, old] of vehicle.nodes) {
      const kept = path.holds.find(
        (hold): hold is NodeHold => hold.kind === 'node' && hold.occurrence === occurrence,
      );
      if (kept) vehicle.nodes.set(occurrence, kept);
      else releaseNode(vehicle, old);
    }
    vehicle.path = path;
  }

  function releaseNode(vehicle: Vehicle, { node, occurrence }: NodeHold) {
    vehicle.nodes.delete(occurrence);
    for (const hold of vehicle.nodes.values()) if (hold.node === node) return;
    if (nodeHolder.get(node) === vehicle.id) nodeHolder.delete(node);
  }

  function release(vehicle: Vehicle) {
    for (const hold of vehicle.nodes.values()) releaseNode(vehicle, hold);
    if (standHolder.get(vehicle.stand) === vehicle.id) standHolder.delete(vehicle.stand);
  }

  function arrive(vehicle: Vehicle) {
    const visit = vehicle.visit!;
    vehicle.phase = 'serving';
    vehicle.v = 0;
    visit.arrivedS = nowS;
    release(vehicle);
    const missed = nowS >= visit.leaveS - 30;
    if (missed) counts.missed++;
    else counts.served++;
    if (missed || nowS > visit.arriveS + 2 * MIN) {
      if (!missed) counts.late++;
      const cause = delayCause(vehicle);
      tally(counts.lateBy, cause);
      if (vehicle.kind === 'tug') tally(counts.lateTugsBy, cause);
    }
  }

  function leave(vehicle: Vehicle) {
    const turn = vehicle.turn!;
    const way = turn.ways!.get(vehicle.visit!.slot)!;
    const merge = turn.merge ?? bestMerge(turn.stand);
    const core = way.exit.slice(0, way.exit.length - way.tail);
    const path = outbound(
      [...core, ...way.approachOut(merge.pos), merge.pos],
      merge,
      turn.stand,
      true,
    );
    vehicle.visit!.state = 'done';
    if (!path)
      throw new Error(`ground vehicle ${vehicle.id}: no way back from stand ${turn.stand}`);
    vehicle.path = path;
    vehicle.detours = 0;
    vehicle.lookS = 0;
    vehicle.s = 0;
    vehicle.v = 0;
    vehicle.phase = 'out';
    vehicle.committedS = path.zones.find((z) => z.fromM <= 0.5)?.toM ?? -1;
  }

  /** The tug lets go where the push ended and drives off to the side, then to a base. */
  function detach(vehicle: Vehicle, pose: AircraftPoseSnapshot) {
    vehicle.detachedS = nowS;
    const visual = pose.visual ?? { ...pose, steering: 0 };
    const type = typeById.get(pose.typeId)!;
    const { noseX } = fixedWingGearStations(type.lengthM);
    const f = { x: Math.cos(visual.heading), y: Math.sin(visual.heading) };
    const g = {
      x: Math.cos(visual.heading + visual.steering),
      y: Math.sin(visual.heading + visual.steering),
    };
    const reach = type.lengthM / 2 - noseX + 0.85 + groundVehicleSizes.tug.lengthM / 2;
    const start = {
      x: visual.x + f.x * noseX + g.x * reach,
      y: visual.y + f.y * noseX + g.y * reach,
    };
    // After a tow, at the new stand: forward off the nose, then to that stand's lane.
    const towedTo =
      pose.state === 'parked' && pose.stand ? graph.index.stand.get(pose.stand) : undefined;
    const access = towedTo === undefined ? null : network!.stands[towedTo];
    if (towedTo !== undefined && access) {
      const merge = mergePoint(access);
      // Round the aircraft as a pushback's tug leaves it (the lane may lie past the tail).
      const tugVisit = {
        slot: 'tug',
        kind: 'tug',
        arriveS: 0,
        leaveS: Infinity,
        carts: 0,
      } as const;
      const way = standWays(
        type,
        visual,
        [tugVisit],
        access.pos,
        merge.pos,
        parkedHulls(pose.id),
      ).get('tug');
      const points = way
        ? [start, ...way.entry.slice(way.lead).reverse(), ...way.approachOut(merge.pos), merge.pos]
        : [start, { x: start.x + g.x * 6, y: start.y + g.y * 6 }, merge.pos];
      const path = outbound(points, merge, towedTo, false);
      if (path) {
        vehicle.path = path;
        vehicle.detours = 0;
        vehicle.lookS = 0;
        vehicle.s = 0;
        vehicle.v = 0;
        vehicle.phase = 'out';
        vehicle.stand = towedTo;
        vehicle.visit!.state = 'done';
        vehicle.committedS = path.zones.find((z) => z.fromM <= 0.5)?.toM ?? -1;
        place(vehicle);
        return;
      }
    }
    const out = (sign: number) => {
      const side = { x: -g.y * sign, y: g.x * sign };
      return [
        start,
        { x: start.x + g.x * 8, y: start.y + g.y * 8 },
        { x: start.x + g.x * 14 + side.x * 8, y: start.y + g.y * 14 + side.y * 8 },
        { x: start.x + g.x * 14 + side.x * 40, y: start.y + g.y * 14 + side.y * 40 },
      ];
    };
    const candidates = [1, -1].map((sign) => {
      const points = out(sign);
      const end = points.at(-1)!;
      let best: ServicePoint | null = null,
        bestM = Infinity;
      for (const l of network!.lanes) {
        const lane = compiled.lanes[l]!;
        for (let s = 2; s < lane.lengthM - ACCESS_AFTER_M; s += 6) {
          const p = pointAtDistance(lane.polyline, lane.cumulative, s);
          const d = Math.hypot(p.x - end.x, p.y - end.y);
          if (d < bestM) [best, bestM] = [{ lane: l, positionM: s, pos: p }, d];
        }
      }
      return { points, merge: best!, d: bestM };
    });
    const pick = candidates[0]!.d <= candidates[1]!.d ? candidates[0]! : candidates[1]!;
    const path = outbound([...pick.points, pick.merge.pos], pick.merge, -1, false);
    if (!path) throw new Error(`tug ${vehicle.id}: no way back`);
    vehicle.path = path;
    vehicle.detours = 0;
    vehicle.lookS = 0;
    vehicle.s = 0;
    vehicle.v = 0;
    vehicle.phase = 'out';
    vehicle.visit!.state = 'done';
    // It starts on the taxiway: committed to every zone it is in until it is off.
    vehicle.committedS = path.zones.find((z) => z.fromM <= 0.5)?.toM ?? -1;
    place(vehicle);
  }

  /** The last resort, after each read's moves: a vehicle an aircraft is about to reach, one an
   * aircraft has come to stand over, or one that has come onto another vehicle leaves. */
  function clearOut() {
    for (const vehicle of [...vehicles]) {
      if (vehicle.phase === 'attached') continue;
      const onOther =
        vehicle.phase !== 'serving' &&
        vehicles.some(
          (o) =>
            o !== vehicle &&
            o.phase !== 'attached' &&
            Math.hypot(o.pos.x - vehicle.pos.x, o.pos.y - vehicle.pos.y) < 40 &&
            bodyBoxes(vehicle).some((a) => bodyBoxes(o).some((b) => boxesOverlap(a, b))),
        );
      const sweep = !onOther && inSpace(vehicle, true);
      if (!onOther && !sweep && !underHull(vehicle)) continue;
      counts.withdrawn++;
      counts.cleared++;
      const cause = onOther
        ? 'vehicle-clear'
        : sweep
          ? inSpace(vehicle, true, true)
            ? 'push-clear'
            : 'aircraft-clear'
          : 'aircraft-hold';
      if (vehicle.visit) {
        if (vehicle.phase === 'in') drop(vehicle.visit, cause);
        else vehicle.visit.cause = cause;
      }
      remove(vehicle);
    }
  }

  function step(timeS: number) {
    const dtS = nowS ? timeS - nowS : 0.1;
    nowS = timeS;
    if (!network) return;
    const reading = timeS >= nextReadS;
    if (reading) {
      read(timeS);
      dispatch(timeS);
    }
    const occupied = occupancy();
    for (const vehicle of [...vehicles]) {
      if (!vehicles.includes(vehicle)) continue;
      if (vehicle.phase === 'attached') {
        const pose = byId.get(vehicle.turn!.aircraft);
        if (!pose || (!pushing(pose.state) && pose.state !== 'tow')) {
          if (pose) detach(vehicle, pose);
          else remove(vehicle);
        }
        continue;
      }
      if (vehicle.phase === 'serving') {
        const visit = vehicle.visit!;
        const pose = byId.get(vehicle.turn!.aircraft);
        if (vehicle.kind === 'tug') {
          const turn = vehicle.turn!;
          // TASK-356: at the nose before its aircraft parks, it waits for it.
          if (turn.comingS !== undefined) {
            if (timeS > turn.comingS + COMING_WAIT_S) leaveTug(vehicle);
            continue;
          }
          // An aircraft that left without its tug (never pushed): the tug goes home.
          if (!pose || (pose.state !== 'parked' && !pushing(pose.state))) leaveTug(vehicle);
          continue;
        }
        const leaving =
          timeS >= visit.leaveS ||
          !pose ||
          pose.state !== 'parked' ||
          (reading && inSpace(vehicle, false));
        if (leaving && standFree(vehicle)) {
          standHolder.set(vehicle.stand, vehicle.id);
          leave(vehicle);
        }
        continue;
      }
      move(vehicle, dtS, occupied);
      if (vehicle.phase === 'in' && vehicle.stoppedS > 0 && timeS - vehicle.stoppedS > 3)
        vehicle.delayedBy = travelCause(vehicle);
      // Held up within 45 m of its base, a vehicle on its way back turns in there.
      const atBase =
        vehicle.phase === 'out' &&
        vehicle.path.lengthM - vehicle.s < 45 &&
        vehicle.stoppedS > 0 &&
        timeS - vehicle.stoppedS > 3;
      // Off the lanes, a mover held by another mover waits up to 90 s. A parked hull or
      // a vehicle standing at its service position gets 15 s.
      const held =
        (vehicle.reason === 'guard' || vehicle.reason === 'vehicle') && vehicle.stoppedS > 0;
      const waited = timeS - vehicle.stoppedS;
      const blocker =
        held && vehicle.blockedBy >= 0
          ? vehicles.find((o) => o.id === vehicle.blockedBy)
          : undefined;
      if (held && waited > (blocker && blocker.phase !== 'serving' ? 90 : 15)) {
        withdraw(vehicle);
        continue;
      }
      if (atBase || vehicle.s >= vehicle.path.lengthM - 1e-6) {
        if (vehicle.phase === 'in') arrive(vehicle);
        else remove(vehicle);
      }
    }
    if (reading) {
      clearOut();
      breakQueueCycles();
    }
  }

  function leaveTug(vehicle: Vehicle) {
    const turn = vehicle.turn!;
    const way = turn.ways!.get('tug')!;
    const merge = turn.merge ?? bestMerge(turn.stand);
    const core = way.entry.slice(way.lead).reverse();
    const path = outbound(
      [...core, ...way.approachOut(merge.pos), merge.pos],
      merge,
      turn.stand,
      false,
    );
    vehicle.visit!.state = 'done';
    if (!path) {
      remove(vehicle);
      return;
    }
    vehicle.path = path;
    vehicle.detours = 0;
    vehicle.lookS = 0;
    vehicle.s = 0;
    vehicle.phase = 'out';
    vehicle.committedS = path.zones.find((z) => z.fromM <= 0.5)?.toM ?? -1;
  }

  function remove(vehicle: Vehicle) {
    release(vehicle);
    vehicles.splice(vehicles.indexOf(vehicle), 1);
    if (vehicle.kind === 'tug' && vehicle.turn && tugAt.get(vehicle.turn.aircraft) === vehicle)
      tugAt.delete(vehicle.turn.aircraft);
  }

  function withdraw(vehicle: Vehicle, retry = false) {
    counts.withdrawn++;
    const { visit, turn } = vehicle;
    if (visit && turn && vehicle.phase === 'in') {
      const cause = travelCause(vehicle);
      const retryAtS = nowS + 15;
      // Losing a deadlock need not cancel a visit. Let the lane clear, then send a replacement
      // once if the aircraft still needs it and there is time to drive back to the stand.
      if (
        retry &&
        visit.retryAtS === undefined &&
        turns.get(turn.aircraft) === turn &&
        !turn.gone &&
        retryAtS + MIN < retryDeadline(turn, visit)
      ) {
        visit.retryAtS = retryAtS;
        visit.state = 'planned';
        visit.cause = cause;
        counts.queueRetries++;
      } else drop(visit, cause);
    }
    remove(vehicle);
  }

  /** The vehicle's body `d` metres further on its way, grown by `margin`; null past the end. */
  function boxAt(vehicle: Vehicle, d: number, margin: number): PlanBox | null {
    const path = vehicle.path;
    const s = vehicle.s + d;
    if (s > path.lengthM + 1e-6) return null;
    const p = pointAtDistance(path.points, path.cumulative, s);
    let heading =
      path.points.length > 1
        ? headingAtDistance(path.points, path.cumulative, Math.min(s, path.lengthM - 1e-3))
        : vehicle.heading;
    if (path.reverse && s >= path.reverse[0] - 1e-6) heading += Math.PI;
    return {
      ...p,
      heading,
      lengthM: vehicle.lengthM + 2 * margin,
      widthM: vehicle.widthM + 2 * margin,
    };
  }

  /** A vehicle's plan boxes: its body and its carts. */
  /** Plan boxes by vehicle, kept while it stands where they were taken. */
  const boxCache = new WeakMap<Vehicle, { x: number; y: number; h: number; boxes: PlanBox[] }>();
  function bodyBoxes(vehicle: Vehicle): PlanBox[] {
    if (vehicle.phase === 'attached') return [];
    const cached = boxCache.get(vehicle);
    if (
      cached &&
      cached.x === vehicle.pos.x &&
      cached.y === vehicle.pos.y &&
      cached.h === vehicle.heading
    )
      return cached.boxes;
    const boxes = freshBoxes(vehicle);
    boxCache.set(vehicle, { x: vehicle.pos.x, y: vehicle.pos.y, h: vehicle.heading, boxes });
    return boxes;
  }
  function freshBoxes(vehicle: Vehicle): PlanBox[] {
    const body = {
      ...vehicle.pos,
      heading: vehicle.heading,
      lengthM: vehicle.lengthM,
      widthM: vehicle.widthM,
    };
    return [
      body,
      ...cartsOf(vehicle).map((c) => ({
        ...c,
        lengthM: baggageCart.lengthM,
        widthM: baggageCart.widthM,
      })),
    ];
  }

  /** Cart poses behind a tractor along its trail. */
  function cartsOf(vehicle: Vehicle) {
    const carts: GroundVehiclePose['carts'] = [];
    if (!vehicle.carts) return carts;
    const trail = [...vehicle.trail].reverse();
    if (
      !trail.length ||
      Math.hypot(trail[0]!.x - vehicle.pos.x, trail[0]!.y - vehicle.pos.y) > 1e-6
    )
      trail.unshift(vehicle.pos);
    const back = { x: -Math.cos(vehicle.heading), y: -Math.sin(vehicle.heading) };
    const sample = (d: number): Vec2 => {
      let run = 0;
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1]!,
          b = trail[i]!;
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (run + l >= d) {
          const t = (d - run) / l;
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        run += l;
      }
      const end = trail.at(-1)!;
      return { x: end.x + back.x * (d - run), y: end.y + back.y * (d - run) };
    };
    const pitch = baggageCart.lengthM + baggageCart.gapM;
    for (let k = 0; k < vehicle.carts; k++) {
      const d = vehicle.lengthM / 2 + baggageCart.gapM + baggageCart.lengthM / 2 + k * pitch;
      const p = sample(d);
      const q = sample(d + baggageCart.lengthM / 2);
      const r = sample(Math.max(0, d - baggageCart.lengthM / 2));
      carts.push({ x: p.x, y: p.y, heading: Math.atan2(r.y - q.y, r.x - q.x) });
    }
    return carts;
  }

  /** The tug's pose while it pushes: at the nose as TASK-314 draws it. */
  function attachedPose(vehicle: Vehicle) {
    const pose = byId.get(vehicle.turn!.aircraft);
    if (!pose) return;
    const visual = pose.visual ?? { ...pose, steering: 0 };
    const type = typeById.get(pose.typeId)!;
    const { noseX } = fixedWingGearStations(type.lengthM);
    const g = visual.heading + visual.steering;
    const reach = type.lengthM / 2 - noseX + 0.85 + groundVehicleSizes.tug.lengthM / 2;
    vehicle.pos = {
      x: visual.x + Math.cos(visual.heading) * noseX + Math.cos(g) * reach,
      y: visual.y + Math.sin(visual.heading) * noseX + Math.sin(g) * reach,
    };
    vehicle.heading = g;
  }

  return {
    network,
    step,
    snapshot(): GroundVehiclePose[] {
      return vehicles.map((vehicle) => {
        if (vehicle.phase === 'attached') attachedPose(vehicle);
        return {
          id: vehicle.id,
          kind: vehicle.kind,
          x: vehicle.pos.x,
          y: vehicle.pos.y,
          heading: vehicle.heading,
          speedMps:
            vehicle.phase === 'attached'
              ? (byId.get(vehicle.turn!.aircraft)?.speedMps ?? 0)
              : vehicle.v,
          carts: cartsOf(vehicle),
          attachedTo: vehicle.phase === 'attached' ? vehicle.turn!.aircraft : -1,
          stand: vehicle.stand >= 0 ? graph.stands[vehicle.stand]!.id : null,
        };
      });
    },
    /** Each turnaround's visits as planned and as served, for tests and the stand inspector. */
    turnarounds: () =>
      [...turns.values()].map((turn) => ({
        aircraft: turn.aircraft,
        stand: turn.stand,
        typeId: turn.type.id,
        onBlockS: turn.onBlockS,
        readyS: turn.readyS,
        visits: turn.visits.map((v) => ({ ...v })),
      })),
    metrics(): GroundVehicleMetrics {
      let stuck = 0;
      const queuedBy: Record<string, number> = {};
      for (const v of vehicles)
        if (
          v.phase !== 'serving' &&
          v.phase !== 'attached' &&
          v.stoppedS &&
          nowS - v.stoppedS > STUCK_S
        ) {
          stuck++;
          tally(queuedBy, travelCause(v));
        }
      return {
        ...counts,
        droppedBy: { ...counts.droppedBy },
        missingTugsBy: { ...counts.missingTugsBy },
        lateTugsBy: { ...counts.lateTugsBy },
        lateBy: { ...counts.lateBy },
        queuedBy,
        active: vehicles.length,
        stuck,
      };
    },
    hash(word: (hash: number, value: number) => number, hash: number) {
      hash = word(hash, vehicles.length);
      for (const v of vehicles) {
        hash = word(hash, v.id);
        hash = word(hash, Math.round(v.pos.x * 100));
        hash = word(hash, Math.round(v.pos.y * 100));
        hash = word(hash, Math.round(v.v * 100));
      }
      return hash;
    },
  };
}

export type GroundVehicles = ReturnType<typeof createGroundVehicles>;
