import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LevelCrossing } from '../network/level-crossings';
import { crossingColors, crossingCounts, crossingDrawings } from '../render/level-crossings';
import type { cityHeights } from './heights';

export class LevelCrossings3D {
  readonly group = new Group();
  readonly counts: ReturnType<typeof crossingCounts>;
  constructor(facilities: readonly LevelCrossing[], heights: ReturnType<typeof cityHeights>) {
    this.counts = crossingCounts(facilities);
    const byColor = new Map<number, BoxGeometry[]>();
    for (const d of crossingDrawings(facilities)) {
      const add = (
        x: number,
        y: number,
        length: number,
        width: number,
        bottom: number,
        height: number,
        heading: number,
        color: number,
        roll = 0,
      ) => {
        const box = new BoxGeometry(length, height, width);
        box.rotateZ(roll);
        box.rotateY(-heading);
        box.translate(x, heights.terrain.surfaceAt(x, y) + d.layer * 5 + bottom + height / 2, y);
        if (!byColor.has(color)) byColor.set(color, []);
        byColor.get(color)!.push(box);
      };
      for (const p of d.parts)
        add(p.x, p.y, p.length, p.width, p.bottom, p.height, p.heading, p.color, p.roll);
      for (const m of d.marks)
        add(
          (m.a.x + m.b.x) / 2,
          (m.a.y + m.b.y) / 2,
          Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y),
          0.35,
          0.075,
          0.012,
          Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x),
          crossingColors.white,
        );
    }
    for (const [color, boxes] of byColor) {
      const geometry = mergeGeometries(boxes);
      for (const box of boxes) box.dispose();
      this.group.add(new Mesh(geometry, new MeshLambertMaterial({ color })));
    }
  }
}
