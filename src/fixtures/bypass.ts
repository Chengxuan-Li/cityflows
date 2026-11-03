import { buildCity } from './build-city';

export function bypass(seed = 1) {
  const { city, node, road, place } = buildCity('Expressway bypass', seed);
  const start = node(0, 0);
  const end = node(1200, 0);
  const expressStart = node(100, -40);
  const expressEnd = node(1100, -40);
  const origin = road(node(-100, 0), start);
  const destination = road(end, node(1300, 0));
  road(start, end);
  road(start, expressStart, { roadClass: 'ramp', speedKmh: 70 });
  road(expressStart, expressEnd, {
    roadClass: 'motorway',
    speedKmh: 100,
    lanes: 2,
    via: [{ x: 600, y: -40 - Math.sqrt(1000 ** 2 - 500 ** 2) }],
  });
  road(expressEnd, end, { roadClass: 'ramp', speedKmh: 70 });
  place('Homes', 'residential', { x: -80, y: 15 }, [{ road: origin, direction: 'out' }]);
  place('Offices', 'work', { x: 1280, y: 15 }, [
    { road: destination, direction: 'in', positionM: 60 },
  ]);
  return city;
}
