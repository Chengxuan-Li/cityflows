import type { Mesh } from 'three';
import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { pointInPolygon } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { railGeometry } from '../../src/render/rail-geometry';
import { style } from '../../src/render/style';
import { cityHeights } from '../../src/render3d/heights';
import { buildRail } from '../../src/render3d/rail';
import type { RailTrack, TrackForm } from '../../src/schema/rail';

// TASK-135 (T69): each tram form has its own look in both views; railways keep theirs.

/** A north-south street at x = 0 (10.5 m wide) crossed by one east-west track per entry, 20 m apart. */
function scene(tracks: { kind: RailTrack['kind']; form?: TrackForm }[]) {
  const { city, node, road } = buildCity('Tram forms', 1);
  road(node(0, -100), node(0, 100), { lanes: 3, roadClass: 'secondary' });
  city.rail = { nodes: {}, tracks: {}, platforms: {} };
  tracks.forEach(({ kind, form }, i) => {
    const y = -60 + 20 * i,
      from = `rn:${2 * i + 1}`,
      to = `rn:${2 * i + 2}`;
    city.rail!.nodes[from] = { id: from, pos: { x: -50, y }, layer: 0, kind: 'plain' };
    city.rail!.nodes[to] = { id: to, pos: { x: 50, y }, layer: 0, kind: 'plain' };
    city.rail!.tracks[`rt:${i + 1}`] = {
      id: `rt:${i + 1}`,
      from,
      to,
      // Bent at the street so that every part has vertices there.
      line: [
        { x: -50, y },
        { x: 0, y: y + 0.5 },
        { x: 50, y },
      ],
      kind,
      layer: 0,
      ...(form ? { form } : {}),
    };
  });
  const result = compile(city);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return { city, compiled: result.compiled };
}
const forms = ['embedded', 'grass', 'paved', 'ballast'] as const;

test('T69 2D: embedded rails only, own beds in their colour clipped by the road, rails across it', () => {
  const { city, compiled } = scene([...forms.map((form) => ({ kind: 'tram' as const, form }))]);
  const shapes = railGeometry(compiled, city);
  const of = (track: number) =>
    shapes.filter((s) => s.pick?.kind === 'track' && s.pick.track === track);
  const road = compiled.roads[0]!.surface;
  for (const [i, form] of forms.entries()) {
    const parts = of(i);
    const bed = parts.find((s) => s.tram === 'bed');
    const sleepers = parts.find((s) => s.tram === 'sleepers');
    if (form === 'embedded') {
      expect(parts.map((s) => s.tram)).toEqual(['street']);
      expect(parts[0]!.color).toBe(style.tram.groove);
      continue;
    }
    expect(bed!.color).toBe(style.tram.beds[form]);
    // The bed gives way to the street; the rails run on through it as street rails.
    expect(
      bed!.polygons.some((tri) =>
        pointInPolygon(
          {
            x: (tri[0]!.x + tri[1]!.x + tri[2]!.x) / 3,
            y: (tri[0]!.y + tri[1]!.y + tri[2]!.y) / 3,
          },
          [...road, road[0]!],
        ),
      ),
    ).toBe(false);
    expect(parts.find((s) => s.tram === 'rail')!.color).toBe(style.tram.rail);
    expect(
      parts.find((s) => s.tram === 'street')!.polygons.every((tri) => Math.abs(tri[0]!.x) < 10),
    ).toBe(true);
    expect(!!sleepers).toBe(form === 'ballast');
    if (sleepers) {
      expect(sleepers.detail).toBe(true);
      const centre = (q: { x: number; y: number }[]) => ({
        x: (q[0]!.x + q[2]!.x) / 2,
        y: (q[0]!.y + q[2]!.y) / 2,
      });
      expect(sleepers.polygons.some((q) => pointInPolygon(centre(q), [...road, road[0]!]))).toBe(
        false,
      );
    }
  }
  // A tram of an older project has no form and keeps the street-running look.
  const legacy = scene([{ kind: 'tram' }]);
  expect(railGeometry(legacy.compiled, legacy.city).map((s) => s.tram)).toEqual(['street']);
});

test('T69 railways keep their bed and rails; trams differ from them in both views', () => {
  const { city, compiled } = scene([{ kind: 'rail' }, { kind: 'tram', form: 'ballast' }]);
  const shapes = railGeometry(compiled, city);
  const rail = shapes.filter((s) => s.pick?.kind === 'track' && s.pick.track === 0);
  expect(rail.map((s) => [s.color, s.detail ?? false, s.tram])).toEqual([
    // TASK-162: the neutral gray bed and rails of the Mac-style palette.
    [0xc2c1bd, false, undefined],
    [0x7c7c80, true, undefined],
    [0x7c7c80, true, undefined],
  ]);
  const mesh = buildRail(compiled, city, cityHeights(compiled, city)).group.children[0] as Mesh;
  const p = mesh.geometry.getAttribute('position');
  const heights = (y: number, x0: number, x1: number) =>
    Array.from({ length: p.count }, (_, i) => i)
      .filter((i) => Math.abs(p.getZ(i) - y) < 2 && p.getX(i) > x0 && p.getX(i) < x1)
      .map((i) => +p.getY(i).toFixed(3));
  // The railway stays flat paint at 0.06 m; the tram bed is a low raised bed with rails on top,
  // and its rails lie on the street where it crosses.
  expect([...new Set(heights(-60, -50, 50))]).toEqual([0.06]);
  const tram = new Set(heights(-40, 15, 51));
  for (const h of [0, 0.12, 0.13, 0.17]) expect(tram.has(h)).toBe(true);
  expect(new Set(heights(-40, -1, 1))).toEqual(new Set([0, 0.06]));
});
