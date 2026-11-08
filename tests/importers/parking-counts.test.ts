import { expect, test } from 'vitest';
import { auditRoute } from '../../bench/route-audit';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { tierCities } from '../tier';
import { throughputFixture } from '../routing/throughput-fixtures';

// TASK-102: explicit mapped garages plus a private inferred garage for each uncovered
// populated/job place. Surface lots remain places/context until TASK-104 imports facilities.
const expected = {
  Munich: { osm: 53, implicit: 87 },
  Sindelfingen: { osm: 4, implicit: 20 },
};

test.each(tierCities(['Munich', 'Sindelfingen'] as const))(
  'T48 %s garage counts by source stay within ten percent',
  (name) => {
    const { city } = throughputFixture(name);
    const counts = { osm: 0, implicit: 0 };
    for (const facility of Object.values(city.parking ?? {})) {
      expect(facility.kind).toBe('garage');
      expect(facility.connectors.length).toBeGreaterThan(0);
      const implicit = facility.provenance.inferred?.includes('implicitGarage') ?? false;
      counts[implicit ? 'implicit' : 'osm']++;
      if (implicit) {
        expect(facility.access).toBe('private');
        expect(facility.provenance.inferred).toContain('capacity');
        expect(city.places[facility.placeId!]!.kind).not.toBe('gateway');
      }
    }
    console.info(name, 'garage facilities', counts);
    for (const source of ['osm', 'implicit'] as const)
      expect(Math.abs(counts[source] - expected[name][source])).toBeLessThanOrEqual(
        expected[name][source] * 0.1,
      );
  },
);

test.each(tierCities(['Munich', 'Sindelfingen'] as const))(
  'T48 %s garage entries route or report their disconnected local access',
  (name) => {
    const { city, net } = throughputFixture(name);
    const gateway = net.places.find((p) => p.kind === 'gateway' && p.connectorsOut.length)!;
    const origin = net.connectors[gateway.connectorsOut[0]!]!;
    const provider = createRouteProvider();
    const costs = freeFlowLinkCosts(net);
    const rejected: number[] = [];
    for (const facility of net.parking.filter((p) => p.source.provenance.source === 'osm')) {
      for (const toConnector of facility.connectorsIn) {
        const request = {
          fromLane: origin.lane,
          fromPosM: origin.positionM,
          toConnector,
          vehicleClass: 'car' as const,
          desiredSpeedFactor: 1,
          noise: 0,
          seed: 1,
        };
        const result = provider.route(net, costs, request);
        if (result.ok) expect(auditRoute(city, net, request, result.route)).toEqual([]);
        else {
          expect(result.reason).toBe('no_path');
          rejected.push(facility.source.provenance.osmIds![0]!);
        }
      }
    }
    // Closest entries on disconnected local roads are kept as mapped; choice must skip
    // rejected routes. Driveways and parking aisles are deferred to TASK-104.
    expect(rejected.sort((a, b) => a - b)).toEqual(
      name === 'Munich'
        ? [366044184, 543004600, 636485626, 1311608337]
        : [25979999, 31583990, 443814543, 803877761],
    );
  },
);
