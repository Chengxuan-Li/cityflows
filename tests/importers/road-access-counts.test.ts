import { expect, test } from 'vitest';
import { vehicleClasses } from '../../src/schema';
import { tierCities } from '../tier';
import { throughputFixture } from '../routing/throughput-fixtures';

const expected = {
  Munich: {
    car: { yes: 511, no: 2, destination: 0, delivery: 2, private: 44 },
    // TASK-100 merge: van follows car except where maxheight < 3 m closes it (Munich 4).
    van: { yes: 507, no: 6, destination: 0, delivery: 2, private: 44 },
    truck: { yes: 461, no: 6, destination: 0, delivery: 48, private: 44 },
    bus: { yes: 509, no: 4, destination: 0, delivery: 2, private: 44 },
  },
  Sindelfingen: {
    car: { yes: 144, no: 6, destination: 0, delivery: 0, private: 417 },
    van: { yes: 144, no: 6, destination: 0, delivery: 0, private: 417 },
    truck: { yes: 142, no: 8, destination: 0, delivery: 0, private: 417 },
    bus: { yes: 205, no: 6, destination: 0, delivery: 0, private: 356 },
  },
};

test.each(tierCities(['Munich', 'Sindelfingen'] as const))(
  'T47 %s access counts within ten percent, with curb-side bus lanes',
  (name) => {
    const { city } = throughputFixture(name);
    for (const kind of vehicleClasses) {
      const counts = { yes: 0, no: 0, destination: 0, delivery: 0, private: 0 };
      for (const road of Object.values(city.roads))
        counts[road.access?.[kind] ?? road.access?.all ?? 'yes']++;
      console.info(name, kind, counts);
      for (const rule of Object.keys(counts) as (keyof typeof counts)[]) {
        const baseline = expected[name][kind][rule];
        expect(Math.abs(counts[rule] - baseline)).toBeLessThanOrEqual(baseline * 0.1);
      }
    }
    let reserved = 0;
    for (const road of Object.values(city.roads))
      road.lanes.forEach((lane, index) => {
        if (lane.allowed.length !== 1 || lane.allowed[0] !== 'bus') return;
        reserved++;
        expect(index).toBe(road.lanes.length - 1);
      });
    expect(reserved).toBe(name === 'Munich' ? 4 : 0);
  },
);
