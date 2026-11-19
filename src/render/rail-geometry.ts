import Flatbush from 'flatbush';
import { earcut } from 'pixi.js';
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
  headingAtDistance,
  nearestOnPolyline,
  offsetPolyline,
  pointAtDistance,
  pointInPolygon,
  trimPolyline,
} from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import { railHeights } from '../network/rail';
import type { RailTrack } from '../schema/rail';
import { cityGrades } from './grades';
import { platformRing } from './station-furniture';
import { style } from './style';
import type { CityGeometry, Pick } from './types';

export interface RailShape {
  layer: number;
  color: number;
  alpha: number;
  /** Triangles; tram sleepers are quads. */
  polygons: Vec2[][];
  pick?: Pick;
  /** Sub-pixel at ordinary 2D zoom; the 2D map draws it only close up (lead, TASK-126 merge). */
  detail?: boolean;
  /** TASK-135: the part of a tram track. Rails draw above road surfaces in 2D (`street` where
   * they run in the road, `rail` on an own bed); 3D raises each part to its own height. TASK-220:
   * `paving` is the street surface under embedded track off the drawn roads (asphalt, or stone in
   * a pedestrian street), flat at road height. */
  tram?: 'bed' | 'sleepers' | 'rail' | 'street' | 'paving';
  /** TASK-220: embedded track that meets no road (a pedestrian street): 3D lifts it to the top of
   * the footways it runs in. */
  onWalk?: boolean;
  /** Outline rings of a tram part, for its 3D sides. */
  outline?: Vec2[][];
  grass?: boolean;
  /** TASK-132: drawn in 2D only (3D builds its own decks and portals), and in 2D in the batch
   * above road surfaces when `over`. */
  only2d?: boolean;
  over?: boolean;
  /** TASK-136: exposed railheads through the road at a mapped level crossing. */
  crossing?: boolean;
  /** The rail node a switch disc marks, for its 3D height. */
  node?: number;
}
/** TASK-132: bridge decks, and the dashed outline and portal marks of tunnel and covered track. */
const structureStyle = { deck: 0xd8d5cb, edge: 0x7d817b, tunnelEdge: 0x6d716b, portal: 0x5d615c };
export const bedWidthM = (t: {
  kind: RailTrack['kind'];
  service?: string;
  form?: RailTrack['form'];
}) =>
  t.kind === 'tram'
    ? t.form === 'embedded' || !t.form
      ? 2.2
      : style.tram.bedWidthM
    : t.service
      ? 2.1
      : 2.7;
/** TASK-232: the widest gap between embedded track's street paving and a road beside it that the
 * paving fills (the importer's `alongsideM`, the reach of a one-lane street's band). */
export const pavingGapM = 2.5;
/** Pieces of `line` `on` metres long, `off` apart. */
function dashes(line: Vec2[], on: number, off: number) {
  const length = cumulativeLengths(line).at(-1)!;
  const pieces: Vec2[][] = [];
  for (let s = 0; s < length; s += on + off)
    pieces.push(trimPolyline(line, s, Math.max(0, length - s - on)));
  return pieces;
}
/** Rail centres of a 1 435 mm gauge track, measured to the inner faces of the rail heads. */
const tramRailOffsetM = (1.435 + style.tram.railWidthM) / 2;
const circle = (p: Vec2, r: number) =>
  Array.from({ length: 16 }, (_, i) => ({
    x: p.x + Math.cos((i * Math.PI) / 8) * r,
    y: p.y + Math.sin((i * Math.PI) / 8) * r,
  }));
const positive = (ring: Vec2[]) => (areaD(ring) < 0 ? [...ring].reverse() : ring);
const box = (points: Vec2[]) =>
  [
    Math.min(...points.map((p) => p.x)),
    Math.min(...points.map((p) => p.y)),
    Math.max(...points.map((p) => p.x)),
    Math.max(...points.map((p) => p.y)),
  ] as const;

/** Both views consume the same triangles, clipped clear of same-grade roads except trams. */
export function railGeometry(city: CompiledCity, source?: CityGeometry): RailShape[] {
  if (!city.rail) return [];
  const { roadGrades, nodeGrades } = cityGrades(city);
  const obstacles = [
    ...city.roads.map((r) => ({ ring: positive(r.surface), layer: roadGrades[r.idx]! })),
    ...city.nodes
      .filter((n) => n.outline.length)
      .map((n) => ({ ring: positive(n.outline), layer: nodeGrades[n.idx]! })),
  ];
  const spatial = new Flatbush(Math.max(1, obstacles.length));
  for (const o of obstacles) spatial.add(...box(o.ring));
  if (!obstacles.length) spatial.add(0, 0, 0, 0);
  spatial.finish();
  const shapes: RailShape[] = [];
  const add = (
    paths: Vec2[][],
    layer: number,
    color: number,
    alpha: number,
    unclipped = false,
    pick?: Pick,
    detail = false,
    extra: Partial<RailShape> = {},
  ) => {
    let rings = paths.map(positive);
    const clips =
      unclipped || !obstacles.length
        ? []
        : spatial
            .search(...box(rings.flat()))
            .flatMap((i) => (obstacles[i]!.layer === layer ? [obstacles[i]!.ring] : []));
    if (clips.length) rings = booleanOpD(ClipType.Difference, rings, clips, FillRule.NonZero, 3);
    const polygons = rings
      .filter((r) => areaD(r) > 0.0001)
      .flatMap((outer) => {
        const holes = rings.filter(
          (r) => areaD(r) < -0.0001 && pointInPolygon(r[0]!, [...outer, outer[0]!]),
        );
        const points = [...outer, ...holes.flat()];
        let end = outer.length;
        const indices = earcut(
          points.flatMap((p) => [p.x, p.y]),
          holes.map((h) => {
            const at = end;
            end += h.length;
            return at;
          }),
          2,
        );
        return Array.from({ length: indices.length / 3 }, (_, i) => [
          points[indices[i * 3]!]!,
          points[indices[i * 3 + 1]!]!,
          points[indices[i * 3 + 2]!]!,
        ]);
      });
    if (polygons.length)
      shapes.push({
        layer,
        color,
        alpha,
        polygons,
        pick,
        ...(detail ? { detail } : {}),
        ...extra,
        ...(extra.tram ? { outline: rings } : {}),
      });
    return rings;
  };
  const stroke = (
    line: Vec2[],
    width: number,
    layer: number,
    color: number,
    alpha: number,
    tram: boolean,
    pick?: Pick,
    detail = false,
  ) =>
    add(
      inflatePathsD([line], width / 2, JoinType.Round, EndType.Butt, 2, 3),
      layer,
      color,
      alpha,
      tram,
      pick,
      detail,
    );
  const stationWays = new Set(
    city.rail.platforms
      .filter((p) => p.station !== null && p.mode === 'rail')
      .flatMap((p) => p.tracks)
      .map((id) => city.rail!.tracks.find((t) => t.id === id)!)
      .filter(Boolean)
      .map((t) => t.osmId ?? t.id),
  );
  // TASK-232: embedded track's street paving takes in the mapped platforms beside it and closes
  // gaps to the other embedded tracks' bands.
  const tramBand = (t: { line: Vec2[] }) =>
    inflatePathsD([t.line], style.tram.bedWidthM / 2, JoinType.Round, EndType.Butt, 2, 3);
  const parts = [
    ...city.rail.platforms.flatMap((p) => {
      const ring = p.shape.kind === 'point' ? null : platformRing(p.shape);
      return ring ? [{ rings: [ring], layer: p.layer, track: -1, platform: true }] : [];
    }),
    ...city.rail.tracks
      .filter((t) => t.kind === 'tram' && (t.form ?? 'embedded') === 'embedded')
      .map((t) => ({ rings: tramBand(t), layer: t.layer, track: t.idx, platform: false })),
  ].map((part) => ({ ...part, box: box(part.rings.flat()) }));
  const partsNear = (paths: Vec2[][], layer: number) => {
    const [x0, y0, x1, y1] = box(paths.flat());
    return parts.filter(
      (p) =>
        p.layer === layer && p.box[0] <= x1 && p.box[2] >= x0 && p.box[1] <= y1 && p.box[3] >= y0,
    );
  };
  const onAsphalt = (p: Vec2, layer: number) =>
    spatial
      .search(p.x, p.y, p.x, p.y)
      .some(
        (i) =>
          obstacles[i]!.layer === layer &&
          pointInPolygon(p, [...obstacles[i]!.ring, obstacles[i]!.ring[0]!]),
      );
  const heights = railHeights(city, roadGrades, nodeGrades);
  // Bridge decks below their beds, one union per grade, with their outline.
  for (const layer of new Set(
    city.rail.tracks.filter((t) => heights.grades[t.idx] === 'bridge').map((t) => t.layer),
  )) {
    const deck = booleanOpD(
      ClipType.Union,
      city.rail.tracks
        .filter((t) => heights.grades[t.idx] === 'bridge' && t.layer === layer)
        .flatMap((t) =>
          inflatePathsD([t.line], bedWidthM(t) / 2 + 1, JoinType.Round, EndType.Butt, 2, 3),
        ),
      [],
      FillRule.NonZero,
      3,
    );
    add(deck, layer, structureStyle.deck, 1, true, undefined, false, { only2d: true });
    add(
      inflatePathsD(deck, style.deckEdgeWidthM / 2, JoinType.Miter, EndType.Polygon, 2, 3),
      layer,
      structureStyle.edge,
      1,
      true,
      undefined,
      false,
      { only2d: true },
    );
  }
  for (const t of city.rail.tracks) {
    const grade = heights.grades[t.idx]!;
    const alpha = grade === 'tunnel' || grade === 'covered' ? 0.4 : 1;
    // Tunnel and covered track also show a dashed outline above the ground's roads and beds.
    if (alpha < 1)
      for (const side of [-1, 1])
        add(
          dashes(offsetPolyline(t.line, side * (bedWidthM(t) / 2 + 0.3)), 3, 3).flatMap((dash) =>
            inflatePathsD([dash], 0.15, JoinType.Miter, EndType.Butt, 2, 3),
          ),
          Math.max(0, t.layer),
          structureStyle.tunnelEdge,
          1,
          true,
          undefined,
          false,
          { only2d: true, over: true },
        );
    const pick: Pick = { kind: 'track', track: t.idx };
    if (t.kind === 'tram') {
      const rails = [-tramRailOffsetM, tramRailOffsetM].flatMap((side) =>
        inflatePathsD(
          [offsetPolyline(t.line, side)],
          style.tram.railWidthM / 2,
          JoinType.Round,
          EndType.Butt,
          2,
          3,
        ),
      );
      // Tracks of older projects carry no form: drawn as street-running rails, as before.
      const form = t.form ?? 'embedded';
      if (form === 'embedded') {
        // TASK-220: the street's surface under the rails off the drawn roads, none on them:
        // asphalt where the track meets a road (the gap that narrow default lane widths leave
        // between one-way carriageways), stone paving where it runs in a pedestrian street.
        const band = tramBand(t);
        const meets = (area: Vec2[][]) =>
          spatial
            .search(...box(area.flat()))
            .flatMap((i) => (obstacles[i]!.layer === t.layer ? [obstacles[i]!.ring] : []))
            .filter(
              (ring) => booleanOpD(ClipType.Intersection, area, [ring], FillRule.NonZero, 3).length,
            );
        const roads = meets(band);
        // It reaches 0.1 m under the roads it meets, so no seam of canvas shows along their edge.
        let paving = roads.length
          ? booleanOpD(
              ClipType.Difference,
              band,
              inflatePathsD(roads, -0.1, JoinType.Miter, EndType.Polygon, 2, 3),
              FillRule.NonZero,
              3,
            )
          : band;
        let inStreet = roads.length > 0;
        // TASK-232 (TASK-224 N3): and on to the edge of the roads beside it, closing gaps under
        // `pavingGapM` to them and to the other embedded tracks' paving (the light strip and wedge
        // beside the Rotteckring's carriageways), reaching no further than that. A stop's
        // platforms beside the track are street too (Fahnenbergplatz, between its tracks and
        // carriageways). Track wholly on the road keeps none.
        // Mitred, not round: closing fills concave corners either way, with far fewer vertices.
        const close = (paths: Vec2[][], by: number) =>
          inflatePathsD(paths, by, JoinType.Miter, EndType.Polygon, 2, 3);
        const widen = (by: number) =>
          inflatePathsD(
            [t.line],
            style.tram.bedWidthM / 2 + by,
            JoinType.Round,
            EndType.Butt,
            2,
            3,
          );
        const touching = widen(0.5);
        const platforms = partsNear(touching, t.layer).filter(
          (p) =>
            p.platform &&
            booleanOpD(ClipType.Intersection, touching, p.rings, FillRule.NonZero, 3).length,
        );
        if (platforms.length || (inStreet && paving.reduce((sum, r) => sum + areaD(r), 0) > 0.01)) {
          const street = [...band, ...platforms.flatMap((p) => p.rings)];
          const m = pavingGapM / 2;
          const around = (by: number) =>
            platforms.length
              ? booleanOpD(
                  ClipType.Union,
                  widen(by),
                  close(
                    platforms.flatMap((p) => p.rings),
                    by,
                  ),
                  FillRule.NonZero,
                  3,
                )
              : widen(by);
          const reach = around(pavingGapM);
          // Roads and tracks are cut to the reach and the closing's margin first: closing whole
          // roads is slow.
          const frame = around(pavingGapM + m);
          const clip = (paths: Vec2[][]) =>
            booleanOpD(ClipType.Intersection, paths, frame, FillRule.NonZero, 3);
          const beside = clip(
            spatial
              .search(...box(frame.flat()))
              .flatMap((i) => (obstacles[i]!.layer === t.layer ? [obstacles[i]!.ring] : [])),
          );
          inStreet ||=
            booleanOpD(ClipType.Intersection, reach, beside, FillRule.NonZero, 3).length > 0;
          if (inStreet) {
            const tracks = partsNear(frame, t.layer).filter(
              (p) => !p.platform && p.track !== t.idx,
            );
            paving = booleanOpD(
              ClipType.Difference,
              booleanOpD(
                ClipType.Intersection,
                close(
                  close([...street, ...beside, ...clip(tracks.flatMap((p) => p.rings))], m),
                  -m,
                ),
                reach,
                FillRule.NonZero,
                3,
              ),
              inflatePathsD(beside, -0.1, JoinType.Miter, EndType.Polygon, 2, 3),
              FillRule.NonZero,
              3,
            );
          }
        }
        add(
          inStreet ? paving : band,
          t.layer,
          inStreet ? style.asphalt : style.tram.beds.paved,
          alpha,
          true,
          pick,
          false,
          { tram: 'paving', ...(inStreet ? {} : { onWalk: true }) },
        );
        add(rails, t.layer, style.tram.groove, alpha, true, pick, false, {
          tram: 'street',
          ...(inStreet ? {} : { onWalk: true }),
        });
        continue;
      }
      const bed = add(
        inflatePathsD([t.line], style.tram.bedWidthM / 2, JoinType.Round, EndType.Butt, 2, 3),
        t.layer,
        style.tram.beds[form],
        alpha,
        false,
        pick,
        false,
        { tram: 'bed', ...(form === 'grass' ? { grass: true } : {}) },
      );
      if (form === 'ballast') {
        // Sleepers only on the bed: none where the track crosses same-grade asphalt.
        const lengths = cumulativeLengths(t.line),
          sleepers: Vec2[][] = [];
        const { sleeperSpacingM: step, sleeperLengthM, sleeperWidthM } = style.tram;
        for (let at = step / 2; at < lengths.at(-1)!; at += step) {
          const p = pointAtDistance(t.line, lengths, at),
            h = headingAtDistance(t.line, lengths, at);
          if (onAsphalt(p, t.layer)) continue;
          const a = sleeperWidthM / 2,
            b = sleeperLengthM / 2;
          const u = { x: Math.cos(h), y: Math.sin(h) },
            v = { x: -u.y, y: u.x };
          sleepers.push([
            { x: p.x - u.x * a - v.x * b, y: p.y - u.y * a - v.y * b },
            { x: p.x + u.x * a - v.x * b, y: p.y + u.y * a - v.y * b },
            { x: p.x + u.x * a + v.x * b, y: p.y + u.y * a + v.y * b },
            { x: p.x - u.x * a + v.x * b, y: p.y - u.y * a + v.y * b },
          ]);
        }
        if (sleepers.length)
          shapes.push({
            layer: t.layer,
            color: style.tram.sleeper,
            alpha,
            polygons: sleepers,
            pick,
            detail: true,
            tram: 'sleepers',
          });
      }
      // Rails sit on the bed; where the bed gives way to asphalt they run in the road.
      add(
        booleanOpD(ClipType.Intersection, rails, bed, FillRule.NonZero, 3),
        t.layer,
        style.tram.rail,
        alpha,
        true,
        pick,
        false,
        { tram: 'rail' },
      );
      add(
        booleanOpD(ClipType.Difference, rails, bed, FillRule.NonZero, 3),
        t.layer,
        style.tram.groove,
        alpha,
        true,
        pick,
        false,
        { tram: 'street' },
      );
      continue;
    }
    const color = t.service
      ? 0xb6aa98
      : t.kind === 'subway' ||
          t.kind === 'light_rail' ||
          t.usage === 'suburban' ||
          stationWays.has(t.osmId ?? t.id)
        ? 0x8aa6a6
        : 0xb5ae9e;
    stroke(t.line, bedWidthM(t), t.layer, color, alpha, false, pick);
    for (const side of [-0.72, 0.72])
      stroke(offsetPolyline(t.line, side), 0.18, t.layer, 0x777b78, alpha, false, pick, true);
    if (grade === 'ground') {
      const mapped = city.rail.nodes.filter(
        (n) => (n.id === t.from || n.id === t.to) && n.crossing?.kind === 'rail',
      );
      for (const n of mapped) {
        const atStart = n.id === t.from;
        const line = trimPolyline(
          t.line,
          atStart ? 0 : Math.max(0, t.lengthM - 30),
          atStart ? Math.max(0, t.lengthM - 30) : 0,
        );
        const rails = [-0.72, 0.72].flatMap((side) =>
          inflatePathsD([offsetPolyline(line, side)], 0.09, JoinType.Round, EndType.Butt, 2, 3),
        );
        const asphalt = obstacles.filter((o) => o.layer === 0).map((o) => o.ring);
        if (asphalt.length)
          add(
            booleanOpD(ClipType.Intersection, rails, asphalt, FillRule.NonZero, 3),
            0,
            0x626b67,
            1,
            true,
            pick,
            true,
            { over: true, crossing: true },
          );
      }
    }
  }
  // A portal: a bar across the track at the tunnel's mouth, its ends turned out to the ground.
  for (const portal of heights.portals.filter((p) => p.kind === 'tunnel')) {
    const t = city.rail.tracks[portal.track]!,
      p = city.rail.nodes[portal.node]!.pos;
    const inward =
      headingAtDistance(t.line, t.cumulative, portal.atEnd ? t.lengthM : 0) +
      (portal.atEnd ? Math.PI : 0);
    const u = { x: Math.cos(inward), y: Math.sin(inward) },
      v = { x: -u.y, y: u.x },
      half = bedWidthM(t) / 2 + 1;
    const at = (a: number, b: number) => ({
      x: p.x + u.x * a + v.x * b,
      y: p.y + u.y * a + v.y * b,
    });
    add(
      [
        [at(0.3, -half), at(0.3, half)],
        [at(0.3, -half), at(-1.2, -half - 1.2)],
        [at(0.3, half), at(-1.2, half + 1.2)],
      ].flatMap((line) => inflatePathsD([line], 0.3, JoinType.Round, EndType.Round, 2, 3)),
      Math.max(0, t.layer),
      structureStyle.portal,
      1,
      true,
      undefined,
      false,
      { only2d: true, over: true },
    );
  }
  for (const n of city.rail.nodes.filter((n) => n.kind === 'switch'))
    add([circle(n.pos, 1.3)], n.layer, 0x77857d, 1, false, undefined, false, { node: n.idx });
  for (const [platform, p] of city.rail.platforms.entries()) {
    const paths =
      p.shape.kind === 'polygon'
        ? [p.shape.ring]
        : p.shape.kind === 'line'
          ? inflatePathsD([p.shape.line], 1, JoinType.Round, EndType.Butt, 2, 3)
          : [circle(p.shape.pos, 1.8)];
    add(paths, p.layer, p.mode === 'rail' ? 0xc1d4ce : 0xd4d7cd, 1, p.mode === 'tram', {
      kind: 'platform',
      platform,
    });
  }
  for (const p of city.places.filter((p) => source?.places[p.id]?.station)) {
    add([circle(p.centroid, 5)], 0, 0x587f77, 1, false, { kind: 'place', place: p.idx });
    add([circle(p.centroid, 2.4)], 0, 0xf8f6ef, 1, false, { kind: 'place', place: p.idx });
  }
  return shapes;
}

export function pickRail(
  city: CompiledCity,
  point: Vec2,
  zoom: number,
  roadGrade = -Infinity,
): Pick | null {
  if (!city.rail) return null;
  for (const p of roadGrade === -Infinity ? city.places : [])
    if (
      city.rail.platforms.some((s) => s.station === p.id) &&
      distance(p.centroid, point) <= Math.max(5, 7 / zoom)
    )
      return { kind: 'place', place: p.idx };
  for (const [platform, p] of city.rail.platforms.entries()) {
    if (roadGrade !== -Infinity) continue;
    if (
      p.shape.kind === 'polygon'
        ? pointInPolygon(point, p.shape.ring)
        : p.shape.kind === 'line'
          ? nearestOnPolyline(p.shape.line, point).away <= Math.max(1, 3 / zoom)
          : distance(point, p.shape.pos) <= Math.max(1.8, 3 / zoom)
    )
      return { kind: 'platform', platform };
  }
  let best = Math.max(1.5, 4 / zoom),
    hit: Pick | null = null;
  for (const t of city.rail.tracks) {
    if (roadGrade !== -Infinity && (t.kind !== 'tram' || t.layer < roadGrade)) continue;
    const d = nearestOnPolyline(t.line, point).away;
    if (d < best) {
      best = d;
      hit = { kind: 'track', track: t.idx };
    }
  }
  return hit;
}
