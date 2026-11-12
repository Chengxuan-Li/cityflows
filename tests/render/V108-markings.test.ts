// TASK-136: crossing metadata/facilities change whole-network pins; T75 strips them and retains the previous bytes.
// TASK-127: compiled rail gains boundary flags; T62 still pins unchanged lanes/movements.
// TASK-124: re-pin repaired/split connector data and exit warnings; T61 pins unchanged car geometry and strips.
// TASK-126: whole-city/compile pins include rail and station metadata; T62 keeps main lane/movement hashes.
// TASK-104: appended lot aisles and their junction mouths; T49 proves main hashes with aisles removed.
import { vehicleJson } from '../vehicle-json';
import { cityHeights } from '../../src/render3d/heights';
import { goreTriangles, triangleHeight, buildMarkings } from '../../src/render3d/markings';
import { laneEdges } from '../../src/network/lanes';
import { booleanOpD, ClipType, FillRule, areaD } from 'clipper2-ts';
import type { Graphics } from 'pixi.js';
import { drawRoad, drawMovementArrow } from '../../src/render/layers/roads';
import { drawTransitions } from '../../src/render/layers/transitions';
import { drawJunctionMarkings } from '../../src/render/layers/junction-markings';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { auditCities, compileAuditCity, loadAuditCity } from '../../bench/junction-audit';
import {
  approachMarkings,
  roadMarkingGeometry,
  nodeMarkingGeometry,
  transitionMarkings,
  markingPolygons,
  movementMarkings,
  paintedGores,
  hatchGeometry,
} from '../../src/render/marking-geometry';
import { markingTheme } from '../../src/render/style';
import { buildGeometry } from '../../src/render3d/geometry';
import { pointInPolygon, segmentsIntersect, segmentDistance } from '../../src/geo/polyline';
import { tierCities, unitTest } from '../tier';

// Compile hashes captured at 56ffccd (main) before the renderer changes, then updated at the
// TASK-100 merge: its lanes also allow `van`; with `van` removed they hash as at 56ffccd.
// TASK-101 merge: compiled roads carry access and zones (all four), and access boundaries keep
// junctions in Munich and Sindelfingen, which moves their arrows; grid and town arrows are equal.
// TASK-104 merge: compiled `lots` (stalls, aisle ids) and the appended aisle graph move the
// Munich and Sindelfingen compile hashes, and the new aisle lanes join the arrow hash.
// TASK-102 merge: garages compile into every city; they take ids before the lots, so the
// aisle lanes are renumbered. Arrows on the other 664 Sindelfingen lanes equal main's.
// TASK-131 keeps OSM geometry (no node merges, junction groups): Munich and Sindelfingen roads,
// lanes and arrows move, so their compile and arrow hashes no longer equal main's.
// Munich re-pinned for 06dae00 (median crossings offset by half their lane block)
// and e4654d8 (merging lanes kept on a group's inner roads).
// TASK-132: building passages (Munich 18 tracks, Sindelfingen 3) gain `covered`; with it
// stripped every pin equals 2df05a1's.
const baseline = {
  grid: {
    compile: '41664cabf1ab1d44115242181e2d531294b4cd516eb00209669329ad514b53f3',
    arrows: '46a5ce9adeddd011af72c58a0c8ef9e9b315ad7f732ebfa71b2cff6c2d531748',
  },
  town: {
    compile: '3c319559549227be144c8ccb3fa783d7d9ca9bd46c66ecb715cabf26a709fa0d',
    arrows: '7e7450ea45037fb309353bfcafce6cf910155b7eb5909a1db610e54aadd7e700',
  },
  sindelfingen: {
    compile: '14770c813381c93ee103d39734aa8c1d72e8321fd3b5ec3d5008adff838e478e',
    arrows: '29bd956f1a3e4825fe96236f91eb9bfbd94b07e62f23f9eff2f7f0e51621ba0a',
  },
  munich: {
    // TASK-103 appends parking entries/spaces; the independent arrow hash stays pinned.
    // TASK-135: Munich's 54 tram tracks gain `form` and `provenance`; with them stripped (the
    // import without assignTramForms) every pin equals c3a6ec2's.
    compile: '821d4a4aa3fa3e034e4271f3e8a08a77b6c4dc6567febfe3cd0a084096822222',
    arrows: 'fc74b34d263cdc6c945bc4bdc85edf24e21476112116318b50a927271ede139e',
  },
} as const;
const hash = (value: unknown) =>
  createHash('sha256').update(vehicleJson(value, true)).digest('hex');

test.each(tierCities(auditCities))('V108: %s compile and arrow placement equal main', (name) => {
  const city = compileAuditCity(name);
  expect(hash(city)).toBe(baseline[name].compile);
  expect(hash(city.lanes.map((l) => [l.id, approachMarkings(city, l)]))).toBe(
    baseline[name].arrows,
  );
});

unitTest('V108: German widths and dash patterns are theme data', () => {
  expect(markingTheme.id).toBe('de');
  expect(markingTheme.classes.residential.lane).toEqual({ widthM: 0.12, dash: [3, 6] });
  expect(markingTheme.classes.motorway.lane).toEqual({ widthM: 0.15, dash: [6, 12] });
  expect(markingTheme.classes.trunk.lane.dash).toEqual([6, 12]);
  expect(markingTheme.classes.motorway.edge.widthM).toBe(0.3);
  expect(new Set(Object.values(markingTheme.colors)).size).toBe(1);
});

unitTest.each(['grid', 'sindelfingen'] as const)(
  'V108: %s 2D and 3D draw the complete shared geometry including arrows',
  (name) => {
    const city = compileAuditCity(name);
    const shapes = city.roads
      .flatMap((road) => {
        const geometry = roadMarkingGeometry(city, road);
        return [...geometry.below, ...geometry.above, ...transitionMarkings(city, road)];
      })
      .concat(
        city.nodes.flatMap((node) => [
          ...nodeMarkingGeometry(city, node),
          ...(node.outline.length
            ? node.movements.flatMap((i) =>
                city.movements[i]!.neverGreen ? [] : movementMarkings(city.movements[i]!),
              )
            : []),
        ]),
      );
    expect(shapes.some((s) => s.role === 'arrow' && s.kind === 'polygon')).toBe(true);
    const points = shapes.flatMap((s) => markingPolygons(s).flat());
    const bounds = (ps: { x: number; y: number }[]) =>
      ps.reduce(
        (b, p) => [
          Math.min(b[0]!, p.x),
          Math.min(b[1]!, p.y),
          Math.max(b[2]!, p.x),
          Math.max(b[3]!, p.y),
        ],
        [Infinity, Infinity, -Infinity, -Infinity],
      );
    let lineCount = 0,
      polygonCount = 0;
    const pen = {
      poly() {
        return this;
      },
      moveTo() {
        return this;
      },
      lineTo() {
        return this;
      },
      fill() {
        polygonCount++;
        return this;
      },
      stroke() {
        lineCount++;
        return this;
      },
    } as unknown as Graphics;
    const surface = {
      poly() {
        return this;
      },
      fill() {
        return this;
      },
      stroke() {
        return this;
      },
    } as unknown as Graphics;
    for (const road of city.roads) {
      drawRoad(surface, pen, city, road, false, pen);
      drawTransitions(surface, pen, city, road);
    }
    for (const node of city.nodes) drawJunctionMarkings(pen, city, node);
    for (const movement of city.movements)
      if (!movement.neverGreen && city.nodes[movement.node]!.outline.length)
        drawMovementArrow(pen, movement);
    expect(lineCount).toBe(shapes.filter((s) => s.kind === 'line').length);
    expect(polygonCount).toBe(shapes.filter((s) => s.kind === 'polygon').length);
    const expectedArea = shapes.reduce(
      (sum, shape) =>
        sum + markingPolygons(shape).reduce((area, ring) => area + Math.abs(areaD(ring)), 0),
      0,
    );
    const geometry = buildGeometry(city, loadAuditCity(name));
    const position = geometry.markings.getAttribute('position');
    expect(geometry.markings.userData.markingCounts).toEqual({
      line: lineCount,
      polygon: polygonCount,
    });
    let renderedArea = 0;
    for (let i = 0; i < position.count; i += 3)
      renderedArea +=
        Math.abs(
          (position.getX(i + 1) - position.getX(i)) * (position.getZ(i + 2) - position.getZ(i)) -
            (position.getZ(i + 1) - position.getZ(i)) * (position.getX(i + 2) - position.getX(i)),
        ) / 2;
    expect(Math.abs(renderedArea - expectedArea) / expectedArea).toBeLessThan(0.0001);
    const rendered = Array.from({ length: position.count }, (_, i) => ({
      x: position.getX(i),
      y: position.getZ(i),
    }));
    bounds(rendered).forEach((v, i) => expect(v).toBeCloseTo(bounds(points)[i]!, 3));
  },
);

test.each(tierCities(['munich', 'sindelfingen'] as const))(
  'V108: %s gores and taper paint stay paved and off lane centrelines',
  (name) => {
    const city = compileAuditCity(name);
    let gores = 0,
      hatches = 0;
    const bad: string[] = [];
    const laneSurfaces = city.roads.flatMap((road) => {
      const all = road.lanes.map((i) => city.lanes[i]!);
      return all.map((lane) => {
        const e = laneEdges(lane, all),
          ring = [...e.left, ...e.right.reverse()],
          xs = ring.map((p) => p.x),
          ys = ring.map((p) => p.y);
        return {
          ring,
          minX: Math.min(...xs),
          minY: Math.min(...ys),
          maxX: Math.max(...xs),
          maxY: Math.max(...ys),
        };
      });
    });
    const segments = city.lanes.flatMap((l) =>
      l.polyline.slice(1).map((p, i) => [l.polyline[i]!, p] as const),
    );
    const safe = (shape: { points: { x: number; y: number }[] }, label: string) => {
      const ring = [...shape.points, shape.points[0]!];
      const xs = ring.map((p) => p.x),
        ys = ring.map((p) => p.y);
      for (const ordinal of city.laneSpatial.search(
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      )) {
        const [a, b] = segments[ordinal]!;
        if (
          pointInPolygon(a, ring, 0) ||
          pointInPolygon(b, ring, 0) ||
          ring.some((p, i) => i > 0 && segmentsIntersect(a, b, ring[i - 1]!, p))
        )
          bad.push(label + ' crosses lane centre');
      }
    };
    for (const node of city.nodes) {
      const areas = paintedGores(city, node);
      gores += areas.length;
      for (const gore of areas) {
        const shapes = hatchGeometry(gore.ring, gore.heading, gore.road, gore.holes);
        for (const shape of shapes) {
          const xs = shape.points.map((p) => p.x),
            ys = shape.points.map((p) => p.y),
            minX = Math.min(...xs),
            maxX = Math.max(...xs),
            minY = Math.min(...ys),
            maxY = Math.max(...ys);
          const laneRings = laneSurfaces
            .filter((b) => b.minX <= maxX && b.maxX >= minX && b.minY <= maxY && b.maxY >= minY)
            .map((b) => b.ring);
          const overlap = booleanOpD(
            ClipType.Intersection,
            [shape.points],
            laneRings,
            FillRule.NonZero,
            3,
          ).reduce((sum, r) => sum + areaD(r), 0);
          if (overlap > 0.005) bad.push(node.id + ' paint overlaps travel lane');
        }
        hatches += shapes.filter((s) => s.role === 'hatch').length;
        for (const shape of shapes) {
          safe(shape, node.id);
          for (const p of shape.points)
            if (!pointInPolygon(p, [...gore.ring, gore.ring[0]!], 0.003))
              bad.push(node.id + ' outside gore');
          for (const index of node.movements) {
            const movement = city.movements[index]!;
            if (
              movement.polyline.some((p) =>
                pointInPolygon(p, [...shape.points, shape.points[0]!], 0),
              )
            )
              bad.push(node.id + ' on movement ' + movement.id);
          }
        }
      }
    }
    for (const road of city.roads)
      for (const shape of transitionMarkings(city, road))
        if (shape.role === 'hatch' || shape.role === 'channel') safe(shape, road.id);
    console.info('V108 gores', name, {
      gores,
      hatches,
      bad: bad.slice(0, 10),
      nodes: city.nodes.flatMap((n) => (paintedGores(city, n).length ? [n.id] : [])),
    });
    const missing = city.nodes
      .filter((node) => {
        const incident = city.roads.filter((r) => r.from === node.idx || r.to === node.idx);
        const pairs = incident.flatMap((r) =>
          r.roadClass === 'ramp'
            ? incident.filter(
                (m) =>
                  ['motorway', 'trunk'].includes(m.roadClass) &&
                  m.lanes.length > 1 &&
                  (m.to === node.idx) === (r.to === node.idx),
              )
            : [],
        );
        return (
          pairs.length > 0 &&
          !nodeMarkingGeometry(city, node).some((s) => s.role === 'hatch') &&
          !incident.some((r) => transitionMarkings(city, r).some((s) => s.role === 'hatch'))
        );
      })
      .map((n) => n.id);
    expect(missing).toEqual([]);
    expect(gores).toBeGreaterThan(0);
    expect(hatches).toBeGreaterThan(0);
    expect(bad).toEqual([]);
    expect(hash(city)).toBe(baseline[name].compile);
  },
);

unitTest('V108: chevron bands point upstream and their entire width stays inside the gore', () => {
  const city = compileAuditCity('grid'),
    road = city.roads[0]!;
  const ring = [
    { x: 0, y: -5 },
    { x: 20, y: -5 },
    { x: 20, y: 5 },
    { x: 0, y: 5 },
    { x: 0, y: -5 },
  ];
  const shapes = hatchGeometry(ring, 0, road).filter((s) => s.role === 'hatch');
  expect(shapes.length).toBeGreaterThan(4);
  for (const shape of shapes) {
    expect(shape.points.every((p) => pointInPolygon(p, ring, 0.003))).toBe(true);
    const top = shape.points.reduce((a, b) => (a.y > b.y ? a : b));
    const bottom = shape.points.reduce((a, b) => (a.y < b.y ? a : b));
    const outer = Math.abs(top.y) > Math.abs(bottom.y) ? top : bottom;
    const inner = Math.abs(top.y) > Math.abs(bottom.y) ? bottom : top;
    expect(outer.x - inner.x).toBeGreaterThanOrEqual(-0.01);
  }
});

// TASK-131 keeps OSM geometry: Sindelfingen's Benzstraße r:137 is an 11 m road between n:134 and
// n:136 (one node on main); its 2-to-1 lane drop tapers within those 11 m and the lane-ending
// arrow's tip stands 0.52 m past the taper edge.
const offSurfaceArrows: Partial<Record<(typeof auditCities)[number], string[]>> = {
  sindelfingen: ['r:137'],
};
test.each(tierCities(auditCities))(
  'V108: %s approach and lane-ending arrows stay on their road surface',
  (name) => {
    const city = compileAuditCity(name),
      bad: string[] = [];
    for (const road of city.roads.filter((r) => !offSurfaceArrows[name]?.includes(r.id)))
      for (const shape of [
        ...roadMarkingGeometry(city, road).above,
        ...transitionMarkings(city, road),
      ])
        if (shape.role === 'arrow')
          for (const p of shape.points)
            if (!pointInPolygon(p, [...road.surface, road.surface[0]!], 0.02)) bad.push(road.id);
    expect([...new Set(bad)]).toEqual([]);
  },
);

unitTest('V108: hatching preserves an enclosed exclusion', () => {
  const city = compileAuditCity('grid');
  const ring = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
  ];
  const hole = [
    { x: 5, y: 3 },
    { x: 5, y: 7 },
    { x: 15, y: 7 },
    { x: 15, y: 3 },
  ];
  const shapes = hatchGeometry(ring, 0, city.roads[0]!, [hole]);
  expect(shapes.filter((s) => s.role === 'hatch').length).toBeGreaterThan(0);
  for (const shape of shapes) {
    const overlap = booleanOpD(
      ClipType.Intersection,
      [shape.points],
      [hole],
      FillRule.NonZero,
      3,
    ).reduce((sum, r) => sum + areaD(r), 0);
    expect(Math.abs(overlap)).toBeLessThan(0.005);
  }
});

test.each(tierCities(['sindelfingen', 'munich'] as const))(
  'V108: %s gore paint follows the actual tessellated pavement',
  (name) => {
    const city = compileAuditCity(name),
      source = loadAuditCity(name),
      heights = cityHeights(city, source);
    const geometry = buildMarkings(city, source, heights),
      positions = geometry.getAttribute('position');
    let samples = 0;
    for (const node of city.nodes)
      for (const gore of paintedGores(city, node)) {
        const triangles = goreTriangles(city, heights, gore);
        const boundary = [...gore.ring, gore.ring[0]!];
        const xs = boundary.map((p) => p.x),
          ys = boundary.map((p) => p.y),
          minX = Math.min(...xs),
          maxX = Math.max(...xs),
          minY = Math.min(...ys),
          maxY = Math.max(...ys);
        for (let i = 0; i < positions.count; i++) {
          const p = { x: positions.getX(i), y: positions.getZ(i) };
          if (
            p.x < minX ||
            p.x > maxX ||
            p.y < minY ||
            p.y > maxY ||
            !pointInPolygon(p, boundary, 0)
          )
            continue;
          const triangle = triangles.find((t) =>
            pointInPolygon(p, [...t.points, t.points[0]!], 0.0002),
          );
          if (!triangle) continue;
          const clearance = positions.getY(i) - triangleHeight(triangle, p);
          // Other road paint can touch the gore boundary; only strictly interior points count.
          if (
            Math.abs(clearance - 0.025) > 0.003 &&
            boundary.some((q, j) => j > 0 && segmentDistance(p, boundary[j - 1]!, q) < 0.003)
          )
            continue;
          // Float32 positions and adjacent tessellation seams retain visible centimetre clearance.
          expect(clearance, node.id).toBeGreaterThan(0.005);
          expect(clearance, node.id).toBeLessThan(0.05);
          samples++;
        }
      }
    expect(samples).toBeGreaterThan(0);
  },
  120_000,
);

unitTest('V108: a lane tapering at both ends keeps its ending arrow', () => {
  const city = compileAuditCity('sindelfingen');
  for (const id of ['r:1252', 'r:1254'] as const) {
    const road = city.roads[city.index.road.get(id)!]!;
    expect(city.lanes[road.lanes[2]!]!.taperEndM).toBeGreaterThan(0);
    expect(transitionMarkings(city, road).some((s) => s.role === 'arrow')).toBe(true);
  }
});
