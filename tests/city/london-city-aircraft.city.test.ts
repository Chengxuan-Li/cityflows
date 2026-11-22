import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { createEngine } from '../../src/sim/engine';
import { overlaps, onRunway } from '../sim/aircraft-checks';
import { limit } from '../timeouts';

// TASK-298: London City's scripted hour (the rotation that drives the airside until TASK-299):
// a dozen arrivals and departures on 27 with no overlap, no runway conflict and no stuck aircraft.

test(
  'London City: an hour of the scripted rotation completes without conflict',
  async () => {
    const project = await openBundled('london-city-airport');
    const result = compile(project.city);
    if (!result.ok) throw new Error('London City must compile');
    const scenario = project.scenarios[0]!;
    const engine = createEngine();
    engine.load({
      compiled: result.compiled,
      trips: [],
      scenario: { ...scenario, endS: scenario.startS + 4200 },
    });
    let conflicts = 0;
    const touched = new Set<string>();
    const appeared = new Map<number, number>();
    for (let step = 0; step < 36_000; step++) {
      engine.step();
      if (step % 10) continue;
      const aircraft = engine.snapshot().aircraft!;
      expect(overlaps(aircraft), `bodies at ${engine.timeS} s`).toEqual([]);
      if (onRunway(aircraft).length > 1) conflicts++;
      for (const a of aircraft) {
        touched.add(`${a.state}:${a.runwayEnd}`);
        if (a.state === 'approach' && !appeared.has(a.id)) appeared.set(a.id, a.heightM);
      }
    }
    const metrics = engine.metrics().aircraft!;
    expect(conflicts).toBe(0);
    expect(metrics.stuck).toBe(0);
    expect(metrics.landed + metrics.departed).toBeGreaterThanOrEqual(10);
    // The prevailing wind puts both flows on 27, approached at London City's 5.5 degrees.
    expect(
      [...touched].filter((s) => s.startsWith('approach')).every((s) => s.endsWith(':27')),
    ).toBe(true);
    // Each appears about 10 km out on a 5.5-degree path (3 degrees would be 524 m high).
    expect(appeared.size).toBeGreaterThanOrEqual(5);
    for (const heightM of appeared.values()) expect(heightM / 10_000).toBeCloseTo(0.098, 2);
  },
  limit(60_000),
);
