import { Graphics } from 'pixi.js';
import { trackGrade, type RailGraph } from '../../network/rail';
import type { TrainPose } from '../../network/trains';
import type { Vec2 } from '../../geo/vec2';
import type { Pick } from '../types';
import { style } from '../style';

export const trainColors = { sbahn: 0xbc4647, mainline: 0x607e99, tram: 0x438b99, roof: 0xecebe4 };
/** TASK-132: tunnels and roofs hide trains in 2D; a ground track keeps them whatever its layer. */
const hidden = (track: RailGraph['tracks'][number]) =>
  trackGrade(track) === 'tunnel' || trackGrade(track) === 'covered';
export function drawTrains(
  layers: Map<number, Graphics>,
  rail: RailGraph,
  trains: TrainPose[],
  selected: string | null,
) {
  for (const g of layers.values()) g.clear();
  for (const train of trains)
    for (const car of train.cars) {
      const track = rail.tracks[car.track]!;
      const g = layers.get(track.layer)!;
      if (hidden(track)) continue;
      const c = Math.cos(car.heading),
        s = Math.sin(car.heading);
      const rectangle = (length: number, width: number) =>
        [
          [-length / 2, -width / 2],
          [length / 2, -width / 2],
          [length / 2, width / 2],
          [-length / 2, width / 2],
        ].map(([x, y]) => ({ x: car.x + x! * c - y! * s, y: car.y + x! * s + y! * c }));
      if (selected === train.id)
        g.poly(rectangle(car.lengthM + 1, 4.8)).fill({ color: style.selection, alpha: 0.6 });
      g.poly(rectangle(car.lengthM, train.kind === 'tram' ? 2.4 : 3)).fill(trainColors[train.kind]);
      if (car.lengthM > 3) g.poly(rectangle(car.lengthM - 3, 1.4)).fill(trainColors.roof);
    }
}
export function pickTrain(
  trains: TrainPose[],
  point: Vec2,
  zoom: number,
  rail: RailGraph,
  minimumGrade = -Infinity,
): Pick | null {
  for (const train of trains)
    for (const car of train.cars) {
      const track = rail.tracks[car.track]!;
      if (hidden(track) || track.layer < minimumGrade) continue;
      const dx = point.x - car.x,
        dy = point.y - car.y,
        c = Math.cos(car.heading),
        s = Math.sin(car.heading);
      if (
        Math.abs(dx * c + dy * s) < car.lengthM / 2 &&
        Math.abs(-dx * s + dy * c) < Math.max(2, 4 / zoom)
      )
        return { kind: 'train', id: train.id, route: train.route };
    }
  return null;
}
export function trainLayers(grades: { layer: number; trains: Graphics }[]) {
  return new Map(grades.map((g) => [g.layer, g.trains]));
}
