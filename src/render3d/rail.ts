import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { CompiledCity } from '../network';
import type { RailGraph } from '../network/rail';
import { railGeometry, type RailShape } from '../render/rail-geometry';
import type { CityGeometry, Pick } from '../render/types';
import type { Vec2 } from '../geo/vec2';
import { heightAt, type cityHeights } from './heights';
import { distance, nearestOnPolyline } from '../geo/polyline';

function trackHeight(graph: RailGraph, track: RailGraph['tracks'][number], point: Vec2) {
  return heightAt(
    {
      lengthM: track.lengthM,
      fromM: graph.nodes[track.fromNode]!.layer * 5,
      toM: graph.nodes[track.toNode]!.layer * 5,
      deckM: track.layer * 5,
    },
    nearestOnPolyline(track.line, point).along,
  );
}

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

export function buildRail(
  city: CompiledCity,
  source: CityGeometry,
  heights: ReturnType<typeof cityHeights>,
) {
  const group = new Group();
  const positions: number[] = [],
    colors: number[] = [];
  const spans: { pick: Pick | undefined; from: number; to: number }[] = [];
  const color = new Color();
  const side = new Color();
  for (const shape of railGeometry(city, source)) {
    const from = colors.length;
    color.setHex(shape.color).lerp(new Color(0xf5f2e9), 1 - shape.alpha);
    side.copy(color).multiplyScalar(0.72);
    const [top, foot] = shape.tram ? tramHeights[shape.tram] : [0.06, 0.06];
    const track = shape.pick?.kind === 'track' ? city.rail!.tracks[shape.pick.track] : undefined;
    const ramp =
      track &&
      (city.rail!.nodes[track.fromNode]!.layer !== track.layer ||
        city.rail!.nodes[track.toNode]!.layer !== track.layer);
    const z = (p: Vec2, offset: number) =>
      heights.terrain.groundAt(p.x, p.y) +
      (track ? trackHeight(city.rail!, track, p) : shape.layer * 5) +
      offset;
    const emit = (tri: Vec2[]) => {
      if (ramp) {
        const lengths = tri.map((p, i) => distance(p, tri[(i + 1) % 3]!));
        const edge = lengths.indexOf(Math.max(...lengths));
        if (lengths[edge]! > 5) {
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
    spans.push({ pick: shape.pick, from, to: colors.length });
  }
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('color', new Float32BufferAttribute(colors, 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
  group.add(mesh);
  const select = (pick: Pick | null) => {
    const attribute = geometry.getAttribute('color');
    (attribute.array as Float32Array).set(colors);
    const accent = new Color(0x4dafa6);
    for (const span of spans)
      if (pick && JSON.stringify(span.pick) === JSON.stringify(pick))
        for (let i = span.from; i < span.to; i += 3)
          attribute.setXYZ(i / 3, accent.r, accent.g, accent.b);
    attribute.needsUpdate = true;
  };
  return { group, select };
}

/** Screen-space picking follows elevated rail geometry rather than projecting to the ground. */
export function pickRail3D(
  city: CompiledCity,
  screen: Vec2,
  project: (p: Vec2, heightM: number) => Vec2,
): Pick | null {
  if (!city.rail) return null;
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
    const ramp =
      city.rail.nodes[t.fromNode]!.layer !== t.layer ||
      city.rail.nodes[t.toNode]!.layer !== t.layer;
    const line = [t.line[0]!];
    for (let i = 1; i < t.line.length; i++) {
      const a = t.line[i - 1]!,
        b = t.line[i]!,
        steps = ramp ? Math.max(1, Math.ceil(distance(a, b) / 5)) : 1;
      for (let j = 1; j <= steps; j++)
        line.push({ x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps });
    }
    const d = nearestOnPolyline(
      line.map((p) => project(p, trackHeight(city.rail!, t, p))),
      screen,
    ).away;
    if (d < best) {
      best = d;
      hit = { kind: 'track', track: t.idx };
    }
  }
  return hit;
}
