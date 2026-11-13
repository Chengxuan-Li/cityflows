import Flatbush from 'flatbush';
import { booleanOpD, ClipType, EndType, FillRule, inflatePathsD, JoinType } from 'clipper2-ts';
import { earcut } from 'pixi.js';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import type { CompiledCity } from '../network';
import { railHeightAt, railHeights, type RailGraph, type RailHeights } from '../network/rail';
import { cityGrades } from '../render/grades';
import { bedWidthM, railGeometry, type RailShape } from '../render/rail-geometry';
import type { CityGeometry, Pick } from '../render/types';
import type { Vec2 } from '../geo/vec2';
import type { cityHeights } from './heights';
import { RailPaintCache } from './rail-paint-cache';
import { distance, headingAtDistance, nearestOnPolyline, pointAtDistance } from '../geo/polyline';

type Track = RailGraph['tracks'][number];

/** TASK-135: top and foot of each tram part above its grade; railway paint stays at 0.06 m. The
 * bed stays below the 0.14 m kerbs so median islands cover it, as in 2D. */
const tramHeights: Record<NonNullable<RailShape['tram']>, [number, number]> = {
  bed: [0.12, 0],
  sleepers: [0.13, 0.13],
  rail: [0.17, 0.12],
  street: [0.06, 0],
};
// A deterministic mottle in [-1, 1] from the position, the procedural grass tone.
const mottle = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
};

/** TASK-132: structure sizes in metres and colours. A tunnel tube's walls stand `tubeM` from the
 * bed's edge and its roof `tubeHeightM` over the rail; decks reach `deckM` beyond the bed with
 * parapets `parapetM` high; piers every `pierSpacingM`; cutting walls end `parapetM` above
 * ground, and embankments fall at 1:1.5. */
const structure = {
  tubeM: 1,
  tubeHeightM: 6.3,
  deckM: 1,
  deckDepthM: 1,
  parapetM: 0.9,
  pierSpacingM: 20,
  pierM: 1.4,
  embankment: 1.5,
  colors: {
    concrete: 0xc8c5bb,
    deck: 0xb9b8b0,
    pier: 0x95a29c,
    bank: 0xbcb69e,
    tube: 0x98a09a,
  },
};

const trackAt = (track: Track, p: Vec2) => nearestOnPolyline(track.line, p).along;

/** The rail top above the terrain at `p` on `track`, in the 3D frame. */
export function railElevation(
  heights: ReturnType<typeof cityHeights>,
  rail: RailHeights,
  track: Track,
  s: number,
  p: Vec2,
) {
  return heights.terrain.groundAt(p.x, p.y) + railHeightAt(rail, track, s);
}

/** Vertex-colour triangles with face normals, for the structures' meshes. */
class Builder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  private readonly color = new Color();
  triangle(a: number[], b: number[], c: number[], hex: number) {
    this.color.setHex(hex);
    for (const v of [a, b, c]) {
      this.positions.push(v[0]!, v[1]!, v[2]!);
      this.colors.push(this.color.r, this.color.g, this.color.b);
    }
  }
  quad(a: number[], b: number[], c: number[], d: number[], hex: number) {
    this.triangle(a, b, c, hex);
    this.triangle(a, c, d, hex);
  }
  /** A vertical wall along `a`-`b` between the heights given at each end. */
  wall(a: Vec2, b: Vec2, a0: number, a1: number, b0: number, b1: number, hex: number) {
    this.quad([a.x, a0, a.y], [b.x, b0, b.y], [b.x, b1, b.y], [a.x, a1, a.y], hex);
  }
  /** An oriented box: centre, along-axis unit `u`, half sizes along `u` and across, bottom, top. */
  box(c: Vec2, u: Vec2, along: number, across: number, z0: number, z1: number, hex: number) {
    const v = { x: -u.y, y: u.x };
    const corner = (i: number, j: number) => ({
      x: c.x + u.x * along * i + v.x * across * j,
      y: c.y + u.y * along * i + v.y * across * j,
    });
    const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let k = 0; k < 4; k++) this.wall(ring[k]!, ring[(k + 1) % 4]!, z0, z1, z0, z1, hex);
    this.quad(
      [ring[0]!.x, z1, ring[0]!.y],
      [ring[1]!.x, z1, ring[1]!.y],
      [ring[2]!.x, z1, ring[2]!.y],
      [ring[3]!.x, z1, ring[3]!.y],
      hex,
    );
  }
  mesh(material: MeshLambertMaterial) {
    const geometry = new BufferGeometry()
      .setAttribute('position', new Float32BufferAttribute(this.positions, 3))
      .setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    return new Mesh(geometry, material);
  }
}

/** Samples of the tracks where `keep` holds, every 2 m, for the union outlines of a structure. */
function samples(
  rail: RailGraph,
  heights: RailHeights,
  keep: (t: Track, h: number) => boolean,
): { p: Vec2; h: number; half: number; track: Track; s: number }[] {
  const out = [];
  for (const t of rail.tracks) {
    const n = Math.max(1, Math.ceil(t.lengthM / 2));
    for (let i = 0; i <= n; i++) {
      const s = (i * t.lengthM) / n,
        h = railHeightAt(heights, t, s);
      if (keep(t, h))
        out.push({
          p: pointAtDistance(t.line, t.cumulative, s),
          h,
          half: bedWidthM(t) / 2,
          track: t,
          s,
        });
    }
  }
  return out;
}

/**
 * The union outline of `margin` metres beyond the bed around consecutive samples, with each
 * ring vertex's nearest sample, edges split to 2 m. An edge whose midpoint lies on a track
 * (`cap`) closes the band across the track's end.
 */
function band(points: ReturnType<typeof samples>, margin: number) {
  // Runs of consecutive samples along one track, each inflated whole so its outline stays smooth.
  const pieces: Vec2[][] = [];
  let run: typeof points = [];
  for (const q of [...points, undefined]) {
    const last = run.at(-1);
    if (q && last && q.track === last.track && distance(q.p, last.p) < 2.5) run.push(q);
    else {
      if (run.length > 1)
        pieces.push(
          ...inflatePathsD(
            [run.map((r) => r.p)],
            run[0]!.half + margin,
            JoinType.Round,
            EndType.Butt,
            2,
            3,
          ),
        );
      run = q ? [q] : [];
    }
  }
  if (!pieces.length) return { rings: [], nearest: () => points[0]! };
  const rings = booleanOpD(ClipType.Union, pieces, [], FillRule.NonZero, 3).map((ring) => {
    const out: Vec2[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!,
        n = Math.max(1, Math.ceil(distance(a, b) / 2));
      for (let k = 0; k < n; k++)
        out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    return out;
  });
  const spatial = new Flatbush(points.length);
  for (const { p } of points) spatial.add(p.x, p.y, p.x, p.y);
  spatial.finish();
  const nearest = (p: Vec2) => points[spatial.neighbors(p.x, p.y, 1)[0]!]!;
  return { rings, nearest };
}
const isCap = (a: Vec2, b: Vec2, nearest: (p: Vec2) => { p: Vec2; half: number }) => {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    s = nearest(m);
  return distance(m, s.p) < s.half * 0.6;
};
/** Triangles covering the outline rings, holes included. */
function fill(rings: Vec2[][]) {
  if (!rings.length) return [];
  const area = (r: Vec2[]) =>
    r.reduce(
      (sum, p, i) => sum + p.x * r[(i + 1) % r.length]!.y - r[(i + 1) % r.length]!.x * p.y,
      0,
    );
  const sign = Math.sign(
    area(rings.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a))),
  );
  const outers = rings.filter((r) => Math.sign(area(r)) === sign);
  const holes = rings.filter((r) => Math.sign(area(r)) !== sign);
  return outers.flatMap((outer) => {
    const inner = holes.filter((h) => inside(h[0]!, outer));
    const points = [...outer, ...inner.flat()];
    let end = outer.length;
    const indices = earcut(
      points.flatMap((p) => [p.x, p.y]),
      inner.map((h) => {
        const at = end;
        end += h.length;
        return at;
      }),
      2,
    );
    return Array.from({ length: indices.length / 3 }, (_, i) =>
      [0, 1, 2].map((k) => points[indices[i * 3 + k]!]!),
    );
  });
}
function inside(p: Vec2, ring: Vec2[]) {
  let contains = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y))
      contains = !contains;
  }
  return contains;
}

/**
 * TASK-132: tunnel tubes, portals and cutting walls, bridge decks with parapets and piers, and
 * embankments under raised ground track. The translucent tube shows, with the tunnel's track and
 * trains, only when "See below ground" is on; the portals and cutting walls always do.
 */
function buildStructures(
  city: CompiledCity,
  rail: RailHeights,
  heights: ReturnType<typeof cityHeights>,
) {
  const graph = city.rail!;
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  const solid = new Builder(),
    tube = new Builder();
  const { concrete, deck, pier, bank, tube: tubeColor } = structure.colors;
  // Tunnel tubes.
  const tunnels = samples(graph, rail, (t) => rail.grades[t.idx] === 'tunnel');
  const tubes = band(tunnels, structure.tubeM);
  for (const ring of tubes.rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      if (isCap(a, b, tubes.nearest)) continue;
      const za = ground(a) + tubes.nearest(a).h,
        zb = ground(b) + tubes.nearest(b).h;
      tube.wall(
        a,
        b,
        za - 0.3,
        za + structure.tubeHeightM,
        zb - 0.3,
        zb + structure.tubeHeightM,
        tubeColor,
      );
    }
  for (const triangle of fill(tubes.rings)) {
    const [a, b, c] = triangle.map((p) => [
      p.x,
      ground(p) + tubes.nearest(p).h + structure.tubeHeightM,
      p.y,
    ]);
    tube.triangle(a!, b!, c!, tubeColor);
  }
  // Cutting walls beside ground track below grade, ending above the ground as parapets.
  const cuttings = samples(graph, rail, (t, h) => rail.grades[t.idx] === 'ground' && h < -0.2);
  const cutting = band(cuttings, 1.5);
  for (const ring of cutting.rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      if (isCap(a, b, cutting.nearest)) continue;
      const ga = ground(a),
        gb = ground(b);
      solid.wall(
        a,
        b,
        ga + cutting.nearest(a).h - 0.3,
        ga + structure.parapetM,
        gb + cutting.nearest(b).h - 0.3,
        gb + structure.parapetM,
        concrete,
      );
    }
  // Portals: two jambs and a lintel at the tunnel's mouth, up to a headwall above the ground.
  for (const portal of rail.portals.filter((p) => p.kind === 'tunnel')) {
    const t = graph.tracks[portal.track]!,
      p = graph.nodes[portal.node]!.pos,
      s = portal.atEnd ? t.lengthM : 0;
    const h = railHeightAt(rail, t, s),
      g = ground(p);
    const heading = headingAtDistance(t.line, t.cumulative, s) + (portal.atEnd ? Math.PI : 0);
    const u = { x: Math.cos(heading), y: Math.sin(heading) },
      v = { x: -u.y, y: u.x };
    const half = bedWidthM(t) / 2 + structure.tubeM,
      top = Math.max(g + h + structure.tubeHeightM, g + structure.parapetM);
    for (const side of [-1, 1])
      solid.box(
        { x: p.x + v.x * side * (half + 0.45), y: p.y + v.y * side * (half + 0.45) },
        u,
        0.5,
        0.45,
        g + h - 0.5,
        top,
        concrete,
      );
    solid.box(p, u, 0.5, half, g + h + structure.tubeHeightM - 1, top, concrete);
  }
  // Bridge decks: slab, sides and parapets, on piers.
  const bridges = samples(graph, rail, (t) => rail.grades[t.idx] === 'bridge');
  const decks = band(bridges, structure.deckM);
  const top = (p: Vec2) => ground(p) + decks.nearest(p).h;
  for (const triangle of fill(decks.rings)) {
    const [a, b, c] = triangle;
    solid.triangle([a!.x, top(a!), a!.y], [b!.x, top(b!), b!.y], [c!.x, top(c!), c!.y], deck);
    solid.triangle(
      [a!.x, top(a!) - structure.deckDepthM, a!.y],
      [c!.x, top(c!) - structure.deckDepthM, c!.y],
      [b!.x, top(b!) - structure.deckDepthM, b!.y],
      deck,
    );
  }
  for (const ring of decks.rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      const za = top(a),
        zb = top(b);
      solid.wall(a, b, za - structure.deckDepthM, za, zb - structure.deckDepthM, zb, concrete);
      if (!isCap(a, b, decks.nearest))
        solid.wall(a, b, za, za + structure.parapetM, zb, zb + structure.parapetM, concrete);
    }
  for (const t of graph.tracks.filter((t) => rail.grades[t.idx] === 'bridge'))
    for (let s = structure.pierSpacingM / 2; s < t.lengthM; s += structure.pierSpacingM) {
      const p = pointAtDistance(t.line, t.cumulative, s),
        h = railHeightAt(rail, t, s) - structure.deckDepthM;
      const heading = headingAtDistance(t.line, t.cumulative, s);
      if (h > 0.5)
        solid.box(
          p,
          { x: Math.cos(heading), y: Math.sin(heading) },
          structure.pierM / 2,
          structure.pierM / 2,
          ground(p),
          ground(p) + h,
          pier,
        );
    }
  // Embankments under ground track raised toward a bridge.
  for (const t of graph.tracks.filter((t) => rail.grades[t.idx] === 'ground')) {
    const n = Math.max(1, Math.ceil(t.lengthM / 2)),
      half = bedWidthM(t) / 2;
    const at = (i: number) => {
      const s = (i * t.lengthM) / n,
        p = pointAtDistance(t.line, t.cumulative, s),
        heading = headingAtDistance(t.line, t.cumulative, s);
      return { p, h: railHeightAt(rail, t, s), v: { x: -Math.sin(heading), y: Math.cos(heading) } };
    };
    let last = at(0);
    for (let i = 1; i <= n; i++) {
      const next = at(i);
      if (Math.max(last.h, next.h) > 0.2)
        for (const side of [-1, 1]) {
          const edge = (q: typeof last, offset: number) => ({
            x: q.p.x + q.v.x * side * offset,
            y: q.p.y + q.v.y * side * offset,
          });
          const a0 = edge(last, half),
            b0 = edge(next, half),
            a1 = edge(last, half + structure.embankment * Math.max(0, last.h)),
            b1 = edge(next, half + structure.embankment * Math.max(0, next.h));
          solid.quad(
            [a0.x, ground(a0) + Math.max(0, last.h), a0.y],
            [b0.x, ground(b0) + Math.max(0, next.h), b0.y],
            [b1.x, ground(b1), b1.y],
            [a1.x, ground(a1), a1.y],
            bank,
          );
        }
      last = next;
    }
  }
  const solidMesh = solid.mesh(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  const tubeMesh = tube.mesh(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  tubeMesh.name = 'rail-tubes';
  return {
    solidMesh,
    tubeMesh,
    counts: { tunnels: tunnels.length, cuttings: cuttings.length, bridges: bridges.length },
  };
}

export function buildRail(
  city: CompiledCity,
  source: CityGeometry,
  heights: ReturnType<typeof cityHeights>,
) {
  const group = new Group();
  const { roadGrades, nodeGrades } = cityGrades(city);
  const rail = city.rail ? railHeights(city, roadGrades, nodeGrades) : undefined;
  // Tracks above ground in one batch; tunnel track in another shown with "See below ground".
  const batches = [0, 1].map(() => ({
    positions: [] as number[],
    colors: [] as number[],
    spans: [] as { pick: Pick | undefined; from: number; to: number }[],
  }));
  const color = new Color();
  const side = new Color();
  for (const shape of railGeometry(city, source)) {
    if (shape.only2d) continue;
    const track = shape.pick?.kind === 'track' ? city.rail!.tracks[shape.pick.track] : undefined;
    const batch = batches[track && rail!.grades[track.idx] === 'tunnel' ? 1 : 0]!;
    const { positions, colors } = batch;
    const from = colors.length;
    color.setHex(shape.color);
    side.copy(color).multiplyScalar(0.72);
    const [top, foot] = shape.tram
      ? tramHeights[shape.tram]
      : shape.crossing
        ? [0.085, 0.085]
        : [0.06, 0.06];
    const ramp = track && rail!.profiles[track.idx]!.length > 1;
    const node = shape.node === undefined ? undefined : city.rail!.nodes[shape.node]!;
    const nodeTrack = node && city.rail!.tracks[node.tracks[0]!]!;
    const z = (p: Vec2, offset: number) =>
      (shape.crossing
        ? heights.terrain.surfaceAt(p.x, p.y)
        : track
          ? railElevation(heights, rail!, track, trackAt(track, p), p)
          : nodeTrack
            ? railElevation(
                heights,
                rail!,
                nodeTrack,
                nodeTrack.fromNode === node.idx ? 0 : nodeTrack.lengthM,
                p,
              )
            : heights.terrain.groundAt(p.x, p.y) + shape.layer * 5) + offset;
    const emit = (tri: Vec2[]) => {
      if (ramp) {
        const lengths = tri.map((p, i) => distance(p, tri[(i + 1) % 3]!));
        const edge = lengths.indexOf(Math.max(...lengths));
        if (lengths[edge]! > 12) {
          const a = tri[edge]!,
            b = tri[(edge + 1) % 3]!,
            c = tri[(edge + 2) % 3]!,
            mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          emit([a, mid, c]);
          emit([mid, b, c]);
          return;
        }
      }
      for (const p of [...tri].reverse()) {
        positions.push(p.x, z(p, top), p.y);
        if (shape.grass) {
          const k = 1 + 0.07 * mottle(p.x, p.y);
          colors.push(color.r * k, color.g * k, color.b * k);
        } else colors.push(color.r, color.g, color.b);
      }
    };
    for (const polygon of shape.polygons)
      if (polygon.length === 4) {
        emit([polygon[0]!, polygon[1]!, polygon[2]!]);
        emit([polygon[0]!, polygon[2]!, polygon[3]!]);
      } else emit(polygon);
    // Sides of raised tram parts, a shade darker than their tops.
    if (top > foot)
      for (const ring of shape.outline ?? [])
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!,
            b = ring[(i + 1) % ring.length]!;
          positions.push(
            ...[a.x, z(a, top), a.y, b.x, z(b, top), b.y, b.x, z(b, foot), b.y],
            ...[a.x, z(a, top), a.y, b.x, z(b, foot), b.y, a.x, z(a, foot), a.y],
          );
          for (let k = 0; k < 6; k++) colors.push(side.r, side.g, side.b);
        }
    batch.spans.push({ pick: shape.pick, from, to: colors.length });
  }
  const meshes = batches.map(({ positions, colors }) => {
    const geometry = new BufferGeometry()
      .setAttribute('position', new Float32BufferAttribute(positions, 3))
      .setAttribute('color', new Float32BufferAttribute(colors, 3));
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
    );
    group.add(mesh);
    return mesh;
  });
  const below = meshes[1]!;
  below.name = 'rail-below';
  below.visible = false;
  const structures = rail && buildStructures(city, rail, heights);
  if (structures) group.add(structures.solidMesh, structures.tubeMesh);
  const paintCache = new RailPaintCache(meshes[0]!);
  group.add(paintCache.mesh);
  if (structures) {
    const material = structures.tubeMesh.material as MeshLambertMaterial;
    material.transparent = true;
    material.opacity = 0.35;
    material.depthWrite = false;
    structures.tubeMesh.renderOrder = 4;
  }
  const setBelowGround = (enabled: boolean) => {
    below.visible = enabled;
    if (structures) structures.tubeMesh.visible = enabled;
  };
  setBelowGround(false);
  const select = (pick: Pick | null) => {
    const accent = new Color(0x4dafa6);
    batches.forEach(({ colors, spans }, i) => {
      const attribute = meshes[i]!.geometry.getAttribute('color');
      (attribute.array as Float32Array).set(colors);
      for (const span of spans)
        if (pick && JSON.stringify(span.pick) === JSON.stringify(pick))
          for (let k = span.from; k < span.to; k += 3)
            attribute.setXYZ(k / 3, accent.r, accent.g, accent.b);
      attribute.needsUpdate = true;
    });
  };
  return {
    group,
    select,
    setBelowGround,
    paintCache,
    heights: rail,
    structures: structures?.counts,
  };
}

/** Screen-space picking follows elevated rail geometry rather than projecting to the ground. */
export function pickRail3D(
  city: CompiledCity,
  rail: RailHeights | undefined,
  screen: Vec2,
  project: (p: Vec2, heightM: number) => Vec2,
  belowGround = false,
): Pick | null {
  if (!city.rail || !rail) return null;
  for (const p of city.places)
    if (city.rail.platforms.some((s) => s.station === p.id)) {
      const v = project(p.centroid, 0);
      if (Math.hypot(v.x - screen.x, v.y - screen.y) < 9) return { kind: 'place', place: p.idx };
    }
  for (const [platform, p] of city.rail.platforms.entries()) {
    const line = (
      p.shape.kind === 'polygon'
        ? p.shape.ring
        : p.shape.kind === 'line'
          ? p.shape.line
          : [p.shape.pos]
    ).map((v) => project(v, p.layer * 5));
    const { away } = nearestOnPolyline(line, screen);
    // Platforms are narrow: their centre and outline remain selectable at overview zoom.
    const centre = {
      x: line.reduce((s, p) => s + p.x, 0) / line.length,
      y: line.reduce((s, p) => s + p.y, 0) / line.length,
    };
    if (away < 4 || Math.hypot(centre.x - screen.x, centre.y - screen.y) < 5)
      return { kind: 'platform', platform };
  }
  let hit: Pick | null = null,
    best = 5;
  for (const t of city.rail.tracks) {
    if (!belowGround && rail.grades[t.idx] === 'tunnel') continue;
    const ramp = rail.profiles[t.idx]!.length > 1;
    const line = [t.line[0]!];
    for (let i = 1; i < t.line.length; i++) {
      const a = t.line[i - 1]!,
        b = t.line[i]!,
        steps = ramp ? Math.max(1, Math.ceil(distance(a, b) / 5)) : 1;
      for (let j = 1; j <= steps; j++)
        line.push({ x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps });
    }
    const d = nearestOnPolyline(
      line.map((p) => project(p, railHeightAt(rail, t, trackAt(t, p)))),
      screen,
    ).away;
    if (d < best) {
      best = d;
      hit = { kind: 'track', track: t.idx };
    }
  }
  return hit;
}
