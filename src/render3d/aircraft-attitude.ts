import type { AircraftPose } from '../render/types';
import type { AircraftVisualPose } from '../sim/aircraft-motion';
import type { AircraftMesh } from './aircraft-mesh';

export function placeAircraft(
  mesh: AircraftMesh,
  pose: AircraftPose & { visual: AircraftVisualPose },
  elevationM: number,
  mainX: number,
  gearStowY: number,
) {
  const { x, y, heightM, heading, visual } = pose;
  const { pitch, roll, steering, gear } = visual;
  const offset = mainX * (1 - Math.cos(pitch));
  mesh.root.position.set(
    x + offset * Math.cos(heading),
    elevationM + heightM - mainX * Math.sin(pitch),
    y + offset * Math.sin(heading),
  );
  mesh.root.rotation.set(roll, -heading, pitch, 'YZX');
  mesh.root.updateMatrix();
  mesh.gear.visible = gear > 0;
  mesh.gear.position.y = gearStowY * (1 - gear);
  mesh.gear.scale.y = gear;
  if (mesh.noseGear) mesh.noseGear.rotation.y = -steering;
}
