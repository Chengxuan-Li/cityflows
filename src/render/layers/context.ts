import { Container, Graphics } from 'pixi.js';
import type { ContextFeature } from '../../schema';
import { style } from '../style';

export function drawContext(features: readonly ContextFeature[]) {
  const container = new Container();
  container.eventMode = 'none';
  const shapes = new Graphics();
  const ties = new Graphics();
  container.addChild(shapes, ties);
  // Broad terrain first, then water/green, then footprints and lines.
  const order = {
    landuse: 0,
    green: 1,
    water: 2,
    parking: 3,
    building: 4,
    waterway: 5,
    rail: 6,
    tram: 7,
  };
  for (const feature of [...features].sort((a, b) => order[a.class] - order[b.class])) {
    if (feature.kind === 'area') {
      const color =
        feature.class === 'landuse'
          ? (style.context.landuseSub[feature.sub ?? ''] ?? style.context.landuse)
          : style.context[feature.class];
      shapes.poly(feature.rings[0]!).fill(color);
      for (const hole of feature.rings.slice(1)) shapes.poly(hole);
      if (feature.rings.length > 1) shapes.cut();
      if (feature.class === 'building')
        for (const ring of feature.rings)
          shapes.poly(ring).stroke({ color: style.context.buildingEdge, width: 0.2 });
    } else {
      const water = feature.class === 'waterway';
      shapes.poly(feature.line, false).stroke({
        color: feature.class === 'waterway' ? style.context.water : style.context[feature.class],
        width: water ? (feature.widthM ?? 2) : feature.class === 'tram' ? 0.45 : 0.7,
        cap: 'round',
        join: 'round',
      });
      if (feature.class !== 'rail') continue;
      let next = 0;
      for (let i = 1; i < feature.line.length; i++) {
        const a = feature.line[i - 1]!,
          b = feature.line[i]!;
        const dx = b.x - a.x,
          dy = b.y - a.y,
          length = Math.hypot(dx, dy);
        if (!length) continue;
        while (next < length) {
          const x = a.x + (dx * next) / length,
            y = a.y + (dy * next) / length;
          ties
            .moveTo(x - (dy / length) * 1.3, y + (dx / length) * 1.3)
            .lineTo(x + (dy / length) * 1.3, y - (dx / length) * 1.3);
          next += 3;
        }
        next -= length;
      }
    }
  }
  ties.stroke({ color: style.context.rail, width: 0.35 });
  const bounds = shapes.getLocalBounds();
  return { container, ties, size: Math.max(bounds.width, bounds.height) };
}
