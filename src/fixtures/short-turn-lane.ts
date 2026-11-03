import { buildCity, generated } from './build-city';

export function shortTurnLane(seed = 1) {
  const { city, node, road, place } = buildCity('Short turn lane', seed);
  const merge = node(0, 0);
  const junction = node(24, 0);
  const main = road(merge, junction, { lanes: 2 });
  road(node(-100, 0), merge, { lanes: 2 });
  const slip = road(node(-80, 20), merge, { roadClass: 'ramp' });
  merge.turnRules.push({
    from: slip.id,
    to: main.id,
    toLane: 0,
    allowed: false,
    provenance: generated,
  });
  const left = road(junction, node(24, -100));
  road(junction, node(124, 0), { lanes: 2 });
  place('Homes', 'residential', { x: -70, y: 30 }, [{ road: slip, direction: 'out' }]);
  place('Offices', 'work', { x: 35, y: -85 }, [{ road: left, direction: 'in', positionM: 65 }]);
  return city;
}
