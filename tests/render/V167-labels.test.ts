import { expect } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { buildCity } from '../../src/fixtures/build-city';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CompiledCity } from '../../src/network';
import {
  labelCandidates,
  labelFonts,
  labelRules,
  placeLabels,
  type Measure,
  type PlacedLabel,
} from '../../src/render/labels';
import type { CityGeometry } from '../../src/render/types';
import { fixture } from '../importers/fixtures';
import { cityTest, unitTest } from '../tier';

// Fixed advances stand in for the browser's text metrics.
const measure: Measure = (text, style) => {
  const advance = labelFonts[style].sizePx * 0.6;
  const glyphs = Array.from(text);
  return {
    glyphs,
    offsets: glyphs.map((_, i) => i * advance),
    widths: glyphs.map(() => advance),
    width: glyphs.length * advance,
    height: labelFonts[style].sizePx * 1.2,
  };
};

/** Each glyph's box on screen, as the four corners of its rotated rectangle. */
function glyphBoxes(label: PlacedLabel, zoom: number): Vec2[][] {
  const m = measure(label.candidate.text, label.candidate.style);
  return label.glyphs.map((g, i) => {
    const a = (m.widths[i]! * label.scale) / 2,
      b = (m.height * label.scale) / 2;
    const cos = Math.cos(g.rotation),
      sin = Math.sin(g.rotation);
    return [
      [-a, -b],
      [a, -b],
      [a, b],
      [-a, b],
    ].map(([u, v]) => ({
      x: g.x * zoom + u! * cos - v! * sin,
      y: g.y * zoom + u! * sin + v! * cos,
    }));
  });
}

/** Separating-axis test of two convex quadrilaterals. */
function intersects(p: Vec2[], q: Vec2[]) {
  for (const shape of [p, q])
    for (let i = 0; i < 4; i++) {
      const a = shape[i]!,
        b = shape[(i + 1) % 4]!;
      const axis = { x: a.y - b.y, y: b.x - a.x };
      const project = (s: Vec2[]) => s.map((v) => v.x * axis.x + v.y * axis.y);
      const [pp, qq] = [project(p), project(q)];
      if (Math.max(...pp) <= Math.min(...qq) || Math.max(...qq) <= Math.min(...pp)) return false;
    }
  return true;
}

function expectGoodPlacement(city: CompiledCity, source: CityGeometry, zoom: number) {
  const candidates = labelCandidates(city, source);
  const placed = placeLabels(candidates, zoom, measure);
  // Deterministic: the same candidates and the same placement on every run.
  expect(labelCandidates(city, source).map((c) => c.key)).toEqual(candidates.map((c) => c.key));
  expect(placeLabels(candidates, zoom, measure)).toEqual(placed);
  // No two labels overlap.
  const boxes = placed.map((label) => glyphBoxes(label, zoom));
  const extent = boxes.map((glyphs) => {
    const xs = glyphs.flat().map((v) => v.x),
      ys = glyphs.flat().map((v) => v.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [extent[i]!, extent[j]!];
      if (a[2]! < b[0]! || b[2]! < a[0]! || a[3]! < b[1]! || b[3]! < a[1]!) continue;
      if (boxes[i]!.some((p) => boxes[j]!.some((q) => intersects(p, q))))
        overlaps.push(`${placed[i]!.candidate.key} / ${placed[j]!.candidate.key}`);
    }
  expect(overlaps).toEqual([]);
  // Upright: every label reads left to right, and no glyph turns past the vertical by more than
  // half the turn a label may make.
  const limit = Math.PI / 2 + labelRules.maxLabelTurn / 2;
  for (const label of placed) {
    const first = label.glyphs[0]!,
      last = label.glyphs.at(-1)!;
    expect(last.x - first.x, label.candidate.key).toBeGreaterThanOrEqual(-1e-9);
    for (const g of label.glyphs) expect(Math.abs(g.rotation)).toBeLessThanOrEqual(limit);
  }
  return placed;
}

function town() {
  const b = buildCity('labels', 1);
  // A primary street running west only, two-way residential streets and a zigzag.
  const main = [0, 200, 400, 600, 800, 1000, 1200].map((x) => b.node(x, 0));
  for (let i = main.length - 1; i > 0; i--)
    b.road(main[i]!, main[i - 1]!, { lanes: 3, roadClass: 'primary' }).name = 'Hauptstraße';
  for (const x of [200, 600, 1000]) {
    const north = b.node(x, -300);
    for (const road of b.street(north, main[x / 200]!)) road.name = `Weg ${x}`;
  }
  const bend = b.node(1200, -300);
  // A zigzag of 15 m legs, each turning 74 degrees from the last.
  const via = Array.from({ length: 24 }, (_, i) => ({
    x: 1200 + (i % 2 ? 9 : 0),
    y: -12 * (i + 1),
  }));
  b.road(main[6]!, bend, { via }).name = 'Zickzack';
  b.place('Rathaus', 'work', { x: 400, y: 80 }, []);
  b.place('parking', 'parking', { x: 800, y: 80 }, []);
  const result = compile(b.city);
  if (!result.ok) throw Error('compile');
  return { compiled: result.compiled, city: b.city };
}

unitTest('V167 labels are deterministic, collision-free and upright at every zoom', () => {
  const { compiled, city } = town();
  for (const zoom of [0.5, 1, 2, 4, 8, 16]) expectGoodPlacement(compiled, city, zoom);
});

unitTest('V167 street names show where the street is wide enough and repeat along it', () => {
  const { compiled, city } = town();
  const candidates = labelCandidates(compiled, city);
  const streets = (zoom: number, name: string) =>
    placeLabels(candidates, zoom, measure).filter(
      (l) => l.candidate.kind === 'street' && l.candidate.text === name,
    );
  // Hauptstraße is 10.5 m wide: under the 12 px font at 0.75 of it from 0.86 px/m. Each Weg is
  // two 3 m lanes: 11 px at 0.75 needs 1.38 px/m.
  expect(streets(0.8, 'Hauptstraße')).toHaveLength(0);
  expect(streets(1, 'Hauptstraße').length).toBeGreaterThan(0);
  expect(streets(1.3, 'Weg 200')).toHaveLength(0);
  expect(streets(1.5, 'Weg 200')).toHaveLength(1);
  // The westbound street reads left to right: its glyphs run east, turned half a circle.
  const [label] = streets(2, 'Hauptstraße');
  expect(Math.abs(label!.glyphs[0]!.rotation)).toBeLessThan(0.01);
  // Repeats along 1.2 km: 300 m apart at 2 px/m, 600 px apart on screen at 8 px/m.
  for (const [zoom, spacing] of [
    [2, 300],
    [8, 75],
  ] as const) {
    const labels = streets(zoom, 'Hauptstraße');
    expect(labels.length).toBeGreaterThan(1);
    const xs = labels
      .map((l) => l.glyphs[Math.floor(l.glyphs.length / 2)]!.x)
      .sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(spacing - 1e-6);
  }
  // The zigzag turns too sharply to carry a label longer than one leg.
  for (const zoom of [2, 3]) expect(streets(zoom, 'Zickzack')).toHaveLength(0);
  // A named place shows its name; an unnamed one its type, capitalised.
  const places = placeLabels(candidates, 2, measure).filter((l) => l.candidate.kind === 'place');
  expect(places.map((l) => l.candidate.text).sort()).toEqual(['Parking', 'Rathaus']);
});

cityTest('V167 Munich labels are deterministic, collision-free and upright at every zoom', () => {
  const { xml, options } = fixture('munich-donnersberger');
  const imported = importOsmCached(xml, options);
  if (!imported.ok) throw Error('import');
  const city = imported.city;
  const result = compile(city);
  if (!result.ok) throw Error('compile');
  const counts = [0.4, 1, 2, 6, 12].map((zoom) => {
    const placed = expectGoodPlacement(result.compiled, city, zoom);
    return placed.reduce<Record<string, number>>(
      (n, l) => ({ ...n, [l.candidate.kind]: (n[l.candidate.kind] ?? 0) + 1 }),
      {},
    );
  });
  // The station from the overview until its entrances carry the name at 6 px/m; streets wherever
  // they are wide enough; tram stops in between, until their boards take over.
  expect(counts.map((n) => n.station)).toEqual([1, 1, 1, undefined, undefined]);
  expect(counts[0]!.street).toBeGreaterThan(0);
  expect(counts[2]!.street).toBeGreaterThan(counts[1]!.street!);
  expect(counts[2]!.stop).toBeGreaterThan(0);
  expect(counts[4]!.stop).toBeUndefined();
});
