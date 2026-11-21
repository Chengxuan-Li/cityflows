import { BufferImageSource, Container, FillPattern, Graphics, Matrix, Texture } from 'pixi.js';
import { parallelOffset } from '../../geo/polyline';
import type { ContextFeature } from '../../schema';
import { groundSurface, surfaceGrain, type Surface } from '../vegetation';
import { mapPalettes, style, type MapPalette } from '../style';

export function drawContext(
  features: readonly ContextFeature[],
  palette: MapPalette = mapPalettes.light,
) {
  const container = new Container();
  container.eventMode = 'none';
  const patterns = new Map<Surface, FillPattern>();
  const pattern = (surface: Surface) => {
    if (!patterns.has(surface)) {
      const texture = new Texture({
        source: new BufferImageSource({
          resource: surfaceGrain(surface),
          width: 64,
          height: 64,
          alphaMode: 'no-premultiply-alpha',
        }),
      });
      const fill = new FillPattern({ texture, repetition: 'repeat' });
      fill.setTransform(new Matrix().scale(0.04, 0.04));
      patterns.set(surface, fill);
    }
    return patterns.get(surface)!;
  };
  container.on('destroyed', () => {
    for (const fill of patterns.values()) fill.destroy();
  });
  const shapes = new Graphics();
  const ties = new Graphics();
  container.addChild(shapes, ties);
  // TASK-273: walls are drawn above the place tints (the scene puts this layer there), so a wall
  // through a tinted place still reads; it stays under the roads and the walk on the wall.
  const walls = new Graphics();
  walls.eventMode = 'none';
  container.on('destroyed', () => walls.destroy());
  // Broad terrain first, then water/green, then footprints and lines.
  const order = {
    tree: -1,
    street_lamp: -1,
    elevator: -1,
    tree_row: -1,
    landuse: 0,
    green: 1,
    water: 2,
    parking: 3,
    building: 4,
    waterway: 5,
    rail: 6,
    tram: 7,
    city_wall: 4.6,
    city_gate: 4.7,
  };
  const rank = (f: ContextFeature) =>
    f.kind === 'area' && f.sub === 'path' ? 3.5 : order[f.class];
  for (const feature of [...features].sort((a, b) => rank(a) - rank(b))) {
    if (feature.kind === 'point' || feature.class === 'tree_row') continue;
    if (feature.kind === 'area') {
      const color =
        feature.class === 'landuse'
          ? (palette.context.landuseSub[feature.sub ?? ''] ?? palette.context.landuse)
          : palette.context[feature.class];
      const surface = groundSurface(feature);
      shapes.poly(feature.rings[0]!).fill(
        surface
          ? {
              texture: pattern(surface).texture,
              matrix: pattern(surface).transform,
              textureSpace: 'global',
              color,
            }
          : color,
      );
      for (const hole of feature.rings.slice(1)) shapes.poly(hole);
      if (feature.rings.length > 1) shapes.cut();
      if (feature.class === 'building')
        for (const ring of feature.rings)
          shapes.poly(ring).stroke({ color: palette.context.buildingEdge, width: 0.2 });
    } else if (feature.class === 'city_wall' || feature.class === 'city_gate') {
      // TASK-273: a wall band of the wall's width (an arch's depth), edged; a gate arch is darker.
      const gate = feature.class === 'city_gate';
      const width = feature.widthM ?? (gate ? 3 : 2);
      walls.poly(feature.line, false).stroke({
        color: gate ? palette.context.wallEdge : palette.context.wall,
        width,
        cap: 'butt',
        join: 'miter',
      });
      for (const side of [-1, 1])
        walls.poly(parallelOffset(feature.line, (side * width) / 2), false).stroke({
          color: palette.context.wallEdge,
          width: 0.5,
          join: 'round',
        });
    } else {
      const water = feature.class === 'waterway';
      shapes.poly(feature.line, false).stroke({
        color: feature.class === 'waterway' ? palette.context.water : style.context[feature.class],
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
  return { container, ties, walls, size: Math.max(bounds.width, bounds.height) };
}
