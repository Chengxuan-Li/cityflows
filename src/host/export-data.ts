import type { CompiledCity } from '../network';
import type { RoadStats, TrajectoryRecord, TripRecord } from '../project/export-csv';
import type { TripRequest } from '../schema';
import type { TrafficEngine } from '../sim/types';

export function tripRecords(engine: TrafficEngine, trips: readonly TripRequest[]): TripRecord[] {
  const outcomes = engine.metrics().tripOutcomes;
  if (!outcomes) throw new Error('Engine does not expose per-trip accounting');
  return trips.map((trip, index) => {
    const outcome = outcomes[index]!;
    const travelTime =
      outcome.arrivedS === null || outcome.departedS === null
        ? null
        : outcome.arrivedS - outcome.departedS;
    return {
      id: trip.id,
      person: trip.personId,
      origin: trip.originPlaceId,
      destination: trip.destinationPlaceId,
      departure: outcome.departedS,
      arrival: outcome.arrivedS,
      travelTime,
      delay: travelTime === null ? null : Math.max(0, travelTime - outcome.freeFlowS!),
      failReason: outcome.failReason,
    };
  });
}

/** Worker-owned observations at every fixed step, independent of rendering/pull frequency. */
export function createExportRecorder(engine: TrafficEngine, compiled: CompiledCity) {
  const stats: RoadStats[] = compiled.roads.map(({ id }) => ({
    id,
    meanSpeedRatio: 1,
    vehiclesPassed: 0,
    maxQueue: 0,
  }));
  const speedSum = new Float64Array(stats.length);
  const observations = new Float64Array(stats.length);
  let previousRoads = new Map<number, number>();
  const samples: TrajectoryRecord[] = [];
  let enabled = false;
  let nextSampleS = Infinity;

  return {
    observe() {
      const snapshot = engine.snapshot();
      const roads = new Map<number, number>();
      const queues = new Uint32Array(stats.length);
      const record = enabled && engine.timeS + 1e-8 >= nextSampleS;
      for (let i = 0; i < snapshot.count; i++) {
        const id = snapshot.id[i]!;
        const field = snapshot.lane[i]!;
        const lane = compiled.lanes[field];
        const road = lane?.road ?? -1;
        roads.set(id, road);
        if (lane) {
          speedSum[road] = speedSum[road]! + snapshot.speed[i]! / lane.speedLimitMps;
          observations[road] = observations[road]! + 1;
          if (snapshot.speed[i]! < 0.5 && lane.lengthM - engine.inspect(id)!.positionM <= 50) {
            queues[road] = queues[road]! + 1;
          }
        }
        if (record)
          samples.push({
            vehicleId: id,
            time: snapshot.timeS,
            x: snapshot.x[i]!,
            y: snapshot.y[i]!,
            lane: lane?.id ?? compiled.movements[-field - 1]!.id,
            speed: snapshot.speed[i]!,
          });
      }
      for (const [id, road] of previousRoads) {
        if (road < 0 || roads.get(id) === road) continue;
        // A lane change within a road is not a pass; failed vehicles are not throughput.
        if (roads.has(id) || engine.inspect(id)?.state === 'completed')
          stats[road]!.vehiclesPassed++;
      }
      for (const [index, stat] of stats.entries()) {
        stat.maxQueue = Math.max(stat.maxQueue, queues[index]!);
        if (observations[index]) stat.meanSpeedRatio = speedSum[index]! / observations[index]!;
      }
      previousRoads = roads;
      if (record) {
        do {
          nextSampleS += 10;
        } while (nextSampleS <= engine.timeS + 1e-8);
      }
    },
    roadStats: () => stats.map((stat) => ({ ...stat })),
    trajectories: () => samples.slice(),
    trajectoryStatus: () => ({ enabled, count: samples.length }),
    setTrajectories(value: boolean) {
      if (value && !enabled) nextSampleS = engine.timeS + 10;
      enabled = value;
      return this.trajectoryStatus();
    },
  };
}
