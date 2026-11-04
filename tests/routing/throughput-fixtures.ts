import { readFileSync } from 'node:fs';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { town } from '../../src/fixtures/town';
import { importOsm } from '../../src/importers/osm';
import { compile, type CompiledCity } from '../../src/network';
import type { RouteRequest } from '../../src/routing';

export const throughputCities = ['grid', 'town', 'Sindelfingen', 'Munich'] as const;
export type ThroughputCity = (typeof throughputCities)[number];

export function throughputFixture(name: ThroughputCity) {
  const imported =
    name === 'Sindelfingen' || name === 'Munich'
      ? importOsm(
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
  return result.compiled;
}

export function throughputRequests(net: CompiledCity): RouteRequest[] {
  // Same ordered connector pairs and exclusions as bench/route-audit.ts; spread
  // the fixed sample across the entire city rather than only its first origins.
  const pairs = net.connectors
    .filter((c) => c.direction !== 'in')
    .flatMap((origin) =>
      net.connectors
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
    ];
  }).flat();
}
