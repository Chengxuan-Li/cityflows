import { expect, test } from 'vitest';
import { signalApproach } from '../../src/fixtures/signal-approach';
import { createEngine } from '../../src/sim/engine';
import { DEFAULT_SIM_PARAMS } from '../../src/sim/params';
import { scenario, setup, trips } from './fixtures';

test('T03 both approach lanes queue on red and drain safely on green', () => {
  const city = signalApproach();
  const compiled = setup(city);
  const engine = createEngine();
  engine.load({
    compiled,
    scenario: { ...scenario(), startS: 29 },
    trips: trips(city, 14, 0.5).map((trip) => ({ ...trip, departS: trip.departS - 71 })),
  });
  const approachLanes = compiled.places[0]!.connectorsOut.map(
    (index) => compiled.connectors[index]!.lane,
  );
  const redPeaks = [0, 0];
  for (let i = 0; i < 1500; i++) {
    const time = engine.timeS;
    engine.step();
    const view = engine.snapshot();
    const positions = compiled.lanes.map((): number[] => []);
    const queued = [0, 0];
    for (const [index, id] of view.id.entries()) {
      const lane = view.lane[index]!;
      if (lane < 0) {
        const movement = compiled.movements[-lane - 1]!;
        expect(movement.neverGreen).toBe(false);
        expect(time).toBeGreaterThanOrEqual(116);
        continue;
      }
      const detail = engine.inspect(id)!;
      positions[lane]!.push(detail.positionM);
      const approach = approachLanes.indexOf(lane);
      if (approach !== -1 && detail.speedMps < 0.15) queued[approach]!++;
    }
    for (const lane of positions) {
      lane.sort((a, b) => b - a);
      for (let j = 1; j < lane.length; j++) {
        expect(lane[j - 1]! - lane[j]!).toBeGreaterThanOrEqual(
          DEFAULT_SIM_PARAMS.vehicleLengthM + DEFAULT_SIM_PARAMS.idm.minGapM - 1e-8,
        );
      }
    }
    if (time < 116) {
      for (let j = 0; j < queued.length; j++) redPeaks[j] = Math.max(redPeaks[j]!, queued[j]!);
    }
    if (time >= 145) expect(queued).toEqual([0, 0]);
  }
  for (const peak of redPeaks) expect(peak).toBeGreaterThan(1);
  expect(engine.metrics().trips.completed).toBe(14);
});
