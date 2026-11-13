import { Container, Graphics } from 'pixi.js';
import { headingAtDistance, pointAtDistance } from '../../geo/polyline';
import { signalStateAt, type CNode, type CSignal, type CompiledCity } from '../../network';
import { style } from '../style';
import type { SignalStates } from '../types';

const stages = ['green', 'amber', 'all-red'] as const;

/** TASK-170: a node's signal phase and stage as the run drives it (`states`, from the
 * snapshot), or from its program at `timeS` before a run reports one. */
export function signalLight(signal: CSignal, node: number, timeS: number, states?: SignalStates) {
  const phase = states?.phase[node] ?? -1;
  return phase >= 0 && phase < signal.phases.length
    ? { phase, state: stages[states!.state[node]!]! }
    : signalStateAt(signal, timeS);
}

/** One light per movement of each approach lane, across the lane just before its stop line
 * (TASK-094: with the stop line and the crossing, not at the lane end in the junction). */
export function signalHeads(city: CompiledCity, node: CNode) {
  const heads: { x: number; y: number; radius: number; lane: number; movement: number }[] = [];
  // TASK-131: heads only where roads enter a junction group, none on its inner roads.
  const lanes = new Set(
    node.movements
      .map((movement) => city.movements[movement]!.fromLane)
      .filter((lane) => city.roads[city.lanes[lane]!.road]!.group === undefined),
  );
  for (const index of lanes) {
    const lane = city.lanes[index]!;
    const point = pointAtDistance(lane.polyline, lane.cumulative, lane.stopM);
    const heading = headingAtDistance(lane.polyline, lane.cumulative, lane.stopM);
    const alongX = Math.cos(heading);
    const alongY = Math.sin(heading);
    const halfWidth = lane.widthM * 0.46;
    const movements = lane.out;
    const spacing = Math.min(0.92, (2 * halfWidth) / movements.length);
    for (let i = 0; i < movements.length; i++) {
      const offset = (i - (movements.length - 1) / 2) * spacing;
      heads.push({
        x: point.x - alongX * 0.93 - alongY * offset,
        y: point.y - alongY * 0.93 + alongX * offset,
        radius: spacing * 0.36,
        lane: index,
        movement: movements[i]!,
      });
    }
  }
  return heads;
}

/** `night` (TASK-163) receives a copy of each head, drawn above the evening tint. */
export function drawSignal(
  city: CompiledCity,
  node: CNode,
  container: Container,
  night?: Container,
): (timeS: number, states?: SignalStates) => void {
  const signal = node.signal!;
  const phases = signal.phases.map(({ movements }) => new Set(movements));
  const heads = signalHeads(city, node).map(({ x, y, radius, movement }) => ({
    graphic: container.addChild(
      new Graphics()
        .circle(x, y, radius * 3.1)
        .fill({ color: 0xffffff, alpha: 0.16 })
        .circle(x, y, radius * 1.9)
        .fill({ color: 0xffffff, alpha: 0.33 })
        .circle(x, y, radius * 1.25)
        .fill(0xffffff),
    ),
    movement,
  }));
  const copies = night
    ? heads.map(({ graphic, movement }) => ({ graphic: night.addChild(graphic.clone()), movement }))
    : [];

  let previousPhase = -1;
  let previousState: string | undefined;
  return (timeS, states) => {
    const { phase, state } = signalLight(signal, node.idx, timeS, states);
    if (phase === previousPhase && state === previousState) return;
    previousPhase = phase;
    previousState = state;
    for (const { graphic, movement } of [...heads, ...copies]) {
      graphic.tint =
        state === 'all-red' || !phases[phase]!.has(movement)
          ? style.signalRed
          : state === 'green'
            ? style.signalGreen
            : style.signalAmber;
    }
  };
}
