import { buildCity } from './build-city';

export function disconnected(seed = 1) {
  const { city, node, road, place } = buildCity('Disconnected network', seed);
  const a = node(0, 0);
  const b = node(100, 0);
  const c = node(50, 85);
  const start = road(a, b);
  const end = road(b, c);
  road(c, a);
  const spur = road(node(250, 0), node(350, 0));
  place('Homes', 'residential', { x: 15, y: -10 }, [{ road: start, direction: 'out' }]);
  place('Offices', 'work', { x: 75, y: 65 }, [{ road: end, direction: 'in', positionM: 60 }]);
  place('Isolated homes', 'residential', { x: 265, y: -10 }, [{ road: spur, direction: 'out' }]);
  return city;
}
