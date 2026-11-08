import { expect, test } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createExportRecorder, tripRecords } from '../../src/host/export-data';
import { createPlayLoop } from '../../src/host/loop';
import {
  exportRoadMetricsCsv,
  exportTrajectoriesCsv,
  exportTripsCsv,
} from '../../src/project/export-csv';
import { createEngine } from '../../src/sim/engine';
import { scenario, setup, trips } from '../sim/fixtures';

const provenance = { seed: 7, engineVersion: '0.1.0', schemaVersion: 1, dtS: 0.1 };

function run() {
  const city = grid5x5();
  const compiled = setup(city);
  const requests = trips(city, 12, 2);
  requests[0] = { ...requests[0]!, vehicleClass: 'truck', purpose: 'through' };
  requests[1] = { ...requests[1]!, vehicleClass: 'bus', purpose: 'service' };
  requests.push({ ...requests[0]!, id: 'unsupported', mode: 'walk' });
  requests.push({ ...requests[0]!, id: 'pending', departS: 8000 });
  const engine = createEngine();
  const input = { compiled, trips: requests, scenario: scenario(7) };
  function load() {
    engine.load(input);
    const recorder = createExportRecorder(engine, compiled);
    const loop = createPlayLoop(engine, {
      dtS: 0.1,
      endS: input.scenario.endS,
      now: () => 0,
      emit: () => {},
      afterStep: () => recorder.observe(),
    });
    return { recorder, loop };
  }
  return { city, compiled, requests, engine, load, ...load() };
}

function lines(csv: string) {
  const rows = csv.trimEnd().split('\r\n');
  expect(rows[0]).toBe(
    '# synthetic traffic, not observed traffic; seed=7; engine version=0.1.0; schema version=1; time step=0.1s',
  );
  return rows.slice(1);
}

test('trip export retains every loaded trip and engine outcomes, with nonnegative delays', () => {
  const { engine, requests, loop } = run();
  expect(tripRecords(engine, requests).every((r) => r.departure === null)).toBe(true);
  loop.step(6000);
  const records = tripRecords(engine, requests);
  expect(records).toHaveLength(requests.length);
  expect(records[0]).toMatchObject({ vehicleClass: 'truck', purpose: 'through' });
  expect(records[1]).toMatchObject({ vehicleClass: 'bus', purpose: 'service' });
  const completed = records.filter((record) => record.arrival !== null);
  expect(completed.length).toBeGreaterThan(0);
  for (const record of completed) {
    const detail = engine.inspect(requests.findIndex((trip) => trip.id === record.id) + 1)!;
    expect(record.departure).toBe(detail.departedS);
    expect(record.arrival).toBe(detail.arrivedS);
    expect(record.travelTime).toBe(record.arrival! - record.departure!);
    expect(record.delay).toBeGreaterThanOrEqual(0);
  }
  expect(records.find((r) => r.id === 'unsupported')).toMatchObject({
    departure: null,
    arrival: null,
    delay: null,
    failReason: 'unsupported_mode',
  });
  expect(records.find((r) => r.id === 'pending')).toMatchObject({
    departure: null,
    arrival: null,
    travelTime: null,
    delay: null,
    failReason: null,
  });
  const rows = lines(exportTripsCsv(records, provenance));
  expect(rows[0]).toBe(
    'id,person,origin,destination,class,purpose,departure,arrival,travel time,delay,fail reason,respawns',
  );
  expect(rows).toHaveLength(requests.length + 1);
  expect(rows[1]!.split(',').slice(4, 6)).toEqual(['truck', 'through']);
  expect(rows[2]!.split(',').slice(4, 6)).toEqual(['bus', 'service']);
});

test('road metrics record throughput and queue maxima and escape imported names', () => {
  const { city, compiled, recorder, loop } = run();
  loop.step(6000);
  const stats = recorder.roadStats();
  expect(stats.some((r) => r.vehiclesPassed > 0)).toBe(true);
  expect(stats.every((r) => r.meanSpeedRatio >= 0 && r.maxQueue >= 0)).toBe(true);
  const csv = exportRoadMetricsCsv(
    stats.map((stat, i) => ({
      ...stat,
      name: i === 0 ? 'Main, "East"' : city.roads[stat.id]!.name,
      roadClass: city.roads[stat.id]!.roadClass,
      length: compiled.roads[i]!.lengthM,
    })),
    provenance,
  );
  const rows = lines(csv);
  expect(rows[0]).toBe('id,name,class,length,mean speed ratio,vehicles passed,max queue');
  expect(rows).toHaveLength(compiled.roads.length + 1);
  expect(csv).toContain('"Main, ""East"""');
  expect(
    exportRoadMetricsCsv(
      [{ ...stats[0]!, name: '=1+1', roadClass: 'service', length: 10 }],
      provenance,
    ),
  ).toContain("'=1+1");
});

test('trajectory recording follows ten simulated seconds, off intervals, and load/restart reset', () => {
  const { recorder, loop, load } = run();
  loop.step(50);
  expect(recorder.trajectories()).toEqual([]);
  recorder.setTrajectories(true);
  loop.step(99);
  expect(recorder.trajectories()).toEqual([]);
  loop.step(201);
  const first = recorder.trajectories();
  expect([...new Set(first.map((r) => r.time))]).toEqual([115, 125, 135]);
  expect(first.every((r) => r.lane.includes('#') && Number.isFinite(r.x) && r.speed >= 0)).toBe(
    true,
  );
  recorder.setTrajectories(false);
  loop.step(200);
  expect(recorder.trajectories()).toEqual(first);
  recorder.setTrajectories(true);
  loop.step(100);
  expect(recorder.trajectories().length).toBeGreaterThan(first.length);
  expect([...new Set(recorder.trajectories().map((r) => r.time))]).toEqual([115, 125, 135, 165]);
  const rows = lines(exportTrajectoriesCsv(recorder.trajectories(), provenance));
  expect(rows[0]).toBe('vehicle id,time,x,y,lane,speed');
  expect(rows).toHaveLength(recorder.trajectories().length + 1);
  const reset = load();
  expect(reset.recorder.trajectoryStatus()).toEqual({ enabled: false, count: 0 });
  expect(reset.recorder.roadStats().every((r) => r.vehiclesPassed === 0 && r.maxQueue === 0)).toBe(
    true,
  );
  reset.loop.step(200);
  expect(reset.recorder.trajectories()).toEqual([]);
});
