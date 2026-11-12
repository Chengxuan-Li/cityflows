import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { importOsmCached } from '../../bench/city-cache';
import { compile } from '../../src/network';
import { createRouteProvider, freeFlowLinkCosts } from '../../src/routing';
import { parseOsm } from '../../src/importers/osm/parse';
import { createEngine } from '../../src/sim/engine';
import { defaultScenario } from '../../src/fixtures/scenarios';
import type { TripRequest } from '../../src/schema';

test.each(['munich-donnersberger', 'sindelfingen-a81'])(
  '%s: restored lot joins are real same-grade source nodes with legal movements',
  (name) => {
    const xml = readFileSync(`fixtures/osm/${name}.osm`, 'utf8');
    const data = parseOsm(xml);
    if (typeof data === 'string') throw new Error(data);
    const imported = importOsmCached(xml, { importerVersion: '1', context: false, terrain: false });
    if (!imported.ok) throw new Error(JSON.stringify(imported.diagnostics));
    const { city } = imported;
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const net = result.compiled;
    const lots = Object.values(city.parking!).filter((f) => f.kind === 'lot');
    const aisles = new Set(lots.flatMap((f) => f.aisles!));
    const firstLot = Math.min(...lots.map((f) => Number(f.id.slice(3))));
    const restored = Object.values(city.nodes).filter(
      (node) =>
        Number(node.id.slice(2)) >= firstLot &&
        Object.values(city.roads).some(
          (r) => !aisles.has(r.id) && (r.from === node.id || r.to === node.id),
        ),
    );
    expect(restored.length).toBe(name === 'munich-donnersberger' ? 2 : 0);
    for (const node of restored) {
      const source = node.provenance.osmIds![0]!;
      const roads = Object.values(city.roads).filter((r) => r.from === node.id || r.to === node.id);
      const publicRoads = roads.filter((r) => !aisles.has(r.id));
      expect(publicRoads.every((r) => r.roadClass === 'service' && r.lanes.length === 1)).toBe(
        true,
      );
      for (const road of roads) {
        expect(
          data.way.some((w) => road.provenance.osmIds?.includes(w.id) && w.nd.includes(source)),
        ).toBe(true);
        expect(road.layer ?? 0).toBe(node.layer);
      }
      const incoming = roads.filter((r) => r.to === node.id);
      const outgoing = roads.filter((r) => r.from === node.id);
      for (const road of incoming) {
        const lane = net.lanes[net.index.lane.get(`${road.id}#0`)!]!;
        expect(
          lane.out.some((i) =>
            outgoing.some(
              (to) => to.id === net.roads[net.lanes[net.movements[i]!.toLane]!.road]!.id,
            ),
          ),
        ).toBe(true);
      }
      expect(lots.some((lot) => lot.entries?.includes(node.id))).toBe(true);
    }
    console.info(
      name,
      'restored source joins',
      restored.map((n) => n.provenance.osmIds![0]),
    );
    if (name !== 'munich-donnersberger') return;

    const lot = Object.values(city.parking!).find((f) => f.provenance.osmIds?.includes(159640410))!;
    const facility = net.parking[net.index.parking.get(lot.id)!]!;
    const provider = createRouteProvider();
    const costs = freeFlowLinkCosts(net);
    for (const sourceWay of [159640404]) {
      const roads = Object.values(city.roads).filter((r) =>
        r.provenance.osmIds?.includes(sourceWay),
      );
      expect(roads).toHaveLength(2);
      for (const road of roads) {
        const entry = facility.connectorsIn
          .map((i) => net.connectors[i]!)
          .find((c) => net.roads[net.lanes[c.lane]!.road]!.id === road.id)!;
        expect(entry).toBeDefined();
        for (const gateway of ['p:1458', 'p:1481']) {
          const origin = net.places[net.index.place.get(gateway)!]!;
          const route = origin.connectorsOut.some((i) => {
            const from = net.connectors[i]!;
            return provider.route(net, costs, {
              fromLane: from.lane,
              fromPosM: from.positionM,
              toConnector: entry.idx,
              vehicleClass: 'car',
              purpose: 'private',
              desiredSpeedFactor: 1,
              noise: 0,
              seed: 1,
            }).ok;
          });
          expect(route, `${gateway} to ${road.id}`).toBe(true);
        }
      }
    }
    for (const [gateway, target] of [
      ['p:1458', 'p:1558'],
      ['p:1481', 'p:1558'],
      ['p:1481', 'p:1560'],
    ] as const) {
      const destination = net.parking.find(
        (f) => net.places[f.place]?.id === target && f.kind === 'lot',
      )!;
      const trips: TripRequest[] = [
        {
          id: `${target}:arrival`,
          personId: 'lot-driver',
          originPlaceId: gateway,
          destinationPlaceId: target,
          departS: 25210,
          mode: 'car',
          vehicleClass: 'car',
          purpose: 'private',
          legs: [],
        },
        {
          id: `${target}:return`,
          personId: 'lot-driver',
          originPlaceId: target,
          destinationPlaceId: gateway,
          departS: 25800,
          mode: 'car',
          vehicleClass: 'car',
          purpose: 'private',
          legs: [],
        },
      ];
      const scenario = defaultScenario('grid5x5', 1);
      scenario.startS = 25200;
      scenario.endS = 27000;
      scenario.simParams.streetParkingShare = 0;
      const engine = createEngine();
      engine.load({ compiled: net, trips, scenario });
      let droveIn = false,
        droveOut = false,
        parked = false,
        reachedPublic = false,
        dwellS = 0;
      let space: number | null = null;
      for (let second = 0; second < 1800; second++) {
        engine.step(10);
        const arrival = engine.inspect(1),
          departure = engine.inspect(2);
        if (arrival?.state === 'in_lot') {
          droveIn ||= arrival.parkingPhase === 'drive_in';
          space = arrival.parkingSpace ?? null;
        }
        if (arrival?.state === 'completed' && engine.timeS < 25800) {
          dwellS++;
          parked ||= [...engine.snapshot().parkedCars!.id].includes(1);
        }
        if (departure?.state === 'in_lot') {
          droveOut ||= departure.parkingPhase === 'drive_out';
          expect(departure.parkingSpace).toBe(space);
        }
        if (departure?.state === 'driving' && departure.lane >= 0)
          reachedPublic ||= !aisles.has(net.roads[net.lanes[departure.lane]!.road]!.id);
        if (departure?.state === 'completed' || departure?.state === 'failed') break;
      }
      expect(engine.inspect(1)?.parkingFacility).toBe(destination.id);
      expect([droveIn, parked, droveOut, reachedPublic]).toEqual([true, true, true, true]);
      expect(dwellS).toBeGreaterThan(60);
      expect(engine.metrics().trips.completed).toBe(2);
      expect(engine.metrics().trips.failed).toBe(0);
      console.info('lot round trip', gateway, target, { dwellS, space });
    }
  },
);
