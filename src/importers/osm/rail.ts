import { distance, nearestOnPolyline, polylineLength } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { Diagnostic } from '../../network';
import { allocateId, type City, type Place } from '../../schema';
import { railKinds, type RailKind, type RailNode, type RailPlatform } from '../../schema/rail';
import { clip, polygonSources } from './buildings';
import { clipPart, contains, type Bounds, type RoadPoint } from './clip';
import type { OsmData, OsmTags } from './parse';
import { osmLayer } from './roads';

const isTrack = (t: OsmTags) => railKinds.includes(t.railway as RailKind);
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
            : ['level_crossing', 'crossing'].includes(tag.railway ?? '')
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
            ...(w.tag.service ? { service: w.tag.service } : {}),
            ...(w.tag.usage ? { usage: w.tag.usage } : {}),
            ...(w.tag.name ? { name: w.tag.name } : {}),
            ...(maxSpeedMps > 0 ? { maxSpeedMps } : {}),
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
