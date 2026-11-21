import Flatbush from 'flatbush';
import { Color, type Mesh } from 'three';
import { boxOf, headingAtDistance, pointAtDistance } from '../src/geo/polyline';
import type { Vec2 } from '../src/geo/vec2';
import { compile } from '../src/network';
import { railHeightAt } from '../src/network/rail';
import { paintedCity } from '../src/render/road-paint';
import { bedWidthM } from '../src/render/rail-geometry';
import { cityHeights } from '../src/render3d/heights';
import { buildRail, railPassages } from '../src/render3d/rail';
import { openBundled, realPlaceBuilds } from './bundled-cities';

// node --experimental-transform-types --import ./bench/register.ts bench/rail-clearance.ts [city ...]
// Sample the rendered deck underside over each paved footprint. Separately audit the solid above
// rail beds every metre, as in TASK-280. A crossing is one track ID and paved surface ID.

type Triangle = {
  ring: Vec2[];
  height: (p: Vec2, inside?: boolean) => number | undefined;
  underside: boolean;
};
const deckColor = new Color(0xb9b8b0);
const bounds = (ring: Vec2[]) => {
  const { minX, minY, maxX, maxY } = boxOf(ring);
  return [minX, minY, maxX, maxY] as const;
};

function trianglesOf(mesh: Mesh): Triangle[] {
  const p = mesh.geometry.getAttribute('position'),
    c = mesh.geometry.getAttribute('color');
  const triangles: Triangle[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const ring = [i, i + 1, i + 2].map((j) => ({ x: p.getX(j), y: p.getZ(j) }));
    const [a, b, d] = ring as [Vec2, Vec2, Vec2];
    const cross = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
    if (Math.abs(cross) < 1e-8) continue;
    const zs = [p.getY(i), p.getY(i + 1), p.getY(i + 2)] as const;
    // A deck face is followed by its reversed underside, 1 m below all three corners.
    const underside =
      i >= 3 &&
      Math.abs(c.getX(i) - deckColor.r) < 1e-6 &&
      [0, 2, 1].every(
        (k, j) =>
          p.getX(i + j) === p.getX(i - 3 + k) &&
          p.getZ(i + j) === p.getZ(i - 3 + k) &&
          Math.abs(zs[j]! + 1 - p.getY(i - 3 + k)) < 1e-4,
      );
    triangles.push({
      ring,
      underside,
      height: ({ x, y }, inside = true) => {
        const u = ((x - a.x) * (d.y - a.y) - (y - a.y) * (d.x - a.x)) / cross;
        const v = ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / cross;
        if (inside && (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6)) return undefined;
        return zs[0] + (zs[1] - zs[0]) * u + (zs[2] - zs[0]) * v;
      },
    });
  }
  return triangles;
}

type Crossing = { track: string; surface: string; required: number; clearance: number; at: Vec2 };
type BedIssues = {
  covered: number;
  floating: number;
  worstCover?: { at: Vec2; depthM: number };
};
for (const name of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(realPlaceBuilds)) {
  const { city: source } = await openBundled(name);
  const result = compile(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
  const city = paintedCity(result.compiled);
  const heights = cityHeights(city, source);
  const start = performance.now();
  const rail = buildRail(city, source, heights);
  const railBuildMs = Math.round(performance.now() - start);
  const mesh = rail.group.getObjectByName('rail-structures') as Mesh | undefined;
  const profile = rail.heights;
  const crossings = new Map<string, Crossing>();
  const sharedRoadDecks = new Map<string, Crossing>();
  const bed = { samples: 0, covered: 0, floating: 0 };
  const bedProblems = new Map<string, BedIssues>();
  if (mesh && profile && city.rail) {
    const triangles = trianglesOf(mesh);
    const solid = new Flatbush(Math.max(1, triangles.length));
    for (const t of triangles) solid.add(...bounds(t.ring));
    if (!triangles.length) solid.add(0, 0, 0, 0);
    solid.finish();
    const trackSamples = city.rail.tracks
      .filter((t) => profile.grades[t.idx] === 'bridge')
      .flatMap((track) => {
        const n = Math.max(1, Math.ceil(track.lengthM / 2));
        return Array.from({ length: n + 1 }, (_, i) => ({
          track,
          p: pointAtDistance(track.line, track.cumulative, (i * track.lengthM) / n),
        }));
      });
    if (trackSamples.length) {
      const spatial = new Flatbush(trackSamples.length);
      for (const { p } of trackSamples) spatial.add(p.x, p.y, p.x, p.y);
      spatial.finish();
      const passages = railPassages(city, source, heights);
      for (const t of triangles) {
        if (!t.underside) continue;
        const x = t.ring.reduce((sum, p) => sum + p.x, 0) / 3,
          y = t.ring.reduce((sum, p) => sum + p.y, 0) / 3;
        const { track } = trackSamples[spatial.neighbors(x, y, 1)[0]!]!;
        const found = passages.sharedRoadDeck(track) ? sharedRoadDecks : crossings;
        for (const { surface, points } of passages.overlaps(t.ring, track))
          for (const p of points) {
            const clearance = t.height(p, false)! - surface.height(p);
            const key = `${track.id} ${surface.id}`;
            if (clearance < (found.get(key)?.clearance ?? Infinity))
              found.set(key, {
                track: track.id,
                surface: surface.id,
                required: surface.clearance,
                clearance,
                at: p,
              });
          }
      }
    }
    for (const t of city.rail.tracks) {
      const grade = profile.grades[t.idx];
      if (grade !== 'bridge' && grade !== 'ground') continue;
      const issues: BedIssues = { covered: 0, floating: 0 };
      for (let s = 0.5; s < t.lengthM - 0.5; s++) {
        const h = railHeightAt(profile, t, s);
        if (grade === 'ground' && h <= 0.25) continue;
        const p = pointAtDistance(t.line, t.cumulative, s);
        const a = headingAtDistance(t.line, t.cumulative, s);
        for (const off of [-0.4, 0, 0.4]) {
          const d = off * bedWidthM(t);
          const q = { x: p.x - d * Math.sin(a), y: p.y + d * Math.cos(a) };
          const z = h + heights.terrain.groundAt(q.x, q.y);
          const top = Math.max(
            ...solid.search(q.x, q.y, q.x, q.y).flatMap((i) => {
              const height = triangles[i]?.height(q);
              return height === undefined ? [] : [height];
            }),
          );
          bed.samples++;
          if (top > z + 0.055) {
            issues.covered++;
            if (top - z > (issues.worstCover?.depthM ?? 0))
              issues.worstCover = { at: q, depthM: top - z };
          }
          if (grade === 'bridge' && top < z - 0.3) issues.floating++;
        }
      }
      bed.covered += issues.covered;
      bed.floating += issues.floating;
      if (issues.covered || issues.floating) bedProblems.set(t.id, issues);
    }
  }
  const ordered = [...crossings.values()].sort(
    (a, b) => a.clearance - a.required - (b.clearance - b.required),
  );
  const low = ordered.filter((c) => c.clearance < c.required - 0.005);
  console.log(
    JSON.stringify({
      name,
      railBuildMs,
      crossings: ordered.length,
      low: {
        road: low.filter((c) => c.required === 4.5).length,
        walk: low.filter((c) => c.required === 2.5).length,
      },
      worst: ordered.slice(0, 10),
      sharedRoadDecks: [...sharedRoadDecks.values()].filter(
        (p) => p.clearance < p.required - 0.005,
      ),
      bed,
      bedProblems: Object.fromEntries(bedProblems),
    }),
  );
}
