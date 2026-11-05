import { expect, test } from 'vitest';
import { createEditor } from '../../src/editor';
import { buildCity } from '../../src/fixtures/build-city';
import { createEngine } from '../../src/sim/engine';
import { scenario, trips } from './fixtures';

test.each(['right', 'left'] as const)(
  'T07 ramp traffic enters the extra curb lane and changes before its drop (%s)',
  (side) => {
    const { city, node, road, place } = buildCity('Ramp taper traffic', 1);
    city.drivingSide = side;
    const approach = road(node(0, 0), node(400, 0));
    const mainline = road(node(0, 100), node(600, 100), { lanes: 2, roadClass: 'motorway' });
    place('Start', 'residential', { x: 0, y: 0 }, [{ road: approach, direction: 'out' }]);
    place('End', 'work', { x: 600, y: 100 }, [{ road: mainline, direction: 'in', positionM: 500 }]);
    const editor = createEditor(city);
    expect(
      editor.apply({
        kind: 'addRamp',
        from: { roadId: approach.id, atM: 100 },
        to: { roadId: mainline.id, atM: 200 },
      }).ok,
    ).toBe(true);
    const compiled = editor.compiled;
    const slip = compiled.roads.find((r) => r.roadClass === 'ramp')!;
    const entry = compiled.movements[compiled.lanes[slip.lanes[0]!]!.out[0]!]!;
    const taper = compiled.roads[compiled.lanes[entry.toLane]!.road]!;
    const curb = side === 'right' ? 2 : 0;
    expect(compiled.lanes[entry.toLane]!.lane).toBe(curb);
    const exitRoads = new Set(
      taper.lanes.flatMap((i) =>
        compiled.lanes[i]!.out.map((m) => compiled.lanes[compiled.movements[m]!.toLane]!.road),
      ),
    );
    const changed = new Set<number>();
    const engine = createEngine();
    engine.load({ compiled, scenario: scenario(), trips: trips(editor.city, 8, 3) });
    const entered = new Set<number>(),
      passed = new Set<number>();
    for (let step = 1; step <= 2000; step++) {
      engine.step();
      const snapshot = engine.snapshot();
      for (const [i, id] of snapshot.id.entries()) {
        const lane = snapshot.lane[i]!;
        if (lane === entry.toLane) entered.add(id);
        if (lane >= 0) {
          const current = compiled.lanes[lane]!;
          if (current.road === taper.idx && current.lane !== curb) changed.add(id);
          if (exitRoads.has(current.road)) {
            expect(changed.has(id), `vehicle ${id} must merge upstream`).toBe(true);
            passed.add(id);
          }
          continue;
        }
        const movement = compiled.movements[-lane - 1]!;
        if (compiled.lanes[movement.fromLane]!.road !== taper.idx) continue;
        expect(compiled.lanes[movement.fromLane]!.lane, `vehicle ${id}, step ${step}`).not.toBe(
          curb,
        );
        passed.add(id);
      }
    }
    expect(entered.size).toBe(8);
    expect(passed.size).toBe(8);
    expect(engine.metrics().trips.completed).toBe(8);
    expect(engine.metrics().trips.failed).toBe(0);
  },
);
