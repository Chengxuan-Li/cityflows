import { Container, Graphics } from 'pixi.js';
import { headingAtDistance } from '../../geo/polyline';
import { signalStateAt, type CNode, type CompiledCity } from '../../network';
import { style } from '../style';

export function drawSignal(
  city: CompiledCity,
  node: CNode,
  container: Container,
): (timeS: number) => void {
  const signal = node.signal!;
  const phases = signal.phases.map(({ movements }) => new Set(movements));
  const heads: { graphic: Graphics; movement: number }[] = [];
  const lanes = new Set(node.movements.map((movement) => city.movements[movement]!.fromLane));
  for (const index of lanes) {
    const lane = city.lanes[index]!;
    const point = lane.polyline.at(-1)!;
    const heading = headingAtDistance(lane.polyline, lane.cumulative, lane.lengthM);
    const alongX = Math.cos(heading);
    const alongY = Math.sin(heading);
    const x = point.x - alongX * 0.18;
    const y = point.y - alongY * 0.18;
    const halfWidth = lane.widthM * 0.46;
    const movements = lane.out;
    const spacing = Math.min(0.92, (2 * halfWidth) / movements.length);
    const radius = spacing * 0.36;
    for (let i = 0; i < movements.length; i++) {
      const offset = (i - (movements.length - 1) / 2) * spacing;
      const headX = x - alongX * 0.75 - alongY * offset;
      const headY = y - alongY * 0.75 + alongX * offset;
      const graphic = container.addChild(
        new Graphics()
          .circle(headX, headY, radius * 3.1)
          .fill({ color: 0xffffff, alpha: 0.16 })
          .circle(headX, headY, radius * 1.9)
          .fill({ color: 0xffffff, alpha: 0.33 })
          .circle(headX, headY, radius * 1.25)
          .fill(0xffffff),
      );
      heads.push({ graphic, movement: movements[i]! });
    }
  }

  let previousPhase = -1;
  let previousState: string | undefined;
  return (timeS) => {
    const { phase, state } = signalStateAt(signal, timeS);
    if (phase === previousPhase && state === previousState) return;
    previousPhase = phase;
    previousState = state;
    for (const { graphic, movement } of heads) {
      graphic.tint =
        state === 'all-red' || !phases[phase]!.has(movement)
          ? style.signalRed
          : state === 'green'
            ? style.signalGreen
            : style.signalAmber;
    }
  };
}
