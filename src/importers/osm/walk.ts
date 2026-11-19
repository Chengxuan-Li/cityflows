import { nearestOnPolyline, pointInPolygon } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { allocateId, type City, type Road, type WalkKind, type WalkNode } from '../../schema';
import { clipPart, contains, type Bounds, type RoadPoint } from './clip';
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

export function importWalk(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
) {
  const walk: NonNullable<City['walk']> = { nodes: {}, links: {} };
  const sourceNodes = new Map(data.node.map((n) => [n.id, n]));
  const nodes = new Map<string, WalkNode>();
  const ways = data.way.filter(
    (way) =>
      ['footway', 'pedestrian', 'path', 'steps', 'living_street'].includes(way.tag.highway ?? '') ||
      way.tag.footway === 'crossing',
  );
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
    // TASK-217 (D1): a path mapped as a crossing (`path=crossing`, Freiburg's 31 sidepath
    // crossings, 12 of them signalised) is one, as `footway=crossing` is.
    const kind: WalkKind =
      way.tag.footway === 'crossing' || way.tag.path === 'crossing'
        ? 'crossing'
        : (highway as WalkKind);
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
  addNodeCrossings(city, walk, data, positions, bounds, incidents);
  city.walk = walk;
}

/** TASK-217 (D1): a crossing node's markings, from its `crossing`, `crossing_ref` and
 * `crossing:markings` tags: painted (zebra, marked, uncontrolled or signalised), or unmarked or
 * unknown (no tag says), which get no crossing link. */
function markedCrossing(tags: OsmTags): boolean {
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

/**
 * TASK-217 (D1): a marked crossing mapped only as a node of a road (`highway=crossing`, or a
 * signal with `crossing=traffic_signals`), on no mapped path, becomes a crossing link: straight
 * across the road's carriageways at the node, square to the road, 1.5 m beyond their outer lane
 * edges, so the compiled walk graph joins its ends to the sidewalks as it does a mapped crossing
 * way's, and the renderer paints it where it is (Freiburg's zebras 2479358348 and 9118444286 at
 * the Hauptbahnhof). Unmarked crossings stay unmapped, as before.
 */
function addNodeCrossings(
  city: City,
  walk: NonNullable<City['walk']>,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  incidents: Map<number, unknown[]>,
) {
  const roads = Object.values(city.roads);
  for (const node of [...data.node].sort((a, b) => a.id - b.id)) {
    const tags = node.tag;
    if (
      (tags.highway !== 'crossing' &&
        !(tags.highway === 'traffic_signals' && tags.crossing === 'traffic_signals')) ||
      !markedCrossing(tags) ||
      incidents.has(node.id)
    )
      continue;
    const pos = positions.get(node.id);
    if (!pos || !contains(bounds, pos)) continue;
    const near = roads
      .map((road) => ({ road, near: nearestOnPolyline(road.centerline, pos) }))
      .filter(({ near }) => near.away < 0.5);
    if (!near.length) continue;
    const { direction } = near[0]!.near;
    const normal = { x: -direction.y, y: direction.x };
    let low = Infinity,
      high = -Infinity;
    for (const { road, near: hit } of near) {
      const sign = hit.direction.x * direction.x + hit.direction.y * direction.y > 0 ? 1 : -1;
      const width = road.lanes.reduce((sum, lane) => sum + lane.widthM, 0);
      low = Math.min(low, sign * road.lateralOffsetM - width / 2);
      high = Math.max(high, sign * road.lateralOffsetM + width / 2);
    }
    const layer = osmLayer(tags) ?? near[0]!.road.layer ?? 0;
    const end = (offset: number): WalkNode => {
      const id = allocateId(city, 'wn');
      const point = { x: pos.x + normal.x * offset, y: pos.y + normal.y * offset };
      return (walk.nodes[id] = {
        id,
        pos: point,
        layer,
        provenance: { source: 'osm', osmIds: [node.id] },
      });
    };
    const from = end(low - 1.5),
      to = end(high + 1.5);
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
