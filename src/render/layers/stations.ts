import { Container, Graphics, Text } from 'pixi.js';
import type { Vec2 } from '../../geo/vec2';
import type { RailGraph } from '../../network/rail';
import type { TrainTimetable } from '../../network/trains';
import {
  departureDisplay,
  furnitureCounts,
  type FurnitureBox,
  type StationFurniture,
} from '../station-furniture';

/** Generic station colours: the teal of the station disc, with white lettering. */
export const stationColors = {
  plate: 0x587f77,
  ink: 0xf8f6ef,
  screen: 0x26343a,
  screenInk: 0xf3e7bf,
  roof: 0x8e8e93,
  bench: 0xb59a76,
  bin: 0x6b8579,
  /** Lettering on the map itself. */
  map: 0x3a3a3c,
};
const zooms = { base: 1.5, small: 4, board: 10, display: 12, entrance: 6 };
const maxLabels = 24;
export interface ViewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boxCorners(b: FurnitureBox): Vec2[] {
  const c = Math.cos(b.heading),
    s = Math.sin(b.heading);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) => ({
    x: b.x + (i! * b.length * c) / 2 - (j! * b.width * s) / 2,
    y: b.y + (i! * b.length * s) / 2 + (j! * b.width * c) / 2,
  }));
}
/** Text stays upright: a heading pointing left reads from the other end. */
const upright = (heading: number) =>
  heading > Math.PI / 2 || heading <= -Math.PI / 2 ? heading + Math.PI : heading;

interface Label {
  layer: number;
  x: number;
  y: number;
  rotation: number;
  /** The text is fitted inside this many metres. */
  maxW: number;
  maxH: number;
  minZoom: number;
  anchorTop: boolean;
  style: 'plate' | 'screen' | 'map';
  text: (timeS: number) => string;
}

function screenText(rail: RailGraph, table: TrainTimetable, platform: string, timeS: number) {
  const { header, rows } = departureDisplay(rail, table, platform, timeS);
  return [header, ...rows].join('\n');
}

export function drawStations(furniture: StationFurniture, rail: RailGraph, table: TrainTimetable) {
  const grades = new Map<
    number,
    { container: Container; small: Graphics; base: Graphics; labels: Container }
  >();
  const at = (layer: number) => {
    let grade = grades.get(layer);
    if (!grade) {
      const container = new Container(),
        small = new Graphics(),
        base = new Graphics(),
        labels = new Container();
      container.addChild(small, base, labels);
      grade = { container, small, base, labels };
      grades.set(layer, grade);
    }
    return grade;
  };
  const labels: Label[] = [];
  for (const p of furniture.platforms) {
    const { small, base } = at(p.layer);
    for (const b of p.benches) small.poly(boxCorners(b)).fill(stationColors.bench);
    for (const b of p.bins) small.circle(b.x, b.y, b.length / 2).fill(stationColors.bin);
    for (const { box } of p.shelters) {
      base
        .poly(boxCorners(box))
        .fill({ color: stationColors.roof, alpha: 0.18 })
        .stroke({ color: stationColors.roof, width: 0.14, alpha: 0.9 });
      // Hatching at 45 degrees to the platform, clipped to the bay.
      const cos = Math.cos(box.heading),
        sin = Math.sin(box.heading),
        L = box.length / 2,
        W = box.width / 2;
      for (let k = -W - L; k <= W + L; k += 1) {
        const v0 = Math.max(-W, -L - k),
          v1 = Math.min(W, L - k);
        if (v1 <= v0) continue;
        const world = (u: number, v: number) => ({
          x: box.x + u * cos - v * sin,
          y: box.y + u * sin + v * cos,
        });
        const s = world(v0 + k, v0),
          e = world(v1 + k, v1);
        base
          .moveTo(s.x, s.y)
          .lineTo(e.x, e.y)
          .stroke({ color: stationColors.roof, width: 0.07, alpha: 0.55 });
      }
    }
    for (const b of p.boards) {
      base.poly(boxCorners(b)).fill(stationColors.plate);
      labels.push({
        layer: p.layer,
        x: b.x,
        y: b.y,
        rotation: upright(b.heading),
        maxW: b.length - 0.5,
        maxH: b.width - 0.3,
        minZoom: zooms.board,
        anchorTop: false,
        style: 'plate',
        text: () => p.name,
      });
    }
    if (p.display) {
      const d = p.display;
      base.poly(boxCorners(d)).fill(stationColors.screen);
      labels.push({
        layer: p.layer,
        x: d.x,
        y: d.y,
        rotation: upright(d.heading),
        maxW: d.length - 0.5,
        maxH: d.width - 0.3,
        minZoom: zooms.display,
        anchorTop: false,
        style: 'screen',
        text: (timeS) => screenText(rail, table, p.platform, timeS),
      });
    }
  }
  for (const e of furniture.entrances) {
    const { base } = at(e.layer);
    base.roundRect(e.x - 1, e.y - 1, 2, 2, 0.35).fill(stationColors.plate);
    // A train seen from the front: body, two windows, two lamps, two rails.
    base.roundRect(e.x - 0.7, e.y - 0.85, 1.4, 1.3, 0.25).fill(stationColors.ink);
    for (const x of [-0.6, 0.1]) base.rect(e.x + x, e.y - 0.6, 0.5, 0.4).fill(stationColors.plate);
    for (const u of [-0.4, 0.4]) base.circle(e.x + u, e.y + 0.18, 0.11).fill(stationColors.plate);
    for (const u of [-1, 1])
      base
        .moveTo(e.x + u * 0.45, e.y + 0.6)
        .lineTo(e.x + u * 0.8, e.y + 1)
        .stroke({ color: stationColors.ink, width: 0.12 });
    labels.push({
      layer: e.layer,
      x: e.x,
      y: e.y + 1.5,
      rotation: 0,
      maxW: 12,
      maxH: 0.9,
      minZoom: zooms.entrance,
      anchorTop: true,
      style: 'map',
      text: () => e.name,
    });
  }

  const pool: { text: Text; layer: number; shown: string }[] = [];
  const hideFrom = (n: number) => {
    for (let i = n; i < pool.length; i++) pool[i]!.text.visible = false;
  };
  let shown = 0;
  return {
    grades,
    counts: furnitureCounts(furniture),
    /** Symbols by zoom; text only for labels in view, at most `maxLabels` of them. */
    update(zoom: number, view: ViewBounds, timeS: number, visible: boolean) {
      for (const g of grades.values()) {
        g.container.visible = visible;
        g.base.visible = zoom >= zooms.base;
        g.small.visible = zoom >= zooms.small;
      }
      if (!visible) {
        hideFrom((shown = 0));
        return;
      }
      const cx = (view.minX + view.maxX) / 2,
        cy = (view.minY + view.maxY) / 2;
      const near = labels
        .filter(
          (l) =>
            zoom >= l.minZoom &&
            l.x >= view.minX - 10 &&
            l.x <= view.maxX + 10 &&
            l.y >= view.minY - 10 &&
            l.y <= view.maxY + 10,
        )
        .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
        .slice(0, maxLabels);
      near.forEach((label, i) => {
        let entry = pool[i];
        if (!entry) {
          const text = new Text({
            text: '',
            style: { fontFamily: ['Arimo', 'Arial'], fontSize: 48 },
          });
          pool.push((entry = { text, layer: NaN, shown: '' }));
        }
        const { text } = entry;
        if (entry.layer !== label.layer) {
          at(label.layer).labels.addChild(text);
          entry.layer = label.layer;
        }
        const content = label.text(timeS),
          key = `${label.style}/${label.maxW}/${label.maxH}/${content}`;
        text.visible = true;
        text.anchor.set(0.5, label.anchorTop ? 0 : 0.5);
        if (entry.shown !== key) {
          const screen = label.style === 'screen';
          text.style.fontFamily = screen ? 'monospace' : ['Arimo', 'Arial'];
          text.style.fontWeight = screen ? 'normal' : 'bold';
          text.style.fontSize = screen ? 40 : 48;
          text.style.fill = screen
            ? stationColors.screenInk
            : label.style === 'map'
              ? stationColors.map
              : stationColors.ink;
          text.style.lineHeight = screen ? 46 : 0;
          text.text = content;
          text.scale.set(1);
          const fit = Math.min(label.maxW / text.width, label.maxH / text.height);
          entry.shown = key;
          text.scale.set(fit);
        }
        text.position.set(label.x, label.y);
        text.rotation = label.rotation;
      });
      hideFrom((shown = near.length));
    },
    /** What each platform's display shows at `timeS` (for tests). */
    displayTexts(timeS: number) {
      return furniture.platforms
        .filter((p) => p.display)
        .map((p) => screenText(rail, table, p.platform, timeS));
    },
    get labelCount() {
      return shown;
    },
  };
}
