import { headingAtDistance, pointAtDistance } from '../geo/polyline';
import type { CLane, CMovement, CompiledCity } from '../network';
import type { VehicleSnapshot } from './types';

export type Segment = CLane | CMovement;

export function distanceAlong(segment: Segment, x: number, y: number): number {
  let nearest = Infinity;
  let distance = 0;
  for (let i = 1; i < segment.polyline.length; i++) {
    const a = segment.polyline[i - 1]!;
    const b = segment.polyline[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const squared = dx * dx + dy * dy;
    if (!squared) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / squared));
    const error = (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2;
    if (error < nearest) {
      nearest = error;
      distance = segment.cumulative[i - 1]! + t * Math.sqrt(squared);
    }
  }
  return distance;
}

export function advanceAlong(segment: Segment, distance: number, speed: number, elapsedS: number) {
  const position = Math.min(segment.lengthM, distance + speed * elapsedS);
  return {
    ...pointAtDistance(segment.polyline, segment.cumulative, position),
    heading: headingAtDistance(segment.polyline, segment.cumulative, position),
  };
}

export function laneChangePose(
  lateralM: number,
  widthM: number,
  durationS: number,
  elapsedS: number,
) {
  if (lateralM === 0 || durationS === 0) return { lateral: 0, yaw: 0 };
  const progress = Math.min(1, Math.max(0, 1 - Math.abs(lateralM) / widthM + elapsedS / durationS));
  const smooth = progress * progress * (3 - 2 * progress);
  return {
    lateral: Math.sign(lateralM) * widthM * (1 - smooth),
    yaw: -Math.sign(lateralM) * 0.12 * 4 * progress * (1 - progress),
  };
}

export type PresentationSnapshot = VehicleSnapshot & {
  vehicleHues?: Uint32Array;
  motionLane?: Int32Array;
};

/** Shared motion cache: geometry belongs to the loaded run, even after a live edit. */
export class VehiclePoses {
  snapshot: PresentationSnapshot | null = null;
  private segments: Segment[] = [];
  private distances = new Float64Array(0);
  private widths = new Float32Array(0);
  private durationS = 0;
  private city: CompiledCity | undefined;

  setGeometry(city: CompiledCity, durationS = this.durationS) {
    this.city = city;
    this.durationS = durationS;
  }

  update(snapshot: PresentationSnapshot) {
    this.snapshot = snapshot;
    if (this.distances.length < snapshot.count) {
      this.distances = new Float64Array(snapshot.count);
      this.widths = new Float32Array(snapshot.count);
    }
    for (let i = 0; i < snapshot.count; i++) {
      if ((snapshot.poseLane?.[i] ?? -1) >= 0) {
        this.widths[i] = 0;
        continue;
      }
      const lane = snapshot.motionLane?.[i] ?? snapshot.lane[i]!;
      const segment = lane >= 0 ? this.city!.lanes[lane]! : this.city!.movements[-lane - 1]!;
      this.segments[i] = segment;
      this.distances[i] = distanceAlong(segment, snapshot.x[i]!, snapshot.y[i]!);
      this.widths[i] = 0;
      if (lane >= 0 && snapshot.lateralM[i] !== 0) {
        const target = this.city!.lanes[lane]!;
        const source = this.city!.lanes[snapshot.lateralM[i]! > 0 ? target.right : target.left]!;
        this.widths[i] = (source.widthM + target.widthM) / 2;
      }
    }
    this.segments.length = snapshot.count;
  }

  at(i: number, elapsedS: number) {
    const snapshot = this.snapshot!;
    if ((snapshot.poseLane?.[i] ?? -1) >= 0)
      return { x: snapshot.x[i]!, y: snapshot.y[i]!, heading: snapshot.heading[i]! };
    const pose =
      elapsedS > 0
        ? advanceAlong(this.segments[i]!, this.distances[i]!, snapshot.speed[i]!, elapsedS)
        : { x: snapshot.x[i]!, y: snapshot.y[i]!, heading: snapshot.heading[i]! };
    const { lateral, yaw } = laneChangePose(
      snapshot.lateralM[i]!,
      this.widths[i]!,
      this.durationS,
      elapsedS,
    );
    return {
      x: pose.x - Math.sin(pose.heading) * lateral,
      y: pose.y + Math.cos(pose.heading) * lateral,
      heading: pose.heading + yaw,
    };
  }
}
