import { Container, Graphics } from 'pixi.js';
import type { LevelCrossing } from '../../network/level-crossings';
import { crossingColors, crossingCounts, crossingDrawings } from '../level-crossings';
import { boxCorners } from './stations';

export function drawLevelCrossings(facilities: readonly LevelCrossing[]) {
  const grades = new Map<number, { container: Container }>();
  for (const d of crossingDrawings(facilities)) {
    let grade = grades.get(d.layer);
    if (!grade) {
      grade = { container: new Container() };
      grades.set(d.layer, grade);
    }
    const g = new Graphics();
    grade.container.addChild(g);
    for (const m of d.marks)
      g.moveTo(m.a.x, m.a.y)
        .lineTo(m.b.x, m.b.y)
        .stroke({ color: crossingColors.white, width: 0.35 });
    for (const p of d.parts) {
      if (p.roll) continue;
      g.poly(boxCorners(p)).fill(p.color);
      // An upright open arm remains legible from directly overhead as a striped gate base.
      if (p.height === 0.5) g.circle(p.x, p.y, 0.2).fill(p.color);
    }
    for (const x of d.crosses) {
      for (const sign of [-1, 1]) {
        const angle = x.heading + (sign * Math.PI) / 4;
        const ux = Math.cos(angle) * 0.7,
          uy = Math.sin(angle) * 0.7;
        g.moveTo(x.pos.x - ux, x.pos.y - uy)
          .lineTo(x.pos.x + ux, x.pos.y + uy)
          .stroke({ color: crossingColors.red, width: 0.22 });
        g.moveTo(x.pos.x - ux * 0.48, x.pos.y - uy * 0.48)
          .lineTo(x.pos.x + ux * 0.48, x.pos.y + uy * 0.48)
          .stroke({ color: crossingColors.white, width: 0.22 });
      }
    }
  }
  return {
    grades,
    counts: crossingCounts(facilities),
    update(zoom: number, visible: boolean) {
      for (const { container } of grades.values()) container.visible = visible && zoom >= 2;
    },
  };
}
