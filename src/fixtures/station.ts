import type { City } from '../schema';
import { buildCity, generated } from './build-city';

export function station(seed = 1): City {
  const { city, node, road, place } = buildCity('Station', seed);
  const west = node(0, 0),
    entry = node(500, 0),
    merge = node(660, 0),
    east = node(1100, 0);
  const southEast = node(1100, 400),
    southWest = node(0, 400);
  const approach = road(west, entry, { roadClass: 'secondary', speedKmh: 40 });
  approach.name = 'Station approach';
  road(entry, merge, { roadClass: 'secondary', speedKmh: 40 });
  const exit = road(merge, east, { roadClass: 'secondary', speedKmh: 40 });
  const eastReturn = road(east, southEast);
  const returnRoad = road(southEast, southWest);
  const westReturn = road(southWest, west);
  const curbWest = node(500, -80),
    curbEast = node(660, -80);
  const loop = [
    road(entry, curbWest, { roadClass: 'service', speedKmh: 20 }),
    road(curbWest, curbEast, { roadClass: 'service', speedKmh: 20 }),
    road(curbEast, merge, { roadClass: 'service', speedKmh: 20 }),
  ];
  for (const link of loop) {
    link.name = 'Pickup loop';
    link.sidewalk = { left: 'yes', right: 'yes' };
  }
  place('West gateway', 'gateway', { x: 0, y: 40 }, [
    { road: approach, direction: 'out', positionM: 20 },
    { road: westReturn, direction: 'in', positionM: 300 },
  ]);
  place('East gateway', 'gateway', { x: 1100, y: 40 }, [
    { road: eastReturn, direction: 'out', positionM: 20 },
    { road: exit, direction: 'in', positionM: 350 },
  ]);
  place('Station', 'station', { x: 600, y: -110 }, [
    { road: loop[1]!, direction: 'in', positionM: 100 },
    { road: loop[1]!, direction: 'out', positionM: 130 },
  ]);
  place('Station parking', 'parking', { x: 900, y: 370 }, [
    { road: returnRoad, direction: 'in', positionM: 150 },
    { road: returnRoad, direction: 'out', positionM: 200 },
  ]);
  const [westGate, eastGate, station, parking] = Object.values(city.places);
  // Station doors serve both ends of the pickup curb.
  city.walk = { nodes: {}, links: {} };
  for (const x of [590, 630]) {
    const id = `wn:${city.nextId++}`;
    city.walk.nodes[id] = {
      id,
      pos: { x, y: -85 },
      layer: 0,
      entrance: { placeId: station!.id },
      provenance: generated,
    };
  }
  westGate!.population = 100;
  westGate!.jobs = 20;
  eastGate!.population = 20;
  eastGate!.jobs = 100;
  station!.capacity = 4;
  station!.connectors[0]!.throughputPerMin = 6;
  station!.events = [
    {
      id: 'train-0805',
      name: '08:05 train',
      startS: 8 * 3600 + 5 * 60,
      durationS: 300,
      arrivals: 80,
      departures: 80,
    },
  ];
  parking!.capacity = 3;
  parking!.events = [
    {
      id: 'parking-0805',
      name: 'Train parking',
      startS: 8 * 3600 + 5 * 60,
      durationS: 600,
      arrivals: 8,
      departures: 8,
    },
  ];
  return city;
}
