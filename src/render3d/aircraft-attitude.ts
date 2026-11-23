import type { AircraftPose } from '../render/types';
import type { AircraftVisualPose } from '../sim/aircraft-motion';
import type { AircraftMesh } from './aircraft-mesh';

/** TASK-331: the gear retracts without scaling: TASK-307's gear slides up by `gearSlideY` as
 * it stows, and the real models' gear, which folds in its own material (`gearFoldMaterial`),
 * is placed with `gearSlideY` 0. */
export function placeAircraft(
  mesh: AircraftMesh,
  pose: AircraftPose & { visual: AircraftVisualPose },
  elevationM: number,
  mainX: number,
  gearSlideY: number,
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
  mesh.gear.position.y = gearSlideY * (1 - gear);
  if (mesh.noseGear) mesh.noseGear.rotation.y = -steering;
}
