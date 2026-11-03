import { buildCity } from './build-city';

export function dividedHighway(seed = 1) {
  const { city, node, road, street, place } = buildCity('Divided highway', seed);
  const eastbound = node(300, 10);
  const westbound = node(300, -10);
  const options = { roadClass: 'primary', lanes: 2, speedKmh: 80 } as const;
  const origin = road(node(-100, 10), eastbound, options);
  const destination = road(eastbound, node(400, 10), options);
  road(node(400, -10), westbound, options);
  road(westbound, node(-100, -10), options);
  street(node(0, -100, 1), node(0, 100, 1));
  street(node(300, -100), westbound);
  street(westbound, eastbound);
  street(eastbound, node(300, 100));
  place('Homes', 'residential', { x: -85, y: 25 }, [{ road: origin, direction: 'out' }]);
  place('Offices', 'work', { x: 375, y: 25 }, [
    { road: destination, direction: 'in', positionM: 55 },
  ]);
  return city;
}
