import type { City, PlaceId, TripRequest, VehicleClass } from '../schema';

export interface DemandSummary {
  totalTrips: number;
  byHour: number[];
  byPlace: Record<PlaceId, { departures: number; arrivals: number }>;
  byClass: Record<VehicleClass, number>;
}

export function demandSummary(trips: readonly TripRequest[], city: City): DemandSummary {
  const byHour = Array<number>(24).fill(0);
  const byClass = { car: 0, van: 0, truck: 0, bus: 0 };
  const byPlace = Object.fromEntries(
    Object.keys(city.places)
      .sort()
      .map((id) => [id, { departures: 0, arrivals: 0 }]),
  );

  for (const trip of trips) {
    const hour = Math.floor(trip.departS / 3600) % byHour.length;
    const origin = byPlace[trip.originPlaceId];
    const destination = byPlace[trip.destinationPlaceId];
    if (!origin || !destination) throw new Error(`Trip ${trip.id} references an unknown place`);
    byHour[hour] = byHour[hour]! + 1;
    origin.departures++;
    destination.arrivals++;
    byClass[trip.vehicleClass]++;
  }

  return { totalTrips: trips.length, byHour, byPlace, byClass };
}
