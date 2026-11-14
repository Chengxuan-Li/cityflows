import { PerspectiveCamera, Texture } from 'three';
import { expect } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { buildCity } from '../../src/fixtures/build-city';
import type { Vec2 } from '../../src/geo/vec2';
import { compile, type CompiledCity } from '../../src/network';
import { labelCandidates, labelFonts, labelRules, type Measure } from '../../src/render/labels';
import type { CityGeometry } from '../../src/render/types';
import { cityHeights } from '../../src/render3d/heights';
import {
  Labels3D,
  placeLabels3D,
  sampleLines,
  settleFrames,
  settleMs,
  type LabelAtlas,
  type LabelView,
  type Placed3D,
} from '../../src/render3d/labels';
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

/** A camera looking at `target` (on the ground at height `ground`) from `distance` metres,
 * `pitch` degrees above the ground, from `bearing` degrees clockwise from south (0: from the
 * south, looking north). */
function view(target: Vec2, distance: number, pitch: number, bearing = 0, ground = 0): LabelView {
  const width = 1200,
    height = 800;
  const camera = new PerspectiveCamera(45, width / height, Math.max(0.2, distance / 10), 50000);
  const a = (pitch * Math.PI) / 180,
    b = (bearing * Math.PI) / 180;
  camera.position.set(
    target.x + distance * Math.cos(a) * Math.sin(b),
    ground + distance * Math.sin(a),
    target.y + distance * Math.cos(a) * Math.cos(b),
  );
  camera.lookAt(target.x, ground, target.y);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return { camera, width, height };
}

function town() {
  const b = buildCity('labels', 1);
  // A primary street running west only, two-way residential streets and a place.
  const main = [0, 200, 400, 600, 800, 1000, 1200].map((x) => b.node(x, 0));
  for (let i = main.length - 1; i > 0; i--)
    b.road(main[i]!, main[i - 1]!, { lanes: 3, roadClass: 'primary' }).name = 'Hauptstraße';
  for (const x of [200, 600, 1000]) {
    const north = b.node(x, -300);
    for (const road of b.street(north, main[x / 200]!)) road.name = `Weg ${x}`;
  }
  b.place('Rathaus', 'work', { x: 400, y: 80 }, []);
  const result = compile(b.city);
  if (!result.ok) throw Error('compile');
  return { compiled: result.compiled, city: b.city };
}

function place(city: CompiledCity, source: CityGeometry, v: LabelView) {
  const candidates = labelCandidates(city, source);
  const heights = cityHeights(city, source);
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  return placeLabels3D(candidates, sampleLines(candidates, ground), ground, v, measure);
}

/** Each glyph's box on screen, as the four corners of its rotated rectangle. */
function glyphBoxes(placed: Placed3D): Vec2[][] {
  const { label } = placed;
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
    ].map(([u, v]) => ({ x: g.x + u! * cos - v! * sin, y: g.y + u! * sin + v! * cos }));
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

function expectGoodPlacement(city: CompiledCity, source: CityGeometry, v: LabelView) {
  const placed = place(city, source, v);
  // Deterministic for a camera.
  expect(place(city, source, v)).toEqual(placed);
  // No two labels overlap on screen.
  const boxes = placed.map(glyphBoxes);
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (boxes[i]!.some((p) => boxes[j]!.some((q) => intersects(p, q))))
        overlaps.push(`${placed[i]!.label.candidate.key} / ${placed[j]!.label.candidate.key}`);
  expect(overlaps).toEqual([]);
  // Upright on screen: every label reads left to right.
  const limit = Math.PI / 2 + labelRules.maxLabelTurn / 2;
  for (const { label, anchor, offsets } of placed) {
    expect(label.glyphs.at(-1)!.x - label.glyphs[0]!.x, label.candidate.key).toBeGreaterThan(-1e-9);
    for (const g of label.glyphs) expect(Math.abs(g.rotation)).toBeLessThanOrEqual(limit);
    // The anchor is in front of the camera, and a street's middle glyph sits on its projection.
    const p = v.camera.worldToLocal(v.camera.position.clone().set(anchor.x, anchor.h, anchor.y));
    expect(p.z).toBeLessThan(0);
    const middle = offsets[Math.floor(offsets.length / 2)]!;
    if (label.candidate.kind === 'street') expect(Math.hypot(middle.x, middle.y)).toBeLessThan(1);
  }
  return placed;
}

const names = (placed: Placed3D[], kind = 'street') =>
  placed.filter((p) => p.label.candidate.kind === kind).map((p) => p.label.candidate.text);

unitTest('V183 3D labels are deterministic, collision-free and upright for fixed cameras', () => {
  const { compiled, city } = town();
  for (const [distance, pitch, bearing] of [
    [300, 55, 0],
    [300, 55, 180],
    [500, 30, 90],
    [150, 20, 30],
    [1000, 70, 0],
  ] as const) {
    const placed = expectGoodPlacement(
      compiled,
      city,
      view({ x: 600, y: -60 }, distance, pitch, bearing),
    );
    expect(names(placed).length, `${distance} m ${pitch} deg ${bearing} deg`).toBeGreaterThan(0);
  }
});

unitTest(
  'V183 a street reads left to right from either side, and fits where it is wide enough',
  () => {
    const { compiled, city } = town();
    // Hauptstraße runs west. From the south east is right on screen: the label reads against the
    // road's direction. From the north the screen is turned half a circle: it reads along it.
    for (const bearing of [0, 180]) {
      const placed = place(compiled, city, view({ x: 600, y: 0 }, 250, 50, bearing));
      const label = placed.find((p) => p.label.candidate.text === 'Hauptstraße')!;
      expect(label, `bearing ${bearing}`).toBeDefined();
      const { glyphs } = label.label;
      expect(glyphs.at(-1)!.x).toBeGreaterThan(glyphs[0]!.x);
      expect(Math.abs(glyphs[0]!.rotation)).toBeLessThan(0.05);
    }
    // Seen from 3 km, the 6 m residential streets are too narrow on screen for their names; the
    // 10.5 m primary still carries its own, and closer in both do.
    const far = place(compiled, city, view({ x: 600, y: -60 }, 3000, 80));
    expect(names(far).some((n) => n.startsWith('Weg'))).toBe(false);
    const near = place(compiled, city, view({ x: 600, y: -60 }, 400, 80));
    expect(names(near)).toContain('Hauptstraße');
    expect(names(near).some((n) => n.startsWith('Weg'))).toBe(true);
    // The place's name sits at its point.
    const rathaus = near.find((p) => p.label.candidate.text === 'Rathaus')!;
    expect(rathaus.anchor.x).toBe(400);
    expect(rathaus.anchor.y).toBe(80);
    // Labels on a camera looking away from the town: none.
    expect(place(compiled, city, view({ x: 600, y: 3000 }, 100, 10, 0))).toEqual([]);
  },
);

unitTest(
  'V183 3D labels place once the camera settles, never while it is still, and hide with their layer',
  async () => {
    const { compiled, city } = town();
    const atlas: LabelAtlas = {
      measure,
      glyph: () => ({ x: 0, y: 0, width: 10, height: 18 }),
      width: 1024,
      height: 256,
      texture: new Texture(),
      upload: () => {},
    };
    const loaded = Promise.resolve(atlas);
    const labels = new Labels3D(loaded);
    await loaded;
    labels.setCity(compiled, city, cityHeights(compiled, city));
    const v = view({ x: 600, y: -60 }, 300, 55);
    // The first sight of a camera starts the wait; the camera then has to stay put for
    // `settleMs` and `settleFrames` frames.
    expect(labels.update(v, 0)).toBe(false);
    expect(labels.update(v, settleMs - 1)).toBe(false);
    for (let frame = 2; frame < settleFrames; frame++)
      expect(labels.update(v, settleMs + frame)).toBe(false);
    expect(labels.update(v, settleMs + settleFrames)).toBe(true);
    const counts = labels.counts;
    expect(counts.street).toBeGreaterThan(0);
    expect(counts.glyphs).toBeGreaterThan(counts.street);
    expect(labels.group.visible).toBe(true);
    // A still camera never places again.
    for (let t = 1; t <= 10; t++) expect(labels.update(v, settleMs + 100 * t)).toBe(false);
    // A moving camera waits until it stops, also when frames are slow: the frame after a
    // camera change keeps the labels as they were.
    const moved = view({ x: 650, y: -60 }, 300, 55);
    expect(labels.update(moved, 2000)).toBe(false);
    for (let frame = 1; frame < settleFrames; frame++)
      expect(labels.update(moved, 2000 + 500 * frame)).toBe(false);
    expect(labels.update(moved, 2000 + 500 * settleFrames)).toBe(true);
    // The Labels layer hides them and shows them again as they were.
    const shown = labels.labels;
    expect(labels.setVisible(false)).toBe(true);
    expect(labels.group.visible).toBe(false);
    expect(labels.counts).toEqual({ street: 0, station: 0, stop: 0, place: 0, glyphs: 0 });
    expect(labels.labels).toEqual([]);
    expect(labels.update(moved, 5000)).toBe(false);
    expect(labels.setVisible(true)).toBe(true);
    expect(labels.group.visible).toBe(true);
    expect(labels.labels).toBe(shown);
    labels.destroy();
  },
);

cityTest(
  'V183 Munich 3D labels are collision-free and upright at street level and overview',
  () => {
    const { xml, options } = fixture('munich-donnersberger');
    const imported = importOsmCached(xml, options);
    if (!imported.ok) throw Error('import');
    const result = compile(imported.city);
    if (!result.ok) throw Error('compile');
    // Around the S-Bahn station.
    const station = result.compiled.places.find((p) => p.kind === 'station')!.centroid;
    const ground = cityHeights(result.compiled, imported.city).terrain.groundAt(
      station.x,
      station.y,
    );
    const counts = (
      [
        [180, 35, 20],
        [700, 55, 0],
        [2500, 60, 200],
      ] as const
    ).map(([distance, pitch, bearing]) => {
      const placed = expectGoodPlacement(
        result.compiled,
        imported.city,
        view(station, distance, pitch, bearing, ground),
      );
      return placed.reduce<Record<string, number>>(
        (n, p) => ({ ...n, [p.label.candidate.kind]: (n[p.label.candidate.kind] ?? 0) + 1 }),
        {},
      );
    });
    for (const n of counts) expect(n.street).toBeGreaterThan(0);
    expect(counts[2]!.station).toBe(1);
  },
);
