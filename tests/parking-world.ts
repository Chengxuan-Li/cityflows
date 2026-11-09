import { buildCity } from '../src/fixtures/build-city';
import { allocateId, type TripRequest } from '../src/schema';
import { defaultScenario } from '../src/fixtures/scenarios';

export function parkingWorld(kind: 'lot' | 'roadside' = 'lot') {
  const { city, node, road, place } = buildCity('Parking motion', 118);
  const a = node(0, 0),
    b = node(400, 0),
    c = node(400, 100),
    d = node(0, 100);
  const street = road(a, b);
  road(b, c);
  road(c, d);
  road(d, a);
  place('Home', 'residential', { x: 20, y: 12 }, [
    { road: street, positionM: 20, direction: 'both' },
  ]);
  place('Shop', 'retail', { x: 180, y: 55 }, [{ road: street, positionM: 180, direction: 'both' }]);
  const [home, shop] = Object.values(city.places);
  home!.population = 20;
  shop!.jobs = 20;
  const id = allocateId(city, 'pk');
  city.parking = {
    [id]: {
      id,
      kind,
      name: 'Test parking',
      capacity: 10,
      access: 'public',
      placeId: null,
      connectors:
        kind === 'lot'
          ? [
              {
                id: allocateId(city, 'c'),
                roadId: street.id,
                lane: 0,
                positionM: 150,
                direction: 'both',
                throughputPerMin: 60,
              },
            ]
          : [],
      shape:
        kind === 'lot'
          ? {
              kind: 'polygon',
              ring: [
                { x: 80, y: 8 },
                { x: 240, y: 8 },
                { x: 240, y: 50 },
                { x: 80, y: 50 },
              ],
            }
          : null,
      ...(kind === 'roadside'
        ? {
            strip: {
              roadId: street.id,
              side: 'right',
              fromM: 100,
              toM: 155,
              layout: 'parallel',
            } as const,
          }
        : {}),
      occupancyAtStart: 0,
      provenance: { source: 'authored', ...(kind === 'lot' ? { inferred: ['driveway'] } : {}) },
    },
  };
  const trip = (name: string, departS = 100): TripRequest => ({
    id: name,
    personId: name,
    originPlaceId: home!.id,
    destinationPlaceId: shop!.id,
    departS,
    mode: 'car',
    vehicleClass: 'car',
    purpose: 'private',
    legs: [],
  });
  const scenario = {
    ...defaultScenario('grid5x5', 118),
    startS: 100,
    endS: 2000,
    simParams: { streetParkingShare: 0 },
  };
  return { city, id, home: home!, shop: shop!, street, trip, scenario };
}
