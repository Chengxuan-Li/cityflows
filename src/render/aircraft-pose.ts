import { fixedWingGearStations, type AircraftVisualPose } from '../sim/aircraft-motion';
import type { AircraftPose } from './types';

/** The towbar reaches from the nose axle to the tractor just beyond the fuselage. */
export function pushbackDrawbarM(lengthM: number) {
  return lengthM / 2 - fixedWingGearStations(lengthM).noseX + 0.85;
}

function visualOf(pose: AircraftPose): AircraftVisualPose {
  return (
    pose.visual ?? {
      x: pose.x,
      y: pose.y,
      heightM: pose.heightM,
      heading: pose.heading,
      pitch: 0,
      roll: 0,
      steering: 0,
      gear: Number(pose.gearDown),
    }
  );
}

/** A one-snapshot delay during playback keeps the aircraft on its path through turns.
 * Pausing or jumping the simulation displays the newest pose immediately. */
export class AircraftPoseTrack {
  readonly pose: AircraftPose & { visual: AircraftVisualPose };
  private previous: AircraftVisualPose;
  private current: AircraftVisualPose;
  private spanS = 0;
  private fraction = 1;
  private headingDelta = 0;

  constructor(
    snapshot: AircraftPose,
    private timeS: number,
  ) {
    this.previous = this.current = visualOf(snapshot);
    this.pose = { ...snapshot, visual: { ...this.current } };
    this.place(1);
  }

  update(snapshot: AircraftPose, timeS: number, playbackSpeed: number) {
    const spanS = timeS - this.timeS;
    const current = visualOf(snapshot);
    const before = this.current;
    // The worker ticks every 100 ms. Allow jitter, and skip interpolation after a long gap
    // or a paused step, when a straight blend could cross a whole turn.
    const moved =
      before.x !== current.x ||
      before.y !== current.y ||
      before.heading !== current.heading ||
      before.pitch !== current.pitch ||
      before.roll !== current.roll ||
      before.steering !== current.steering ||
      before.gear !== current.gear ||
      before.heightM !== current.heightM;
    this.spanS = moved && spanS > 0 && spanS <= playbackSpeed * 0.25 ? spanS : 0;
    this.previous = this.spanS ? before : current;
    this.current = current;
    this.timeS = timeS;
    const delta = current.heading - this.previous.heading;
    this.headingDelta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const visual = this.pose.visual;
    Object.assign(this.pose, snapshot, { visual });
    this.place(this.spanS ? 0 : 1);
  }

  sample(ageS: number, playing: boolean) {
    const t = playing && this.spanS > 0 ? Math.min(1, ageS / this.spanS) : 1;
    if (t === this.fraction) return false;
    this.place(t);
    return true;
  }

  private place(t: number) {
    this.fraction = t;
    const { previous: a, current: b, pose } = this;
    const visual = pose.visual;
    const lerp = (from: number, to: number) => from + (to - from) * t;
    pose.x = visual.x = lerp(a.x, b.x);
    pose.y = visual.y = lerp(a.y, b.y);
    pose.heading = visual.heading = a.heading + this.headingDelta * t;
    pose.heightM = visual.heightM = lerp(a.heightM, b.heightM);
    visual.pitch = lerp(a.pitch, b.pitch);
    visual.roll = lerp(a.roll, b.roll);
    visual.steering = lerp(a.steering, b.steering);
    visual.gear = lerp(a.gear, b.gear);
  }
}
