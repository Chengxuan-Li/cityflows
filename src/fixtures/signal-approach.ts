import { buildCity } from './build-city';

export function signalApproach(seed = 1) {
  const { city, node, street, place, signal } = buildCity('Four-way signal', seed);
  const center = node(0, 0);
  const west = node(-120, 0);
  const east = node(120, 0);
  const north = node(0, -120);
  const south = node(0, 120);
  const arms = [west, east, north, south].map((end) => street(end, center, 2));
  signal(center, arms);
  const [westIn, westOut] = arms[0]!;
  const [eastIn, eastOut] = arms[1]!;
  place('Homes', 'residential', { x: -100, y: 15 }, [
    { road: westIn, direction: 'out' },
    { road: westIn, direction: 'out', lane: 1 },
    { road: westOut, direction: 'in', positionM: 85 },
    { road: westOut, direction: 'in', lane: 1, positionM: 85 },
  ]);
  place('Offices', 'work', { x: 100, y: -15 }, [
    { road: eastIn, direction: 'out' },
    { road: eastIn, direction: 'out', lane: 1 },
    { road: eastOut, direction: 'in', positionM: 85 },
    { road: eastOut, direction: 'in', lane: 1, positionM: 85 },
  ]);
  return city;
}
