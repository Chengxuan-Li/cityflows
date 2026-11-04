import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createRouteProvider } from '../../src/routing';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

test.each([true, false])(
  'a blocked turn uses a reachable fallback or waits for a safe lane change (detour: %s)',
  (reachable) => {
    const { city, node, road, place } = buildCity('Missed left turn', 1);
    const center = node(0, 0);
    const north = node(0, -100);
    const east = node(100, 0);
    const approach = road(node(-100, 0), center, { lanes: 2 });
    const left = road(center, north);
    road(center, east, { lanes: 2 }); // Cheapest turn, but an unrelated boundary exit.
    const destination = road(north, node(0, -200));
    let fallback;
    if (reachable) {
      const south = node(0, 100);
      fallback = road(center, south);
      const corner = node(100, -100);
      road(south, corner, { via: [{ x: 100, y: 100 }] });
      road(corner, north);
    }
    place('Homes', 'residential', { x: -80, y: 10 }, [
      { road: approach, lane: 1, positionM: 80, direction: 'out' },
    ]);
    place('Office', 'work', { x: 10, y: -170 }, [
      { road: destination, direction: 'in', positionM: 65 },
    ]);
    place('Local origin', 'residential', { x: -20, y: -10 }, [
      { road: approach, positionM: 80, direction: 'out' },
    ]);
    place('Full lot', 'work', { x: -10, y: -10 }, [
      { road: approach, positionM: 85, direction: 'in' },
    ]);
    const [, , blockerOrigin, blockerDestination] = Object.values(city.places);
    blockerDestination!.events = [
      { id: 'open', name: 'Open', startS: 180, durationS: 1, arrivals: 1, departures: 0 },
    ];
    const compiled = setup(city);
    const engine = createEngine();
    const [trip] = trips(city, 1);
    engine.load({
      compiled,
      scenario: scenario(),
      routeProvider: createRouteProvider({ laneChangeDistanceM: 10 }),
      trips: [
        { ...trip!, departS: 110 },
        {
          ...trip!,
          id: 'blocker',
          originPlaceId: blockerOrigin!.id,
          destinationPlaceId: blockerDestination!.id,
        },
      ],
    });
    engine.step(101);
    expect(engine.inspect(2)!.state).toBe('queued_destination');
    const initial = engine.inspect(1)!;
    const firstTurn = compiled.movements[initial.route!.movements[0]!]!;
    expect(compiled.roads[compiled.lanes[firstTurn.toLane]!.road]!.id).toBe(left.id);
    expect(firstTurn.fromLane).not.toBe(initial.lane);
    let previous = initial.lane;
    let droveFallback = false;
    let waited = false;
    for (let i = 0; i < 2000; i++) {
      engine.step();
      const detail = engine.inspect(1)!;
      if (!reachable && engine.timeS > 170 && engine.timeS < 180) {
        expect(detail.state).toBe('driving');
        expect(detail.lane).toBe(initial.lane);
        expect(detail.positionM).toBeLessThan(compiled.lanes[initial.lane]!.lengthM);
        expect(detail.speedMps).toBeLessThan(0.1);
        waited = true;
      }
      if (detail.lane !== previous) {
        const through = compiled.lanes[previous >= 0 ? previous : 0]!.out.some(
          (i) =>
            compiled.movements[i]!.toLane === detail.lane && compiled.movements[i]!.lengthM === 0,
        );
        if (previous >= 0 && detail.lane >= 0 && through) {
          // A through node's movement has no length and is crossed within one step (TASK-061).
        } else if (previous >= 0 && detail.lane >= 0) {
          expect(reachable).toBe(false);
          expect(compiled.lanes[detail.lane]!.road).toBe(compiled.lanes[previous]!.road);
        } else if (previous >= 0) {
          const movement = compiled.movements[-detail.lane - 1]!;
          expect(movement.fromLane).toBe(previous);
          if (reachable && !droveFallback) {
            expect(compiled.roads[compiled.lanes[movement.toLane]!.road]!.id).toBe(fallback!.id);
            expect(detail.routeReason).toBe('missed_turn');
            droveFallback = true;
          }
        } else {
          expect(detail.lane).toBe(compiled.movements[-previous - 1]!.toLane);
        }
        previous = detail.lane;
      }
      if (detail.state === 'completed' || detail.state === 'failed') break;
    }
    expect(droveFallback).toBe(reachable);
    expect(waited).toBe(!reachable);
    const final = engine.inspect(1)!;
    expect(final.state).toBe('completed');
    expect(final.failReason).toBe(null);
    expect(final.routeReason).toBe(reachable ? 'missed_turn' : 'initial');
  },
);
