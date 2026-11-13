import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RailGraph } from '../network/rail';
import type { TrainTimetable } from '../network/trains';
import { stationColors } from '../render/layers/stations';
import {
  departureDisplay,
  furnitureCounts,
  furnitureSize,
  type FurnitureBox,
  type PlatformFurniture,
  type StationFurniture,
} from '../render/station-furniture';
import type { cityHeights } from './heights';

/** A display redraws at most once per this many simulated seconds. */
export const displayRefreshS = 30;
export const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const dims = {
  boardHeight: 0.8,
  boardCentre: 2.0,
  displayHeight: 2,
  displayCentre: 2.8,
  /** Posts are thinner than the panels they carry, so they never show through a face. */
  postM: 0.12,
  panelM: 0.2,
  roofM: 3,
  roofThickness: 0.18,
  entrance: { length: 3, height: 1.6, centre: 3.0 },
};
export type CreateCanvas = (width: number, height: number) => HTMLCanvasElement;
export const documentCanvas: CreateCanvas = (width, height) =>
  Object.assign(document.createElement('canvas'), { width, height });

/** Fit `text` on one line of at most `width` pixels, from `size` px down. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  size: number,
  width: number,
) {
  ctx.font = font.replace('{}', String(size));
  const wide = ctx.measureText(text).width;
  const fitted = wide > width ? Math.floor((size * width) / wide) : size;
  ctx.font = font.replace('{}', String(fitted));
}

function boardTexture(create: CreateCanvas, name: string) {
  const canvas = create(1024, 186),
    ctx = canvas.getContext('2d')!;
  ctx.fillStyle = hex(stationColors.plate);
  ctx.fillRect(0, 0, 1024, 186);
  ctx.strokeStyle = hex(stationColors.ink);
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 1004, 166);
  ctx.fillStyle = hex(stationColors.ink);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, name, 'bold {}px Arimo, Arial, sans-serif', 112, 930);
  ctx.fillText(name, 512, 96);
  return canvasTexture(canvas);
}

/** A generic rail-station sign: a train seen from the front above the station's name. */
function entranceTexture(create: CreateCanvas, name: string) {
  const canvas = create(600, 320),
    ctx = canvas.getContext('2d')!;
  ctx.fillStyle = hex(stationColors.plate);
  ctx.fillRect(0, 0, 600, 320);
  ctx.strokeStyle = hex(stationColors.ink);
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 580, 300);
  ctx.fillStyle = hex(stationColors.ink);
  ctx.beginPath();
  ctx.roundRect(255, 30, 90, 110, 18);
  ctx.fill();
  ctx.fillStyle = hex(stationColors.plate);
  ctx.fillRect(266, 46, 30, 36);
  ctx.fillRect(304, 46, 30, 36);
  ctx.beginPath();
  ctx.arc(272, 112, 7, 0, Math.PI * 2);
  ctx.arc(328, 112, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hex(stationColors.ink);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(270, 150);
  ctx.lineTo(244, 180);
  ctx.moveTo(330, 150);
  ctx.lineTo(356, 180);
  ctx.stroke();
  ctx.fillStyle = hex(stationColors.ink);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, name, 'bold {}px Arimo, Arial, sans-serif', 64, 540);
  ctx.fillText(name, 300, 244);
  return canvasTexture(canvas);
}

export function canvasTexture(canvas: HTMLCanvasElement) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function drawDisplay(canvas: HTMLCanvasElement, header: string, rows: readonly string[]) {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = hex(stationColors.screen);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '38px monospace';
  ctx.fillStyle = '#9fb8b2';
  ctx.fillText(header, 48, 42);
  ctx.font = '54px monospace';
  ctx.fillStyle = hex(stationColors.screenInk);
  rows.forEach((row, i) => ctx.fillText(row, 48, 106 + i * 62));
}

export class Stations3D {
  readonly group = new Group();
  readonly posts: InstancedMesh;
  readonly roofs: InstancedMesh;
  readonly benches: InstancedMesh;
  readonly bins: InstancedMesh;
  /** Name boards and entrance signs, one instanced mesh per station name. */
  readonly panels: InstancedMesh[] = [];
  readonly displays: StationDisplay[] = [];
  readonly furnitureCounts: ReturnType<typeof furnitureCounts>;
  /** Display redraws since construction. */
  drawCount = 0;
  private bucket = 0;
  private readonly textures = new Map<string, CanvasTexture>();
  private readonly edge = new MeshLambertMaterial({ color: 0x7d8b86 });

  constructor(
    furniture: StationFurniture,
    private readonly rail: RailGraph,
    private readonly table: TrainTimetable,
    private readonly heights: ReturnType<typeof cityHeights>,
    create: CreateCanvas = documentCanvas,
  ) {
    this.furnitureCounts = furnitureCounts(furniture);
    const object = new Object3D();
    const place = (
      mesh: InstancedMesh,
      i: number,
      x: number,
      y: number,
      z: number,
      rotationY: number,
      sx: number,
      sy: number,
      sz: number,
    ) => {
      object.position.set(x, y, z);
      object.rotation.set(0, rotationY, 0);
      object.scale.set(sx, sy, sz);
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
    };
    const ground = (x: number, y: number, layer: number) =>
      this.heights.terrain.groundAt(x, y) + layer * 5 + 0.06;

    type Post = { x: number; y: number; layer: number; height: number; heading: number };
    const posts: Post[] = [],
      roofs: { box: FurnitureBox; layer: number }[] = [],
      benches: { box: FurnitureBox; layer: number }[] = [],
      bins: { box: FurnitureBox; layer: number }[] = [];
    const panels = new Map<
      string,
      {
        name: string;
        entrance: boolean;
        items: { x: number; y: number; layer: number; rotation: number }[];
      }
    >();
    const panel = (name: string, entrance: boolean) => {
      const key = `${entrance ? 'entrance' : 'board'}/${name}`;
      if (!panels.has(key)) panels.set(key, { name, entrance, items: [] });
      return panels.get(key)!.items;
    };
    const seen = new Set<string>();
    const addPost = (p: Post) => {
      const key = `${p.layer}/${Math.round(p.x * 10)}/${Math.round(p.y * 10)}/${p.height}`;
      if (!seen.has(key)) {
        seen.add(key);
        posts.push(p);
      }
    };
    /** Offsets from a box centre: `u` along its heading, `v` across it. */
    const corner = (b: FurnitureBox, u: number, v: number) => ({
      x: b.x + u * Math.cos(b.heading) - v * Math.sin(b.heading),
      y: b.y + u * Math.sin(b.heading) + v * Math.cos(b.heading),
    });
    const displays: { p: PlatformFurniture; box: FurnitureBox }[] = [];
    for (const p of furniture.platforms) {
      for (const box of p.boards) {
        panel(p.name, false).push({ x: box.x, y: box.y, layer: p.layer, rotation: -box.heading });
        for (const u of [-1, 1])
          addPost({
            ...corner(box, (u * (box.length - 0.8)) / 2, 0),
            layer: p.layer,
            height: dims.boardCentre + dims.boardHeight / 2,
            heading: box.heading,
          });
      }
      for (const { box, mapped } of p.shelters) {
        if (!mapped) roofs.push({ box, layer: p.layer });
        for (const u of [-1, 1])
          for (const v of [-1, 1])
            addPost({
              ...corner(box, (u * (box.length - 0.2)) / 2, (v * (box.width - 0.3)) / 2),
              layer: p.layer,
              height: dims.roofM,
              heading: box.heading,
            });
      }
      for (const box of p.benches) benches.push({ box, layer: p.layer });
      for (const box of p.bins) bins.push({ box, layer: p.layer });
      if (p.display) {
        displays.push({ p, box: p.display });
        for (const u of [-1, 1])
          addPost({
            ...corner(p.display, u * (p.display.length / 2 - 0.5), 0),
            layer: p.layer,
            height: dims.displayCentre + dims.displayHeight / 2,
            heading: p.display.heading,
          });
      }
    }
    for (const e of furniture.entrances) {
      panel(e.name, true).push({
        x: e.x,
        y: e.y,
        layer: e.layer,
        rotation: Math.PI / 2 - e.facing,
      });
      addPost({
        x: e.x,
        y: e.y,
        layer: e.layer,
        height: dims.entrance.centre + dims.entrance.height / 2,
        heading: 0,
      });
    }

    const lambert = (color: number) => new MeshLambertMaterial({ color });
    this.posts = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      lambert(0x8b9792),
      Math.max(1, posts.length),
    );
    posts.forEach((p, i) =>
      place(
        this.posts,
        i,
        p.x,
        ground(p.x, p.y, p.layer) + p.height / 2,
        p.y,
        -p.heading,
        dims.postM,
        p.height,
        dims.postM,
      ),
    );
    this.posts.count = posts.length;
    this.roofs = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      lambert(0xaab7b2),
      Math.max(1, roofs.length),
    );
    roofs.forEach(({ box, layer }, i) =>
      place(
        this.roofs,
        i,
        box.x,
        ground(box.x, box.y, layer) + dims.roofM + dims.roofThickness / 2,
        box.y,
        -box.heading,
        box.length,
        dims.roofThickness,
        box.width,
      ),
    );
    this.roofs.count = roofs.length;

    const bench = (w: number, h: number, d: number, x: number, y: number, z: number) =>
      new BoxGeometry(w, h, d).translate(x, y, z);
    const { length: bl, width: bw } = furnitureSize.bench;
    const benchGeometry = mergeGeometries([
      bench(bl, 0.07, bw, 0, 0.45, 0),
      bench(bl, 0.4, 0.06, 0, 0.72, -bw / 2 + 0.03),
      bench(0.08, 0.45, bw - 0.1, -bl / 2 + 0.2, 0.22, 0),
      bench(0.08, 0.45, bw - 0.1, bl / 2 - 0.2, 0.22, 0),
    ])!;
    this.benches = new InstancedMesh(benchGeometry, lambert(0xb59a76), Math.max(1, benches.length));
    benches.forEach(({ box, layer }, i) =>
      place(this.benches, i, box.x, ground(box.x, box.y, layer), box.y, -box.heading, 1, 1, 1),
    );
    this.benches.count = benches.length;
    this.bins = new InstancedMesh(
      new CylinderGeometry(0.24, 0.2, 0.9, 10).translate(0, 0.45, 0),
      lambert(0x5f7b6f),
      Math.max(1, bins.length),
    );
    bins.forEach(({ box, layer }, i) =>
      place(this.bins, i, box.x, ground(box.x, box.y, layer), box.y, 0, 1, 1, 1),
    );
    this.bins.count = bins.length;
    // A kind with no instances costs no draw call.
    for (const mesh of [this.posts, this.roofs, this.benches, this.bins])
      if (mesh.count) this.group.add(mesh);

    for (const { name, entrance, items } of panels.values()) {
      const key = `${entrance ? 'entrance' : 'board'}/${name}`;
      if (!this.textures.has(key))
        this.textures.set(key, (entrance ? entranceTexture : boardTexture)(create, name));
      const face = new MeshBasicMaterial({ map: this.textures.get(key)! });
      const size = entrance
        ? { w: dims.entrance.length, h: dims.entrance.height, centre: dims.entrance.centre }
        : { w: furnitureSize.board.length, h: dims.boardHeight, centre: dims.boardCentre };
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
      const mesh = new InstancedMesh(
        new BoxGeometry(1, 1, 1),
        [this.edge, this.edge, this.edge, this.edge, face, face],
        items.length,
      );
      items.forEach((it, i) =>
        place(
          mesh,
          i,
          it.x,
          ground(it.x, it.y, it.layer) + size.centre,
          it.y,
          it.rotation,
          size.w,
          size.h,
          dims.panelM,
        ),
      );
      this.panels.push(mesh);
      this.group.add(mesh);
    }

    for (const { p, box } of displays) {
      const canvas = create(800, 300);
      const texture = canvasTexture(canvas);
      const face = new MeshBasicMaterial({ map: texture });
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), [
        this.edge,
        this.edge,
        this.edge,
        this.edge,
        face,
        face,
      ]);
      mesh.scale.set(furnitureSize.display.length, dims.displayHeight, dims.panelM);
      mesh.position.set(box.x, ground(box.x, box.y, p.layer) + dims.displayCentre, box.y);
      mesh.rotation.y = -box.heading;
      const display = new StationDisplay(this, canvas, texture, p.platform, mesh);
      // Only a display in view repaints: three calls this just before drawing the mesh.
      mesh.onBeforeRender = () => display.refresh(this.bucket);
      this.displays.push(display);
      this.group.add(mesh);
    }
    for (const mesh of [this.posts, this.roofs, this.benches, this.bins, ...this.panels])
      mesh.computeBoundingSphere();
  }

  private reported = '';
  /** Test hook: publish the displays' text and repaint count on the canvas, only when they change. */
  report(canvas: HTMLCanvasElement, visible: boolean) {
    const text = JSON.stringify([visible ? this.displays.map((d) => d.text) : [], this.drawCount]);
    if (text === this.reported) return;
    this.reported = text;
    canvas.dataset.stationDisplays = JSON.stringify(
      visible ? this.displays.map((d) => d.text) : [],
    );
    canvas.dataset.stationDisplayDraws = String(this.drawCount);
  }

  /** Move the displays' clock: their text changes at most once per `displayRefreshS`. */
  update(timeS: number) {
    this.bucket = Math.floor(timeS / displayRefreshS);
  }

  get counts() {
    return {
      posts: this.posts.count,
      roofs: this.roofs.count,
      benches: this.benches.count,
      bins: this.bins.count,
      panels: this.panels.reduce((n, m) => n + m.count, 0),
      displays: this.displays.length,
    };
  }

  /** @internal used by StationDisplay */
  content(platform: string, bucket: number) {
    return departureDisplay(this.rail, this.table, platform, bucket * displayRefreshS);
  }
}

export class StationDisplay {
  private drawn = NaN;
  private shown = '';
  constructor(
    private readonly owner: Stations3D,
    readonly canvas: HTMLCanvasElement,
    readonly texture: CanvasTexture,
    readonly platform: string,
    readonly mesh: Mesh,
  ) {}
  /** What the display last drew. */
  get text() {
    return this.shown;
  }
  /** Repaint for the 30 s bucket `bucket`, unless it is the bucket already drawn. */
  refresh(bucket: number) {
    if (bucket === this.drawn) return;
    this.drawn = bucket;
    const { header, rows } = this.owner.content(this.platform, bucket);
    const text = [header, ...rows].join('\n');
    if (text === this.shown) return;
    this.shown = text;
    drawDisplay(this.canvas, header, rows);
    this.texture.needsUpdate = true;
    this.owner.drawCount++;
  }
}
