import {
  PerspectiveCamera,
  Texture,
  Vector3,
  type InstancedBufferAttribute,
  type Mesh,
} from 'three';
import { expect } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { buildCity } from '../../src/fixtures/build-city';
import type { Vec2 } from '../../src/geo/vec2';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { compile, type CompiledCity } from '../../src/network';
import { labelCandidates, labelFonts, labelRules, type Measure } from '../../src/render/labels';
import type { CityGeometry } from '../../src/render/types';
import { cityHeights } from '../../src/render3d/heights';
import type { ContextFeature } from '../../src/schema';
import {
  buildingPrisms,
  deckPrisms,
  glyphsOnScreen,
  Labels3D,
  Occluders,
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

/** The buildings and decks of a city, as the 3D view's labels see them. */
function occluders(city: CompiledCity, source: CityGeometry) {
  const heights = cityHeights(city, source);
  return [
    new Occluders(buildingPrisms(source.context?.features ?? [], heights.terrain)),
    new Occluders(deckPrisms(city, heights)),
  ];
}

function place(city: CompiledCity, source: CityGeometry, v: LabelView, hidden: Occluders[] = []) {
  const candidates = labelCandidates(city, source);
  const heights = cityHeights(city, source);
  const ground = (p: Vec2) => heights.terrain.groundAt(p.x, p.y);
  return placeLabels3D(candidates, sampleLines(candidates, ground), ground, v, measure, hidden);
}

/** A flat-roofed block of `heightM` over the rectangle. */
function block(minX: number, minY: number, maxX: number, maxY: number, heightM: number) {
  return {
    kind: 'area',
    class: 'building',
    rings: [
      [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: minY },
      ],
    ],
    heightM,
  } satisfies ContextFeature;
}

const depth = (v: LabelView, p: { x: number; y: number; h: number }) =>
  -new Vector3(p.x, p.h, p.y).applyMatrix4(v.camera.matrixWorldInverse).z;

const toScreen = (v: LabelView, x: number, y: number, h: number) => {
  const p = new Vector3(x, h, y).project(v.camera);
  return { x: ((p.x + 1) * v.width) / 2, y: ((1 - p.y) * v.height) / 2 };
};

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

function expectGoodPlacement(
  city: CompiledCity,
  source: CityGeometry,
  v: LabelView,
  hidden: Occluders[] = [],
) {
  const placed = place(city, source, v, hidden);
  // Deterministic for a camera.
  expect(place(city, source, v, hidden)).toEqual(placed);
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
    // TASK-192: while the camera moves on, street glyphs follow their roads without placing.
    const orbit = view({ x: 650, y: -60 }, 260, 45, 40);
    expect(labels.update(orbit, 4000)).toBe(false);
    const anchor = (labels.group.children[0] as Mesh).geometry.getAttribute(
      'anchor',
    ) as InstancedBufferAttribute;
    let k = 0;
    for (const p of labels.labels) {
      const poses = p.along && glyphsOnScreen(p, orbit);
      p.label.glyphs.forEach((g, i) => {
        if (g.char.trim() === '') return;
        if (poses) {
          expect(anchor.getX(k)).toBeCloseTo(poses[i]!.at.x, 2);
          expect(anchor.getZ(k)).toBeCloseTo(poses[i]!.at.y, 2);
          expect(anchor.getW(k)).toBeCloseTo(poses[i]!.rotation, 5);
        }
        k++;
      });
    }
    expect(k).toBe(labels.counts.glyphs);
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

unitTest('V192 a street behind a building block carries no label until the camera sees it', () => {
  const { compiled, city } = town();
  // Weg 600 runs north from Hauptstraße (y = 0) to y = -300. A 30 m block stands just east of
  // it along its whole length.
  city.context = { features: [block(615, -315, 700, -8, 30)] };
  const hidden = occluders(compiled, city);
  const weg = (placed: Placed3D[]) => placed.filter((p) => p.label.candidate.text === 'Weg 600');
  // From the east at street level, the block hides the street.
  const east = view({ x: 600, y: -150 }, 150, 10, 90);
  expect(weg(place(compiled, city, east))).not.toEqual([]);
  expect(weg(place(compiled, city, east, hidden))).toEqual([]);
  // From the west, or from above, the camera sees it, and its name is back.
  for (const v of [view({ x: 600, y: -150 }, 150, 10, 270), view({ x: 600, y: -150 }, 400, 75, 90)])
    expect(weg(place(compiled, city, v, hidden))).not.toEqual([]);
  // Whatever is placed lies on visible road: every glyph's sight line is clear.
  for (const v of [east, view({ x: 600, y: -150 }, 400, 30, 60)]) {
    const eye = { x: v.camera.position.x, y: v.camera.position.z, h: v.camera.position.y };
    for (const p of place(compiled, city, v, hidden))
      for (const g of p.along?.placed ?? [])
        expect(hidden.some((o) => o.blocked(eye, g.at.x, g.at.y, g.at.h + 0.5))).toBe(false);
  }
  // A place inside its own building keeps its name; behind another one it loses it.
  city.context = { features: [block(380, 60, 420, 100, 20)] };
  const own = occluders(compiled, city);
  const rathaus = (v: LabelView, h: Occluders[]) =>
    place(compiled, city, v, h).some((p) => p.label.candidate.text === 'Rathaus');
  const south = view({ x: 400, y: 0 }, 300, 12, 0);
  expect(rathaus(south, own)).toBe(true);
  city.context = { features: [block(370, 120, 430, 160, 40)] };
  expect(rathaus(south, [])).toBe(true);
  expect(rathaus(south, occluders(compiled, city))).toBe(false);
});

unitTest('V192 street labels stay on their roads and upright through a scripted orbit', () => {
  const { compiled, city } = town();
  const candidates = labelCandidates(compiled, city);
  const target = { x: 600, y: -60 };
  const start = view(target, 300, 55, 0);
  const placed = place(compiled, city, start).filter((p) => p.along);
  expect(placed.length).toBeGreaterThan(2);
  // At the placement camera the glyphs are where placement put them.
  for (const p of placed)
    glyphsOnScreen(p, start).forEach((g, i) => {
      const q = p.label.glyphs[i]!;
      expect(Math.hypot(g.x - q.x, g.y - q.y)).toBeLessThan(0.01);
      expect(Math.abs(Math.sin(g.rotation - q.rotation))).toBeLessThan(1e-6);
      expect(Math.cos(g.rotation - q.rotation)).toBeGreaterThan(0);
      expect(g.scale).toBeCloseTo(1, 9);
    });
  // Half a turn round the target while pitching down and closing in, in 15 degree steps.
  for (let step = 1; step <= 12; step++) {
    const v = view(target, 300 - 10 * step, 55 - 2 * step, 15 * step);
    for (const p of placed) {
      const line = candidates.find((c) => c.key === p.label.candidate.key)!;
      if (line.kind !== 'street') throw Error('street');
      // The road on screen, in front of the camera.
      const road: Vec2[] = [];
      for (let k = 1; k < line.line.length; k++)
        for (let t = 0; t < 1; t += 0.01) {
          const a = line.line[k - 1]!,
            b = line.line[k]!;
          const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: 0 };
          if (depth(v, q) > v.camera.near) road.push(toScreen(v, q.x, q.y, 0));
        }
      const glyphs = glyphsOnScreen(p, v);
      if (glyphs.some((g) => g.scale === 0)) continue;
      for (const g of glyphs) {
        // On the road's line on screen, turned along it.
        const { away, direction } = nearestOnPolyline(road, g);
        expect(away, `${p.label.candidate.key} at ${15 * step} deg`).toBeLessThan(0.5);
        expect(
          Math.abs(Math.cos(g.rotation) * direction.y - Math.sin(g.rotation) * direction.x),
        ).toBeLessThan(0.02);
        // Sized for its distance: as placed, scaled by how much nearer it is.
        expect(g.scale).toBeCloseTo(depth(start, g.at) / depth(v, g.at), 6);
      }
      // Upright: it reads left to right, flipping once the road turns past upright.
      const first = glyphs[0]!,
        last = glyphs.at(-1)!;
      expect(last.x - first.x).toBeGreaterThan(
        -0.11 * Math.hypot(last.x - first.x, last.y - first.y),
      );
    }
  }
  // From the far side, Hauptstraße reads the other way round along the same road.
  const hauptstrasse = placed.find((p) => p.label.candidate.text === 'Hauptstraße')!;
  const turned = glyphsOnScreen(hauptstrasse, view(target, 180, 31, 180));
  expect(turned.at(-1)!.x).toBeGreaterThan(turned[0]!.x);
});

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
    const hidden = occluders(result.compiled, imported.city);
    const counts = (
      [
        [180, 35, 20],
        [700, 55, 0],
        [2500, 60, 200],
      ] as const
    ).map(([distance, pitch, bearing]) => {
      const v = view(station, distance, pitch, bearing, ground);
      const t0 = performance.now();
      place(result.compiled, imported.city, v);
      const t1 = performance.now();
      const placed = expectGoodPlacement(result.compiled, imported.city, v, hidden);
      const t2 = performance.now();
      console.log(
        'TIMING',
        distance,
        (t1 - t0).toFixed(1),
        ((t2 - t1) / 2).toFixed(1),
        placed.length,
        place(result.compiled, imported.city, v).length,
      );
      // Every street glyph stands on road the camera sees.
      const eye = { x: v.camera.position.x, y: v.camera.position.z, h: v.camera.position.y };
      for (const p of placed)
        for (const g of p.along?.placed ?? [])
          expect(hidden.some((o) => o.blocked(eye, g.at.x, g.at.y, g.at.h + 0.5))).toBe(false);
      return placed.reduce<Record<string, number>>(
        (n, p) => ({ ...n, [p.label.candidate.kind]: (n[p.label.candidate.kind] ?? 0) + 1 }),
        {},
      );
    });
    for (const n of counts) expect(n.street).toBeGreaterThan(0);
    expect(counts[2]!.station).toBe(1);
  },
);
