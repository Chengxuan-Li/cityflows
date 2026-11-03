import { buildCity } from './build-city';

export function shortTurnLane(seed = 1) {
  const { city, node, road, place } = buildCity('Short turn lane', seed);
  const merge = node(0, 0);
  const junction = node(24, 0);
  road(merge, junction, { lanes: 2 });
  road(node(-100, 0), merge, { lanes: 2 });
  // The slip road merges into the curb lane; the left turn at the junction leaves from lane 0,
  // and the 24 m between them is shorter than laneChangeDistanceM.
  const slip = road(node(-80, 20), merge, { roadClass: 'ramp' });
  const left = road(junction, node(24, -100));
  road(junction, node(124, 0), { lanes: 2 });
  place('Homes', 'residential', { x: -70, y: 30 }, [{ road: slip, direction: 'out' }]);
  place('Offices', 'work', { x: 35, y: -85 }, [{ road: left, direction: 'in', positionM: 65 }]);
  return city;
}
