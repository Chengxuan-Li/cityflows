import { nearestOnPolyline } from '../geo/polyline';
import type { Vec2 } from '../geo/vec2';
import type { CompiledCity, CRoad } from '../network';
import { cityGrades } from '../render/grades';
import type { CityGeometry } from '../render/types';

export interface RoadHeight {
  lengthM: number;
  deckM: number;
  fromM: number;
  toM: number;
}

export function heightAt(road: RoadHeight, s: number): number {
  const rampM = Math.min(60, road.lengthM / 2);
  const smooth = (distance: number) => {
    const t = Math.max(0, Math.min(1, distance / rampM));
    return t * t * (3 - 2 * t);
  };
  return (
    road.deckM +
    (road.fromM - road.deckM) * (1 - smooth(s)) +
    (road.toM - road.deckM) * (1 - smooth(road.lengthM - s))
  );
}

export function cityHeights(city: CompiledCity, source: CityGeometry) {
  const { nodeGrades, roadGrades } = cityGrades(city, source);
  const nodes = nodeGrades.map((g) => 5 * g);
  const roads = city.roads.map((road): RoadHeight => ({
    lengthM: road.stations.at(-1)! - road.stations[0]!,
    deckM: 5 * roadGrades[road.idx]!,
    fromM: nodes[road.from]!,
    toM: nodes[road.to]!,
  }));
  return { nodes, roads };
}

/** Station zero is the compiled surface cut, where the flat junction meets the ramp. */
export function roadStation(road: CRoad, point: Vec2): number {
  return nearestOnPolyline(road.reference, point).along - road.stations[0]!;
}
