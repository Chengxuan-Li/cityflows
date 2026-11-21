import Flatbush from 'flatbush';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineLength,
  offsetPolyline,
  trimPolyline,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CompiledCity, Diagnostic } from '../../network';
import { curbLane, stripWidth } from '../../network/strips';
import { allocateId, type City, type Place } from '../../schema';
import {
  railKinds,
  type RailKind,
  type RailNode,
  type RailPlatform,
  type RailTrack,
  type TrackForm,
} from '../../schema/rail';
import { clip, polygonSources } from './buildings';
import { clipPart, contains, type Bounds, type RoadPoint } from './clip';
import type { OsmData, OsmTags } from './parse';
import { osmLayer } from './roads';

const isTrack = (t: OsmTags) => railKinds.includes(t.railway as RailKind);
/** TASK-132: a building passage or covered way stays at grade under its roof; its `layer` (and
 * `tunnel`) still order it below the building, as before. */
const covered = (t: OsmTags) => t.tunnel === 'building_passage' || t.covered === 'yes';
/** TASK-134: whether a way carries an overhead contact line, from `electrified`; undefined when
 * untagged. `yes` counts unless `electrified:rail` says the conductor is a rail. */
const contactLine = (t: OsmTags) => {
  if (t.electrified === undefined) return undefined;
  const values = t.electrified.split(';').map((v) => v.trim());
  return (
    values.includes('contact_line') ||
    (values.includes('yes') && t['electrified:rail'] === undefined)
  );
};
const isPlatform = (t: OsmTags) => t.railway === 'platform' || t.public_transport === 'platform';
const normalize = (name: string) => name.normalize('NFKC').toLocaleLowerCase('de').trim();
const pointsOf = (p: RailPlatform) =>
  p.shape.kind === 'polygon'
    ? p.shape.ring
    : p.shape.kind === 'line'
      ? p.shape.line
      : [p.shape.pos];
const center = (points: Vec2[]) => ({
  x: points.reduce((s, p) => s + p.x, 0) / points.length,
  y: points.reduce((s, p) => s + p.y, 0) / points.length,
});
const placePos = (p: Place) => (p.shape.kind === 'point' ? p.shape.pos : center(p.shape.ring));

/** Runs after all vehicle/walk/parking allocation, preserving existing entity IDs. */
export function importRail(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  diagnostics: Diagnostic[],
) {
  const ways = data.way.filter((w) => isTrack(w.tag));
  if (!ways.length) return;
  const rail: NonNullable<City['rail']> = { nodes: {}, tracks: {}, platforms: {} };
  city.rail = rail;
  const source = new Map(data.node.map((n) => [n.id, n]));
  const incidents = new Map<number, number>();
  for (const w of ways)
    for (const ref of new Set(w.nd)) incidents.set(ref, (incidents.get(ref) ?? 0) + 1);
  const nodes = new Map<string, RailNode>();
  const crossingRoads = new Map<number, number[]>();
  for (const way of data.way.filter((w) => w.tag.highway))
    for (const ref of way.nd) {
      const ids = crossingRoads.get(ref) ?? [];
      ids.push(way.id);
      crossingRoads.set(ref, ids);
    }
  const addNode = (p: RoadPoint, layer: number) => {
    const old = nodes.get(p.key);
    if (old) return old.id;
    const tag = p.osmId === undefined ? {} : source.get(p.osmId)!.tag;
    const kind: RailNode['kind'] =
      tag.railway === 'switch'
        ? 'switch'
        : tag.railway === 'buffer_stop'
          ? 'buffer_stop'
          : tag.railway === 'stop'
            ? 'stop'
            : ['level_crossing', 'tram_level_crossing', 'crossing'].includes(tag.railway ?? '')
              ? 'level_crossing'
              : 'plain';
    const id = allocateId(city, 'rn');
    const n: RailNode = {
      id,
      pos: p.pos,
      kind,
      layer: tag.layer === undefined ? layer : (osmLayer(tag) ?? layer),
      ...(p.osmId === undefined ? {} : { osmId: p.osmId }),
      ...(tag.railway === 'signal' ? { signal: true } : {}),
      ...(['level_crossing', 'tram_level_crossing', 'crossing'].includes(tag.railway ?? '')
        ? {
            crossing: {
              kind:
                tag.railway === 'crossing'
                  ? ('pedestrian' as const)
                  : tag.railway === 'tram_level_crossing'
                    ? ('tram' as const)
                    : ('rail' as const),
              roadOsmIds: crossingRoads.get(p.osmId!) ?? [],
              ...(tag['crossing:barrier'] ? { barrier: tag['crossing:barrier'] } : {}),
              ...(tag['crossing:light'] ? { lights: tag['crossing:light'] } : {}),
              ...(tag['crossing:bell'] ? { bell: tag['crossing:bell'] } : {}),
            },
          }
        : {}),
    };
    nodes.set(p.key, n);
    rail.nodes[id] = n;
    return id;
  };
  for (const w of ways) {
    const layer = osmLayer(w.tag) ?? 0;
    const runs: RoadPoint[][] = [];
    let run: RoadPoint[] = [];
    for (const ref of [...w.nd, NaN]) {
      const pos = positions.get(ref);
      if (pos) {
        if (run.at(-1)?.osmId !== ref) run.push({ key: String(ref), osmId: ref, pos });
      } else {
        if (run.length > 1) runs.push(run);
        run = [];
      }
    }
    if (w.nd.some((ref) => !positions.has(ref)))
      diagnostics.push({
        severity: 'warning',
        code: 'osm_rail_incomplete',
        refs: [`way/${w.id}`],
        message: `Rail way ${w.id} is broken at missing nodes`,
      });
    for (const [i, points] of runs.entries())
      for (const part of clipPart(points, bounds, `rail/${w.id}/${i}`, new Set())) {
        let start = 0;
        for (let j = 1; j < part.points.length; j++) {
          const p = part.points[j]!,
            tag = p.osmId === undefined ? {} : source.get(p.osmId)!.tag;
          if (
            j !== part.points.length - 1 &&
            (incidents.get(p.osmId!) ?? 0) < 2 &&
            !tag.railway &&
            !(w.nd[0] === w.nd.at(-1) && j === Math.floor(part.points.length / 2))
          )
            continue;
          const line = part.points.slice(start, j + 1).map((p) => p.pos);
          if (polylineLength(line) < 0.01) {
            diagnostics.push({
              severity: 'warning',
              code: 'osm_rail_incomplete',
              refs: [`way/${w.id}`],
              message: `Ignored degenerate section of rail way ${w.id}`,
            });
            start = j;
            continue;
          }
          const from = addNode(part.points[start]!, layer),
            to = addNode(p, layer);
          start = j;
          const id = allocateId(city, 'rt');
          const speed = /^(\d+(?:\.\d+)?)\s*(mph|km\/h)?$/i.exec(w.tag.maxspeed?.trim() ?? '');
          const maxSpeedMps =
            Number(speed?.[1]) * (speed?.[2]?.toLowerCase() === 'mph' ? 0.44704 : 1 / 3.6);
          rail.tracks[id] = {
            id,
            from,
            to,
            line,
            kind: w.tag.railway as RailKind,
            layer,
            osmId: w.id,
            ...(w.tag.bridge && w.tag.bridge !== 'no' ? { bridge: true } : {}),
            ...(w.tag.tunnel && w.tag.tunnel !== 'no' ? { tunnel: true } : {}),
            ...(covered(w.tag) ? { covered: true } : {}),
            ...(w.tag.service ? { service: w.tag.service } : {}),
            ...(w.tag.usage ? { usage: w.tag.usage } : {}),
            ...(['forward', 'backward', 'both'].includes(w.tag['railway:preferred_direction'] ?? '')
              ? {
                  preferredDirection: w.tag['railway:preferred_direction'] as
                    'forward' | 'backward' | 'both',
                }
              : {}),
            ...(w.tag.name ? { name: w.tag.name } : {}),
            ...(maxSpeedMps > 0 ? { maxSpeedMps } : {}),
            ...(contactLine(w.tag) === undefined ? {} : { contactLine: contactLine(w.tag) }),
          };
        }
      }
  }
  const nodeLayers = new Map<string, number[]>();
  for (const track of Object.values(rail.tracks))
    for (const id of [track.from, track.to]) {
      const layers = nodeLayers.get(id) ?? [];
      layers.push(track.layer);
      nodeLayers.set(id, layers);
    }
  for (const n of Object.values(rail.nodes))
    if (n.osmId !== undefined && source.get(n.osmId)!.tag.layer === undefined) {
      const layers = nodeLayers.get(n.id)!;
      n.layer = layers.includes(0) ? 0 : Math.min(...layers);
    }
  const masts = data.node
    .filter((n) => n.tag.power === 'catenary_mast' && contains(bounds, positions.get(n.id)!))
    .map((n) => ({ pos: positions.get(n.id)!, osmId: n.id }));
  if (masts.length) rail.masts = masts;
  const platformSources = new Map<string, string[]>();
  const addPlatform = (
    sourceKey: string,
    osmId: number,
    tag: OsmTags,
    shape: RailPlatform['shape'],
  ) => {
    const id = allocateId(city, 'rp');
    const mode = tag.bus === 'yes' ? 'bus' : tag.tram === 'yes' ? 'tram' : 'rail';
    const p: RailPlatform = {
      id,
      shape,
      name: tag.name ?? tag.ref ?? 'Platform',
      ...(tag.ref ? { ref: tag.ref } : {}),
      mode,
      layer: osmLayer(tag) ?? 0,
      tracks: [],
      station: null,
      osmId,
    };
    if (mode !== 'bus')
      for (const t of Object.values(rail.tracks)) {
        if (t.layer !== p.layer || (mode === 'tram') !== (t.kind === 'tram')) continue;
        const platformPoints = pointsOf(p);
        if (
          platformPoints.some((pos) => nearestOnPolyline(t.line, pos).away <= 5) ||
          (platformPoints.length > 1 &&
            t.line.some((pos) => nearestOnPolyline(platformPoints, pos).away <= 5))
        )
          p.tracks.push(t.id);
      }
    rail.platforms[id] = p;
    const list = platformSources.get(sourceKey) ?? [];
    list.push(id);
    platformSources.set(sourceKey, list);
  };
  const relations = new Set(
    data.relation
      .filter((r) => r.tag.type === 'multipolygon' && isPlatform(r.tag))
      .map((r) => r.id),
  );
  for (const p of polygonSources(data, isPlatform))
    for (const ring of p.rings.filter((r) => r.role === 'outer')) {
      if (ring.ids.some((ref) => !positions.has(ref))) continue;
      const clipped = clip(
        ring.ids.slice(0, -1).map((ref) => positions.get(ref)!),
        bounds,
      );
      if (clipped.length < 3) continue;
      addPlatform(`${relations.has(p.id) ? 'relation' : 'way'}/${p.id}`, p.id, p.tag, {
        kind: 'polygon',
        ring: [...clipped, clipped[0]!],
      });
    }
  for (const p of data.way.filter((w) => isPlatform(w.tag) && w.nd[0] !== w.nd.at(-1))) {
    if (p.nd.some((ref) => !positions.has(ref))) continue;
    const points = p.nd.map((ref) => ({ key: String(ref), osmId: ref, pos: positions.get(ref)! }));
    for (const part of clipPart(points, bounds, `platform/${p.id}`, new Set()))
      addPlatform(`way/${p.id}`, p.id, p.tag, {
        kind: 'line',
        line: part.points.map((p) => p.pos),
      });
  }
  for (const n of data.node.filter((n) => isPlatform(n.tag))) {
    const pos = positions.get(n.id)!;
    if (contains(bounds, pos)) addPlatform(`node/${n.id}`, n.id, n.tag, { kind: 'point', pos });
  }
  const stations = Object.values(city.places).filter((p) => p.kind === 'station');
  for (const s of stations) s.station = { platforms: [], entrances: [] };
  for (const p of Object.values(rail.platforms)) {
    const area = data.relation.find(
      (r) =>
        r.tag.public_transport === 'stop_area' &&
        r.member.some((m) => (platformSources.get(`${m.type}/${m.ref}`) ?? []).includes(p.id)),
    );
    const mapped =
      area &&
      stations.find((s) =>
        area.member.some((m) => m.type === 'node' && s.provenance.osmIds?.includes(m.ref)),
      );
    const near =
      p.mode === 'rail'
        ? stations
            .filter(
              (s) =>
                normalize(s.name) === normalize(p.name) &&
                distance(placePos(s), center(pointsOf(p))) <= 500,
            )
            .sort(
              (a, b) =>
                distance(placePos(a), center(pointsOf(p))) -
                  distance(placePos(b), center(pointsOf(p))) || a.id.localeCompare(b.id),
            )[0]
        : undefined;
    const station = mapped ?? near;
    if (station) {
      p.station = station.id;
      station.station!.platforms.push(p.id);
    }
  }
  for (const n of data.node.filter(
    (n) =>
      n.tag.public_transport === 'entrance' &&
      n.tag.entrance !== 'no' &&
      n.tag.access !== 'no' &&
      n.tag.foot !== 'no',
  )) {
    const pos = positions.get(n.id)!;
    if (!contains(bounds, pos)) continue;
    const s = stations
      .filter(
        (s) =>
          distance(placePos(s), pos) <= 250 &&
          (!n.tag.name || normalize(n.tag.name) === normalize(s.name)),
      )
      .sort(
        (a, b) =>
          distance(placePos(a), pos) - distance(placePos(b), pos) || a.id.localeCompare(b.id),
      )[0];
    if (!s) continue;
    city.walk ??= { nodes: {}, links: {} };
    let door = Object.values(city.walk.nodes).find((d) => d.provenance.osmIds?.includes(n.id));
    if (!door) {
      const id = allocateId(city, 'wn');
      door = {
        id,
        pos,
        layer: osmLayer(n.tag) ?? 0,
        provenance: { source: 'osm', osmIds: [n.id] },
      };
      city.walk.nodes[id] = door;
    }
    door.entrance = { placeId: s.id };
    s.station!.entrances.push(door.id);
  }
  for (const s of stations) {
    if (s.shape.kind === 'polygon' || !s.station!.platforms.length) continue;
    const points = s.station!.platforms.flatMap((id) => pointsOf(rail.platforms[id]!));
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    let x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    if (x0 === x1) {
      x0 -= 1;
      x1 += 1;
    }
    if (y0 === y1) {
      y0 -= 1;
      y1 += 1;
    }
    s.shape = {
      kind: 'polygon',
      ring: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
        { x: x0, y: y0 },
      ],
    };
  }
}

const pavedSurfaces = new Set([
  'asphalt',
  'paving_stones',
  'concrete',
  'concrete:plates',
  'sett',
  'cobblestone',
  'unhewn_cobblestone',
  'bricks',
  'paved',
]);
const ballastSurfaces = new Set(['gravel', 'fine_gravel', 'pebblestone', 'ballast']);
/** Share of a tram track inside drivable road for an untagged track to count as embedded. */
export const embeddedShare = 0.8;
/** TASK-220: one-lane carriageways are drawn at the default lane width, narrower than their
 * street (TASK-216 D9: the Rotteckring's 2 m); track this close to one runs in that street.
 * TASK-232: measured to the street band's outer edge, its street parking and the mapped street
 * areas (`area:highway`) that reach within this of the carriageway (a stop's platform). */
export const alongsideM = 2.5;
/** TASK-220: a mapped grass area narrower than this (mean width, m) is a strip along the track,
 * not a park or a lawn it crosses. */
export const grassStripM = 10;
/** TASK-256: a section of track shorter than this between two other beds is where one bed meets
 * the next, not a bed of its own (Rotteckring's `rt:12944`, 10 m from the stop's street track to
 * the grass strip, paved on the ground). */
export const transitionM = 20;
/** How far off a grass strip track still counts as on it (strips end at their own kerb). */
const stripReachM = 1.5;

/** TASK-220: a highway that carries tram rails, from `embedded_rails*`, `railway:lanes*` or
 * `railway=tram` on the highway itself; its half-width from `width`, else 1.5 m a lane (two at
 * least, for untagged pedestrian streets) and 1 m of tolerance for the rails off its centreline. */
function tramRoadHalfWidth(tag: OsmTags): number | undefined {
  if (!tag.highway || tag.highway === 'platform') return;
  const rails =
    tag.railway === 'tram' ||
    Object.entries(tag).some(
      ([key, value]) =>
        (key.startsWith('embedded_rails') || key.startsWith('railway:lanes')) &&
        (value ?? '').split(/[;|]/).includes('tram'),
    );
  if (!rails) return;
  const width = Number.parseFloat(tag.width ?? '');
  return (width > 0 ? width / 2 : Math.max(2, Number(tag.lanes) || 0) * 1.5) + 1;
}

const bbox = (points: Vec2[]) =>
  [
    Math.min(...points.map((p) => p.x)),
    Math.min(...points.map((p) => p.y)),
    Math.max(...points.map((p) => p.x)),
    Math.max(...points.map((p) => p.y)),
  ] as const;

/**
 * TASK-135, TASK-220: the form of each tram track. Tags decide first: a tram mapped on a highway
 * way is embedded; `embedded=no` gives an own bed (from `surface`, else ballast) and any other
 * `embedded` value embedded; `surface=grass` or `railway:track_ballast=no` grass;
 * `railway:track_ballast=yes` or a loose `surface` (gravel) ballast; a highway carrying tram rails
 * (`tramRoadHalfWidth`) along over half its length embedded. Otherwise, marked
 * `inferred: ['form']`: inside same-grade road or junction surface over `embeddedShare` of its
 * length, embedded; on (or within `stripReachM` of) a mapped grass strip over half its length off
 * the road, grass, unless a paved `surface` is tagged; inside or within `alongsideM` of a one-lane
 * carriageway's street band (TASK-232: the carriageway, its street parking strips, and the
 * `area:highway` areas reaching within `alongsideM` of it) over `embeddedShare`, embedded; else a
 * paved bed for a paved `surface`, and ballast for the rest (a separate track between
 * carriageways, a median reservation; `railway:track_ref` says nothing of form). TASK-256: an
 * inferred ballast section under `transitionM` between other beds, one embedded, is embedded.
 */
export function assignTramForms(
  city: City,
  data: OsmData,
  compiled: CompiledCity,
  positions: Map<number, Vec2>,
) {
  const trams = Object.values(city.rail?.tracks ?? {}).filter((t) => t.kind === 'tram');
  if (!trams.length) return;
  const ways = new Map(data.way.map((w) => [w.id, w.tag]));
  const nodeLayer = (id: string) => city.nodes[id]!.layer;
  const index = <T>(items: T[], points: (item: T) => Vec2[]) => {
    const spatial = new Flatbush(Math.max(1, items.length));
    for (const item of items) spatial.add(...bbox(points(item)));
    if (!items.length) spatial.add(0, 0, 0, 0);
    spatial.finish();
    return spatial;
  };
  const areas = [
    ...compiled.roads.map((r) => {
      const road = city.roads[r.id]!;
      return {
        ring: [...r.surface, r.surface[0]!],
        layer: road.layer ?? Math.min(nodeLayer(road.from), nodeLayer(road.to)),
        oneLane: road.lanes.length === 1,
      };
    }),
    ...compiled.nodes
      .filter((n) => n.outline.length >= 3)
      .map((n) => ({
        ring: [...n.outline, n.outline[0]!],
        layer: nodeLayer(n.id),
        oneLane: false,
      })),
  ];
  const areaIndex = index(areas, (a) => a.ring);
  const located = (ids: number[]) =>
    ids.every((id) => positions.has(id)) ? ids.map((id) => positions.get(id)!) : undefined;
  // TASK-232: a one-lane carriageway's street band beyond its drawn surface. Street parking
  // strips (a mapped area, else the band beside the curb lane) belong to their road; a mapped
  // street area (`area:highway`: platform, footway, pedestrian) when it reaches within
  // `alongsideM` of the carriageway. Fahnenbergplatz's stop platforms lie between the tracks and
  // their carriageways, 4.5 to 5.4 m off.
  const nearOneLane = (ring: Vec2[], layer: number) => {
    const [x0, y0, x1, y1] = bbox(ring);
    return areaIndex
      .search(x0 - alongsideM, y0 - alongsideM, x1 + alongsideM, y1 + alongsideM)
      .map((j) => areas[j]!)
      .some(
        (a) =>
          a.oneLane &&
          a.layer === layer &&
          (ring.some(
            (q) => pointInPolygon(q, a.ring) || nearestOnPolyline(a.ring, q).away <= alongsideM,
          ) ||
            a.ring.some((q) => nearestOnPolyline(ring, q).away <= alongsideM)),
      );
  };
  const band = [
    ...Object.values(city.parking ?? {}).flatMap(({ strip }) => {
      const road = strip && city.roads[strip.roadId];
      if (!road || road.lanes.length !== 1) return [];
      const layer = road.layer ?? Math.min(nodeLayer(road.from), nodeLayer(road.to));
      if (strip.ring) return [{ ring: [...strip.ring, strip.ring[0]!], layer }];
      const lane = curbLane(city, compiled, strip.roadId, strip.side);
      if (!lane) return [];
      const cumulative = cumulativeLengths(road.centerline);
      const at = (station: number) =>
        nearestOnPolyline(lane.polyline, pointAtDistance(road.centerline, cumulative, station))
          .along;
      const part = trimPolyline(
        lane.polyline,
        at(strip.fromM),
        lane.cumulative.at(-1)! - at(strip.toM),
      );
      const sign = strip.side === 'left' ? -1 : 1;
      const inner = offsetPolyline(part, (sign * lane.widthM) / 2);
      const outer = offsetPolyline(part, sign * (lane.widthM / 2 + stripWidth(strip.layout)));
      const ring = [...inner, ...outer.reverse()];
      return [{ ring: [...ring, ring[0]!], layer }];
    }),
    ...data.way.flatMap((w) => {
      const ring = w.tag['area:highway'] && w.nd[0] === w.nd.at(-1) ? located(w.nd) : undefined;
      const layer = osmLayer(w.tag) ?? 0;
      return ring && ring.length >= 4 && nearOneLane(ring, layer) ? [{ ring, layer }] : [];
    }),
  ];
  const bandIndex = index(band, (b) => b.ring);
  const tramRoads = data.way.flatMap((w) => {
    const half = tramRoadHalfWidth(w.tag);
    const line = half === undefined ? undefined : located(w.nd);
    return line && line.length >= 2 ? [{ line, half: half!, layer: osmLayer(w.tag) ?? 0 }] : [];
  });
  const tramRoadIndex = index(tramRoads, (r) => r.line);
  const reach = Math.max(0, ...tramRoads.map((r) => r.half));
  const strips = data.way.flatMap((w) => {
    const grass =
      w.tag.landuse === 'grass' || w.tag.landcover === 'grass' || w.tag.natural === 'grassland';
    const ring = grass && w.nd[0] === w.nd.at(-1) ? located(w.nd) : undefined;
    if (!ring || ring.length < 4) return [];
    const area = Math.abs(
      ring.reduce((sum, a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        return sum + a.x * b.y - b.x * a.y;
      }, 0) / 2,
    );
    return (2 * area) / polylineLength(ring) <= grassStripM ? [ring] : [];
  });
  const stripIndex = index(strips, (r) => r);
  for (const t of trams) {
    const tag = ways.get(t.osmId!)!;
    const paved = pavedSurfaces.has(tag.surface ?? '');
    const bed: TrackForm | undefined =
      tag.surface === 'grass' || tag['railway:track_ballast'] === 'no'
        ? 'grass'
        : tag['railway:track_ballast'] === 'yes' || ballastSurfaces.has(tag.surface ?? '')
          ? 'ballast'
          : paved
            ? 'paved'
            : undefined;
    let form: TrackForm | undefined = tag.highway
      ? 'embedded'
      : tag.embedded === 'no'
        ? (bed ?? 'ballast')
        : tag.embedded
          ? 'embedded'
          : bed === 'grass' || bed === 'ballast'
            ? bed
            : undefined;
    if (form) {
      t.form = form;
      continue;
    }
    // Length-weighted samples at the middle of each metre along the centreline.
    const lengths = cumulativeLengths(t.line),
      length = lengths.at(-1)!,
      steps = Math.max(1, Math.round(length));
    let inRoad = 0,
      byRoad = 0,
      onTramRoad = 0,
      onStrip = 0;
    for (let i = 0; i < steps; i++) {
      const p = pointAtDistance(t.line, lengths, ((i + 0.5) * length) / steps);
      if (
        tramRoadIndex.search(p.x - reach, p.y - reach, p.x + reach, p.y + reach).some((j) => {
          const r = tramRoads[j]!;
          return r.layer === t.layer && nearestOnPolyline(r.line, p).away <= r.half;
        })
      )
        onTramRoad++;
      const near = areaIndex
        .search(p.x - alongsideM, p.y - alongsideM, p.x + alongsideM, p.y + alongsideM)
        .map((j) => areas[j]!)
        .filter((a) => a.layer === t.layer);
      if (near.some((a) => pointInPolygon(p, a.ring))) {
        inRoad++;
        byRoad++;
        continue;
      }
      if (
        near.some((a) => a.oneLane && nearestOnPolyline(a.ring, p).away <= alongsideM) ||
        bandIndex
          .search(p.x - alongsideM, p.y - alongsideM, p.x + alongsideM, p.y + alongsideM)
          .some((j) => {
            const b = band[j]!;
            return (
              b.layer === t.layer &&
              (pointInPolygon(p, b.ring) || nearestOnPolyline(b.ring, p).away <= alongsideM)
            );
          })
      )
        byRoad++;
      // Off the road only, where a strip ends at the kerb, a little short of the drawn one.
      if (
        stripIndex
          .search(p.x - stripReachM, p.y - stripReachM, p.x + stripReachM, p.y + stripReachM)
          .some(
            (j) =>
              pointInPolygon(p, strips[j]!) || nearestOnPolyline(strips[j]!, p).away <= stripReachM,
          )
      )
        onStrip++;
    }
    if (onTramRoad > steps / 2) {
      t.form = 'embedded';
      continue;
    }
    form =
      inRoad >= embeddedShare * steps
        ? 'embedded'
        : onStrip > (steps - inRoad) / 2 && !paved
          ? 'grass'
          : byRoad >= embeddedShare * steps
            ? 'embedded'
            : (bed ?? 'ballast');
    t.form = form;
    t.provenance = { source: 'osm', inferred: ['form'] };
  }
  // TASK-256: a short inferred ballast section whose ends join only other beds, one of them
  // embedded, is where the street track meets the next bed, paved up to it: embedded.
  const byNode = new Map<string, RailTrack[]>();
  for (const t of trams)
    for (const n of [t.from, t.to]) byNode.set(n, [...(byNode.get(n) ?? []), t]);
  const transitions = trams.filter((t) => {
    if (t.form !== 'ballast' || !t.provenance?.inferred || polylineLength(t.line) >= transitionM)
      return false;
    const ends = [t.from, t.to].map((n) => byNode.get(n)!.filter((o) => o !== t));
    return (
      ends.every((list) => list.length && list.every((o) => o.form !== 'ballast')) &&
      ends.flat().some((o) => o.form === 'embedded')
    );
  });
  for (const t of transitions) t.form = 'embedded';
}
