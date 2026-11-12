import { readFileSync } from 'node:fs';
import { importOsmCached } from '../../bench/city-cache';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { town } from '../../src/fixtures/town';
import { compile } from '../../src/network';
import type { CConnector, CompiledCity } from '../../src/network';
import type { RouteRequest } from '../../src/routing';
import type { City } from '../../src/schema';
import { pointAtDistance } from '../../src/geo/polyline';

export const throughputCities = ['grid', 'town', 'Sindelfingen', 'Munich'] as const;
export type ThroughputCity = (typeof throughputCities)[number];

/** Physical endpoints survive allocation changes after the public/place import. */
export function sourceRequestKey(
  city: City,
  net: CompiledCity,
  key: string,
  request: RouteRequest,
) {
  const endpoint = (connector: CConnector) => {
    const lane = net.lanes[connector.lane]!;
    const road = city.roads[net.roads[lane.road]!.id]!;
    const point = pointAtDistance(lane.polyline, lane.cumulative, connector.positionM);
    return `${net.places[connector.place]!.id}/${connector.direction}/${road.layer ?? 0}/${point.x.toFixed(5)},${point.y.toFixed(5)}`;
  };
  const origin = net.connectors[net.index.connector.get(key.slice(0, key.indexOf('>')))!]!;
  return `${endpoint(origin)}>${endpoint(net.connectors[request.toConnector]!)}#${key.slice(key.lastIndexOf('#') + 1)}`;
}

export function throughputFixture(name: ThroughputCity) {
  const imported =
    name === 'Sindelfingen' || name === 'Munich'
      ? importOsmCached(
          readFileSync(
            `fixtures/osm/${name === 'Munich' ? 'munich-donnersberger' : 'sindelfingen-a81'}.osm`,
            'utf8',
          ),
          {
            importerVersion: '1',
            drivingSide: 'right',
            bbox: name === 'Munich' ? [11.525, 48.135, 11.545, 48.148] : [8.98, 48.69, 9, 48.702],
          },
        )
      : null;
  if (imported && !imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
  const city = imported?.ok ? imported.city : name === 'grid' ? grid5x5() : town();
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return { city, net: result.compiled };
}

/** The fixed sample, each request keyed by its connectors and its variant (0 to 2). */
export function throughputRequests(net: CompiledCity): { key: string; request: RouteRequest }[] {
  // Keep the original place-connector sample when TASK-102 appends garage entries.
  const placeEntries = new Set(net.places.flatMap((p) => [...p.connectorsIn, ...p.connectorsOut]));
  const connectors = net.connectors.filter((c) => placeEntries.has(c.idx));
  const pairs = connectors
    .filter((c) => c.direction !== 'in')
    .flatMap((origin) =>
      connectors
        .filter((c) => c.direction !== 'out' && c.place !== origin.place)
        .map((destination) => ({ origin, destination })),
    );
  const count = Math.min(32, pairs.length);
  return Array.from({ length: count }, (_, i) => {
    const { origin, destination } = pairs[Math.floor((i * (pairs.length - 1)) / (count - 1))]!;
    const request: RouteRequest = {
      fromLane: origin.lane,
      fromPosM: origin.positionM,
      toConnector: destination.idx,
      vehicleClass: 'car',
      desiredSpeedFactor: 1,
      noise: 0,
      seed: 1,
    };
    return [
      request,
      { ...request, noise: 0.1, seed: i + 1 },
      { ...request, fromPosM: net.lanes[origin.lane]!.lengthM - 5, noise: 0.3, seed: i + 17 },
    ].map((request, variant) => ({ key: `${origin.id}>${destination.id}#${variant}`, request }));
  }).flat();
}
