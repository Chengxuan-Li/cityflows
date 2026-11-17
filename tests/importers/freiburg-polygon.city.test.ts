import { expect, test } from 'vitest';
import { importFreiburg } from '../../bench/freiburg';
import { nearestOnPolyline, pointInPolygon } from '../../src/geo/polyline';
import { lonLatToLocal } from '../../src/geo/projection';
import type { Vec2 } from '../../src/geo/vec2';
import { compile } from '../../src/network';
import { polygonCenter } from '../../src/importers/osm/places';
import { limit } from '../timeouts';

// TASK-198 phase 1: Freiburg's polygon import keeps nothing outside the ring, and the cut leaves
// no disconnected piece and no dead end.

test(
  'Freiburg keeps no road, track or feature outside its polygon',
  () => {
    const city = importFreiburg();
    const ring = city.geo!.boundary!.map(([lon, lat]) => lonLatToLocal(city.geo!, { lon, lat }));
    ring.push(ring[0]!);
    // Context geometry is rounded to 0.1 m and area clipping to 0.1 mm.
    const outside = (points: Vec2[]) => points.filter((p) => !pointInPolygon(p, ring, 0.08));
    const roads = Object.values(city.roads);
    expect(roads.length).toBeGreaterThan(900);
    expect(roads.flatMap((r) => outside(r.centerline))).toEqual([]);
    expect(Object.values(city.nodes).flatMap((n) => outside([n.pos]))).toEqual([]);
    const tracks = Object.values(city.rail!.tracks);
    expect(tracks.length).toBeGreaterThan(50);
    expect(tracks.flatMap((t) => outside(t.line))).toEqual([]);
    expect(Object.values(city.walk!.links).flatMap((l) => outside(l.line))).toEqual([]);
    const shapes = [
      ...Object.values(city.places).map((p) => p.shape),
      ...Object.values(city.parking ?? {}).flatMap((p) => (p.shape ? [p.shape] : [])),
    ];
    expect(
      shapes.flatMap((s) => outside(s.kind === 'point' ? [s.pos] : [polygonCenter(s.ring)!])),
    ).toEqual([]);
    const features = city.context!.features;
    expect(features.filter((f) => f.class === 'building').length).toBeGreaterThan(2000);
    expect(
      features.flatMap((f) =>
        f.kind === 'point'
          ? outside([f.pos])
          : f.kind === 'line'
            ? outside(f.line)
            : outside(f.rings[0]!),
      ),
    ).toEqual([]);
  },
  limit(120_000),
);

test(
  'the cut leaves Freiburg no disconnected piece and no dead end',
  () => {
    const city = importFreiburg();
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
    const ring = city.geo!.boundary!.map(([lon, lat]) => lonLatToLocal(city.geo!, { lon, lat }));
    ring.push(ring[0]!);
    const onRing = (p: Vec2) => nearestOnPolyline(ring, p).away < 0.5;
    const refs = (code: string) =>
      result.diagnostics.filter((d) => d.code === code).flatMap((d) => d.refs);
    const road = (lane: string) => city.roads[lane.split('#')[0]!]!;
    // What stays apart are mapped lot aisles that OSM joins to no street, inside the ring.
    const apart = refs('disconnected_component').map(road);
    expect(apart.filter((r) => !r.provenance.inferred!.includes('lotAccess'))).toEqual([]);
    const touching = (r: ReturnType<typeof road>) =>
      onRing(r.centerline[0]!) || onRing(r.centerline.at(-1)!);
    expect(apart.filter(touching)).toEqual([]);
    expect(refs('dead_end').map(road).filter(touching)).toEqual([]);
  },
  limit(120_000),
);
