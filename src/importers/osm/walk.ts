import {
  nearestOnPolyline,
  pointInPolygon,
  polylineCrossings,
  polylineLength,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { SIGNAL_NEAR_M } from '../../network/crossings';
import { allocateId, type City, type Road, type WalkKind, type WalkNode } from '../../schema';
import { clipPart, contains, type Bounds, type RoadPoint } from './clip';
import { drivableClass } from './filter';
import type { OsmData, OsmTags } from './parse';
import { osmLayer } from './roads';

/** OSM sides follow the way; a backward carriageway reverses them. */
export function sidewalkTags(tags: OsmTags, backward: boolean): Road['sidewalk'] {
  const value = (tag: string | undefined) =>
    tag === 'yes' || tag === 'no' || tag === 'separate' ? tag : undefined;
  const base = tags.sidewalk;
  const left =
    value(tags['sidewalk:left']) ??
    value(tags['sidewalk:both']) ??
    (base === 'left' || base === 'both' ? 'yes' : base === 'right' ? 'no' : value(base));
  const right =
    value(tags['sidewalk:right']) ??
    value(tags['sidewalk:both']) ??
    (base === 'right' || base === 'both' ? 'yes' : base === 'left' ? 'no' : value(base));
  if (left === undefined && right === undefined) return undefined;
  return backward ? { left: right, right: left } : { left, right };
}

/** The mapped pedestrian ways the walk network imports. */
const walkWays = (data: OsmData) =>
  data.way.filter(
    (way) =>
      ['footway', 'pedestrian', 'path', 'steps', 'living_street'].includes(way.tag.highway ?? '') ||
      way.tag.footway === 'crossing',
  );

export function importWalk(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
) {
  const walk: NonNullable<City['walk']> = { nodes: {}, links: {} };
  const sourceNodes = new Map(data.node.map((n) => [n.id, n]));
  const nodes = new Map<string, WalkNode>();
  const ways = walkWays(data);
  const incidents = new Map<number, { way: number; layer: number; through: boolean }[]>();
  for (const way of ways)
    for (const [i, ref] of way.nd.entries()) {
      const list = incidents.get(ref) ?? [];
      list.push({
        way: way.id,
        layer: osmLayer(way.tag) ?? 0,
        through: i > 0 && i < way.nd.length - 1,
      });
      incidents.set(ref, list);
    }
  const places = Object.values(city.places).sort((a, b) => a.id.localeCompare(b.id));
  const buildings = data.way.filter((way) => way.tag.building && way.tag.building !== 'no');
  const placeAt = (ref: number, pos: Vec2) => {
    const outlines = buildings.filter((way) => way.nd.includes(ref));
    const byId = places.find((place) =>
      outlines.some((way) => place.provenance.osmIds?.includes(way.id)),
    );
    if (byId) return byId.id;
    return (
      places.find(
        (place) =>
          place.shape.kind === 'polygon' &&
          (pointInPolygon(pos, place.shape.ring, 0.5) ||
            nearestOnPolyline(place.shape.ring, pos).away < 0.5),
      )?.id ?? null
    );
  };
  const addNode = (point: RoadPoint, layer: number) => {
    const key = point.key;
    const old = nodes.get(key);
    if (old) {
      if (
        layer === 0 &&
        (point.osmId === undefined || sourceNodes.get(point.osmId)?.tag.layer === undefined)
      )
        old.layer = 0;
      return old;
    }
    const source = point.osmId === undefined ? undefined : sourceNodes.get(point.osmId);
    const incident = point.osmId === undefined ? [] : (incidents.get(point.osmId) ?? []);
    const onDeck = incident.some(
      (e) =>
        e.layer === layer &&
        (e.through || incident.some((other) => other.way !== e.way && other.layer === layer)),
    );
    const entrance = source?.tag.entrance && source.tag.entrance !== 'no';
    const id = allocateId(city, 'wn');
    const node: WalkNode = {
      id,
      pos: point.pos,
      layer:
        source?.tag.layer !== undefined
          ? (osmLayer(source.tag) ?? layer)
          : layer !== 0 && !onDeck
            ? 0
            : layer,
      ...(entrance ? { entrance: { placeId: placeAt(source.id, point.pos) } } : {}),
      provenance: {
        source: 'osm',
        ...(point.osmId !== undefined ? { osmIds: [point.osmId] } : {}),
      },
    };
    walk.nodes[id] = node;
    nodes.set(key, node);
    return node;
  };
  for (const way of [...ways].sort((a, b) => a.id - b.id)) {
    const highway = way.tag.highway;
    if (way.tag.foot === 'no' || way.tag.access === 'no') continue;
    const kind: WalkKind = way.tag.footway === 'crossing' ? 'crossing' : (highway as WalkKind);
    const layer = osmLayer(way.tag) ?? 0;
    const width = Number(way.tag.width?.replace(/\s*m$/, ''));
    let run: RoadPoint[] = [];
    const flush = () => {
      for (const part of clipPart(run, bounds, `walk/${way.id}`, new Set())) {
        for (let i = 1; i < part.points.length; i++) {
          const a = part.points[i - 1]!,
            b = part.points[i]!;
          if (a.pos.x === b.pos.x && a.pos.y === b.pos.y) continue;
          const from = addNode(a, layer),
            to = addNode(b, layer);
          const id = allocateId(city, 'wl');
          walk.links[id] = {
            id,
            from: from.id,
            to: to.id,
            line: [from.pos, to.pos],
            kind,
            layer,
            widthM: width > 0 && Number.isFinite(width) ? width : null,
            provenance: { source: 'osm', osmIds: [way.id] },
          };
        }
      }
      run = [];
    };
    for (const ref of way.nd) {
      const pos = positions.get(ref);
      if (!pos) flush();
      else run.push({ key: String(ref), osmId: ref, pos });
    }
    flush();
  }
  for (const node of [...data.node].sort((a, b) => a.id - b.id)) {
    const pos = positions.get(node.id)!;
    if (
      !node.tag.entrance ||
      node.tag.entrance === 'no' ||
      !contains(bounds, pos) ||
      nodes.has(String(node.id))
    )
      continue;
    addNode({ key: String(node.id), osmId: node.id, pos }, osmLayer(node.tag) ?? 0);
  }
  city.walk = walk;
}

/** TASK-239: a crossing node's paint from its `crossing`, `crossing_ref` and `crossing:markings`
 * tags (TASK-217's full version): marked (zebra, marked, uncontrolled or signalised), or unmarked
 * or unknown (no tag says), which get no crossing link: a walk link carries only its kind, so it
 * would paint as a zebra (the owner's open schema decision for `crossing=unmarked` ways). */
export function markedCrossing(tags: OsmTags): boolean {
  const { crossing } = tags,
    markings = tags['crossing:markings'];
  if (crossing === 'unmarked' || crossing === 'no' || crossing === 'informal' || markings === 'no')
    return false;
  return (
    ['zebra', 'marked', 'uncontrolled', 'traffic_signals'].includes(crossing ?? '') ||
    tags.crossing_ref === 'zebra' ||
    markings !== undefined
  );
}

/** TASK-239: how far a road's centreline may lie from its crossing node (relaxing and separating
 * carriageways move centrelines off the mapped nodes). */
const NODE_ROAD_M = 3;
/** TASK-239: how far from a signalised node the compiled walk graph gives a mapped crossing that
 * node's walk light (`compileWalk`). */
const SIGNAL_WALK_M = 40;
/** TASK-239: a node crossing reaches this far beyond the outer lane edges of its roads, past the
 * curb, so the compiled walk graph joins its ends to the generated sidewalks (`SNAP_M`)... */
const NODE_KERB_M = 1.5;
/** ... or on to a mapped footway its line meets within this far of the lane edge (a separately
 * mapped sidewalk behind a verge or parking). */
const NODE_REACH_M = 8;

/**
 * TASK-239 (TASK-224 D1): a marked crossing mapped only as a node of a road (`highway=crossing`,
 * or a pedestrian signal `highway=traffic_signals` + `crossing=traffic_signals` whose control the
 * importer did not keep at the node), on no mapped pedestrian way or cycle track, becomes a
 * crossing link: straight across the carriageway of the node's road ways, square to the nearest
 * road, from beyond one outer lane edge to beyond the other (to a mapped footway within 8 m, else
 * 1.5 m out). The compiled walk graph then treats it as
 * a mapped crossing way: it joins its ends to the sidewalks, anchors it onto a junction arm's
 * stripes within 12 m, gives it a zebra's or a signal's priority and the stop line, and the
 * renderer paints it (zebra, or signal lines near a signal). Run last in the import, so that every
 * other id stays where it was (TASK-217: a walk id allocated before the rail import renumbers the
 * trams and moves their timetable offsets).
 */
export function addNodeCrossings(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
) {
  const walk = city.walk!;
  const paths = Object.values(walk.links).filter((link) => link.kind !== 'crossing');
  // Cycle tracks too: a crossing node on one is the cycle crossing (Freiburg 5268773652, Munich
  // 9344476700), whose pedestrian crossing OSM maps as its own way beside it.
  const onPath = new Set(
    [...walkWays(data), ...data.way.filter((way) => way.tag.highway === 'cycleway')].flatMap(
      (way) => way.nd,
    ),
  );
  const roadWays = new Map<number, number[]>();
  for (const way of data.way)
    if (drivableClass(way))
      for (const ref of way.nd) roadWays.set(ref, [...(roadWays.get(ref) ?? []), way.id]);
  const roadsByWay = new Map<number, Road[]>();
  for (const road of Object.values(city.roads))
    for (const way of road.provenance.osmIds ?? [])
      roadsByWay.set(way, [...(roadsByWay.get(way) ?? []), road]);
  const signals = Object.values(city.nodes).filter((n) => n.control === 'signal');
  const signalled = new Set(signals.map((n) => n.provenance.osmIds![0]));
  for (const node of [...data.node].sort((a, b) => a.id - b.id)) {
    const tags = node.tag;
    if (
      (tags.highway !== 'crossing' &&
        !(tags.highway === 'traffic_signals' && tags.crossing === 'traffic_signals')) ||
      !markedCrossing(tags) ||
      onPath.has(node.id) ||
      signalled.has(node.id)
    )
      continue;
    const pos = positions.get(node.id);
    const ways = roadWays.get(node.id);
    if (!pos || !ways || !contains(bounds, pos)) continue;
    const near = [...new Set(ways.flatMap((way) => roadsByWay.get(way) ?? []))]
      .map((road) => ({ road, hit: nearestOnPolyline(road.centerline, pos) }))
      .filter(({ hit }) => hit.away < NODE_ROAD_M)
      .sort((a, b) => a.hit.away - b.hit.away || a.road.id.localeCompare(b.road.id));
    if (!near.length) continue;
    // A signalised crossing is made only where it works as one: it paints its broken lines only
    // near a signal the import kept (`nearSignal`; Freiburg 507039980 lies 14.5 m from n:899),
    // and its walkers wait for a walk light only where the end of the road it crosses nearer it
    // is that signal (`compileWalk`). Elsewhere they would cross at will, as on a zebra, through
    // a signalised street: Freiburg 334475575, on the carriageway beside n:527's, alone cost its
    // gate 5.9 s (the first version).
    if (tags.crossing === 'traffic_signals') {
      const { road, hit } = near[0]!;
      const end =
        city.nodes[hit.along > polylineLength(road.centerline) / 2 ? road.to : road.from]!;
      const away = (n: { pos: Vec2 }) => Math.hypot(n.pos.x - pos.x, n.pos.y - pos.y);
      if (
        !signals.some((n) => away(n) < SIGNAL_NEAR_M) ||
        end.control !== 'signal' ||
        away(end) >= SIGNAL_WALK_M
      )
        continue;
    }
    const base = near[0]!.hit.point,
      direction = near[0]!.hit.direction;
    const normal = { x: -direction.y, y: direction.x };
    const grade = (road: Road) =>
      road.layer ?? Math.min(city.nodes[road.from]!.layer, city.nodes[road.to]!.layer);
    const layer = grade(near[0]!.road);
    let low = Infinity,
      high = -Infinity;
    for (const { road, hit } of near) {
      if (grade(road) !== layer) continue;
      const sign = hit.direction.x * direction.x + hit.direction.y * direction.y > 0 ? 1 : -1;
      const centre =
        (hit.point.x - base.x) * normal.x +
        (hit.point.y - base.y) * normal.y +
        sign * road.lateralOffsetM;
      const width = road.lanes.reduce((sum, lane) => sum + lane.widthM, 0);
      low = Math.min(low, centre - width / 2);
      high = Math.max(high, centre + width / 2);
    }
    const at = (offset: number) => ({
      x: base.x + normal.x * offset,
      y: base.y + normal.y * offset,
    });
    const end = (edge: number, side: number): WalkNode => {
      const ray = [at(edge), at(edge + side * NODE_REACH_M)];
      const hits = paths
        .filter((link) => (link.layer ?? walk.nodes[link.from]!.layer) === layer)
        .flatMap((link) => polylineCrossings(ray, link.line))
        .sort((a, b) => a.alongA - b.alongA);
      const id = allocateId(city, 'wn');
      return (walk.nodes[id] = {
        id,
        pos: hits[0]?.point ?? at(edge + side * NODE_KERB_M),
        layer,
        provenance: { source: 'osm', osmIds: [node.id] },
      });
    };
    const from = end(low, -1),
      to = end(high, 1);
    const id = allocateId(city, 'wl');
    walk.links[id] = {
      id,
      from: from.id,
      to: to.id,
      line: [from.pos, to.pos],
      kind: 'crossing',
      layer,
      widthM: null,
      provenance: { source: 'osm', osmIds: [node.id] },
    };
  }
}
