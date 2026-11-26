import { CanvasSource, Container, Graphics, Particle, ParticleContainer, Texture } from 'pixi.js';
import type { Vec2 } from '../../geo/vec2';
import {
  walkGreenS,
  type CNode,
  type CompiledCity,
  type CSignal,
  type CWalkLink,
} from '../../network';
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

/** TASK-252: a walk light from the program alone (before the run's first snapshot): 1 green,
 * 0 red, or 2 dark at a crossing no phase serves, which walkers cross in a gap (TASK-245), so
 * nothing shows red while they legally cross. */
export function walkLightAt(signal: CSignal, link: number, timeS: number) {
  if (!signal.phases.some((phase) => phase.walk.includes(link))) return 2;
  return walkGreenS(signal, link, timeS) > 0 ? 1 : 0;
}

export const walkLightColor = (light: number) =>
  light === 1 ? style.signalGreen : light === 2 ? style.signalDark : style.signalRed;

/** Small marks at both kerbs of each signalised crossing, with its walk light. */
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
      .map(({ link }) => (states ? states.walk[link]! : walkLightAt(signal, link, timeS)))
      .join('');
    if (key === previous) return;
    previous = key;
    marks.forEach(({ graphic }, i) => {
      graphic.tint = walkLightColor(Number(key[i]));
    });
  };
}

/** TASK-277: a grade's walkers: one particle per dot and a ring for the selected one. Drawn as
 * vector circles, every snapshot re-tessellated thousands of them (Philadelphia at 07:45: 2.5 ms
 * of a 2D frame ten times a second); particles only move, as the vehicles' dots do. */
export function createWalkerLayer() {
  const container = new Container();
  const dots = new ParticleContainer({
    dynamicProperties: { position: true, color: true, vertex: true },
  });
  const ring = new Graphics();
  container.addChild(dots, ring);
  return { container, dots, ring, pool: [] as Particle[], count: 0, ringDrawn: false };
}
export type WalkerLayer = ReturnType<typeof createWalkerLayer>;

let dotTexture: Texture | undefined;
/** A white disc, 32 px across, tinted per walker; mipmapped, so a dot two pixels across stays
 * round rather than sampling a cross out of the disc. */
function walkerDot() {
  if (dotTexture) return dotTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(16, 16, 16, 0, Math.PI * 2);
  context.fill();
  const source = new CanvasSource({ resource: canvas, autoGenerateMipmaps: true });
  return (dotTexture = new Texture({ source }));
}

/** Walkers as dots, at least two pixels across, per grade; the selected one gets a ring. */
export function drawWalkers(
  layers: Map<number, WalkerLayer>,
  snapshot: WalkerSnapshot | undefined,
  zoom: number,
  selected: number,
) {
  for (const layer of layers.values()) {
    layer.count = 0;
    if (layer.ringDrawn) layer.ring.clear();
    layer.ringDrawn = false;
  }
  const radius = Math.max(0.3, 1.2 / zoom);
  const base = layers.get(0) ?? layers.values().next().value;
  const texture = walkerDot();
  const scale = (2 * radius) / texture.width;
  for (let i = 0; i < (snapshot?.count ?? 0); i++) {
    const layer = layers.get(snapshot!.layer[i]!) ?? base;
    if (!layer) continue;
    const x = snapshot!.x[i]!,
      y = snapshot!.y[i]!;
    const particle = (layer.pool[layer.count++] ??= new Particle({
      texture,
      anchorX: 0.5,
      anchorY: 0.5,
    }));
    particle.x = x;
    particle.y = y;
    particle.scaleX = particle.scaleY = scale;
    particle.tint = snapshot!.state[i] === 2 ? style.walker.waiting : style.walker.walking;
    if (snapshot!.id[i] === selected) {
      layer.ringDrawn = true;
      layer.ring
        .circle(x, y, radius + 4 / zoom)
        .stroke({ width: 1.25 / zoom, color: style.selection });
    }
  }
  for (const { dots, pool, count } of layers.values()) {
    const children = dots.particleChildren;
    if (children.length === count) continue;
    for (let i = children.length; i < count; i++) children[i] = pool[i]!;
    children.length = count;
    dots.update();
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
