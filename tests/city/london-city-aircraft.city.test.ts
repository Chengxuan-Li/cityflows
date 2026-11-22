import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { aircraftTypes } from '../../src/schema/aircraft';
import { createEngine } from '../../src/sim/engine';
import { overlaps, onRunway } from '../sim/aircraft-checks';
import { limit } from '../timeouts';

// Exercise the default airport driver through engine.load, including carry-in parked aircraft.
// The complete schedule and its completion floor run in the full traffic tier.

test(
  'London City: the default flight schedule runs through the engine without conflict',
  async () => {
    const project = await openBundled('london-city-airport');
    const result = compile(project.city);
    if (!result.ok) throw new Error('London City must compile');
    const { airside } = result.compiled;
    if (!airside) throw new Error('Expected London City airside');
    const scenario = project.scenarios[0]!;
    const engine = createEngine();
    engine.load({
      compiled: result.compiled,
      trips: [],
      scenario: { ...scenario, endS: scenario.startS + 4200 },
    });
    const initial = engine.flightBoard()!;
    expect(initial.arrivals).toHaveLength(75);
    expect(initial.departures).toHaveLength(75);
    expect(initial.stands.some(({ occupiedBy }) => occupiedBy)).toBe(true);
    let conflicts = 0;
    const touched = new Set<string>();
    const appeared = new Map<number, number>();
    const parked = new Set<number>();
    for (let step = 0; step < 36_000; step++) {
      engine.step();
      if (step % 10) continue;
      const aircraft = engine.snapshot().aircraft!;
      expect(overlaps(aircraft), `bodies at ${engine.timeS} s`).toEqual([]);
      if (onRunway(aircraft).length > 1) conflicts++;
      for (const a of aircraft) {
        touched.add(`${a.state}:${a.runwayEnd}`);
        if (a.state === 'approach' && !appeared.has(a.id)) appeared.set(a.id, a.heightM);
        if (a.state === 'parked' && a.stand && !parked.has(a.id)) {
          parked.add(a.id);
          const stand = airside.stands[airside.index.stand.get(a.stand)!]!;
          const type = aircraftTypes.find(({ id }) => id === a.typeId)!;
          const pose = a.visual!;
          expect(Math.cos(pose.heading)).toBeCloseTo(Math.cos(stand.heading), 8);
          expect(Math.sin(pose.heading)).toBeCloseTo(Math.sin(stand.heading), 8);
          expect(pose.x + (type.lengthM / 2) * Math.cos(pose.heading)).toBeCloseTo(stand.pos.x, 5);
          expect(pose.y + (type.lengthM / 2) * Math.sin(pose.heading)).toBeCloseTo(stand.pos.y, 5);
        }
      }
    }
    const metrics = engine.metrics().aircraft!;
    expect(conflicts).toBe(0);
    expect(metrics.stuck).toBe(0);
    expect(metrics.landed).toBeGreaterThan(0);
    expect(metrics.departed).toBeGreaterThan(0);
    expect(engine.metrics().flights!.completed).toBe(metrics.landed + metrics.departed);
    // The prevailing wind puts both flows on 27, approached at London City's 5.5 degrees.
    expect(
      [...touched].filter((s) => s.startsWith('approach')).every((s) => s.endsWith(':27')),
    ).toBe(true);
    // Each appears about 10 km out on a 5.5-degree path (3 degrees would be 524 m high).
    expect(appeared.size).toBeGreaterThan(0);
    for (const heightM of appeared.values()) expect(heightM / 10_000).toBeCloseTo(0.098, 2);
  },
  limit(60_000),
);
