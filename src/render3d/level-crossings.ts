import { BoxGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LevelCrossing } from '../network/level-crossings';
import type { RailGraph } from '../network/rail';
import {
  crossingAspect,
  crossingColors,
  crossingCounts,
  crossingDrawings,
  tramCrossingSignals,
} from '../render/level-crossings';
import type { cityHeights } from './heights';

export class LevelCrossings3D {
  readonly group = new Group();
  readonly counts: ReturnType<typeof crossingCounts>;
  private readonly variants: Group[][] = [];
  constructor(
    private readonly facilities: readonly LevelCrossing[],
    heights: ReturnType<typeof cityHeights>,
    rail?: RailGraph,
  ) {
    this.counts = crossingCounts(facilities);
    for (const facility of facilities) {
      const appearances: Group[] = [];
      this.variants.push(appearances);
      const signals = tramCrossingSignals(facility, rail);
      for (let aspect = 0; aspect < (facility.kind === 'tram' ? 7 : 5); aspect++) {
        const group = new Group();
        group.visible = aspect === 0;
        appearances.push(group);
        this.group.add(group);
        const byColor = new Map<number, BoxGeometry[]>();
        const d = crossingDrawings(
          [facility],
          new Uint8Array([Math.min(2, Math.ceil(aspect / 2))]),
          ((aspect + 1) % 2) / 2,
          new Uint8Array([aspect >= 5 ? 1 : 0]),
          [signals],
        )[0]!;
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
        for (const [color, boxes] of byColor) {
          const geometry = mergeGeometries(boxes);
          for (const box of boxes) box.dispose();
          group.add(
            new Mesh(
              geometry,
              new MeshLambertMaterial({
                color,
                emissive: color === crossingColors.lit || color === crossingColors.tram ? color : 0,
                emissiveIntensity: 0.7,
              }),
            ),
          );
        }
      }
    }
  }
  setSnapshot(states?: Uint8Array, timeS = 0, railReady?: Uint8Array) {
    this.variants.forEach((appearances, i) => {
      const active = crossingAspect(
        states?.[i] ?? 0,
        timeS,
        this.facilities[i]!.kind === 'tram' && railReady?.[i] === 1,
      );
      appearances.forEach((group, aspect) => {
        group.visible = aspect === active;
      });
    });
  }
}
