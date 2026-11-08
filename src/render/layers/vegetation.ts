import { Container, Graphics } from 'pixi.js';
import { style } from '../style';
import type { Tree } from '../vegetation';

/** Static canopies share the base terrain's overview texture with roads and surroundings. */
export function drawVegetation(trees: readonly Tree[]) {
  const container = new Container();
  container.eventMode = 'none';
  const natural = new Graphics(),
    street = new Graphics();
  container.addChild(natural, street);
  for (const [graphics, generated] of [
    [natural, false],
    [street, true],
  ] as const) {
    for (const [tone, color] of style.vegetation.canopy.entries()) {
      trees.forEach((tree, i) => {
        if ((tree.source === 'street') !== generated || i % style.vegetation.canopy.length !== tone)
          return;
        graphics.circle(tree.pos.x, tree.pos.y, tree.crownM / 2);
      });
      graphics.fill(color);
    }
  }
  return { container, natural, street };
}
