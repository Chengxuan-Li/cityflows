import {
  cumulativeLengths,
  headingAtDistance,
  pointAtDistance,
  segmentDistance,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { AirsideGraph } from '../network/airside';
import { aircraftCodes, codeSpanLimitM } from '../schema/aircraft';
import type { Airport } from '../schema/airport';
import type { AircraftPose, AirfieldState } from './types';

// TASK-301: airfield and aircraft lighting, by rule, shared by the 2D and 3D views. Placement
// follows ICAO Annex 14 Vol. I chapter 5.3 in simplified form: runway edge lights at most 60 m
// apart, amber over the last 600 m (or third) of the run; centreline lights every 30 m, red and
// white alternating from 900 m before the end and red over the last 300 m; green threshold and
// red end lights across the runway every 3 and 6 m; approach lights 900 m out (420 m on a runway
// under 1,800 m) with a crossbar at 300 m; four PAPI units on the left 300 m past the threshold;
// green taxiway centreline lights every 30 m and blue taxiway edge lights every 60 m; red stop
// bars across the taxiway every 3 m at runway holding positions and three yellow lights at an
// intermediate one; a floodlight over each stand. Lights a runway end in use needs follow the
// airfield state the sim reports (TASK-300 changes which ends are in use).

export const airfieldColors = {
  white: 0xfff4dc,
  amber: 0xffb428,
  red: 0xff2414,
  green: 0x2bff7a,
  blue: 0x3a6cff,
  yellow: 0xffd21e,
  approach: 0xfffaf0,
  flood: 0xfff0d2,
} as const;

export type AirfieldLightKind =
  | 'runway-edge'
  | 'runway-centreline'
  | 'threshold'
  | 'runway-end'
  | 'approach'
  | 'papi'
  | 'taxiway-centreline'
  | 'taxiway-edge'
  | 'stop-bar'
  | 'intermediate-hold'
  | 'apron-flood';

export interface AirfieldLight {
  kind: AirfieldLightKind;
  x: number;
  y: number;
  /** Above the airfield: in-pavement and edge lights at 0.3 m, floodlights on 20 m masts. */
  heightM: number;
  /** The runway, and the runway end the light serves (threshold, approach and PAPI: the landing
   * end; end lights: the end they stand at), or -1. */
  runway: number;
  end: number;
  /** Runway lights: the station from `ends[0]` along the runway. */
  stationM: number;
  /** Stop bars: the holding position. PAPI: the unit, 0 next to the runway. */
  hold: number;
  unit: number;
}

const EDGE_SPACING_M = 60;
const CENTRELINE_SPACING_M = 30;
const TAXI_CENTRELINE_SPACING_M = 30;
const TAXI_EDGE_SPACING_M = 60;
const PAPI_FROM_THRESHOLD_M = 300;
const LIGHT_M = 0.3;

const light = (
  kind: AirfieldLightKind,
  p: Vec2,
  extra: Partial<Omit<AirfieldLight, 'kind' | 'x' | 'y'>> = {},
): AirfieldLight => ({
  kind,
  x: p.x,
  y: p.y,
  heightM: LIGHT_M,
  runway: -1,
  end: -1,
  stationM: 0,
  hold: -1,
  unit: -1,
  ...extra,
});

/** `count` points evenly from `-half` to `half` across `heading` at `at`. */
function across(at: Vec2, heading: number, half: number, count: number): Vec2[] {
  const nx = -Math.sin(heading),
    ny = Math.cos(heading);
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : -half + (2 * half * i) / (count - 1);
    return { x: at.x + nx * t, y: at.y + ny * t };
  });
}

/** Segments of every airside edge, bucketed in 50 m cells, to keep edge lights off pavement. */
function pavementIndex(graph: AirsideGraph) {
  const cell = 50;
  const cells = new Map<string, { a: Vec2; b: Vec2; half: number; edge: number }[]>();
  for (const edge of graph.edges)
    for (let i = 1; i < edge.line.length; i++) {
      const a = edge.line[i - 1]!,
        b = edge.line[i]!,
        half = edge.widthM / 2;
      for (
        let cx = Math.floor((Math.min(a.x, b.x) - half) / cell);
        cx * cell <= Math.max(a.x, b.x) + half;
        cx++
      )
        for (
          let cy = Math.floor((Math.min(a.y, b.y) - half) / cell);
          cy * cell <= Math.max(a.y, b.y) + half;
          cy++
        ) {
          const key = `${cx},${cy}`;
          let list = cells.get(key);
          if (!list) cells.set(key, (list = []));
          list.push({ a, b, half, edge: edge.idx });
        }
    }
  /** Whether `p` lies on the pavement of an edge other than `own`, with `marginM` to spare. */
  return (p: Vec2, own: number, marginM: number) =>
    (cells.get(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`) ?? []).some(
      (s) => s.edge !== own && segmentDistance(p, s.a, s.b) < s.half + marginM,
    );
}

/** Every airfield light the airport can show, on or off; `airfieldLightColors` says which shine. */
export function placeAirfieldLights(
  graph: AirsideGraph,
  approachAids: Airport['approachAids'] = [],
): AirfieldLight[] {
  const lights: AirfieldLight[] = [];
  const onPavement = pavementIndex(graph);
  for (const runway of graph.runways) {
    const r = runway.idx;
    const cumulative = cumulativeLengths(runway.line);
    const length = cumulative.at(-1)!;
    const half = runway.widthM / 2;
    const at = (m: number) => pointAtDistance(runway.line, cumulative, m);
    const headingAt = (m: number) => headingAtDistance(runway.line, cumulative, m);
    const edges = Math.max(1, Math.ceil(length / EDGE_SPACING_M));
    for (let i = 0; i <= edges; i++) {
      const m = (length * i) / edges;
      for (const p of across(at(m), headingAt(m), half + 1.5, 2))
        lights.push(light('runway-edge', p, { runway: r, stationM: m }));
    }
    for (let m = CENTRELINE_SPACING_M / 2; m < length; m += CENTRELINE_SPACING_M)
      lights.push(light('runway-centreline', at(m), { runway: r, stationM: m }));
    for (const end of [0, 1] as const) {
      const e = runway.ends[end];
      // Outward from the runway at this end, and inward along the landing direction.
      const inward = end === 0 ? headingAt(0) : headingAt(length) + Math.PI;
      const thresholdAt = at(e.thresholdM);
      for (const p of across(thresholdAt, inward, half, Math.floor(runway.widthM / 3) + 1))
        lights.push(light('threshold', p, { runway: r, end, stationM: e.thresholdM }));
      const endCount = Math.max(6, Math.floor(runway.widthM / 6) + 1);
      for (const p of across(at(e.stationM), inward, half, endCount))
        lights.push(light('runway-end', p, { runway: r, end, stationM: e.stationM }));
      const dx = Math.cos(inward),
        dy = Math.sin(inward);
      const approachM = length >= 1800 ? 900 : 420;
      for (let d = 30; d <= approachM; d += 30) {
        const centre = { x: thresholdAt.x - dx * d, y: thresholdAt.y - dy * d };
        const width = d === 300 ? 15 : 1.5;
        for (const p of across(centre, inward, width, d === 300 ? 11 : 3))
          lights.push(light('approach', p, { runway: r, end, heightM: 0.3 + d * 0.004 }));
      }
      // PAPI: a mapped unit for this end gives the distance and side; else the left, 300 m in.
      const mapped = approachAids.find(
        (aid) => aid.kind === 'papi' && aid.runway === runway.id && aid.end === e.designator,
      );
      let alongM = PAPI_FROM_THRESHOLD_M,
        side = -1;
      if (mapped) {
        const ox = mapped.pos.x - thresholdAt.x,
          oy = mapped.pos.y - thresholdAt.y;
        alongM = Math.max(0, ox * dx + oy * dy);
        side = -ox * dy + oy * dx < 0 ? -1 : 1;
      }
      const papiAt = { x: thresholdAt.x + dx * alongM, y: thresholdAt.y + dy * alongM };
      // Left of the landing direction is -1 across (y south, x east: a right-handed turn is +).
      for (let unit = 0; unit < 4; unit++) {
        const offset = side * (half + 15 + unit * 9);
        lights.push(
          light(
            'papi',
            { x: papiAt.x - dy * offset, y: papiAt.y + dx * offset },
            { runway: r, end, unit, heightM: 0.8 },
          ),
        );
      }
    }
  }
  const nearRunway = (p: Vec2) =>
    graph.runways.some((runway) => {
      for (let i = 1; i < runway.line.length; i++)
        if (segmentDistance(p, runway.line[i - 1]!, runway.line[i]!) < runway.widthM / 2 + 5)
          return true;
      return false;
    });
  for (const edge of graph.edges) {
    if (edge.kind !== 'taxiway' && edge.kind !== 'taxilane') continue;
    for (let m = TAXI_CENTRELINE_SPACING_M / 2; m < edge.lengthM; m += TAXI_CENTRELINE_SPACING_M) {
      const p = pointAtDistance(edge.line, edge.cumulative, m);
      if (!nearRunway(p)) lights.push(light('taxiway-centreline', p));
    }
    if (edge.kind !== 'taxiway') continue;
    const count = Math.max(1, Math.round(edge.lengthM / TAXI_EDGE_SPACING_M));
    for (let i = 0; i <= count; i++) {
      const m = (edge.lengthM * i) / count;
      const heading = headingAtDistance(
        edge.line,
        edge.cumulative,
        Math.min(m, edge.lengthM - 0.01),
      );
      for (const p of across(
        pointAtDistance(edge.line, edge.cumulative, m),
        heading,
        edge.widthM / 2 + 1,
        2,
      ))
        if (!onPavement(p, edge.idx, 1) && !nearRunway(p)) lights.push(light('taxiway-edge', p));
    }
  }
  for (const hold of graph.holds) {
    const node = graph.nodes[hold.node]!;
    const toward = hold.toward >= 0 ? graph.edges[hold.toward]! : graph.edges[node.edges[0]!]!;
    const fromStart = toward.from === hold.node;
    const heading = headingAtDistance(
      toward.line,
      toward.cumulative,
      fromStart ? 0 : toward.lengthM - 0.01,
    );
    if (hold.runway >= 0) {
      const width = Math.max(
        ...node.edges
          .map((e) => graph.edges[e]!)
          .filter((e) => e.kind !== 'runway')
          .map((e) => e.widthM),
      );
      for (const p of across(node.pos, heading, width / 2 - 0.5, Math.floor(width / 3) + 1))
        lights.push(light('stop-bar', p, { hold: hold.idx, runway: hold.runway }));
    } else
      for (const p of across(node.pos, heading, 1.5, 3))
        lights.push(light('intermediate-hold', p, { hold: hold.idx }));
  }
  for (const stand of graph.stands) {
    const span = codeSpanLimitM[aircraftCodes[Math.max(0, stand.maxCode)]!];
    // The mast stands ahead of the nose; the pool covers the aircraft behind it.
    const dx = Math.cos(stand.heading),
      dy = Math.sin(stand.heading);
    lights.push(
      light(
        'apron-flood',
        { x: stand.pos.x + dx * 12, y: stand.pos.y + dy * 12 },
        { heightM: 20, stationM: span },
      ),
    );
  }
  return lights;
}

/** The four PAPI units' setting angles, next to the runway first (ICAO: the on-slope signal is
 * two red next to the runway and two white outside, at 30' and 10' either side of the slope). */
export const papiSettingsDeg = (glideDeg: number) => [
  glideDeg + 0.5,
  glideDeg + 1 / 6,
  glideDeg - 1 / 6,
  glideDeg - 0.5,
];

/** Whether each unit shows white to an eye `angleDeg` above the horizontal at the units. */
export const papiWhite = (glideDeg: number, angleDeg: number) =>
  papiSettingsDeg(glideDeg).map((setting) => angleDeg > setting);

/** The elevation angle of the aircraft approaching each landing end, seen from its PAPI: the
 * nearest one airborne on approach to that end and not yet past the units. Keyed by
 * `runway * 2 + end`; an end with none is absent. */
export function papiAngles(
  graph: AirsideGraph,
  lights: readonly AirfieldLight[],
  poses: readonly AircraftPose[],
): Map<number, number> {
  const angles = new Map<number, { angle: number; d: number }>();
  for (const papi of lights) {
    if (papi.kind !== 'papi' || papi.unit !== 0) continue;
    const runway = graph.runways[papi.runway]!;
    const e = runway.ends[papi.end]!;
    const inward = e.heading;
    for (const pose of poses) {
      if (!pose.airborne || pose.runwayEnd !== e.designator) continue;
      if (pose.state !== 'approach' && pose.state !== 'flare') continue;
      const ox = pose.x - papi.x,
        oy = pose.y - papi.y;
      // Still short of the units, along the landing direction.
      const before = -(ox * Math.cos(inward) + oy * Math.sin(inward));
      if (before <= 0) continue;
      const d = Math.hypot(ox, oy);
      const key = papi.runway * 2 + papi.end;
      if ((angles.get(key)?.d ?? Infinity) > d)
        angles.set(key, { angle: (Math.atan2(pose.heightM, d) * 180) / Math.PI, d });
    }
  }
  return new Map([...angles].map(([key, { angle }]) => [key, angle]));
}

/** Each light's colour now, or 0 when it is off. Runways light up only with an end in use; the
 * edge and centreline colour coding follows the landing direction (else the take-off one). */
export function airfieldLightColors(
  graph: AirsideGraph,
  lights: readonly AirfieldLight[],
  state: AirfieldState | undefined,
  angles: ReadonlyMap<number, number>,
): number[] {
  const arrival = (r: number) => state?.arrivalEnds[r] ?? -1;
  const departure = (r: number) => state?.departureEnds[r] ?? -1;
  const cleared = new Set(state?.clearedHolds);
  const glide = state?.glideSlopeDeg ?? 3;
  const c = airfieldColors;
  return lights.map((l) => {
    if (l.runway < 0 || l.kind === 'stop-bar') {
      if (l.kind === 'stop-bar') return cleared.has(l.hold) ? 0 : c.red;
      return l.kind === 'taxiway-centreline'
        ? c.green
        : l.kind === 'taxiway-edge'
          ? c.blue
          : l.kind === 'intermediate-hold'
            ? c.yellow
            : c.flood;
    }
    const runway = graph.runways[l.runway]!;
    const a = arrival(l.runway),
      d = departure(l.runway);
    const direction = a >= 0 ? a : d;
    if (direction < 0) return 0;
    switch (l.kind) {
      case 'threshold':
      case 'approach':
        return a === l.end ? (l.kind === 'threshold' ? c.green : c.approach) : 0;
      case 'papi': {
        if (a !== l.end) return 0;
        const angle = angles.get(l.runway * 2 + l.end) ?? glide;
        return papiWhite(glide, angle)[l.unit] ? c.white : c.red;
      }
      case 'runway-end':
        // At the far end of a run in use.
        return a === 1 - l.end || d === 1 - l.end ? c.red : 0;
      default: {
        // Metres of runway left ahead, running from the end in use.
        const left =
          direction === 0
            ? runway.ends[1].stationM - l.stationM
            : l.stationM - runway.ends[0].stationM;
        if (l.kind === 'runway-edge')
          return left < Math.min(600, runway.lengthM / 3) ? c.amber : c.white;
        if (left < 300) return c.red;
        if (left < 900) return Math.round(left / CENTRELINE_SPACING_M) % 2 ? c.red : c.white;
        return c.white;
      }
    }
  });
}

export interface AircraftLightState {
  /** Red left, green right, white tail. */
  nav: boolean;
  /** Flashing red. */
  beacon: boolean;
  /** Flashing white at the wingtips. */
  strobes: boolean;
  landing: boolean;
  taxi: boolean;
}

const landingStates = new Set([
  'approach',
  'flare',
  'landing-roll',
  'takeoff-roll',
  'rotation',
  'helicopter-approach',
  'vertical-descent',
  'vertical-climb',
]);
const climbStates = new Set(['climb', 'go-around', 'helicopter-climb']);
const taxiStates = new Set(['taxi', 'line-up', 'hover-taxi']);

/** Which of an aircraft's lights are on, from its sim state: navigation lights always; the beacon
 * while engines run or it moves; strobes on the runway and airborne; landing lights on final,
 * through the landing roll, on the take-off roll and until the gear comes up; taxi lights while
 * taxiing (off while holding). */
export function aircraftLights(
  pose: Pick<
    AircraftPose,
    'state' | 'enginesRunning' | 'speedMps' | 'onRunway' | 'airborne' | 'gearDown'
  >,
): AircraftLightState {
  return {
    nav: true,
    beacon: pose.enginesRunning || pose.speedMps > 0.1,
    strobes: pose.onRunway || pose.airborne,
    landing: landingStates.has(pose.state) || (climbStates.has(pose.state) && pose.gearDown),
    taxi: taxiStates.has(pose.state),
  };
}

/** Flash phases at `timeS` seconds: the beacon once a second, the strobes a double flash every
 * 1.2 s; `seed` staggers aircraft. */
export function aircraftFlash(timeS: number, seed: number) {
  const beacon = (timeS + (seed % 7) * 0.13) % 1;
  const strobe = (timeS + (seed % 5) * 0.21) % 1.2;
  return { beacon: beacon < 0.12, strobe: strobe < 0.05 || (strobe > 0.16 && strobe < 0.21) };
}

/** A per-flight accent (fin and engines) from its registration: a fixed set of livery colours. */
const accents = [
  0x1f3f78, 0xb3202a, 0x10707a, 0x5a2d82, 0xd9661f, 0x2e7d32, 0x1f78c8, 0x7a1f3d, 0xc79a1b,
  0x3b4650,
];
export function aircraftAccent(registration: string) {
  let hash = 2166136261;
  for (let i = 0; i < registration.length; i++)
    hash = Math.imul(hash ^ registration.charCodeAt(i), 16777619);
  return accents[(hash >>> 0) % accents.length]!;
}
