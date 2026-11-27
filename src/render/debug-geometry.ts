import Flatbush from 'flatbush';
import { cumulativeLengths, headingAtDistance, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { gradeHeightM, gradeProfiles, profileHeightAt } from '../network/heights';
import { railHeightAt, railHeights } from '../network/rail';
import type { DebugSnapshot, VehicleDebug } from '../sim/debug-snapshot';
import type { DebugOverlay } from './debug-settings';
import { movementLight, signalHeads, signalLight } from './layers/signals';
import { connectorPosition } from './picking';
import type { CityGeometry, Pick, SignalStates, VehicleSnapshot } from './types';

/** TASK-373: the debug overlays as plain drawing items in world metres (x east, y south, z up),
 * built once per city or snapshot and drawn by the 2D and the 3D view alike (`debug-canvas.ts`).
 * Colours are named inks, resolved from the `--debug-*` tokens of the current appearance. */
export const inks = ['blue', 'teal', 'green', 'amber', 'red', 'purple', 'pink', 'grey'] as const;
export type Ink = (typeof inks)[number];
export interface DebugPalette {
  ink: Record<Ink, number>;
  /** The casing under every mark, so it reads over the scene and on the plain canvas. */
  halo: number;
  /** Low to high, for elevations and the overdraw count. */
  ramp: readonly number[];
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}
/** What hovering shows (the id, in the tooltip) and clicking selects. */
export interface DebugTarget {
  label: string;
  pick?: Pick;
}
interface Common {
  ink: Ink;
  /** A ramp colour in place of the ink. */
  colour?: number;
  /** Drawn only from this many pixels per metre on (detail that would only clutter a far view). */
  minScale?: number;
  target?: DebugTarget;
}
export type DebugItem =
  | (Common & {
      kind: 'line';
      points: P3[];
      /** Pixels; `widthM` instead scales with the view (a road's width in Heights and grades). */
      width: number;
      widthM?: number;
      dash?: boolean;
      /** A chevron at the middle, in the line's direction. */
      arrow?: boolean;
    })
  | (Common & { kind: 'dot'; at: P3; radius: number; hollow?: boolean })
  | (Common & { kind: 'text'; at: P3; text: string });

export interface DebugLayer {
  items: DebugItem[];
  /** Whether items lie near the ground, so the view may skip those outside its ground area.
   * Aircraft on approach and the glide path do not. */
  grounded: boolean;
  index?: Flatbush;
}

/** Surface heights the overlays sit at. The 2D view draws them flat. */
export interface DebugHeights {
  lane(lane: number, vertex: number): number;
  node(node: number): number;
  /** The ground plus `grade` levels (walk links, platforms, places). */
  level(p: Vec2, grade: number): number;
  rail(track: number, s: number): number;
  ground(p: Vec2): number;
}
export const flatHeights: DebugHeights = {
  lane: () => 0,
  node: () => 0,
  level: () => 0,
  rail: () => 0,
  ground: () => 0,
};
/** Heights above ground from the compiled grade profiles, without terrain: the 2D Heights and
 * grades view. */
export function profileHeights(city: CompiledCity): DebugHeights {
  const profiles = gradeProfiles(city);
  const rail = city.rail
    ? railHeights(
        city,
        city.roads.map((r) => r.grade),
        city.nodes.map((n) => n.grade),
      )
    : undefined;
  return {
    lane(index, vertex) {
      const road = city.roads[city.lanes[index]!.road]!;
      return profileHeightAt(profiles.roads[road.idx]!, road.stations[vertex]! - road.stations[0]!);
    },
    node: (node) => profiles.nodes[node]!,
    level: (_, grade) => grade * gradeHeightM,
    rail: (track, s) => (rail ? railHeightAt(rail, city.rail!.tracks[track]!, s) : 0),
    ground: () => 0,
  };
}

const at = (p: Vec2, z = 0): P3 => ({ x: p.x, y: p.y, z });
const ring = (points: readonly Vec2[], z: (p: Vec2) => number) => {
  const out = points.map((p) => at(p, z(p)));
  if (out.length) out.push(out[0]!);
  return out;
};
function circle(centre: Vec2, radiusM: number, z: number) {
  const out: P3[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    out.push({ x: centre.x + radiusM * Math.cos(a), y: centre.y + radiusM * Math.sin(a), z });
  }
  return out;
}
/** A bar across a line at `p`, `widthM` wide. */
function across(p: Vec2, heading: number, widthM: number, z: number): P3[] {
  const dx = (-Math.sin(heading) * widthM) / 2,
    dy = (Math.cos(heading) * widthM) / 2;
  return [
    { x: p.x + dx, y: p.y + dy, z },
    { x: p.x - dx, y: p.y - dy, z },
  ];
}
/** The stretch of a polyline between two stations. */
function stretch(line: readonly Vec2[], cumulative: Float64Array, fromM: number, toM: number) {
  const out: Vec2[] = [pointAtDistance(line, cumulative, fromM)];
  for (let i = 0; i < line.length; i++)
    if (cumulative[i]! > fromM && cumulative[i]! < toM) out.push(line[i]!);
  out.push(pointAtDistance(line, cumulative, toM));
  return out;
}

const lanePoints = (city: CompiledCity, lane: number, heights: DebugHeights) =>
  city.lanes[lane]!.polyline.map((p, i) => at(p, heights.lane(lane, i)));
const movementPoints = (city: CompiledCity, movement: number, heights: DebugHeights) => {
  const m = city.movements[movement]!;
  const from = heights.lane(m.fromLane, city.lanes[m.fromLane]!.polyline.length - 1);
  const to = heights.lane(m.toLane, 0);
  return m.polyline.map((p, i) =>
    at(p, from + ((to - from) * m.cumulative[i]!) / Math.max(1e-6, m.lengthM)),
  );
};

const nodeInks = {
  junction: 'blue',
  signal: 'red',
  roundabout: 'amber',
  'dead end': 'grey',
  gateway: 'purple',
} as const satisfies Record<string, Ink>;

function roadGraph(city: CompiledCity, source: CityGeometry | undefined, heights: DebugHeights) {
  const items: DebugItem[] = [];
  const gateways = new Set<number>();
  for (const place of city.places) {
    if (place.kind !== 'gateway') continue;
    for (const c of [...place.connectorsIn, ...place.connectorsOut]) {
      const connector = city.connectors[c]!;
      const lane = city.lanes[connector.lane]!;
      const road = city.roads[lane.road]!;
      gateways.add(connector.positionM < lane.lengthM / 2 ? road.from : road.to);
    }
  }
  const degree = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!degree.has(a)) degree.set(a, new Set());
    degree.get(a)!.add(b);
  };
  for (const road of city.roads) {
    link(road.from, road.to);
    link(road.to, road.from);
    const first = city.lanes[road.lanes[0]!]!;
    const last = city.lanes[road.lanes.at(-1)!]!;
    const middle = first.polyline.map((p, i) =>
      at(
        { x: (p.x + last.polyline[i]!.x) / 2, y: (p.y + last.polyline[i]!.y) / 2 },
        (heights.lane(first.idx, i) + heights.lane(last.idx, i)) / 2,
      ),
    );
    items.push({
      kind: 'line',
      points: [
        at(city.nodes[road.from]!.pos, heights.node(road.from)),
        ...middle,
        at(city.nodes[road.to]!.pos, heights.node(road.to)),
      ],
      ink: 'blue',
      width: 1.5,
      arrow: true,
      target: { label: `Road ${road.id}`, pick: { kind: 'lane', lane: first.idx, road: road.idx } },
    });
  }
  for (const node of city.nodes) {
    const signal = node.signal || node.control === 'signal';
    const kind = gateways.has(node.idx)
      ? 'gateway'
      : signal
        ? 'signal'
        : node.miniRoundabout || source?.nodes[node.id]?.roundabout
          ? 'roundabout'
          : (degree.get(node.idx)?.size ?? 0) <= 1
            ? 'dead end'
            : 'junction';
    const through = kind === 'junction' && degree.get(node.idx)!.size === 2;
    items.push({
      kind: 'dot',
      at: at(node.pos, heights.node(node.idx)),
      ink: nodeInks[kind],
      radius: through ? 2 : 3.5,
      target: { label: `Node ${node.id} · ${kind}`, pick: { kind: 'node', node: node.idx } },
    });
  }
  return items;
}

function lanes(city: CompiledCity, heights: DebugHeights) {
  const items: DebugItem[] = [];
  for (const lane of city.lanes) {
    const points = lanePoints(city, lane.idx, heights);
    items.push({
      kind: 'line',
      points,
      ink: 'teal',
      width: 1,
      arrow: true,
      target: { label: `Lane ${lane.id}`, pick: { kind: 'lane', lane: lane.idx, road: lane.road } },
    });
    if (!lane.out.length) continue;
    const stop = pointAtDistance(lane.polyline, lane.cumulative, lane.stopM);
    const z = heights.lane(lane.idx, lane.polyline.length - 1);
    items.push({
      kind: 'line',
      points: across(
        stop,
        headingAtDistance(lane.polyline, lane.cumulative, lane.stopM),
        lane.widthM,
        z,
      ),
      ink: 'red',
      width: 2,
      minScale: 1.5,
    });
  }
  for (const m of city.movements) {
    const points = movementPoints(city, m.idx, heights);
    items.push({
      kind: 'line',
      points,
      ink: 'purple',
      width: 1,
      minScale: 1.5,
      target: { label: `Movement ${m.id} · ${m.turn}`, pick: { kind: 'node', node: m.node } },
    });
    for (let i = 0; i < m.conflicts.length; i++) {
      if (m.conflicts[i]! < m.idx) continue;
      const [fromM, toM] = m.conflictZones[i]!;
      const p = pointAtDistance(m.polyline, m.cumulative, (fromM + toM) / 2);
      items.push({
        kind: 'dot',
        at: at(p, points[Math.min(points.length - 1, 1)]!.z),
        ink: 'amber',
        radius: 2,
        minScale: 4,
      });
    }
  }
  return items;
}

function railGraph(city: CompiledCity, heights: DebugHeights) {
  const rail = city.rail;
  if (!rail) return [];
  const items: DebugItem[] = [];
  // Signal block sections: tracks joined at nodes without a signal share a section.
  const parent = rail.tracks.map((t) => t.idx);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const node of rail.nodes) {
    if (node.signal) continue;
    for (let i = 1; i < node.tracks.length; i++)
      parent[find(node.tracks[i]!)] = find(node.tracks[0]!);
  }
  const sectionInks = ['teal', 'blue', 'green'] as const;
  const sections = new Map<number, number>();
  for (const track of rail.tracks) {
    const root = find(track.idx);
    if (!sections.has(root)) sections.set(root, sections.size);
    items.push({
      kind: 'line',
      points: track.line.map((p, i) => at(p, heights.rail(track.idx, track.cumulative[i]!))),
      ink: sectionInks[sections.get(root)! % sectionInks.length]!,
      width: 1.5,
      dash: track.tunnel,
      target: {
        label: `Track ${track.id} · ${track.kind} · section ${sections.get(root)! + 1}`,
        pick: { kind: 'track', track: track.idx },
      },
    });
  }
  for (const node of rail.nodes) {
    const switched = node.kind === 'switch' || rail.connections.some((c) => c.node === node.idx);
    const ink: Ink = node.signal
      ? 'pink'
      : node.kind === 'buffer_stop'
        ? 'red'
        : switched
          ? 'amber'
          : node.kind === 'level_crossing'
            ? 'purple'
            : 'grey';
    const kind = node.signal ? 'signal' : switched ? 'switch' : node.kind.replace('_', ' ');
    const track = rail.tracks[node.tracks[0]!];
    const z = track ? heights.rail(track.idx, track.fromNode === node.idx ? 0 : track.lengthM) : 0;
    items.push({
      kind: 'dot',
      at: at(node.pos, z),
      ink,
      radius: ink === 'grey' ? 1.5 : 3,
      minScale: ink === 'grey' ? 1 : undefined,
      target: { label: `Rail node ${node.id} · ${kind}` },
    });
  }
  rail.platforms.forEach((platform, idx) => {
    const z = (p: Vec2) => heights.level(p, platform.layer);
    const { shape } = platform;
    items.push({
      kind: 'line',
      points:
        shape.kind === 'polygon'
          ? ring(shape.ring, z)
          : shape.kind === 'line'
            ? shape.line.map((p) => at(p, z(p)))
            : circle(shape.pos, 3, z(shape.pos)),
      ink: 'purple',
      width: 1.5,
      target: {
        label: `Platform ${platform.ref ?? platform.id}${platform.name ? ` · ${platform.name}` : ''}`,
        pick: { kind: 'platform', platform: idx },
      },
    });
  });
  return items;
}

function airsideGraph(city: CompiledCity, heights: DebugHeights) {
  const graph = city.airside;
  if (!graph) return [];
  const items: DebugItem[] = [];
  const ground = (p: Vec2) => at(p, heights.ground(p));
  for (const edge of graph.edges) {
    if (edge.kind === 'runway') continue;
    const name = edge.ref ? `${edge.kind} ${edge.ref}` : edge.kind;
    items.push({
      kind: 'line',
      points: edge.line.map(ground),
      ink: edge.kind === 'taxilane' ? 'green' : 'teal',
      width: 1.5,
      dash: edge.oneway ? undefined : edge.kind === 'taxilane',
      arrow: edge.oneway,
      target: {
        label: `${name[0]!.toUpperCase()}${name.slice(1)} ${edge.id}`,
        pick: { kind: 'taxiway', edge: edge.idx },
      },
    });
  }
  for (const node of graph.nodes)
    items.push({ kind: 'dot', at: ground(node.pos), ink: 'grey', radius: 1.5, minScale: 0.3 });
  for (const runway of graph.runways) {
    const cumulative = cumulativeLengths(runway.line);
    items.push({
      kind: 'line',
      points: runway.line.map(ground),
      ink: 'purple',
      width: 3,
      target: { label: `Runway ${runway.ref}` },
    });
    for (const end of runway.ends) {
      const p = pointAtDistance(runway.line, cumulative, end.thresholdM);
      const heading = headingAtDistance(runway.line, cumulative, end.thresholdM);
      items.push(
        {
          kind: 'line',
          points: across(p, heading, runway.widthM, heights.ground(p)),
          ink: 'red',
          width: 2.5,
        },
        { kind: 'dot', at: ground(graph.nodes[end.node]!.pos), ink: 'purple', radius: 3 },
        { kind: 'text', at: ground(p), text: end.designator, ink: 'purple' },
      );
    }
  }
  for (const hold of graph.holds) {
    const node = graph.nodes[hold.node]!;
    const edge = graph.edges[hold.toward];
    const heading = edge
      ? headingAtDistance(edge.line, edge.cumulative, edge.from === node.idx ? 0 : edge.lengthM)
      : 0;
    items.push({
      kind: 'line',
      points: across(node.pos, heading, Math.max(12, edge?.widthM ?? 0), heights.ground(node.pos)),
      ink: 'amber',
      width: 2.5,
      target: {
        label: `Holding position ${hold.ref ?? hold.id}`,
        pick: { kind: 'hold', hold: hold.idx },
      },
    });
  }
  for (const stand of graph.stands) {
    const tip = {
      x: stand.pos.x + Math.cos(stand.heading) * 8,
      y: stand.pos.y + Math.sin(stand.heading) * 8,
    };
    items.push(
      {
        kind: 'dot',
        at: ground(stand.pos),
        ink: 'green',
        radius: 3,
        target: {
          label: `Stand ${stand.ref ?? stand.id}`,
          pick: { kind: 'stand', stand: stand.idx },
        },
      },
      { kind: 'line', points: [ground(stand.pos), ground(tip)], ink: 'green', width: 1.5 },
    );
  }
  return items;
}

/** TASK-373: the glide path down to each runway end arrivals use (3D only). */
export function glidePaths(
  city: CompiledCity,
  heights: DebugHeights,
  arrivalEnds: readonly number[] | undefined,
  glideSlopeDeg: number,
) {
  const graph = city.airside;
  if (!graph) return [];
  const items: DebugItem[] = [];
  const slope = Math.tan((glideSlopeDeg * Math.PI) / 180);
  for (const runway of graph.runways) {
    const which = arrivalEnds?.[runway.idx] ?? -1;
    if (which < 0) continue;
    const end = runway.ends[which]!;
    const cumulative = cumulativeLengths(runway.line);
    const sign = which === 0 ? 1 : -1;
    const aimM = end.thresholdM + sign * Math.min(300, runway.lengthM / 3);
    const aim = pointAtDistance(runway.line, cumulative, aimM);
    const heading = headingAtDistance(runway.line, cumulative, aimM) + (which === 0 ? 0 : Math.PI);
    const z = heights.ground(aim);
    const points: P3[] = [];
    for (let d = 0; d <= 10_000; d += 500)
      points.push({
        x: aim.x - Math.cos(heading) * d,
        y: aim.y - Math.sin(heading) * d,
        z: z + slope * d,
      });
    items.push({
      kind: 'line',
      points,
      ink: 'pink',
      width: 1.5,
      dash: true,
      target: { label: `Glide path ${end.designator} · ${glideSlopeDeg.toFixed(1)}°` },
    });
  }
  return items;
}

function walkNetwork(city: CompiledCity, source: CityGeometry | undefined, heights: DebugHeights) {
  const items: DebugItem[] = [];
  const { nodes, links } = city.walk;
  for (const link of links) {
    const crossing = link.crossing?.control;
    items.push({
      kind: 'line',
      points: link.line.map((p) => at(p, heights.level(p, link.layer))),
      ink:
        crossing === 'signal'
          ? 'red'
          : crossing
            ? 'amber'
            : link.kind === 'access'
              ? 'purple'
              : 'green',
      width: crossing ? 2 : 1,
      dash: crossing === 'unmarked' || link.kind === 'steps',
      minScale: crossing || link.kind === 'access' ? undefined : 0.8,
      target: { label: `Walk link ${link.id} · ${crossing ? `${crossing} crossing` : link.kind}` },
    });
  }
  for (const node of nodes)
    items.push({
      kind: 'dot',
      at: at(node.pos, heights.level(node.pos, node.layer)),
      ink: 'green',
      radius: 1.5,
      minScale: 2,
    });
  for (const node of Object.values(source?.walk?.nodes ?? {})) {
    if (!node.entrance) continue;
    items.push({
      kind: 'dot',
      at: at(node.pos, heights.level(node.pos, node.layer)),
      ink: 'purple',
      radius: 3,
      hollow: true,
      target: {
        label: `Entrance ${node.id}${node.entrance.placeId ? ` · ${node.entrance.placeId}` : ''}`,
      },
    });
  }
  for (const stop of city.rail?.tramStops ?? [])
    for (const halt of stop.halts)
      items.push({
        kind: 'dot',
        at: at(halt.pos, heights.level(halt.pos, stop.layer)),
        ink: 'pink',
        radius: 3,
        hollow: true,
        target: { label: `Tram stop ${stop.name || stop.id}` },
      });
  return items;
}

function placesAndAccess(
  city: CompiledCity,
  source: CityGeometry | undefined,
  heights: DebugHeights,
) {
  const items: DebugItem[] = [];
  const ground = (p: Vec2) => heights.ground(p);
  for (const place of city.places) {
    const shape = source?.places[place.id]?.shape;
    if (!shape) continue;
    items.push({
      kind: 'line',
      points:
        shape.kind === 'polygon'
          ? ring(shape.ring, ground)
          : circle(shape.pos, 6, ground(shape.pos)),
      ink: 'purple',
      width: 1.25,
      target: {
        label: `Place ${place.id} · ${place.kind}`,
        pick: { kind: 'place', place: place.idx },
      },
    });
  }
  for (const connector of city.connectors) {
    const p = connectorPosition(city, connector);
    const lane = city.lanes[connector.lane]!;
    const vertex = Math.max(
      0,
      lane.cumulative.findIndex((s) => s >= connector.positionM),
    );
    const z = heights.lane(lane.idx, vertex);
    const place = city.places[connector.place];
    items.push({
      kind: 'dot',
      at: at(p, z),
      ink: connector.direction === 'in' ? 'green' : connector.direction === 'out' ? 'blue' : 'teal',
      radius: 3,
      target: {
        label: `Connector ${connector.id} · ${connector.direction}${place ? ` · ${place.id}` : ''}`,
        pick: { kind: 'connector', connector: connector.idx },
      },
    });
    if (place)
      items.push({
        kind: 'line',
        points: [at(p, z), at(place.centroid, ground(place.centroid))],
        ink: 'grey',
        width: 1,
        dash: true,
        minScale: 1,
      });
  }
  for (const space of city.parkingSpaces ?? []) {
    const access = connectorPosition(city, city.connectors[space.connector]!);
    items.push(
      {
        kind: 'dot',
        at: at(space.position, ground(space.position)),
        ink: 'amber',
        radius: 1.5,
        minScale: 2,
        target: {
          label: `Parking space ${space.idx} · ${city.parking[space.parking]!.id}`,
          pick: { kind: 'parked', space: space.idx },
        },
      },
      {
        kind: 'line',
        points: [at(space.position, ground(space.position)), at(access, ground(access))],
        ink: 'amber',
        width: 1,
        minScale: 4,
      },
    );
  }
  for (const lot of city.lots ?? [])
    for (const path of lot.aislePaths ?? [])
      items.push({
        kind: 'line',
        points: path.map((p) => at(p, ground(p))),
        ink: 'amber',
        width: 1,
        dash: true,
        minScale: 1,
      });
  return items;
}

/** The overlays that depend only on the city. */
export function networkLayer(
  overlay: 'roadGraph' | 'lanes' | 'railGraph' | 'airsideGraph' | 'walkNetwork' | 'places',
  city: CompiledCity,
  source: CityGeometry | undefined,
  heights: DebugHeights,
): DebugItem[] {
  switch (overlay) {
    case 'roadGraph':
      return roadGraph(city, source, heights);
    case 'lanes':
      return lanes(city, heights);
    case 'railGraph':
      return railGraph(city, heights);
    case 'airsideGraph':
      return airsideGraph(city, heights);
    case 'walkNetwork':
      return walkNetwork(city, source, heights);
    case 'places':
      return placesAndAccess(city, source, heights);
  }
}

/** TASK-373 Heights and grades: each road's surface by elevation on the ramp (its width scaled
 * when `fill`), bridge decks cased, tunnels dashed, its grade in per cent. */
export function heightsLayer(
  city: CompiledCity,
  heights: DebugHeights,
  ramp: readonly number[],
  fill: boolean,
): DebugItem[] {
  const items: DebugItem[] = [];
  let low = Infinity,
    high = -Infinity;
  const roadPoints = city.roads.map((road) => {
    const lane = city.lanes[road.lanes[0]!]!;
    const points = lanePoints(city, lane.idx, heights);
    for (const p of points) {
      low = Math.min(low, p.z);
      high = Math.max(high, p.z);
    }
    return points;
  });
  for (const track of city.rail?.tracks ?? [])
    for (const s of [0, track.lengthM]) {
      const z = heights.rail(track.idx, s);
      low = Math.min(low, z);
      high = Math.max(high, z);
    }
  if (low > high) return items;
  high = Math.max(high, low + 10);
  // Twenty steps on the ramp, so a road's segments of one step draw as one line.
  const colour = (z: number) => rampColour(ramp, Math.round((20 * (z - low)) / (high - low)) / 20);
  city.roads.forEach((road, i) => {
    const points = roadPoints[i]!;
    const widthM = road.lanes.reduce((sum, lane) => sum + city.lanes[lane]!.widthM, 0);
    const bridge = road.grade > 0,
      tunnel = road.grade < 0;
    if (fill && bridge)
      items.push({ kind: 'line', points, ink: 'grey', width: 3, widthM: widthM + 2 });
    for (const run of colourRuns(points, colour))
      items.push({
        kind: 'line',
        ...run,
        ink: 'grey',
        width: fill ? 1.5 : 2.5,
        widthM: fill ? widthM : undefined,
        dash: tunnel,
      });
    const span = points.at(-1)!;
    const lengthM = Math.max(1, road.lengthM);
    const grade = (100 * (span.z - points[0]!.z)) / lengthM;
    const middle = points[Math.floor(points.length / 2)]!;
    items.push({
      kind: 'text',
      at: middle,
      text: `${grade >= 0 ? '+' : ''}${grade.toFixed(1)}%${bridge ? ' bridge' : tunnel ? ' tunnel' : ''}`,
      ink: bridge ? 'purple' : tunnel ? 'blue' : 'grey',
      minScale: Math.abs(grade) >= 0.5 || bridge || tunnel ? 1.5 : 6,
    });
  });
  for (const track of city.rail?.tracks ?? []) {
    const points = track.line.map((p, i) => at(p, heights.rail(track.idx, track.cumulative[i]!)));
    for (const run of colourRuns(points, colour))
      items.push({ kind: 'line', ...run, ink: 'grey', width: 2, dash: track.tunnel });
  }
  return items;
}

/** A polyline split where its segments' colour changes, each run sharing its end points. */
function colourRuns(points: P3[], colour: (z: number) => number) {
  const runs: { points: P3[]; colour: number }[] = [];
  for (let j = 1; j < points.length; j++) {
    const c = colour((points[j - 1]!.z + points[j]!.z) / 2);
    const run = runs.at(-1);
    if (run?.colour === c) run.points.push(points[j]!);
    else runs.push({ points: [points[j - 1]!, points[j]!], colour: c });
  }
  return runs;
}

export function rampColour(ramp: readonly number[], t: number) {
  const u = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(u));
  const f = u - i;
  const a = ramp[i]!,
    b = ramp[i + 1]!;
  const mix = (shift: number) =>
    Math.round(((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f) << shift;
  return mix(16) | mix(8) | mix(0);
}

const waitInks: Ink[] = ['green', 'grey', 'amber', 'red', 'purple', 'teal'];
const waitNames = ['moving', 'in a queue', 'at its junction', 'jammed', 'parking', 'arriving'];

/** Where a vehicle of the snapshot stands, with its height. */
function vehiclePlace(
  snapshot: VehicleSnapshot,
  i: number,
  city: CompiledCity,
  heights: DebugHeights,
) {
  const p = { x: snapshot.x[i]!, y: snapshot.y[i]! };
  const field = snapshot.lane[i]!;
  if (field < 0) {
    const m = city.movements[-field - 1];
    return at(p, m ? heights.node(m.node) : heights.ground(p));
  }
  const lane = city.lanes[field];
  if (!lane) return at(p, heights.ground(p));
  let nearest = 0,
    best = Infinity;
  lane.polyline.forEach((q, k) => {
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < best) [best, nearest] = [d, k];
  });
  return at(p, heights.lane(lane.idx, nearest) + 0.2);
}

function vehiclesLayer(
  city: CompiledCity,
  snapshot: VehicleSnapshot,
  debug: DebugSnapshot | undefined,
  selected: number | null,
  heights: DebugHeights,
) {
  const items: DebugItem[] = [];
  const places = new Map<number, P3>();
  for (let i = 0; i < snapshot.count; i++)
    places.set(snapshot.id[i]!, vehiclePlace(snapshot, i, city, heights));
  const details = new Map<number, VehicleDebug>((debug?.vehicles ?? []).map((v) => [v.id, v]));
  for (let i = 0; i < snapshot.count; i++) {
    const id = snapshot.id[i]!;
    const place = places.get(id)!;
    const detail = details.get(id);
    const wait = detail?.wait ?? (snapshot.speed[i]! < 0.1 ? 1 : 0);
    items.push(
      {
        kind: 'dot',
        at: place,
        ink: waitInks[wait]!,
        radius: 3,
        hollow: true,
        target: {
          label: `Vehicle ${id} · ${waitNames[wait]} · ${(snapshot.speed[i]! * 3.6).toFixed(0)} km/h${
            detail && detail.leader ? ` · gap ${detail.gapM.toFixed(1)} m to ${detail.leader}` : ''
          }`,
          pick: { kind: 'vehicle', id },
        },
      },
      { kind: 'text', at: place, text: String(id), ink: waitInks[wait]!, minScale: 3 },
    );
    if (!detail) continue;
    const leader = detail.leader ? places.get(detail.leader) : undefined;
    if (leader) {
      items.push({
        kind: 'line',
        points: [place, leader],
        ink: detail.gapM < 2.5 ? 'red' : 'blue',
        width: 1,
        arrow: true,
        minScale: 1.5,
      });
      items.push({
        kind: 'text',
        at: {
          x: (place.x + leader.x) / 2,
          y: (place.y + leader.y) / 2,
          z: (place.z + leader.z) / 2,
        },
        text: `${detail.gapM.toFixed(1)} m`,
        ink: 'blue',
        minScale: 6,
      });
    }
    // A change under way moves against its remaining offset; one waiting for a gap points at
    // the lane it needs. Lane index 0 is the leftmost in travel direction.
    const lateral = snapshot.lateralM[i]!;
    const wanted = detail.wantsLane >= 0 ? city.lanes[detail.wantsLane] : undefined;
    const current = city.lanes[snapshot.lane[i]!];
    const side = lateral
      ? -Math.sign(lateral)
      : wanted && current
        ? Math.sign(wanted.lane - current.lane)
        : 0;
    if (side) {
      const heading = snapshot.heading[i]!;
      items.push({
        kind: 'line',
        points: [
          place,
          {
            x: place.x - Math.sin(heading) * 3.2 * side + Math.cos(heading) * 4,
            y: place.y + Math.cos(heading) * 3.2 * side + Math.sin(heading) * 4,
            z: place.z,
          },
        ],
        ink: 'pink',
        width: 1.5,
        arrow: true,
        dash: !lateral,
        minScale: 2,
      });
    }
    // The route ahead: the next movement for every vehicle, the whole of it for the selected one.
    const route = id === selected ? detail.route : detail.route.slice(0, 1);
    for (const movement of route) {
      const m = city.movements[movement];
      if (!m) break;
      items.push({
        kind: 'line',
        points: movementPoints(city, movement, heights),
        ink: 'blue',
        width: id === selected ? 2.5 : 1,
        minScale: id === selected ? undefined : 3,
      });
      if (id === selected)
        items.push({
          kind: 'line',
          points: lanePoints(city, m.toLane, heights),
          ink: 'blue',
          width: 2.5,
          dash: true,
        });
    }
  }
  return items;
}

function signalsLayer(
  city: CompiledCity,
  states: SignalStates | undefined,
  timeS: number,
  selected: number | null,
  heights: DebugHeights,
) {
  const items: DebugItem[] = [];
  for (const node of city.nodes) {
    const signal = node.signal;
    if (!signal) continue;
    const light = signalLight(signal, node.idx, timeS, states);
    const lanes = new Map<number, ('green' | 'amber' | 'red')[]>();
    for (const head of signalHeads(city, node)) {
      if (!lanes.has(head.lane)) lanes.set(head.lane, []);
      lanes.get(head.lane)!.push(movementLight(signal, light, head.movement));
    }
    for (const [index, colours] of lanes) {
      const lane = city.lanes[index]!;
      const stop = pointAtDistance(lane.polyline, lane.cumulative, lane.stopM);
      const heading = headingAtDistance(lane.polyline, lane.cumulative, lane.stopM);
      const colour = colours.includes('green')
        ? 'green'
        : colours.includes('amber')
          ? 'amber'
          : 'red';
      items.push({
        kind: 'line',
        points: across(
          stop,
          heading,
          lane.widthM * 0.9,
          heights.lane(index, lane.polyline.length - 1),
        ),
        ink: colour,
        width: 4,
        target: {
          label: `Lane ${lane.id} · ${colour} · phase ${light.phase + 1} of ${signal.phases.length}`,
          pick: { kind: 'node', node: node.idx },
        },
      });
    }
    items.push({
      kind: 'text',
      at: at(node.pos, heights.node(node.idx)),
      text: `P${light.phase + 1}/${signal.phases.length} ${light.state}`,
      ink: light.state === 'green' ? 'green' : light.state === 'amber' ? 'amber' : 'red',
      minScale: 1.5,
    });
  }
  if (selected === null) return items;
  // The selected junction's conflict matrix: its movements numbered, and a cell per pair that
  // conflicts, as a grid beside the junction.
  const node = city.nodes[selected];
  if (!node || !node.movements.length) return items;
  const ms = node.movements;
  const z = heights.node(node.idx);
  ms.forEach((movement, k) => {
    const m = city.movements[movement]!;
    const points = movementPoints(city, movement, heights);
    items.push(
      { kind: 'line', points, ink: 'purple', width: 1.5, arrow: true },
      {
        kind: 'text',
        at: at(pointAtDistance(m.polyline, m.cumulative, m.lengthM * 0.5), points[0]!.z),
        text: String(k + 1),
        ink: 'purple',
      },
    );
  });
  const cellM = Math.max(1.2, Math.min(3, 40 / ms.length));
  const origin = { x: node.pos.x + node.radiusM + 6, y: node.pos.y - (cellM * ms.length) / 2 };
  ms.forEach((a, r) => {
    const conflicts = new Set(city.movements[a]!.conflicts);
    items.push({
      kind: 'text',
      at: { x: origin.x - cellM, y: origin.y + (r + 0.5) * cellM, z },
      text: String(r + 1),
      ink: 'grey',
    });
    ms.forEach((b, c) => {
      const x = origin.x + c * cellM,
        y = origin.y + r * cellM;
      const square = [
        { x, y, z },
        { x: x + cellM, y, z },
        { x: x + cellM, y: y + cellM, z },
        { x, y: y + cellM, z },
        { x, y, z },
      ];
      items.push({
        kind: 'line',
        points: square,
        ink: a === b ? 'grey' : conflicts.has(b) ? 'red' : 'grey',
        width: conflicts.has(b) ? 2.5 : 0.75,
        target: conflicts.has(b)
          ? {
              label: `${city.movements[a]!.id} conflicts with ${city.movements[b]!.id}`,
            }
          : undefined,
      });
    });
  });
  return items;
}

function aircraftLayer(
  city: CompiledCity,
  snapshot: VehicleSnapshot,
  debug: DebugSnapshot | undefined,
  heights: DebugHeights,
) {
  const graph = city.airside;
  const items: DebugItem[] = [];
  if (!graph || !snapshot.aircraft) return items;
  const places = new Map<number, P3>();
  for (const pose of snapshot.aircraft) {
    const p = { x: pose.x, y: pose.y };
    places.set(pose.id, at(p, heights.ground(p) + pose.heightM));
  }
  for (const pose of snapshot.aircraft) {
    const place = places.get(pose.id)!;
    items.push(
      {
        kind: 'dot',
        at: place,
        ink: pose.airborne ? 'pink' : 'purple',
        radius: 3.5,
        target: {
          label: `${pose.registration} · ${pose.typeId} · ${pose.state}`,
          pick: { kind: 'aircraft', id: pose.id },
        },
      },
      { kind: 'text', at: place, text: pose.registration, ink: 'purple' },
    );
  }
  for (const craft of debug?.aircraft ?? []) {
    const place = places.get(craft.id);
    if (!place) continue;
    if (craft.radiusM > 0)
      items.push({
        kind: 'line',
        points: circle(place, craft.radiusM, place.z),
        ink: 'purple',
        width: 1,
        dash: true,
      });
    for (const { edge, fromM, toM } of craft.reserved) {
      const e = graph.edges[edge];
      if (!e) continue;
      const lo = Math.max(0, Math.min(fromM, toM)),
        hi = Math.min(e.lengthM, Math.max(fromM, toM));
      if (hi <= lo) continue;
      items.push({
        kind: 'line',
        points: stretch(e.line, e.cumulative, lo, hi).map((p) => at(p, heights.ground(p) + 0.3)),
        ink: 'amber',
        width: 4,
        target: {
          label: `Reserved by aircraft ${craft.id}: ${e.id} ${lo.toFixed(0)}-${hi.toFixed(0)} m`,
        },
      });
    }
  }
  for (const link of debug?.aircraftWaits ?? []) {
    const from = places.get(link.from),
      to = places.get(link.to);
    if (from && to)
      items.push({
        kind: 'line',
        points: [from, to],
        ink: link.ring ? 'red' : 'blue',
        width: 1.5,
        arrow: true,
      });
  }
  return items;
}

function gridlockLayer(
  snapshot: VehicleSnapshot,
  debug: DebugSnapshot | undefined,
  city: CompiledCity,
  heights: DebugHeights,
) {
  const items: DebugItem[] = [];
  const vehicles = new Map<number, P3>();
  for (let i = 0; i < snapshot.count; i++)
    vehicles.set(snapshot.id[i]!, vehiclePlace(snapshot, i, city, heights));
  const aircraft = new Map<number, P3>();
  for (const pose of snapshot.aircraft ?? [])
    aircraft.set(pose.id, at(pose, heights.ground(pose) + pose.heightM));
  const draw = (links: DebugSnapshot['vehicleWaits'], places: Map<number, P3>, kind: string) => {
    for (const link of links ?? []) {
      const from = places.get(link.from),
        to = places.get(link.to);
      if (!from || !to) continue;
      items.push({
        kind: 'line',
        points: [from, to],
        ink: link.ring ? 'red' : 'amber',
        width: link.ring ? 3 : 1.25,
        arrow: true,
        target: { label: `${kind} ${link.from} waits for ${link.to}${link.ring ? ' · ring' : ''}` },
      });
      if (link.ring) items.push({ kind: 'dot', at: from, ink: 'red', radius: 5, hollow: true });
    }
  };
  draw(debug?.vehicleWaits, vehicles, 'Vehicle');
  draw(debug?.aircraftWaits, aircraft, 'Aircraft');
  return items;
}

/** The overlays that follow the run. */
export function simLayer(
  overlay: 'vehicles' | 'signals' | 'aircraft' | 'gridlock',
  city: CompiledCity,
  snapshot: VehicleSnapshot & { debug?: DebugSnapshot },
  selection: Pick | null,
  heights: DebugHeights,
): DebugItem[] {
  switch (overlay) {
    case 'vehicles':
      return vehiclesLayer(
        city,
        snapshot,
        snapshot.debug,
        selection?.kind === 'vehicle' ? selection.id : null,
        heights,
      );
    case 'signals':
      return signalsLayer(
        city,
        snapshot.signals,
        snapshot.timeS,
        selection?.kind === 'node' ? selection.node : null,
        heights,
      );
    case 'aircraft':
      return aircraftLayer(city, snapshot, snapshot.debug, heights);
    case 'gridlock':
      return gridlockLayer(snapshot, snapshot.debug, city, heights);
  }
}

export const simOverlays = [
  'vehicles',
  'signals',
  'aircraft',
  'gridlock',
] as const satisfies readonly DebugOverlay[];
export const networkOverlays = [
  'roadGraph',
  'lanes',
  'railGraph',
  'airsideGraph',
  'walkNetwork',
  'places',
] as const satisfies readonly DebugOverlay[];

/** The spatial index of a layer's items, by their footprint on the ground (built on first use). */
export function layerIndex(layer: DebugLayer) {
  if (layer.index) return layer.index;
  const index = new Flatbush(Math.max(1, layer.items.length));
  for (const item of layer.items) {
    const points = item.kind === 'line' ? item.points : [item.at];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    index.add(minX, minY, maxX, maxY);
  }
  if (!layer.items.length) index.add(0, 0, 0, 0);
  index.finish();
  return (layer.index = index);
}
