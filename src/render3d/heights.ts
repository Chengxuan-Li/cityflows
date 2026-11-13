import { cumulativeLengths, pointAtDistance } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity } from '../network';
import {
  gradeProfiles,
  profileAt,
  profileHeightAt,
  roadStation,
  type RoadProfile,
} from '../network/heights';
import type { CityGeometry } from '../render/types';
import { createTerrain } from './terrain';

export { roadStation };

export interface RoadHeight extends RoadProfile {
  ground?: (s: number) => number;
  crossfall?: (s: number, p: Vec2) => number;
}

export function heightAt(road: RoadHeight, s: number): number {
  const grade = profileHeightAt(road, s);
  return road.ground ? road.ground(s) + grade : grade;
}

export function heightSlopeAt(road: RoadHeight, s: number): number {
  if (s < 0 || s > road.lengthM) return 0;
  const { fromM, toM, fromSlope, toSlope, lengthM, t } = profileAt(road, s);
  return (
    (road.ground
      ? (road.ground(Math.min(road.lengthM, s + 0.1)) - road.ground(Math.max(0, s - 0.1))) /
        (Math.min(road.lengthM, s + 0.1) - Math.max(0, s - 0.1))
      : 0) +
    ((toM - fromM) * 6 * t * (1 - t)) / lengthM +
    fromSlope * (1 - t) * (1 - 3 * t) +
    toSlope * t * (3 * t - 2)
  );
}

export function cityHeights(city: CompiledCity, source: CityGeometry) {
  const profiles = gradeProfiles(city);
  const nodeGrades = city.nodes.map((n) => n.grade),
    roadGrades = city.roads.map((r) => r.grade);
  const nodes = profiles.nodes.slice();
  const roads = profiles.roads.map((road): RoadHeight => ({ ...road }));
  const terrain = createTerrain(source.terrain, source.context?.features);
  if (source.terrain) {
    for (const road of city.roads) {
      const height = roads[road.idx]!;
      const cumulative = cumulativeLengths(road.reference);
      const at = (s: number) => {
        const p = pointAtDistance(road.reference, cumulative, s + road.stations[0]!);
        return terrain.groundAt(p.x, p.y);
      };
      const fromNode = city.nodes[road.from]!,
        toNode = city.nodes[road.to]!;
      const from = nodeGrades[road.from] ? terrain.groundAt(fromNode.pos.x, fromNode.pos.y) : at(0);
      const to = nodeGrades[road.to]
        ? terrain.groundAt(toNode.pos.x, toNode.pos.y)
        : at(height.lengthM);
      const linear = (s: number) =>
        from + (to - from) * Math.max(0, Math.min(1, s / height.lengthM));
      const amplitude = Math.max(
        Math.abs(height.deckM),
        Math.abs(height.fromM),
        Math.abs(height.toM),
      );
      const blend = (s: number) =>
        amplitude ? Math.min(1, Math.abs(profileHeightAt(height, s)) / amplitude) : 0;
      height.ground = amplitude ? (s) => at(s) * (1 - blend(s)) + linear(s) * blend(s) : at;
      if (roadGrades[road.idx] === 0)
        height.crossfall = (s, p) => (terrain.surfaceAt(p.x, p.y) - at(s)) * (1 - blend(s));
    }
    for (const node of city.nodes) nodes[node.idx]! += terrain.groundAt(node.pos.x, node.pos.y);
  }
  return { nodes, roads, terrain, nodeGrades };
}

/** Apply the road's transverse terrain slope, or the ground junction's local surface. */
export function terrainVehicleOffset(
  city: CompiledCity,
  heights: ReturnType<typeof cityHeights>,
  segment: number,
  point: Vec2,
) {
  if (!heights.terrain.grid) return 0;
  if (segment >= 0) {
    const road = city.roads[city.lanes[segment]!.road]!;
    return heights.roads[road.idx]!.crossfall?.(roadStation(road, point), point) ?? 0;
  }
  const node = city.nodes[city.movements[-segment - 1]!.node]!;
  return heights.nodeGrades[node.idx] === 0
    ? heights.terrain.surfaceAt(point.x, point.y) - heights.terrain.groundAt(node.pos.x, node.pos.y)
    : 0;
}
