import { Container, Graphics, Text } from 'pixi.js';
import type { FurnitureBox } from '../station-furniture';
import { tramStopCounts, type TramStopPlacement } from '../tram-stops';
import { boxCorners, type ViewBounds } from './stations';

/** Tram stops, in the green of a stop sign and the warm paving of an island. */
export const tramStopColors = {
  island: 0xe0ddd2,
  kerb: 0x8c897f,
  tactile: 0xe6d47c,
  rib: 0xbfa84c,
  roof: 0x8e8e93,
  plate: 0x3f7a58,
  screen: 0x26343a,
  screenInk: 0xf3e7bf,
  mark: 0xf4f1e6,
  markEdge: 0x6b7378,
  /** Lettering on the map itself. */
  map: 0x3a3a3c,
};
/** Zoom (pixels per metre) from which each part is drawn. */
const zooms = { island: 1.5, mark: 3, tactile: 4, furniture: 5, label: 12 };
const maxLabels = 12;

/** Text stays upright: a heading pointing left reads from the other end. */
const upright = (heading: number) =>
  heading > Math.PI / 2 || heading <= -Math.PI / 2 ? heading + Math.PI : heading;

interface Label {
  layer: number;
  box: FurnitureBox;
  text: string;
}

export function drawTramStops(placements: readonly TramStopPlacement[]) {
  const grades = new Map<
    number,
    { container: Container; island: Graphics; detail: Graphics; marks: Graphics; labels: Container }
  >();
  const at = (layer: number) => {
    let grade = grades.get(layer);
    if (!grade) {
      const container = new Container(),
        island = new Graphics(),
        marks = new Graphics(),
        detail = new Graphics(),
        labels = new Container();
      container.addChild(island, marks, detail, labels);
      grade = { container, island, detail, marks, labels };
      grades.set(layer, grade);
    }
    return grade;
  };
  const labels: Label[] = [];
  for (const p of placements) {
    const { island, detail, marks } = at(p.layer);
    if (p.ring.length)
      island
        .poly(p.ring)
        .fill(tramStopColors.island)
        .stroke({ color: tramStopColors.kerb, width: 0.16, alpha: 0.9 });
    for (const m of p.marks)
      marks
        .poly(boxCorners(m))
        .fill({ color: tramStopColors.mark, alpha: 0.95 })
        .stroke({ color: tramStopColors.markEdge, width: 0.05, alpha: 0.8 });
    if (p.tactile) {
      detail.poly(p.tactile, false).stroke({ color: tramStopColors.tactile, width: 0.4 });
      // Ribs across the strip every 0.6 m, as the pattern of a guidance strip.
      for (let i = 1; i < p.tactile.length; i++) {
        const a = p.tactile[i - 1]!,
          b = p.tactile[i]!,
          length = Math.hypot(b.x - a.x, b.y - a.y);
        for (let d = 0.3; d < length; d += 0.6) {
          const t = d / length,
            x = a.x + (b.x - a.x) * t,
            y = a.y + (b.y - a.y) * t,
            nx = -(b.y - a.y) / length,
            ny = (b.x - a.x) / length;
          detail
            .moveTo(x - nx * 0.17, y - ny * 0.17)
            .lineTo(x + nx * 0.17, y + ny * 0.17)
            .stroke({ color: tramStopColors.rib, width: 0.06 });
        }
      }
    }
    for (const box of p.shelters) {
      detail
        .poly(boxCorners(box))
        .fill({ color: tramStopColors.roof, alpha: 0.2 })
        .stroke({ color: tramStopColors.roof, width: 0.12, alpha: 0.9 });
      const cos = Math.cos(box.heading),
        sin = Math.sin(box.heading),
        L = box.length / 2,
        W = box.width / 2;
      // Hatching at 45 degrees to the island, clipped to the bay.
      for (let k = -W - L; k <= W + L; k += 0.8) {
        const v0 = Math.max(-W, -L - k),
          v1 = Math.min(W, L - k);
        if (v1 <= v0) continue;
        const world = (u: number, v: number) => ({
          x: box.x + u * cos - v * sin,
          y: box.y + u * sin + v * cos,
        });
        const s = world(v0 + k, v0),
          e = world(v1 + k, v1);
        detail
          .moveTo(s.x, s.y)
          .lineTo(e.x, e.y)
          .stroke({ color: tramStopColors.roof, width: 0.06, alpha: 0.55 });
      }
    }
    for (const b of p.boards) detail.poly(boxCorners(b)).fill(tramStopColors.plate);
    if (p.display)
      detail
        .poly(boxCorners(p.display))
        .fill(tramStopColors.screen)
        .stroke({ color: tramStopColors.screenInk, width: 0.05, alpha: 0.9 });
    if (p.label)
      labels.push({
        layer: p.layer,
        box: p.label,
        text: p.lines.length ? `${p.name}\n${p.lines.join(' · ')}` : p.name,
      });
  }

  const pool: { text: Text; layer: number; shown: string }[] = [];
  const hideFrom = (n: number) => {
    for (let i = n; i < pool.length; i++) pool[i]!.text.visible = false;
  };
  let shown = 0;
  return {
    grades,
    counts: tramStopCounts(placements),
    /** Parts by zoom; the name and lines only of stops in view, at most `maxLabels`. */
    update(zoom: number, view: ViewBounds, visible: boolean) {
      for (const g of grades.values()) {
        g.container.visible = visible;
        g.island.visible = zoom >= zooms.island;
        g.marks.visible = zoom >= zooms.mark;
        g.detail.visible = zoom >= zooms.tactile;
      }
      if (!visible || zoom < zooms.label) {
        hideFrom((shown = 0));
        return;
      }
      const cx = (view.minX + view.maxX) / 2,
        cy = (view.minY + view.maxY) / 2;
      const near = labels
        .filter(
          (l) =>
            l.box.x >= view.minX - 20 &&
            l.box.x <= view.maxX + 20 &&
            l.box.y >= view.minY - 20 &&
            l.box.y <= view.maxY + 20,
        )
        .sort(
          (a, b) => Math.hypot(a.box.x - cx, a.box.y - cy) - Math.hypot(b.box.x - cx, b.box.y - cy),
        )
        .slice(0, maxLabels);
      near.forEach((label, i) => {
        let entry = pool[i];
        if (!entry) {
          const text = new Text({
            text: '',
            style: {
              fontFamily: ['Arimo', 'Arial'],
              fontSize: 48,
              fontWeight: 'bold',
              fill: tramStopColors.map,
              align: 'center',
              lineHeight: 56,
            },
          });
          text.anchor.set(0.5);
          pool.push((entry = { text, layer: NaN, shown: '' }));
        }
        const { text } = entry;
        if (entry.layer !== label.layer) {
          at(label.layer).labels.addChild(text);
          entry.layer = label.layer;
        }
        text.visible = true;
        const key = `${label.box.length}/${label.box.width}/${label.text}`;
        if (entry.shown !== key) {
          text.text = label.text;
          text.scale.set(1);
          text.scale.set(Math.min(label.box.length / text.width, label.box.width / text.height));
          entry.shown = key;
        }
        text.position.set(label.box.x, label.box.y);
        text.rotation = upright(label.box.heading);
      });
      hideFrom((shown = near.length));
    },
    get labelCount() {
      return shown;
    },
  };
}
