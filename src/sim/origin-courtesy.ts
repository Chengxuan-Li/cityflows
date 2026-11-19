import { headingAtDistance, pointAtDistance } from '../geo/polyline';
import type { CConnector, CompiledCity } from '../network';
import type { SimParams } from '../schema';
import { idmAcceleration } from './idm';
import { manoeuvreLaneBounds, manoeuvrePath, parkedPose } from './manoeuvre';
import type { createParking } from './parking';
import { createVehicleProfiles, DRIVING, QUEUED_ORIGIN, type Vehicles } from './vehicle';

type Hold = {
  owner: number;
  follower: number;
  leader: number;
  lane: number;
  frontM: number;
  startedS: number;
};

/** One short request to create a real departure gap; ordinary admission still owns the release. */
export function createOriginCourtesy(
  compiled: CompiledCity,
  vehicles: Vehicles,
  params: SimParams,
  parking: Pick<ReturnType<typeof createParking>, 'location' | 'motion' | 'leavingSpace'>,
  committed: (id: number) => boolean,
) {
  const profiles = createVehicleProfiles(params);
  const profile = (id: number) => profiles[vehicles.vclass[id]!]!;
  const since = new Float64Array(vehicles.count).fill(NaN);
  const seen = new Float64Array(vehicles.count).fill(-Infinity);
  const lastLeader = new Int32Array(vehicles.count).fill(-1);
  const followerLane = new Int32Array(vehicles.count).fill(-1);
  const eligible = new Set<number>();
  const holds = new Map<number, Hold>();
  // TASK-230: each (space, vehicle class)'s manoeuvre envelope on the lane, [low, high] at 2 * key
  // (NaN until found). Blocked departures ask every step; a dense array spares the map lookup.
  let envelopes = new Float64Array(
    2 * (compiled.parkingSpaces?.length ?? 0) * profiles.length,
  ).fill(NaN);
  const stats = { started: 0, succeeded: 0, aborted: 0 };

  function finish(hold: Hold, success: boolean) {
    holds.delete(hold.lane);
    followerLane[hold.follower] = -1;
    if (success) stats.succeeded++;
    else stats.aborted++;
  }
  function valid(hold: Hold) {
    const id = hold.follower;
    return (
      vehicles.state[id] === DRIVING &&
      vehicles.lane[id] === hold.lane &&
      !committed(id) &&
      !parking.motion(id) &&
      vehicles.position[id]! >= profile(id).lengthM &&
      vehicles.position[id]! <= hold.frontM + 1e-8
    );
  }

  return {
    stats,
    consider(id: number, connector: CConnector, gap: boolean, timeS: number) {
      if (!parking.leavingSpace(id)) return;
      const slot = compiled.parkingSpaces?.[parking.location(id, true).space];
      if (!slot?.manoeuvre || compiled.parking[slot.parking]!.kind !== 'roadside') return;
      if (timeS - seen[id]! > params.dtS + 1e-8) since[id] = timeS;
      seen[id] = timeS;
      eligible.add(id);
      if (gap || timeS - since[id]! < params.gridlock.respawnS || holds.has(connector.lane)) return;
      const lane = compiled.lanes[connector.lane]!;
      if (compiled.roads[lane.road]!.group !== undefined) return;
      const key = 2 * (slot.idx * profiles.length + vehicles.vclass[id]!);
      if (Number.isNaN(envelopes[key])) {
        const to = {
          ...pointAtDistance(lane.polyline, lane.cumulative, connector.positionM),
          heading: headingAtDistance(lane.polyline, lane.cumulative, connector.positionM),
        };
        const path = manoeuvrePath(
          parkedPose(slot, profile(id).lengthM),
          to,
          slot.layout === 'parallel',
          true,
        );
        const bounds = manoeuvreLaneBounds(path, lane, profile(id).lengthM, profile(id).widthM);
        if (!bounds) return;
        envelopes[key] = bounds.low;
        envelopes[key + 1] = bounds.high;
      }
      const spawnGap = Math.max(params.spawnMinGapM, params.idm.minGapM);
      const frontM = Math.min(
        envelopes[key]! - params.idm.minGapM,
        connector.positionM - profile(id).lengthM - spawnGap,
      );
      const clearRearM = Math.max(
        envelopes[key + 1]! + params.idm.minGapM,
        connector.positionM + spawnGap,
      );
      let follower = -1;
      for (
        let car = vehicles.last(lane.idx);
        car !== -1 && vehicles.position[car]! <= frontM;
        car = vehicles.previous[car]!
      )
        follower = car;
      if (
        follower === -1 ||
        vehicles.state[follower] !== DRIVING ||
        committed(follower) ||
        parking.motion(follower) ||
        vehicles.position[follower]! < profile(follower).lengthM
      )
        return;
      const leader = vehicles.previous[follower]!;
      if (
        leader === -1 ||
        leader === lastLeader[id] ||
        vehicles.speed[leader]! <= 0.1 ||
        parking.motion(leader)
      )
        return;
      const clearS =
        Math.max(0, clearRearM - vehicles.position[leader]! + profile(leader).lengthM) /
        vehicles.speed[leader]!;
      if (clearS > params.intersection.boxWaitS) return;
      const speed = vehicles.speed[follower]!,
        p = profile(follower);
      const remaining = frontM - vehicles.position[follower]! - speed * params.dtS;
      if (
        (speed > 0 &&
          (remaining <= 0 || speed * speed > 2 * params.mobil.safeDecelMps2 * remaining)) ||
        idmAcceleration(
          p.idm,
          speed,
          Math.min(lane.speedLimitMps * vehicles.speedFactor[follower]!, p.maxSpeedMps),
          0,
          remaining + params.idm.minGapM,
        ) < -params.mobil.safeDecelMps2
      )
        return;
      const hold = { owner: id, follower, leader, lane: lane.idx, frontM, startedS: timeS };
      holds.set(lane.idx, hold);
      followerLane[follower] = lane.idx;
      lastLeader[id] = leader;
      stats.started++;
    },
    refresh(timeS: number) {
      for (const hold of holds.values()) {
        if (vehicles.state[hold.owner] !== QUEUED_ORIGIN) {
          finish(hold, parking.motion(hold.owner)?.phase === 'leave');
        } else if (
          seen[hold.owner] !== timeS ||
          timeS - hold.startedS + 1e-9 >= params.intersection.boxWaitS ||
          !valid(hold)
        )
          finish(hold, false);
      }
      for (const id of eligible)
        if (seen[id] !== timeS) {
          eligible.delete(id);
          since[id] = NaN;
        }
    },
    hold(id: number) {
      if (followerLane[id] === -1) return null;
      const held = holds.get(followerLane[id]!);
      if (!held) return null;
      if (!valid(held)) {
        finish(held, false);
        return null;
      }
      return held;
    },
    patch(next: CompiledCity) {
      for (const hold of holds.values()) finish(hold, false);
      compiled = next;
      eligible.clear();
      envelopes = new Float64Array(2 * (next.parkingSpaces?.length ?? 0) * profiles.length).fill(
        NaN,
      );
      since.fill(NaN);
      seen.fill(-Infinity);
      lastLeader.fill(-1);
    },
  };
}
