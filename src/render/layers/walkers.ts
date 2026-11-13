import { Container, Graphics } from 'pixi.js';
import type { Vec2 } from '../../geo/vec2';
import { walkGreenS, type CNode, type CompiledCity, type CWalkLink } from '../../network';
import { style } from '../style';
import type { SignalStates, WalkerSnapshot } from '../types';

/** TASK-111: the two kerb ends of each signalised crossing of a node: the outer ends of the pieces
 * of one crossing (its compiled links share an id before `/`), each with the link that ends there. */
export function walkSignalMarks(city: CompiledCity, node: CNode) {
  const crossings = new Map<string, CWalkLink[]>();
  for (const link of city.walk.links)
    if (link.crossing?.control === 'signal' && link.crossing.node === node.idx) {
      const key = link.id.slice(0, link.id.lastIndexOf('/'));
      crossings.set(key, [...(crossings.get(key) ?? []), link]);
    }
  const inset = (a: Vec2, b: Vec2, length: number): Vec2 => {
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const s = Math.min(0.6, length / 4);
    return { x: a.x + ((b.x - a.x) * s) / d, y: a.y + ((b.y - a.y) * s) / d };
  };
  return [...crossings.values()].flatMap((pieces) => {
    const first = pieces[0]!,
      last = pieces.at(-1)!;
    return [
      { link: first.idx, pos: inset(first.line[0]!, first.line[1]!, first.lengthM) },
      { link: last.idx, pos: inset(last.line.at(-1)!, last.line.at(-2)!, last.lengthM) },
    ];
  });
}

/** Small marks at both kerbs of each signalised crossing, red or green with its walk light. */
export function drawWalkSignals(
  city: CompiledCity,
  node: CNode,
  container: Container,
): (timeS: number, states?: SignalStates) => void {
  const signal = node.signal!;
  const marks = walkSignalMarks(city, node).map(({ link, pos }) => ({
    link,
    graphic: container.addChild(
      new Graphics()
        .roundRect(pos.x - 0.55, pos.y - 0.55, 1.1, 1.1, 0.25)
        .fill({ color: 0xffffff, alpha: 0.45 })
        .roundRect(pos.x - 0.38, pos.y - 0.38, 0.76, 0.76, 0.16)
        .fill(0xffffff),
    ),
  }));
  let previous = '';
  return (timeS, states) => {
    const key = marks
      .map(({ link }) =>
        states ? states.walk[link]! : walkGreenS(signal, link, timeS) > 0 ? 1 : 0,
      )
      .join('');
    if (key === previous) return;
    previous = key;
    marks.forEach(({ graphic }, i) => {
      graphic.tint = key[i] === '1' ? style.signalGreen : style.signalRed;
    });
  };
}

/** Walkers as dots, at least two pixels across, per grade; the selected one gets a ring. */
export function drawWalkers(
  layers: Map<number, Graphics>,
  snapshot: WalkerSnapshot | undefined,
  zoom: number,
  selected: number,
) {
  for (const graphics of layers.values()) graphics.clear();
  if (!snapshot) return;
  const radius = Math.max(0.3, 1.2 / zoom);
  const base = layers.get(0) ?? layers.values().next().value;
  for (let i = 0; i < snapshot.count; i++) {
    const graphics = layers.get(snapshot.layer[i]!) ?? base;
    if (!graphics) continue;
    const x = snapshot.x[i]!,
      y = snapshot.y[i]!;
    graphics
      .circle(x, y, radius)
      .fill(snapshot.state[i] === 2 ? style.walker.waiting : style.walker.walking);
    if (snapshot.id[i] === selected)
      graphics
        .circle(x, y, radius + 4 / zoom)
        .stroke({ width: 1.25 / zoom, color: style.selection });
  }
}

/** The walk links of a selected walker's route. */
export function drawWalkerRoute(graphics: Graphics, city: CompiledCity, links: readonly number[]) {
  graphics.clear();
  for (const index of links) {
    const link = city.walk.links[index];
    if (!link) continue;
    graphics
      .poly(link.line, false)
      .stroke({ width: 1, color: style.selection, alpha: 0.75, cap: 'round', join: 'round' });
  }
}
