import { expect, test } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

test.each([true, false])(
  'a missed turn traverses a legal fallback before rerouting (reachable: %s)',
  (reachable) => {
    const { city, node, road, place } = buildCity('Missed left turn', 1);
    const center = node(0, 0);
    const north = node(0, -100);
    const east = node(100, 0);
    const approach = road(node(-100, 0), center, { lanes: 2 });
    const left = road(center, north);
    const fallback = road(center, east, { lanes: 2 });
    const destination = road(north, node(0, -200));
    if (reachable) {
      const corner = node(100, -100);
      road(east, corner);
      road(corner, north);
    }
    place('Homes', 'residential', { x: -80, y: 10 }, [
      { road: approach, lane: 1, direction: 'out' },
    ]);
    place('Office', 'work', { x: 10, y: -170 }, [
      { road: destination, direction: 'in', positionM: 65 },
    ]);
    const compiled = setup(city);
    const engine = createEngine();
    engine.load({ compiled, scenario: scenario(), trips: trips(city, 1) });
    engine.step();
    const initial = engine.inspect(1)!;
    const firstTurn = compiled.movements[initial.route!.movements[0]!]!;
    expect(compiled.roads[compiled.lanes[firstTurn.toLane]!.road]!.id).toBe(left.id);
    expect(firstTurn.fromLane).not.toBe(initial.lane);
    let previous = initial.lane;
    let droveFallback = false;
    for (let i = 0; i < 2000; i++) {
      engine.step();
      const detail = engine.inspect(1)!;
      if (detail.lane !== previous) {
        if (previous >= 0) {
          expect(detail.lane).toBeLessThan(0);
          const movement = compiled.movements[-detail.lane - 1]!;
          expect(movement.fromLane).toBe(previous);
          if (!droveFallback) {
            expect(compiled.roads[compiled.lanes[movement.toLane]!.road]!.id).toBe(fallback.id);
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
    expect(droveFallback).toBe(true);
    const final = engine.inspect(1)!;
    expect(final.state).toBe(reachable ? 'completed' : 'failed');
    expect(final.failReason).toBe(reachable ? null : 'stranded');
    expect(final.routeReason).toBe('missed_turn');
  },
);
