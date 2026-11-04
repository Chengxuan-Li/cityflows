import { expect, it } from 'vitest';
import { town } from '../../src/fixtures/town';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';

it('compiles the town without diagnostics and routes every departure to every arrival', () => {
  const result = compile(town());
  expect(result.diagnostics).toEqual([]);
  if (!result.ok) throw new Error('Town did not compile');
  const { compiled } = result;
  const provider = createRouteProvider();
  const costs = freeFlowLinkCosts(compiled);
  const origins = compiled.connectors.filter((connector) => connector.direction !== 'in');
  const destinations = compiled.connectors.filter((connector) => connector.direction !== 'out');
  expect(origins).toHaveLength(18);
  expect(destinations).toHaveLength(18);
  for (const origin of origins) {
    for (const destination of destinations) {
      const route = provider.route(compiled, costs, {
        fromLane: origin.lane,
        fromPosM: origin.positionM,
        toConnector: destination.idx,
        vehicleClass: 'car',
        desiredSpeedFactor: 1,
        noise: 0,
        seed: 1,
      });
      expect(route, `${origin.id} → ${destination.id}`).toMatchObject({ ok: true });
    }
  }
});
