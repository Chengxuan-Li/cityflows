import {
  areaD,
  booleanOpD,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
} from 'clipper2-ts';
import {
  cumulativeLengths,
  distance,
  nearestOnPolyline,
  offsetPolyline,
  pointAtDistance,
  pointInPolygon,
  polylineLength,
} from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CompiledCity, Diagnostic } from '../../network';
import { allocateId, type City } from '../../schema';
import type { RailPlatform, RailTrack, TramStop } from '../../schema/rail';
import { contains, type Bounds } from './clip';
import type { OsmData, OsmTags } from './parse';

/** TASK-137: the island generated beside a track that has stop positions but no mapped platform. */
export const tramIsland = {
  /** The kerb stands this far from the track axis: a tram's clearance. */
  clearM: 1.4,
  widthM: 2.5,
  lengthM: 30,
  /** Smaller than this once clipped, there is no island. */
  minAreaM2: 8,
  /** Half the width of a tram bed: an island never covers another track's bed. */
  bedHalfM: 1.6,
};
/** A platform serves the tram tracks whose axis lies within this of its edge. */
const platformReachM = 2.5;
/** A stop position this close to a track lies on it. */
const onTrackM = 1;
/** A marker (a station or platform node) snaps to a track this close, or joins a stop of its
 * name this close. */
const markerReachM = 25;
const nameReachM = 80;
/** Two stop positions of one name share a centre island across a gap of this much between axes. */
const centreGapM = [4.8, 12] as const;

const normalize = (name: string) => name.normalize('NFKC').toLocaleLowerCase('de').trim();
const flag = (v: string | undefined) => (v === 'yes' ? true : v === 'no' ? false : undefined);
const positive = (ring: Vec2[]) => (areaD(ring) < 0 ? [...ring].reverse() : ring);
const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const sameName = (a?: string, b?: string) => !a || !b || normalize(a) === normalize(b);

/** A tram stop position: `railway=tram_stop`, or a stop position with `tram=yes`. */
export const isTramStopNode = (t: OsmTags) =>
  t.railway === 'tram_stop' ||
  ((t.public_transport === 'stop_position' || t.railway === 'stop') && t.tram === 'yes');

function sample(line: Vec2[], stepM = 1.5) {
  const lengths = cumulativeLengths(line),
    total = lengths.at(-1)!,
    n = Math.max(1, Math.ceil(total / stepM));
  return Array.from({ length: n + 1 }, (_, i) => pointAtDistance(line, lengths, (i / n) * total));
}

/** Distance from a platform's drawn shape: a mapped line draws 2 m wide. */
function shapeDistance(shape: RailPlatform['shape'], p: Vec2) {
  if (shape.kind === 'polygon')
    return pointInPolygon(p, shape.ring) ? 0 : nearestOnPolyline(shape.ring, p).away;
  if (shape.kind === 'line') return Math.max(0, nearestOnPolyline(shape.line, p).away - 1);
  return distance(p, shape.pos);
}

/** The line from `pos` outward along `line` in one direction, at most `reachM` long. */
function arm(line: Vec2[], pos: Vec2, forward: boolean, reachM: number) {
  const lengths = cumulativeLengths(line),
    { along } = nearestOnPolyline(line, pos);
  const end = forward ? Math.min(lengths.at(-1)!, along + reachM) : Math.max(0, along - reachM);
  const inside = line.filter((_, i) =>
    forward ? lengths[i]! > along && lengths[i]! < end : lengths[i]! < along && lengths[i]! > end,
  );
  return [pos, ...(forward ? inside : inside.reverse()), pointAtDistance(line, lengths, end)];
}

/** The track through `pos`: two arms of `reachM` each (one of twice that at the end of a track). */
function trackThrough(tracks: RailTrack[], pos: Vec2, reachM: number) {
  const arms: Vec2[][] = [];
  for (const t of tracks) {
    const { along } = nearestOnPolyline(t.line, pos),
      length = polylineLength(t.line);
    for (const forward of [false, true])
      if (forward ? along < length - 0.01 : along > 0.01)
        arms.push(arm(t.line, pos, forward, 2 * reachM));
  }
  const dir = (a: Vec2[]) => {
    const d = distance(a[0]!, a[1]!) || 1;
    return { x: (a[1]!.x - a[0]!.x) / d, y: (a[1]!.y - a[0]!.y) / d };
  };
  let best: Vec2[][] = arms.slice(0, 1),
    dot = Infinity;
  for (let i = 0; i < arms.length; i++)
    for (let j = i + 1; j < arms.length; j++) {
      const a = dir(arms[i]!),
        b = dir(arms[j]!);
      if (a.x * b.x + a.y * b.y < dot) {
        dot = a.x * b.x + a.y * b.y;
        best = [arms[i]!, arms[j]!];
      }
    }
  if (best.length === 1) return best[0]!;
  const trim = (a: Vec2[]) => {
    const l = cumulativeLengths(a);
    return l.at(-1)! <= reachM
      ? a
      : [...a.filter((_, i) => l[i]! < reachM), pointAtDistance(a, l, reachM)];
  };
  return [...trim(best[0]!).reverse(), ...trim(best[1]!).slice(1)];
}

interface StopNode {
  id: number;
  tag: OsmTags;
  name?: string;
  pos: Vec2;
  tracks: RailTrack[];
}
/** A stop in the making: a mapped platform or one or two stop positions, with the markers and
 * platform nodes that joined it. */
interface Cluster {
  platform?: RailPlatform;
  tag?: OsmTags;
  /** Mapped: the tram tracks the platform serves. */
  served: RailTrack[];
  nodes: StopNode[];
  extra: { id: number; tag: OsmTags }[];
  /** Where the platform lies, when a platform node or a marker beside the track says. */
  hint?: Vec2;
}

export interface TramStopSkip {
  osmId: number;
  name: string;
  reason: 'outside' | 'off_track';
}

/**
 * Groups the tram stop positions and tram platforms of an extract into stops, one per island, and
 * stores them as `city.rail.tramStops`. Runs after the rail network and the junction groups have
 * their ids. A mapped platform (`tram=yes`, or a `railway=platform` beside a tram track) keeps its
 * shape, serves the tram tracks within 2.5 m of its edge and takes the stop positions of its name
 * on them. Stop positions without a platform get an island generated: 2.5 m wide and 30 m long
 * beside the track, on the side of a platform node or marker, else on the side with more room,
 * or one centre island between two tracks of the same name; clipped clear of every carriageway
 * and of other tram beds. Returns the stop positions it left out.
 */
export function importTramStops(
  city: City,
  data: OsmData,
  positions: Map<number, Vec2>,
  bounds: Bounds,
  compiled: CompiledCity,
  diagnostics: Diagnostic[],
): TramStopSkip[] {
  const rail = city.rail;
  const trams = Object.values(rail?.tracks ?? {})
    .filter((t) => t.kind === 'tram')
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!rail || !trams.length) return [];
  const samples = new Map(trams.map((t) => [t.id, sample(t.line)]));
  const tagged = new Map<string, OsmTags>();
  for (const [type, items] of [
    ['node', data.node],
    ['way', data.way],
    ['relation', data.relation],
  ] as const)
    for (const item of items)
      if (Object.keys(item.tag).length) tagged.set(`${type}/${item.id}`, item.tag);

  // Mapped tram platforms. The rail layer's `mode` puts `bus=yes` first, so a platform shared by
  // bus and tram reads as bus there; the tags decide here.
  const clusters: Cluster[] = [];
  const platformNodes: { pos: Vec2; name?: string; id: number; tag: OsmTags }[] = [];
  const platformTag = (p: RailPlatform) =>
    p.shape.kind === 'polygon'
      ? (tagged.get(`way/${p.osmId}`) ?? tagged.get(`relation/${p.osmId}`))
      : tagged.get(`${p.shape.kind === 'point' ? 'node' : 'way'}/${p.osmId}`);
  for (const p of Object.values(rail.platforms).sort((a, b) => a.id.localeCompare(b.id))) {
    const tag = platformTag(p);
    if (!tag) continue;
    const tram =
      tag.tram === 'yes' ||
      (p.mode === 'rail' &&
        !p.tracks.length &&
        tag.railway === 'platform' &&
        !['bus', 'train', 'subway', 'light_rail', 'ferry', 'trolleybus'].some(
          (k) => tag[k] === 'yes',
        ));
    if (!tram) continue;
    if (p.shape.kind === 'point') {
      platformNodes.push({ pos: p.shape.pos, name: tag.name, id: p.osmId!, tag });
      continue;
    }
    const served = trams.filter(
      (t) =>
        t.layer === p.layer &&
        samples.get(t.id)!.some((s) => shapeDistance(p.shape, s) <= platformReachM),
    );
    if (served.length) clusters.push({ platform: p, tag, served, nodes: [], extra: [] });
  }

  // Stop positions: on a track, markers beside one, or outside the extract.
  const skipped: TramStopSkip[] = [];
  const onTrack: StopNode[] = [],
    markers: StopNode[] = [];
  for (const n of data.node.filter((n) => isTramStopNode(n.tag))) {
    const pos = positions.get(n.id)!;
    if (!contains(bounds, pos)) {
      skipped.push({ osmId: n.id, name: n.tag.name ?? '', reason: 'outside' });
      continue;
    }
    const node: StopNode = {
      id: n.id,
      tag: n.tag,
      ...(n.tag.name ? { name: n.tag.name } : {}),
      pos,
      tracks: trams.filter((t) => nearestOnPolyline(t.line, pos).away <= onTrackM),
    };
    // A `public_transport=station` node names the stop; it is no halting position even on the line.
    (node.tracks.length && n.tag.public_transport !== 'station' ? onTrack : markers).push(node);
  }
  const mappedCount = clusters.length;
  for (const n of onTrack) {
    const ids = new Set(n.tracks.map((t) => t.id));
    const mapped = clusters
      .slice(0, mappedCount)
      .filter((c) => sameName(n.name, c.tag!.name) && c.served.some((t) => ids.has(t.id)))
      .sort(
        (a, b) =>
          shapeDistance(a.platform!.shape, n.pos) - shapeDistance(b.platform!.shape, n.pos) ||
          a.platform!.id.localeCompare(b.platform!.id),
      )[0];
    if (mapped) mapped.nodes.push(n);
    else clusters.push({ served: [], nodes: [n], extra: [] });
  }
  const nearestTrack = (p: Vec2) =>
    trams.map((t) => ({ t, ...nearestOnPolyline(t.line, p) })).sort((a, b) => a.away - b.away)[0]!;
  /** A marker or platform node joins the stop of its name nearby (and says where its platform
   * lies); else it becomes a stop position on the nearest track within `reachM`. */
  const attach = (m: { id: number; tag: OsmTags; name?: string; pos: Vec2 }, reachM: number) => {
    const join = clusters
      .filter(
        (c) =>
          m.name !== undefined &&
          c.nodes.some((n) => distance(n.pos, m.pos) <= nameReachM && sameName(n.name, m.name)),
      )
      .sort((a, b) => distance(a.nodes[0]!.pos, m.pos) - distance(b.nodes[0]!.pos, m.pos))[0];
    if (join) {
      join.extra.push({ id: m.id, tag: m.tag });
      if (!join.platform) join.hint ??= m.pos;
      return true;
    }
    const near = nearestTrack(m.pos);
    if (near.away > reachM) return false;
    clusters.push({
      served: [],
      nodes: [
        {
          id: m.id,
          tag: m.tag,
          ...(m.name ? { name: m.name } : {}),
          pos: near.point,
          tracks: [near.t],
        },
      ],
      extra: [],
      hint: m.pos,
    });
    return true;
  };
  for (const m of markers)
    if (!attach(m, markerReachM))
      skipped.push({ osmId: m.id, name: m.name ?? '', reason: 'off_track' });
  // A platform node beside a stop position says which side its platform lies on; one alone is
  // a stop position of its own.
  for (const p of platformNodes) attach(p, 12);

  // Stop positions of one name on two tracks a platform's width apart share a centre island.
  const pairs: [Cluster, Cluster][] = [];
  const lone = clusters.filter((c) => !c.platform && c.nodes.length === 1);
  const paired = new Set<Cluster>();
  for (const a of lone) {
    if (paired.has(a)) continue;
    const b = lone.find((b) => {
      if (
        b === a ||
        paired.has(b) ||
        !a.nodes[0]!.name ||
        !sameName(a.nodes[0]!.name, b.nodes[0]!.name)
      )
        return false;
      if (a.nodes[0]!.tracks.some((t) => b.nodes[0]!.tracks.includes(t))) return false;
      const gap = nearestOnPolyline(a.nodes[0]!.tracks[0]!.line, b.nodes[0]!.pos).away;
      return (
        gap >= centreGapM[0] &&
        gap <= centreGapM[1] &&
        distance(a.nodes[0]!.pos, b.nodes[0]!.pos) <= 50
      );
    });
    if (!b) continue;
    pairs.push([a, b]);
    paired.add(a).add(b);
  }
  for (const [a, b] of pairs) {
    a.nodes.push(...b.nodes);
    a.extra.push(...b.extra);
    clusters.splice(clusters.indexOf(b), 1);
  }

  // Carriageways and other tram beds an island must stay clear of.
  const layerOfNode = (id: string) => city.nodes[id]!.layer;
  const carriageways = [
    ...compiled.roads.map((r) => {
      const road = city.roads[r.id]!;
      return {
        ring: positive(r.surface),
        layer: road.layer ?? Math.min(layerOfNode(road.from), layerOfNode(road.to)),
      };
    }),
    ...compiled.nodes
      .filter((n) => n.outline.length >= 3)
      .map((n) => ({ ring: positive(n.outline), layer: layerOfNode(n.id) })),
  ].map((o) => ({
    ...o,
    box: [
      Math.min(...o.ring.map((p) => p.x)),
      Math.min(...o.ring.map((p) => p.y)),
      Math.max(...o.ring.map((p) => p.x)),
      Math.max(...o.ring.map((p) => p.y)),
    ],
  }));
  const island = (c: Cluster, layer: number): Vec2[] | null => {
    const own = c.nodes.map((n) => trackThrough(n.tracks, n.pos, tramIsland.lengthM / 2));
    const lead = own[0]!;
    const { direction, point } = nearestOnPolyline(lead, c.nodes[0]!.pos);
    const normal = { x: -direction.y, y: direction.x };
    const lateralOf = (p: Vec2) => (p.x - point.x) * normal.x + (p.y - point.y) * normal.y;
    const xs = own.flat().map((p) => p.x),
      ys = own.flat().map((p) => p.y);
    const near = [
      Math.min(...xs) - 10,
      Math.min(...ys) - 10,
      Math.max(...xs) + 10,
      Math.max(...ys) + 10,
    ];
    const clips: Vec2[][] = carriageways
      .filter(
        (o) =>
          o.layer === layer &&
          o.box[0]! <= near[2]! &&
          o.box[2]! >= near[0]! &&
          o.box[1]! <= near[3]! &&
          o.box[3]! >= near[1]!,
      )
      .map((o) => o.ring);
    // Other tram tracks nearby, but not the stop's own (the same line, or the paired one).
    for (const t of trams) {
      if (t.layer !== layer) continue;
      const others: Vec2[][] = [];
      let run: Vec2[] = [];
      for (const s of samples.get(t.id)!) {
        const away = Math.min(...own.map((line) => nearestOnPolyline(line, s).away));
        if (away > 1 && s.x > near[0]! && s.x < near[2]! && s.y > near[1]! && s.y < near[3]!)
          run.push(s);
        else {
          if (run.length > 1) others.push(run);
          run = [];
        }
      }
      if (run.length > 1) others.push(run);
      for (const line of others)
        clips.push(
          ...inflatePathsD([line], tramIsland.bedHalfM, JoinType.Round, EndType.Butt, 2, 3),
        );
    }
    const lay = (side: number, from: number, to: number) => {
      const a = offsetPolyline(lead, side * from),
        b = offsetPolyline(lead, side * to);
      const ring = positive([...a, ...b.reverse()]);
      const pieces = booleanOpD(ClipType.Difference, [ring], clips, FillRule.NonZero, 3);
      const best = pieces
        .map((r) => ({ r, area: areaD(r) }))
        .filter(({ area }) => area >= tramIsland.minAreaM2)
        .sort((x, y) => y.area - x.area)[0];
      return best ? { ring: [...best.r, best.r[0]!], area: best.area } : null;
    };
    const { clearM, widthM } = tramIsland;
    if (c.nodes.length > 1) {
      const gap = lateralOf(nearestOnPolyline(c.nodes[1]!.tracks[0]!.line, point).point);
      return lay(gap > 0 ? 1 : -1, clearM, Math.abs(gap) - clearM)?.ring ?? null;
    }
    const hinted = c.hint ? (lateralOf(c.hint) > 0 ? 1 : -1) : 0;
    const options = (hinted ? [hinted] : [1, -1]).map((side) => lay(side, clearM, clearM + widthM));
    const best = options.sort((a, b) => (b?.area ?? 0) - (a?.area ?? 0))[0];
    return best?.ring ?? null;
  };

  // Stops, in the order of their lowest OSM id.
  const made = clusters.map((c) => {
    const ids = [
      ...c.nodes.map((n) => n.id),
      ...c.extra.map((e) => e.id),
      ...(c.platform ? [c.platform.osmId!] : []),
    ];
    return { c, ids: [...new Set(ids)].sort((a, b) => a - b) };
  });
  made.sort(
    (a, b) =>
      a.ids[0]! - b.ids[0]! || (a.c.platform?.id ?? '').localeCompare(b.c.platform?.id ?? ''),
  );
  const stops: Record<string, TramStop> = {};
  const noIsland: string[] = [];
  const relations = data.relation.filter(
    (r) => r.tag.type === 'route' && r.tag.route === 'tram' && r.tag.ref,
  );
  for (const { c, ids } of made) {
    const tracks = new Map<string, RailTrack>();
    for (const t of c.served) tracks.set(t.id, t);
    for (const n of c.nodes) for (const t of n.tracks) tracks.set(t.id, t);
    const layer = [...tracks.values()].sort((a, b) => a.id.localeCompare(b.id))[0]!.layer;
    const tags = [c.tag, ...c.nodes.map((n) => n.tag), ...c.extra.map((e) => e.tag)].filter(
      (t): t is OsmTags => t !== undefined,
    );
    const tagOf = <K extends string>(key: K) =>
      tags.map((t) => t[key]).find((v) => v !== undefined);
    const name = tagOf('name') ?? tagOf('ref') ?? 'Tram stop';
    const members = new Set(ids.flatMap((id) => [`node/${id}`, `way/${id}`, `relation/${id}`]));
    const lines = (() => {
      const refs = tags.flatMap((t) => t.route_ref?.split(';') ?? []);
      if (!refs.length)
        for (const r of relations)
          if (r.member.some((m) => members.has(`${m.type}/${m.ref}`)))
            refs.push(...r.tag.ref!.split(';'));
      if (!refs.length)
        for (const t of tags) {
          const found =
            /\b(?:Tram|Straßenbahn)\s+([A-Za-z]?\d+[A-Za-z]?(?:[/;,][A-Za-z]?\d+[A-Za-z]?)*)/.exec(
              t.description ?? '',
            );
          if (found) refs.push(...found[1]!.split(/[/;,]/));
        }
      return [...new Set(refs.map((r) => r.trim()).filter(Boolean))].sort(byNumber);
    })();
    const halts = c.nodes.length
      ? c.nodes.map((n) => ({
          track: [...n.tracks].sort((a, b) => a.id.localeCompare(b.id))[0]!.id,
          pos: n.pos,
        }))
      : (() => {
          const p =
            c.platform!.shape.kind === 'polygon'
              ? c.platform!.shape.ring
              : (c.platform!.shape as { line: Vec2[] }).line;
          const middle = {
            x: p.reduce((s, q) => s + q.x, 0) / p.length,
            y: p.reduce((s, q) => s + q.y, 0) / p.length,
          };
          const near = c.served
            .map((t) => ({ t, ...nearestOnPolyline(t.line, middle) }))
            .sort((a, b) => a.away - b.away || a.t.id.localeCompare(b.t.id))[0]!;
          return [{ track: near.t.id, pos: near.point }];
        })();
    let platform: TramStop['platform'];
    if (c.platform) platform = { kind: 'mapped', platform: c.platform.id };
    else {
      const ring = island(c, layer);
      platform = ring ? { kind: 'generated', ring } : null;
    }
    const id = allocateId(city, 'ts');
    if (!platform) noIsland.push(id);
    const stop: TramStop = {
      id,
      name,
      lines,
      layer,
      tracks: [...tracks.keys()].sort(),
      halts,
      platform,
      ...Object.fromEntries(
        (
          [
            ['shelter', flag(tagOf('shelter'))],
            ['bench', flag(tagOf('bench'))],
            ['covered', flag(tagOf('covered'))],
            ['tactilePaving', flag(tagOf('tactile_paving'))],
          ] as const
        ).filter(([, v]) => v !== undefined),
      ),
      osmIds: ids,
      provenance: {
        source: 'osm',
        osmIds: ids,
        ...(c.platform ? {} : { inferred: ['platform'] }),
      },
    };
    stops[id] = stop;
  }
  if (Object.keys(stops).length) rail.tramStops = stops;
  const note = (code: string, refs: string[], message: string) =>
    refs.length && diagnostics.push({ severity: 'info', code, refs, message });
  for (const reason of ['outside', 'off_track'] as const) {
    const list = skipped.filter((s) => s.reason === reason);
    note(
      'osm_tram_stop_skipped',
      list.map((s) => `node/${s.osmId}`),
      reason === 'outside'
        ? `Left out ${list.length} tram stop positions outside the area: ${[...new Set(list.map((s) => s.name))].join(', ')}`
        : `Left out ${list.length} tram stop positions more than ${markerReachM} m from a tram track: ${[...new Set(list.map((s) => s.name))].join(', ')}`,
    );
  }
  note(
    'osm_tram_stop_no_island',
    noIsland,
    `${noIsland.length} tram stops have no room for a platform island`,
  );
  return skipped;
}
