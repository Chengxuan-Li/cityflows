import type { Graphics } from 'pixi.js';
import { headingAtDistance, pointAtDistance } from '../../geo/polyline';
import type { CompiledCity } from '../../network';
import { style } from '../style';
import type { SignalStates } from '../types';
import { signalLight } from './signals';

/** Uses the loaded engine tables, never the inspector's draft program. */
export function drawSignalPreview(
  graphics: Graphics,
  city: CompiledCity | null,
  nodeId: string | null,
  timeS: number,
  states?: SignalStates,
) {
  graphics.clear();
  const index = nodeId === null ? undefined : city?.index.node.get(nodeId);
  const node = index === undefined ? undefined : city!.nodes[index];
  if (!node?.signal) return null;
  const { phase, state } = signalLight(node.signal, node.idx, timeS, states);
  const movements = state === 'green' ? node.signal.phases[phase]!.movements : [];
  for (const index of movements) {
    const { polyline, cumulative, lengthM } = city!.movements[index]!;
    graphics.poly(polyline, false).stroke({ color: style.signalGreen, width: 0.65, cap: 'round' });
    const tip = pointAtDistance(polyline, cumulative, lengthM * 0.8);
    const heading = headingAtDistance(polyline, cumulative, lengthM * 0.8);
    const size = Math.min(1.5, lengthM / 4);
    const dx = Math.cos(heading) * size;
    const dy = Math.sin(heading) * size;
    graphics
      .poly([
        tip.x,
        tip.y,
        tip.x - dx - dy * 0.65,
        tip.y - dy + dx * 0.65,
        tip.x - dx + dy * 0.65,
        tip.y - dy - dx * 0.65,
      ])
      .fill(style.signalGreen);
  }
  return { nodeId, timeS, phase, state, movements: movements.map((i) => city!.movements[i]!.id) };
}
