import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { nearestOnPolyline } from '../../src/geo/polyline';
import { compile } from '../../src/network';
import { createAircraftFleet } from '../../src/sim/aircraft';
import { createFlightOperations } from '../../src/sim/flight-operations';
import { overlaps } from '../sim/aircraft-checks';
import { limit } from '../timeouts';

// TASK-302: Zurich's flight day on its airside, sampled every simulated second. Two aircraft on
// one runway, or on the two crossing runways 10/28 and 16/34, at once are a runway conflict
// (TASK-298's interlock: one aircraft holds a runway and every runway sharing its nodes).

test(
  'Zurich operates its flight day through its concepts with crossing runways interlocked',
  { timeout: limit(900_000) },
  async () => {
    const project = await openBundled('zurich-airport');
    const result = compile(project.city);
    if (!result.ok || !result.compiled.airside) throw new Error('Zurich must compile');
    const graph = result.compiled.airside;
    const fleet = createAircraftFleet(graph, 1);
    const operations = createFlightOperations(fleet, 1, 0);
    const interlocked = graph.runways.map((a) =>
      graph.runways.map((b) => a.idx === b.idx || a.nodes.some((n) => b.nodes.includes(n))),
    );
    const under = (x: number, y: number) =>
      graph.runways.flatMap((r) => {
        const near = nearestOnPolyline(r.line, { x, y });
        return near.away <= r.widthM / 2 + 5 && near.along > 0 && near.along < r.lengthM
          ? [r.idx]
          : [];
      });
    let overlapCount = 0;
    let runwayConflicts = 0;
    let crossingUse = 0;
    let peakStuck = 0;
    const helicopters = new Set<string>();
    for (let step = 0; step < 864_000; step++) {
      operations.step(step / 10);
      fleet.step(step / 10);
      if (step % 10 !== 0) continue;
      const aircraft = fleet.snapshot();
      overlapCount += overlaps(aircraft).length;
      const on = aircraft.filter((a) => a.onRunway).map((a) => under(a.x, a.y));
      for (let i = 0; i < on.length; i++)
        for (let j = i + 1; j < on.length; j++)
          if (on[i]!.some((p) => on[j]!.some((q) => interlocked[p]![q]))) runwayConflicts++;
      crossingUse += on.filter((r) => r.length > 1).length;
      for (const a of aircraft)
        if (a.typeId === 'EC45' || a.typeId === 'A139') helicopters.add(a.registration);
      peakStuck = Math.max(peakStuck, fleet.metrics().stuck);
    }
    operations.step(86_400);
    const metrics = operations.metrics();
    const transitions = fleet.runwayTransitions();
    console.info({ metrics, aircraft: fleet.metrics(), transitions, crossingUse });
    expect(metrics.completed / metrics.scheduled).toBeGreaterThanOrEqual(0.98);
    expect(overlapCount).toBe(0);
    expect(runwayConflicts).toBe(0);
    expect(peakStuck).toBe(0);
    // The crossing is used (an aircraft on both runways at the intersection) and helicopters fly.
    expect(crossingUse).toBeGreaterThan(0);
    expect(helicopters.size).toBeGreaterThan(0);
    // The concepts in their order: south at 06:00, north at 07:00, east at 21:00, closed at 23:30.
    expect(transitions.map(({ toId }) => toId)).toEqual(['south', 'north', 'east', null]);
    for (const { startS, openS } of transitions) expect(openS).toBeGreaterThanOrEqual(startS);
  },
);
