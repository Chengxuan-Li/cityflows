import {
  booleanOpD,
  ClipperD,
  ClipType,
  EndType,
  FillRule,
  inflatePathsD,
  JoinType,
  areaD,
} from 'clipper2-ts';
import Flatbush from 'flatbush';
import { Container, Graphics, ParticleContainer, Polygon } from 'pixi.js';
import { cumulativeLengths, pointAtDistance, prepareRing } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import type { CompiledCity, CRoad } from '../../network';
import { style } from '../style';

export const GRADE_HEIGHT_M = 5;
const SHADOW_LENGTH_PER_HEIGHT = 0.6;
const LIGHT_DIRECTION = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
const ABUTMENT_FADE_M = 20;
const PENUMBRA_M = 1.5;

/** Warp both surface edges, inserting fade breakpoints so a straight bridge can taper too.
 * A cut meeting a shallower grade is the abutment/portal, including at a setback node. */
export function shadowRoadSurface(
  road: CRoad,
  grade: number,
  belowGrade: number,
  nodeGrades: readonly number[],
  spreadM = 0,
): Vec2[] {
  const half = road.surface.length / 2;
  const left = road.surface.slice(0, half);
  const right = road.surface.slice(half).reverse();
  const start = road.stations[0]!;
  const end = road.stations.at(-1)!;
  const offset = Math.abs(grade - belowGrade) * GRADE_HEIGHT_M * SHADOW_LENGTH_PER_HEIGHT + spreadM;
  const fadeStart = grade > 0 ? nodeGrades[road.from]! < grade : nodeGrades[road.from]! > grade;
  const fadeEnd = grade > 0 ? nodeGrades[road.to]! < grade : nodeGrades[road.to]! > grade;
  const edges = [left, right].map((edge) => {
    const points: Vec2[] = [];
    for (let i = 1; i < edge.length; i++) {
      const a = edge[i - 1]!,
        b = edge[i]!;
      const s0 = road.stations[i - 1]!,
        s1 = road.stations[i]!;
      const samples = [s1];
      if (i === 1) samples.push(s0);
      if (fadeStart) samples.push(start + ABUTMENT_FADE_M);
      if (fadeEnd) samples.push(end - ABUTMENT_FADE_M);
      if (fadeStart && fadeEnd) samples.push((start + end) / 2);
      for (const s of [...new Set(samples)]
        .filter((s) => s >= s0 && s <= s1 && (i === 1 || s > s0))
        .sort((a, b) => a - b)) {
        const t = (s - s0) / (s1 - s0);
        const fade = Math.min(
          1,
          fadeStart ? (s - start) / ABUTMENT_FADE_M : 1,
          fadeEnd ? (end - s) / ABUTMENT_FADE_M : 1,
        );
        points.push({
          x: a.x + (b.x - a.x) * t + LIGHT_DIRECTION.x * offset * fade,
          y: a.y + (b.y - a.y) * t + LIGHT_DIRECTION.y * offset * fade,
        });
      }
    }
    return points;
  });
  return [...edges[0]!, ...edges[1]!.reverse()];
}

/** Only the longitudinal outside edges: never the end cuts or a shared deck seam. */
export function deckEdges(
  city: CompiledCity,
  road: CRoad,
  roadGrades: readonly number[],
  expandedSurfaces = new Map<Vec2[], Vec2[][]>(),
): Vec2[][] {
  const clips = [
    ...city.roads
      .filter((other) => other !== road && roadGrades[other.idx] === roadGrades[road.idx])
      .map((other) => other.surface),
    city.nodes[road.from]!.outline,
    city.nodes[road.to]!.outline,
  ].filter((ring) => ring.length);
  const bounds = prepareRing(road.surface).box;
  const margin = style.deckEdgeWidthM / 2;
  const expanded = clips
    .filter((ring) => {
      const box = prepareRing(ring).box;
      return (
        box.minX <= bounds.maxX + margin &&
        box.maxX >= bounds.minX - margin &&
        box.minY <= bounds.maxY + margin &&
        box.maxY >= bounds.minY - margin
      );
    })
    .flatMap((ring) => {
      // Inflate independently: a loop of neighbours must not turn its empty interior into a clip.
      let expanded = expandedSurfaces.get(ring);
      if (!expanded) {
        expanded = inflatePathsD([ring], margin, JoinType.Round, EndType.Polygon, 2, 3);
        expandedSurfaces.set(ring, expanded);
      }
      return expanded;
    });
  const half = road.surface.length / 2;
  const clipper = new ClipperD(3);
  clipper.addOpenSubjectPaths([road.surface.slice(0, half), road.surface.slice(half).reverse()]);
  clipper.addClipPaths(expanded);
  const edges: Vec2[][] = [];
  if (!clipper.execute(ClipType.Difference, FillRule.NonZero, [], edges))
    throw new Error('Failed to clip deck edges');
  return edges;
}

function union(rings: Vec2[][]): Vec2[][] {
  return booleanOpD(ClipType.Union, rings, null, FillRule.NonZero, 3);
}

function fillRings(graphics: Graphics, rings: Vec2[][], alpha: number) {
  const holes = rings.filter((ring) => areaD(ring) < 0);
  for (const ring of rings.filter((ring) => areaD(ring) > 0)) {
    graphics.poly(ring).fill({ color: style.shadow, alpha });
    const polygon = new Polygon(ring);
    for (const hole of holes) {
      if (polygon.contains(hole[0]!.x, hole[0]!.y)) graphics.poly(hole).cut();
    }
  }
}

/** Owner revision: ground casts nothing; raised surfaces cast outside, lower surfaces shade
 * inside their own north-west lip. The difference clips every inset to the existing surface. */
export function gradeShadowSurface(
  city: CompiledCity,
  grade: number,
  belowGrade: number | undefined,
  roadGrades: readonly number[],
  nodeGrades: readonly number[],
  spreadM = 0,
): Vec2[][] {
  if (grade === 0 || (grade > 0 && belowGrade === undefined)) return [];
  const referenceGrade = grade < 0 ? 0 : belowGrade!;
  const roads = city.roads.filter((road) => roadGrades[road.idx] === grade);
  const nodes = city.nodes.filter((node) => nodeGrades[node.idx] === grade && node.outline.length);
  const offset =
    Math.abs(grade - referenceGrade) * GRADE_HEIGHT_M * SHADOW_LENGTH_PER_HEIGHT + spreadM;
  const shifted = [
    ...roads.map((road) => shadowRoadSurface(road, grade, referenceGrade, nodeGrades, spreadM)),
    ...nodes.map((node) =>
      node.outline.map((p) => ({
        x: p.x + LIGHT_DIRECTION.x * offset,
        y: p.y + LIGHT_DIRECTION.y * offset,
      })),
    ),
  ];
  return grade > 0
    ? union(shifted)
    : booleanOpD(
        ClipType.Difference,
        [...roads.map((road) => road.surface), ...nodes.map((node) => node.outline)],
        shifted,
        FillRule.NonZero,
        3,
      );
}

export function drawGradeShadows(
  city: CompiledCity,
  grade: number,
  belowGrade: number | undefined,
  roadGrades: readonly number[],
  nodeGrades: readonly number[],
) {
  const roads = city.roads.filter((road) => roadGrades[road.idx] === grade);
  const shadow = new Graphics();
  const edges = new Graphics();
  const expandedSurfaces = new Map<Vec2[], Vec2[][]>();
  if (grade !== 0) {
    // Union each pass first: adjoining road/node polygons must not darken their shared seams.
    for (const [spread, alpha] of [
      [PENUMBRA_M, 0.04],
      [PENUMBRA_M / 2, 0.07],
      [0, 0.16],
    ]) {
      fillRings(
        shadow,
        gradeShadowSurface(city, grade, belowGrade, roadGrades, nodeGrades, spread),
        alpha!,
      );
    }
  }
  if (grade !== 0)
    for (const road of roads) {
      for (const line of deckEdges(city, road, roadGrades, expandedSurfaces)) {
        if (grade > 0)
          edges.poly(line, false).stroke({ width: style.deckEdgeWidthM, color: style.deckEdge });
        else {
          const lengths = cumulativeLengths(line);
          for (let s = 0; s < lengths.at(-1)!; s += 6) {
            const end = Math.min(s + 3, lengths.at(-1)!);
            const dash = [pointAtDistance(line, lengths, s)];
            for (let i = 1; i < line.length - 1; i++)
              if (lengths[i]! > s && lengths[i]! < end) dash.push(line[i]!);
            dash.push(pointAtDistance(line, lengths, end));
            edges.poly(dash, false).stroke({ width: style.deckEdgeWidthM, color: style.deckEdge });
          }
        }
      }
    }
  return { shadow, edges };
}

/** A spatial index for static signal heads covered by higher surfaces. */
export class DeckCoverage {
  private readonly surfaces: { grade: number; polygon: Polygon }[];
  private readonly index: Flatbush | undefined;

  constructor(city: CompiledCity, roadGrades: readonly number[], nodeGrades: readonly number[]) {
    const lowest = Math.min(0, ...roadGrades, ...nodeGrades);
    this.surfaces = [
      ...city.roads.map((road) => ({ grade: roadGrades[road.idx]!, ring: road.surface })),
      ...city.nodes.map((node) => ({ grade: nodeGrades[node.idx]!, ring: node.outline })),
    ]
      .filter(({ grade, ring }) => grade > lowest && ring.length > 2)
      .map(({ grade, ring }) => ({ grade, polygon: new Polygon(ring) }));
    if (!this.surfaces.length) return;
    this.index = new Flatbush(this.surfaces.length);
    for (const { polygon } of this.surfaces) {
      const xs = polygon.points.filter((_, i) => i % 2 === 0);
      const ys = polygon.points.filter((_, i) => i % 2 === 1);
      this.index.add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    this.index.finish();
  }

  covers(x: number, y: number, grade: number): boolean {
    return (
      this.index?.search(x, y, x, y).some((i) => {
        const surface = this.surfaces[i]!;
        return surface.grade > grade && surface.polygon.contains(x, y);
      }) ?? false
    );
  }
}

/** Heads share contexts and live tints. Vehicle ghosts reuse the whole particle array:
 * the contract permits an unmasked copy, avoiding per-car coverage queries every frame. */
export class DeckGhosts {
  readonly container = new Container();
  readonly signals = new Container();
  private readonly vehicles = new ParticleContainer({
    dynamicProperties: { position: true, rotation: true, color: true, vertex: true, uvs: true },
  });
  private readonly heads: { original: Graphics; copy: Graphics }[] = [];
  private vehicleCount = 0;

  constructor(
    grade: number,
    coverage: DeckCoverage,
    signals: Container,
    private readonly originalVehicles: ParticleContainer,
  ) {
    this.container.alpha = style.deckGhostAlpha;
    this.container.addChild(this.signals, this.vehicles);
    this.vehicles.particleChildren = originalVehicles.particleChildren;
    for (const original of signals.children) {
      if (!(original instanceof Graphics)) continue;
      const bounds = original.getLocalBounds();
      if (!coverage.covers(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, grade))
        continue;
      const copy = original.clone();
      this.signals.addChild(copy);
      this.heads.push({ original, copy });
    }
    this.sync();
  }

  sync() {
    for (const { original, copy } of this.heads) {
      copy.tint = original.tint;
      copy.alpha = original.alpha;
    }
    const particles = this.originalVehicles.particleChildren;
    const count = particles.length;
    let changed = count !== this.vehicleCount;
    this.vehicleCount = count;
    if (count && this.vehicles.texture !== particles[0]!.texture) {
      this.vehicles.texture = particles[0]!.texture;
      changed = true;
    }
    if (changed) this.vehicles.update();
  }

  destroy() {
    // The original grade owns the contexts/textures, not these shared copies.
    this.container.removeFromParent();
    this.container.destroy({ children: true, context: false, texture: false });
  }
}
