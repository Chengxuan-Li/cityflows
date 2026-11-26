import { GraphicsContext } from 'pixi.js';
import type { Box } from '../../geo/polyline';
import { baggageCart, groundVehicleSizes, type GroundVehiclePose } from '../../sim/ground-vehicles';
import { style } from '../style';
import { GraphicsPool, placeShared } from './aircraft';

// TASK-316: airside ground vehicles from above, under the aircraft: a body by kind with its cab
// (tug, tractor, bus windscreen), tank (fuel) or box (catering) accent, and a tractor's carts.
// TASK-357: each kind's body and the cart are one shared context in local metres (+x forward,
// +y starboard), placed by their graphics' transforms, so moving vehicles are not triangulated
// again every frame.

function rectangle(g: GraphicsContext, along: number, lengthM: number, widthM: number) {
  return g.poly([
    { x: along + lengthM / 2, y: widthM / 2 },
    { x: along + lengthM / 2, y: -widthM / 2 },
    { x: along - lengthM / 2, y: -widthM / 2 },
    { x: along - lengthM / 2, y: widthM / 2 },
  ]);
}

export class GroundVehicles2D {
  private readonly pool = new GraphicsPool();
  readonly container = this.pool.container;
  private readonly contexts = new Map<string, GraphicsContext>();

  private context(kind: GroundVehiclePose['kind'] | 'cart') {
    let g = this.contexts.get(kind);
    if (g) return g;
    this.contexts.set(kind, (g = new GraphicsContext()));
    const colors = style.groundVehicle;
    if (kind === 'cart') {
      rectangle(g, 0, baggageCart.lengthM, baggageCart.widthM)
        .fill(colors.cart.body)
        .stroke({ width: 0.15, color: colors.edge });
      rectangle(g, 0, baggageCart.lengthM - 0.6, baggageCart.widthM - 0.5).fill(colors.cart.accent);
      return g;
    }
    const { lengthM, widthM } = groundVehicleSizes[kind];
    const paint = colors[kind];
    rectangle(g, 0, lengthM, widthM).fill(paint.body).stroke({ width: 0.15, color: colors.edge });
    // Accent: the cab at the front, a tank or box behind it, a bus's windscreen.
    if (kind === 'fuel' || kind === 'catering')
      rectangle(g, -0.12 * lengthM, 0.66 * lengthM, widthM - 0.5).fill(paint.accent);
    else if (kind === 'hydrant')
      rectangle(g, -0.1 * lengthM, 0.5 * lengthM, widthM - 0.6).fill(paint.accent);
    else if (kind === 'bus') rectangle(g, lengthM / 2 - 0.5, 0.6, widthM - 0.4).fill(paint.accent);
    else rectangle(g, lengthM / 2 - 0.55, 1.1, widthM - 0.3).fill(paint.accent);
    return g;
  }

  draw(poses: readonly GroundVehiclePose[], bounds: Box | null) {
    for (const pose of poses) {
      if (
        bounds &&
        (pose.x < bounds.minX ||
          pose.x > bounds.maxX ||
          pose.y < bounds.minY ||
          pose.y > bounds.maxY)
      )
        continue;
      for (const cart of pose.carts)
        placeShared(this.pool.next(), this.context('cart'), cart.x, cart.y, cart.heading);
      placeShared(this.pool.next(), this.context(pose.kind), pose.x, pose.y, pose.heading);
    }
    this.pool.finish();
  }
}
