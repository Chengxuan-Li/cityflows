import type { GroundVehiclePose } from '../sim/ground-vehicles';
import type { AircraftPose } from './types';

// TASK-316: ground vehicles between snapshots for both views, one snapshot behind during
// playback like the aircraft (`aircraft-pose.ts`), carts included. A tug coupled to an aircraft
// ready for pushback or pushing is drawn by the aircraft layers (TASK-314's tug at the nose) and
// hidden here; one towing is drawn
// here from its snapshot pose.

const lerpAngle = (a: number, b: number, t: number) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

interface Track {
  previous: GroundVehiclePose;
  current: GroundVehiclePose;
  pose: GroundVehiclePose;
}

export class GroundVehicleTracks {
  private tracks = new Map<number, Track>();
  private spanS = 0;
  private timeS = 0;
  private fraction = 1;
  /** Poses as drawn now. */
  poses: GroundVehiclePose[] = [];

  update(snapshot: readonly GroundVehiclePose[], timeS: number, playbackSpeed: number) {
    const spanS = timeS - this.timeS;
    this.spanS = spanS > 0 && spanS <= playbackSpeed * 0.25 ? spanS : 0;
    this.timeS = timeS;
    const next = new Map<number, Track>();
    for (const pose of snapshot) {
      const old = this.tracks.get(pose.id);
      const previous =
        old && this.spanS && old.current.carts.length === pose.carts.length ? old.current : pose;
      next.set(pose.id, { previous, current: pose, pose: structuredClone(pose) });
    }
    this.tracks = next;
    this.place(this.spanS ? 0 : 1);
  }

  /** Moves the poses to `ageS` after the newest snapshot; whether anything moved. */
  sample(ageS: number, playing: boolean) {
    const t = playing && this.spanS > 0 ? Math.min(1, ageS / this.spanS) : 1;
    if (t === this.fraction) return false;
    this.place(t);
    return this.tracks.size > 0;
  }

  private place(t: number) {
    this.fraction = t;
    this.poses = [];
    for (const { previous: a, current: b, pose } of this.tracks.values()) {
      pose.x = a.x + (b.x - a.x) * t;
      pose.y = a.y + (b.y - a.y) * t;
      pose.heading = lerpAngle(a.heading, b.heading, t);
      pose.carts.forEach((cart, i) => {
        const from = a.carts[i]!,
          to = b.carts[i]!;
        cart.x = from.x + (to.x - from.x) * t;
        cart.y = from.y + (to.y - from.y) * t;
        cart.heading = lerpAngle(from.heading, to.heading, t);
      });
      this.poses.push(pose);
    }
  }
}

/** Whether a vehicle is drawn by this layer: not a tug the aircraft layers draw pushing. */
export function shownVehicle(pose: GroundVehiclePose, aircraft: ReadonlyMap<number, AircraftPose>) {
  const state = aircraft.get(pose.attachedTo)?.state;
  return pose.attachedTo < 0 || (state !== 'pushback' && state !== 'ready-for-pushback');
}
