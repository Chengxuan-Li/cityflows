import { Container, Graphics } from 'pixi.js';
import type { Catenary } from '../../network/catenary';

/** TASK-134: overhead line colours, shared with the 3D view. */
export const catenaryColors = { mast: 0x56605b, beam: 0x67716c, wire: 0x3b423e };
/** Supports show from `supports` px/m, wires (hairlines) from `wires`. */
export const catenaryZooms = { supports: 1.5, wires: 3 };
const mastM = 0.7;

/** Masts as squares at the bundle's edges, portals and arms as thin lines across, wires as
 * hairlines, one container per grade. Tunnel wires are not drawn in 2D. */
export function drawCatenary(lines: Catenary) {
  const grades = new Map<number, { container: Container; supports: Graphics; wires: Graphics }>();
  const at = (layer: number) => {
    let grade = grades.get(layer);
    if (!grade) {
      const container = new Container(),
        supports = new Graphics(),
        wires = new Graphics();
      container.addChild(wires, supports);
      grade = { container, supports, wires };
      grades.set(layer, grade);
    }
    return grade;
  };
  for (const s of lines.supports) {
    const { supports } = at(s.layer);
    supports
      .moveTo(s.beam[0].x, s.beam[0].y)
      .lineTo(s.beam[1].x, s.beam[1].y)
      .stroke({ color: catenaryColors.beam, width: s.kind === 'portal' ? 0.35 : 0.2 });
    // Squares turned square to the beam.
    const length = Math.hypot(s.beam[1].x - s.beam[0].x, s.beam[1].y - s.beam[0].y) || 1;
    const u = {
        x: ((s.beam[1].x - s.beam[0].x) / length) * (mastM / 2),
        y: ((s.beam[1].y - s.beam[0].y) / length) * (mastM / 2),
      },
      v = { x: -u.y, y: u.x };
    for (const { pos: p } of s.masts)
      supports
        .poly([
          { x: p.x - u.x - v.x, y: p.y - u.y - v.y },
          { x: p.x + u.x - v.x, y: p.y + u.y - v.y },
          { x: p.x + u.x + v.x, y: p.y + u.y + v.y },
          { x: p.x - u.x + v.x, y: p.y - u.y + v.y },
        ])
        .fill(catenaryColors.mast);
  }
  for (const w of lines.wires) {
    if (w.hidden || w.points.length < 2) continue;
    const { wires } = at(w.layer);
    wires.moveTo(w.points[0]!.pos.x, w.points[0]!.pos.y);
    for (const p of w.points.slice(1)) wires.lineTo(p.pos.x, p.pos.y);
    wires.stroke({ color: catenaryColors.wire, width: 1, pixelLine: true, alpha: 0.75 });
  }
  return grades;
}
