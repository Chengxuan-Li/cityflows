import { expect, test } from 'vitest';
import { ramp } from '../../src/fixtures/ramp';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from './fixtures';

test.each(['on-ramp', 'mainline'])(
  'T07 %s traffic follows the compiled merge and exit lanes',
  (origin) => {
    const city = ramp();
    const [from, to] = Object.values(city.places);
    from!.connectors = [from!.connectors[origin === 'on-ramp' ? 0 : 1]!];
    to!.connectors = [to!.connectors[0]!];
    const compiled = setup(city);
    const engine = createEngine();
    engine.load({ compiled, scenario: scenario(), trips: trips(city, 8, 2) });
    const exit = compiled.movements.find(
      (movement) =>
        movement.turn === 'diverge' &&
        compiled.roads[compiled.lanes[movement.toLane]!.road]!.roadClass === 'ramp',
    )!;
    const merge = compiled.movements.find(
      (movement) =>
        movement.turn === 'merge' &&
        compiled.roads[compiled.lanes[movement.fromLane]!.road]!.roadClass === 'ramp',
    )!;
    const merged = new Set<number>();
    const exited = new Set<number>();
    let previous = new Int32Array(9).fill(-100);

    for (let i = 0; i < 900; i++) {
      engine.step();
      const snapshot = engine.snapshot();
      const lanes = new Int32Array(9).fill(-100);
      for (const [index, id] of snapshot.id.entries()) {
        const lane = snapshot.lane[index]!;
        lanes[id] = lane;
        if (lane === -merge.idx - 1 && !merged.has(id)) {
          expect(previous[id]).toBe(merge.fromLane);
          merged.add(id);
        }
        if (lane === -exit.idx - 1 && !exited.has(id)) {
          expect(previous[id]).toBe(exit.fromLane);
          exited.add(id);
        }
        if (
          origin === 'on-ramp' &&
          lane >= 0 &&
          compiled.roads[compiled.lanes[lane]!.road]!.roadClass === 'motorway'
        ) {
          expect(merged.has(id)).toBe(true);
        }
      }
      previous = lanes;
    }
    expect(merged.size).toBe(origin === 'on-ramp' ? 8 : 0);
    expect(exited.size).toBe(8);
    expect(engine.metrics().trips.completed).toBe(8);
  },
);
