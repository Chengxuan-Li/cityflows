import { compile } from '../../src/network';
import type { RouteRequest } from '../../src/routing';
import type { City } from '../../src/schema';

export function routingFixture(city: City) {
  const result = compile(city);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const { compiled } = result;
  const origin = compiled.connectors.find((connector) => connector.direction === 'out')!;
  const destination = compiled.connectors
    .filter((connector) => connector.direction === 'in')
    .at(-1)!;
  const request: RouteRequest = {
    fromLane: origin.lane,
    fromPosM: origin.positionM,
    toConnector: destination.idx,
    vehicleClass: 'car',
    desiredSpeedFactor: 1,
    noise: 0,
    seed: 1,
  };
  return { compiled, request };
}
