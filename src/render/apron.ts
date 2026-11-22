import {
  boxOf,
  distance,
  pointInPolygon,
  segmentDistance,
  segmentsIntersect,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { AirsideGraph } from '../network/airside';
import { aircraftTypes, type AircraftType } from '../schema/aircraft';
import type { Airport } from '../schema/airport';
import type { City } from '../schema/city';
import { aircraftLayout, boardingDoor, bridgeable } from './aircraft-outline';
import { FLOOD_AHEAD_M, placeAirfieldLights, type AirfieldLight } from './airfield-lights';
import type { AircraftPose } from './types';

// TASK-315: jet bridges and apron furniture by rule, shared by the 2D and 3D views.
//
// Bridges: a contact stand admitting a jet (code C or larger) gets an apron-drive bridge when a
// terminal facade lies on the aircraft's port side ahead of the wing, within reach of the
// boarding door of the stand's reference aircraft (A320neo up to code D, 777-300ER at E, A380
// at F), and the building there is multi-level: at least 8 m by its mapped height, or by 3 m a
// mapped level. A single-storey apron front (London City's, two levels) boards by stairs. The
// rotunda stands at the facade point nearest the door; a stand with a mapped gate whose facade
// is farther than a tunnel reaches gets a fixed link out to a rotunda on the apron. Three telescopic tunnels run from the rotunda to the cab, sized so
// the reference aircraft docks at four fifths of their extension. A bridge docks at the parked
// aircraft's own door when the aircraft is a jet it can reach, extending over 45 s after the
// aircraft parks. The snapshot shows no phase between boarding and the push (the sim grants the
// push and starts it in the same step), so the bridge retracts in 4 s as the push starts: the
// tug accelerates the aircraft from rest at under 1 m/s2, and the cab, backing away across the
// fuselage, stays clear of it.
//
// Furniture: a floodlight mast under each of TASK-301's apron floodlights (none inside a
// terminal or hangar); a stand guidance board for each bridged stand, on the facade ahead of the
// nose or else on that stand's mast, facing the pilot.

export const bridgeSize = {
  rotundaRadiusM: 2.2,
  /** Floor of the rotunda and any fixed link above the apron. */
  floorM: 4.2,
  cabDepthM: 3.4,
  cabWidthM: 4.2,
  /** A parked bridge's floor and how far its cab stands back from the reference door. */
  restFloorM: 3.6,
  restPullM: 8,
  /** Each tunnel overlaps the next by this much at full extension. */
  overlapM: 1.5,
  /** The longest tunnel placed straight from a facade, and the longest fixed link. */
  reachM: 40,
  linkMaxM: 60,
};
const DOCK_S = 45;
const RETRACT_S = 4;
/** Facade samples, and the clear distance kept from the port side of the fuselage. */
const SAMPLE_M = 1;
const SIDE_CLEAR_M = 3;
const BOARD_RANGE_M = 40;

export interface BridgePose {
  /** Cab centre, the direction its front faces (towards the fuselage), its floor height. */
  cab: Vec2;
  facing: number;
  floorM: number;
}

export interface JetBridge {
  stand: string;
  /** The compiled stand index. */
  index: number;
  rotunda: Vec2;
  /** The facade end of a fixed link out to the rotunda, or null. */
  link: Vec2 | null;
  /** Length of each of the three tunnels. */
  segmentM: number;
  rest: BridgePose;
}

interface StandPlace {
  pos: Vec2;
  heading: number;
}

/** Airport rings are open; `pointInPolygon` walks closed ones. */
export const closed = (ring: readonly Vec2[]) => [...ring, ring[0]!];

const typeById = new Map(aircraftTypes.map((t) => [t.id, t]));
const reference = (code: number) =>
  typeById.get(code >= 5 ? 'A388' : code === 4 ? 'B77W' : 'A20N')!;

/** Where a jet bridge's cab stands docked at `type`'s boarding door, parked at `stand`. */
export function dockedPose(stand: StandPlace, type: AircraftType): BridgePose {
  const door = boardingDoor(type);
  const fx = Math.cos(stand.heading),
    fy = Math.sin(stand.heading);
  // Starboard is (-fy, fx) in the map frame (y south); the door's z is negative, to port.
  const along = door.x - type.lengthM / 2;
  const out = -door.z + bridgeSize.cabDepthM / 2;
  return {
    cab: {
      x: stand.pos.x + fx * along + fy * out,
      y: stand.pos.y + fy * along - fx * out,
    },
    facing: stand.heading + Math.PI / 2,
    floorM: door.sillM,
  };
}

/** The middle of the cab's back wall, where the last tunnel joins it. */
export function cabBack(pose: BridgePose): Vec2 {
  const half = bridgeSize.cabDepthM / 2;
  return {
    x: pose.cab.x - Math.cos(pose.facing) * half,
    y: pose.cab.y - Math.sin(pose.facing) * half,
  };
}

/** The tunnels' length from the rotunda wall to the cab, for a cab pose. */
export const tunnelLength = (bridge: Pick<JetBridge, 'rotunda'>, pose: BridgePose) =>
  distance(bridge.rotunda, cabBack(pose)) - bridgeSize.rotundaRadiusM;

/** Whether the tunnels reach a cab pose: from one tunnel to three overlapping. */
export function reaches(bridge: JetBridge, pose: BridgePose) {
  const length = tunnelLength(bridge, pose);
  return length >= bridge.segmentM + 0.5 && length <= 3 * bridge.segmentM - 2 * bridgeSize.overlapM;
}

/** A terminal building tall enough to carry a bridge's rotunda at its upper floor. */
const MULTI_LEVEL_M = 8;
/** How far from a facade point a building's outline may lie and still be the one there. */
const BUILDING_NEAR_M = 3;

/** The mapped height of the buildings at a facade point: the tallest whose outline holds it or
 * passes within a few metres; levels count 3 m each; undefined where none is tagged. */
function heightsAt(context: City['context']) {
  const buildings = (context?.features ?? []).flatMap((f) => {
    if (f.kind !== 'area' || f.class !== 'building') return [];
    const heightM = f.heightM ?? (f.levels === undefined ? undefined : f.levels * 3);
    if (heightM === undefined) return [];
    const ring = closed(f.rings[0]!);
    return [{ ring, box: boxOf(ring), heightM }];
  });
  return (q: Vec2) => {
    let tallest: number | undefined;
    for (const { ring, box, heightM } of buildings) {
      if (
        q.x < box.minX - BUILDING_NEAR_M ||
        q.x > box.maxX + BUILDING_NEAR_M ||
        q.y < box.minY - BUILDING_NEAR_M ||
        q.y > box.maxY + BUILDING_NEAR_M
      )
        continue;
      if (pointInPolygon(q, ring, BUILDING_NEAR_M)) tallest = Math.max(tallest ?? 0, heightM);
    }
    return tallest;
  };
}

export function placeJetBridges(
  airport: Airport,
  graph: AirsideGraph,
  context: City['context'],
): JetBridge[] {
  const rings = Object.values(airport.terminals).map((t) => closed(t.rings[0]!));
  const edges = rings.flatMap((ring) => ring.slice(1).map((b, i) => [ring[i]!, b] as const));
  const heightAt = heightsAt(context);
  const bridges: JetBridge[] = [];
  for (const stand of graph.stands) {
    if (stand.maxCode < 2 || stand.kind !== 'contact') continue;
    const type = reference(stand.maxCode);
    const dock = dockedPose(stand, type);
    const back = cabBack(dock);
    const fx = Math.cos(stand.heading),
      fy = Math.sin(stand.heading);
    const centre = {
      x: stand.pos.x - (fx * type.lengthM) / 2,
      y: stand.pos.y - (fy * type.lengthM) / 2,
    };
    const minAlong = boardingDoor(type).x - 0.15 * type.lengthM;
    const side = aircraftLayout(type).radius + SIDE_CLEAR_M;
    let best: { q: Vec2; d: number; normal: Vec2 } | null = null;
    for (const [a, b] of edges) {
      const length = distance(a, b);
      const near = segmentDistance(back, a, b);
      if (!length || near > bridgeSize.reachM + bridgeSize.linkMaxM || (best && near >= best.d))
        continue;
      const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
      for (let s = 0; s <= length; s += SAMPLE_M) {
        const q = { x: a.x + ((b.x - a.x) * s) / length, y: a.y + ((b.y - a.y) * s) / length };
        const dx = q.x - centre.x,
          dy = q.y - centre.y;
        if (dx * fx + dy * fy < minAlong || -dx * fy + dy * fx > -side) continue;
        const d = distance(q, back);
        if (!best || d < best.d) best = { q, d, normal };
      }
    }
    if (!best || (heightAt(best.q) ?? 0) < MULTI_LEVEL_M) continue;
    const { q, d } = best;
    const sign = best.normal.x * (back.x - q.x) + best.normal.y * (back.y - q.y) >= 0 ? 1 : -1;
    const lift = bridgeSize.rotundaRadiusM + 0.5;
    let rotunda: Vec2,
      link: Vec2 | null = null;
    if (d <= bridgeSize.reachM)
      rotunda = { x: q.x + best.normal.x * sign * lift, y: q.y + best.normal.y * sign * lift };
    else if (airport.stands[stand.id]?.gate) {
      const out = bridgeSize.reachM * 0.6;
      rotunda = { x: back.x + ((q.x - back.x) * out) / d, y: back.y + ((q.y - back.y) * out) / d };
      if (d - out > bridgeSize.linkMaxM) continue;
      link = q;
    } else continue;
    if (rings.some((ring) => pointInPolygon(rotunda, ring))) continue;
    // The tunnels may not pass through a terminal.
    if (edges.some(([a, b]) => segmentsIntersect(rotunda, back, a, b))) continue;
    const length = tunnelLength({ rotunda }, dock);
    if (length < 4) continue;
    const segmentM = (length + 2 * bridgeSize.overlapM) / 2.4;
    const pull = Math.max(0, Math.min(bridgeSize.restPullM, length - segmentM - 0.5));
    const towards = {
      x: (rotunda.x - back.x) / distance(rotunda, back),
      y: (rotunda.y - back.y) / distance(rotunda, back),
    };
    bridges.push({
      stand: stand.id,
      index: stand.idx,
      rotunda,
      link,
      segmentM,
      rest: {
        cab: { x: dock.cab.x + towards.x * pull, y: dock.cab.y + towards.y * pull },
        facing: dock.facing,
        floorM: bridgeSize.restFloorM,
      },
    });
  }
  return bridges;
}

/** Each bridge's movement between its parked pose and the door of the aircraft at its stand,
 * from the aircraft snapshot (state `parked` at the stand docks; anything else retracts). */
export class JetBridgeStates {
  private readonly states: {
    from: number;
    target: 0 | 1;
    changedS: number;
    dock: BridgePose | null;
  }[];
  private started = false;
  readonly bridges: readonly JetBridge[];
  constructor(bridges: readonly JetBridge[]) {
    this.bridges = bridges;
    this.states = bridges.map(() => ({ from: 0, target: 0, changedS: 0, dock: null }));
  }

  /** The docked pose for an aircraft, or null when this bridge does not serve it. */
  /** The docked pose at the parked aircraft's own boarding door, from its displayed pose
   * (TASK-314's visual pose, else the snapshot's), or null when this bridge does not serve it. */
  dockFor(
    i: number,
    pose:
      | Pick<AircraftPose, 'typeId' | 'state' | 'stand' | 'x' | 'y' | 'heading' | 'visual'>
      | undefined,
  ) {
    const bridge = this.bridges[i]!;
    if (!pose || pose.state !== 'parked' || pose.stand !== bridge.stand) return null;
    const type = typeById.get(pose.typeId);
    if (!type || !bridgeable(type)) return null;
    const { x, y, heading } = pose.visual ?? pose;
    const half = type.lengthM / 2;
    const nose = { x: x + Math.cos(heading) * half, y: y + Math.sin(heading) * half };
    const dock = dockedPose({ pos: nose, heading }, type);
    return reaches(bridge, dock) ? dock : null;
  }

  update(poses: readonly AircraftPose[], timeS: number) {
    const atStand = new Map<string, AircraftPose>();
    for (const pose of poses) if (pose.stand) atStand.set(pose.stand, pose);
    for (const [i, bridge] of this.bridges.entries()) {
      const state = this.states[i]!;
      const dock = this.dockFor(i, atStand.get(bridge.stand));
      const target = dock ? 1 : 0;
      if (!this.started) Object.assign(state, { from: target, target, changedS: timeS, dock });
      else if (target !== state.target) {
        state.from = this.progress(i, timeS);
        state.target = target;
        state.changedS = timeS;
        if (dock) state.dock = dock;
      }
    }
    this.started = true;
  }

  /** 0 parked to 1 docked at `timeS`. */
  progress(i: number, timeS: number) {
    const { from, target, changedS } = this.states[i]!;
    const elapsed = Math.max(0, timeS - changedS);
    return target ? Math.min(1, from + elapsed / DOCK_S) : Math.max(0, from - elapsed / RETRACT_S);
  }

  poseAt(i: number, timeS: number): BridgePose {
    const { rest } = this.bridges[i]!;
    const dock = this.states[i]!.dock;
    const p = this.progress(i, timeS);
    if (!dock || p === 0) return rest;
    // Ease in and out; the cab swings round its facing by the shorter way.
    const t = p * p * (3 - 2 * p);
    const turn = Math.atan2(
      Math.sin(dock.facing - rest.facing),
      Math.cos(dock.facing - rest.facing),
    );
    return {
      cab: {
        x: rest.cab.x + (dock.cab.x - rest.cab.x) * t,
        y: rest.cab.y + (dock.cab.y - rest.cab.y) * t,
      },
      facing: rest.facing + turn * t,
      floorM: rest.floorM + (dock.floorM - rest.floorM) * t,
    };
  }

  /** Whether any bridge moves at `timeS`. */
  moving(timeS: number) {
    return this.states.some((_, i) => {
      const p = this.progress(i, timeS);
      return p > 0 && p < 1;
    });
  }

  /** Bridges docked and moving at `timeS`, for tests and the canvas dataset. */
  counts(timeS: number) {
    let docked = 0,
      moving = 0;
    for (let i = 0; i < this.states.length; i++) {
      const p = this.progress(i, timeS);
      if (p === 1) docked++;
      else if (p > 0) moving++;
    }
    return { bridges: this.bridges.length, docked, moving };
  }
}

const layouts = new WeakMap<AirsideGraph, ReturnType<typeof layApron>>();

/** Bridges, masts and boards of an airport, placed once per compiled airside for both views. */
export function apronLayout(airport: Airport, graph: AirsideGraph, context: City['context']) {
  let layout = layouts.get(graph);
  if (!layout) layouts.set(graph, (layout = layApron(airport, graph, context)));
  return layout;
}

function layApron(airport: Airport, graph: AirsideGraph, context: City['context']) {
  const bridges = placeJetBridges(airport, graph, context);
  const lights = placeAirfieldLights(graph, airport.approachAids);
  return { bridges, ...placeApronFurniture(airport, graph, lights, bridges) };
}

export interface StandBoard {
  stand: string;
  pos: Vec2;
  /** The direction the display faces (towards the pilot). */
  facing: number;
  heightM: number;
  mount: 'facade' | 'mast';
}

export function placeApronFurniture(
  airport: Airport,
  graph: AirsideGraph,
  lights: readonly AirfieldLight[],
  bridges: readonly JetBridge[],
) {
  const blocked = [
    ...Object.values(airport.terminals).map((t) => closed(t.rings[0]!)),
    ...airport.hangars.map((h) => closed(h.rings[0]!)),
  ];
  const edges = Object.values(airport.terminals).flatMap(({ rings: [ring] }) =>
    ring!.map((a, i) => [a, ring![(i + 1) % ring!.length]!] as const),
  );
  const masts = lights
    .filter((l) => l.kind === 'apron-flood' && !blocked.some((ring) => pointInPolygon(l, ring)))
    .map((l) => ({ pos: { x: l.x, y: l.y }, heightM: l.heightM }));
  const boards: StandBoard[] = [];
  for (const bridge of bridges) {
    const stand = graph.stands[bridge.index]!;
    const fx = Math.cos(stand.heading),
      fy = Math.sin(stand.heading);
    // Pilot eye height grows with the code: about 5 m on a narrowbody, 7 m on a widebody.
    const heightM = stand.maxCode >= 4 ? 7.5 : 5.5;
    const ahead = { x: stand.pos.x + fx * BOARD_RANGE_M, y: stand.pos.y + fy * BOARD_RANGE_M };
    let hit = Infinity;
    for (const [a, b] of edges) {
      if (!segmentsIntersect(stand.pos, ahead, a, b)) continue;
      // Distance along the centreline to the facade.
      const ex = b.x - a.x,
        ey = b.y - a.y;
      const denominator = fx * ey - fy * ex;
      if (!denominator) continue;
      hit = Math.min(hit, ((a.x - stand.pos.x) * ey - (a.y - stand.pos.y) * ex) / denominator);
    }
    const facing = stand.heading + Math.PI;
    if (hit < BOARD_RANGE_M) {
      const d = hit - 0.3;
      boards.push({
        stand: stand.id,
        pos: { x: stand.pos.x + fx * d, y: stand.pos.y + fy * d },
        facing,
        heightM,
        mount: 'facade',
      });
      continue;
    }
    const at = { x: stand.pos.x + fx * FLOOD_AHEAD_M, y: stand.pos.y + fy * FLOOD_AHEAD_M };
    const mast = masts.find((m) => distance(m.pos, at) < 0.01);
    if (mast)
      boards.push({
        stand: stand.id,
        pos: { x: mast.pos.x - fx * 0.5, y: mast.pos.y - fy * 0.5 },
        facing,
        heightM,
        mount: 'mast',
      });
  }
  return { masts, boards };
}
