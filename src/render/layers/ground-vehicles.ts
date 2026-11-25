import type { Graphics } from 'pixi.js';
import type { Box } from '../../geo/polyline';
import type { Vec2 } from '../../geo/vec2';
import { baggageCart, groundVehicleSizes, type GroundVehiclePose } from '../../sim/ground-vehicles';
import { style } from '../style';

// TASK-316: airside ground vehicles from above, under the aircraft: a body by kind with its cab
// (tug, tractor, bus windscreen), tank (fuel) or box (catering) accent, and a tractor's carts.

function rectangle(
  g: Graphics,
  centre: Vec2,
  heading: number,
  along: number,
  lengthM: number,
  widthM: number,
) {
  const c = Math.cos(heading),
    s = Math.sin(heading);
  const corners = [
    [along + lengthM / 2, widthM / 2],
    [along + lengthM / 2, -widthM / 2],
    [along - lengthM / 2, -widthM / 2],
    [along - lengthM / 2, widthM / 2],
  ].map(([u, v]) => ({ x: centre.x + u! * c - v! * s, y: centre.y + u! * s + v! * c }));
  return g.poly(corners);
}

export function drawGroundVehicles(
  g: Graphics,
  poses: readonly GroundVehiclePose[],
  bounds: Box | null,
) {
  g.clear();
  const colors = style.groundVehicle;
  for (const pose of poses) {
    if (
      bounds &&
      (pose.x < bounds.minX || pose.x > bounds.maxX || pose.y < bounds.minY || pose.y > bounds.maxY)
    )
      continue;
    for (const cart of pose.carts) {
      rectangle(g, cart, cart.heading, 0, baggageCart.lengthM, baggageCart.widthM)
        .fill(colors.cart.body)
        .stroke({ width: 0.15, color: colors.edge });
      rectangle(g, cart, cart.heading, 0, baggageCart.lengthM - 0.6, baggageCart.widthM - 0.5).fill(
        colors.cart.accent,
      );
    }
    const { lengthM, widthM } = groundVehicleSizes[pose.kind];
    const kind = colors[pose.kind];
    rectangle(g, pose, pose.heading, 0, lengthM, widthM)
      .fill(kind.body)
      .stroke({ width: 0.15, color: colors.edge });
    // Accent: the cab at the front, a tank or box behind it, a bus's windscreen.
    if (pose.kind === 'fuel' || pose.kind === 'catering')
      rectangle(g, pose, pose.heading, -0.12 * lengthM, 0.66 * lengthM, widthM - 0.5).fill(
        kind.accent,
      );
    else if (pose.kind === 'hydrant')
      rectangle(g, pose, pose.heading, -0.1 * lengthM, 0.5 * lengthM, widthM - 0.6).fill(
        kind.accent,
      );
    else if (pose.kind === 'bus')
      rectangle(g, pose, pose.heading, lengthM / 2 - 0.5, 0.6, widthM - 0.4).fill(kind.accent);
    else rectangle(g, pose, pose.heading, lengthM / 2 - 0.55, 1.1, widthM - 0.3).fill(kind.accent);
  }
}
