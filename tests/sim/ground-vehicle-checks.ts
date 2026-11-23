import { aircraftTypes } from '../../src/schema/aircraft';
import type { AircraftPoseSnapshot } from '../../src/sim/aircraft';
import {
  aircraftHull,
  baggageCart,
  boxesOverlap,
  groundVehicleSizes,
  type GroundVehiclePose,
  type PlanBox,
} from '../../src/sim/ground-vehicles';

// TASK-316: the gates' checks on ground vehicles. A vehicle's plan is its body and each baggage
// cart's. It overlaps an aircraft when it meets the fuselage or the tailplane in plan, or the
// wing of an aircraft that moves (wings and engines stand above apron vehicles at a stand). A
// tug pushing an aircraft is part of it.

const typeById = new Map(aircraftTypes.map((t) => [t.id, t]));

export function vehicleBoxes(pose: GroundVehiclePose): PlanBox[] {
  const size = groundVehicleSizes[pose.kind];
  return [
    { x: pose.x, y: pose.y, heading: pose.heading, lengthM: size.lengthM, widthM: size.widthM },
    ...pose.carts.map((c) => ({ ...c, lengthM: baggageCart.lengthM, widthM: baggageCart.widthM })),
  ];
}

function aircraftBoxes(a: AircraftPoseSnapshot): PlanBox[] {
  const type = typeById.get(a.typeId)!;
  const pose = a.visual ?? a;
  const hull = aircraftHull(type, pose);
  if (a.state === 'parked') return hull;
  const wing = {
    x: pose.x + Math.cos(pose.heading) * 0.02 * type.lengthM,
    y: pose.y + Math.sin(pose.heading) * 0.02 * type.lengthM,
    heading: pose.heading,
    lengthM: 0.2 * type.lengthM,
    widthM: type.spanM,
  };
  return [...hull, wing];
}

/** Vehicle and aircraft pairs that overlap, and vehicle pairs that do. */
export function groundOverlaps(
  vehicles: readonly GroundVehiclePose[],
  aircraft: readonly AircraftPoseSnapshot[],
) {
  const withAircraft: [number, string][] = [];
  const withVehicles: [number, number][] = [];
  const shown = vehicles.filter((v) => v.attachedTo < 0);
  const boxes = shown.map(vehicleBoxes);
  const low = aircraft.filter((a) => a.heightM < 20);
  const planes = low.map(aircraftBoxes);
  for (const [i, v] of shown.entries())
    for (const [j, a] of low.entries()) {
      if (Math.hypot(v.x - a.x, v.y - a.y) > 120) continue;
      if (boxes[i]!.some((b) => planes[j]!.some((p) => boxesOverlap(b, p))))
        withAircraft.push([v.id, a.registration]);
    }
  for (let i = 0; i < shown.length; i++)
    for (let j = i + 1; j < shown.length; j++) {
      if (Math.hypot(shown[i]!.x - shown[j]!.x, shown[i]!.y - shown[j]!.y) > 40) continue;
      if (boxes[i]!.some((a) => boxes[j]!.some((b) => boxesOverlap(a, b))))
        withVehicles.push([shown[i]!.id, shown[j]!.id]);
    }
  return { withAircraft, withVehicles };
}
