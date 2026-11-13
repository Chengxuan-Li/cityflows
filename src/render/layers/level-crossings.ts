import { Container, Graphics } from 'pixi.js';
import type { LevelCrossing } from '../../network/level-crossings';
import type { RailGraph } from '../../network/rail';
import {
  crossingAspect,
  crossingColors,
  crossingCounts,
  crossingDrawings,
  tramCrossingSignals,
} from '../level-crossings';
import { boxCorners } from './stations';

export function drawLevelCrossings(facilities: readonly LevelCrossing[], rail?: RailGraph) {
  const grades = new Map<number, { container: Container }>();
  const variants: Graphics[][] = [];
  for (const f of facilities) {
    const appearances: Graphics[] = [];
    variants.push(appearances);
    const signals = tramCrossingSignals(f, rail);
    for (let aspect = 0; aspect < (f.kind === 'tram' ? 7 : 5); aspect++) {
      const d = crossingDrawings(
        [f],
        new Uint8Array([Math.min(2, Math.ceil(aspect / 2))]),
        ((aspect + 1) % 2) / 2,
        new Uint8Array([aspect >= 5 ? 1 : 0]),
        [signals],
      )[0]!;
      let grade = grades.get(d.layer);
      if (!grade) {
        grade = { container: new Container() };
        grades.set(d.layer, grade);
      }
      const g = new Graphics();
      appearances.push(g);
      g.visible = aspect === 0;
      grade.container.addChild(g);
      for (const m of d.marks)
        g.moveTo(m.a.x, m.a.y)
          .lineTo(m.b.x, m.b.y)
          .stroke({ color: crossingColors.white, width: 0.35 });
      for (const p of d.parts) {
        if (p.kind === 'tram-signal') {
          g.poly(boxCorners({ ...p, length: p.height, width: p.width })).fill(p.color);
        } else if (p.kind === 'lamp') {
          g.circle(p.x, p.y, 0.14).fill(p.color);
        } else if (p.kind === 'arm') {
          g.poly(
            boxCorners({ ...p, length: Math.max(0.16, p.length * Math.cos(p.roll ?? 0)) }),
          ).fill(p.color);
        } else if (!p.roll) g.poly(boxCorners(p)).fill(p.color);
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
  }
  return {
    grades,
    counts: crossingCounts(facilities),
    setSnapshot(states?: Uint8Array, timeS = 0, railReady?: Uint8Array) {
      variants.forEach((appearances, i) => {
        const active = crossingAspect(
          states?.[i] ?? 0,
          timeS,
          facilities[i]!.kind === 'tram' && railReady?.[i] === 1,
        );
        appearances.forEach((g, aspect) => {
          g.visible = aspect === active;
        });
      });
    },
    update(zoom: number, visible: boolean) {
      for (const { container } of grades.values()) container.visible = visible && zoom >= 2;
    },
  };
}
