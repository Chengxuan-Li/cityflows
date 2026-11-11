import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  ShapeUtils,
  Vector2,
} from 'three';
import { boxCorners } from '../render/layers/stations';
import { tramStopColors } from '../render/layers/tram-stops';
import type { FurnitureBox } from '../render/station-furniture';
import { tramStopCounts, tramStopSize, type TramStopPlacement } from '../render/tram-stops';
import type { cityHeights } from './heights';
import { canvasTexture, documentCanvas, fitText, hex, type CreateCanvas } from './stations';

const dims = {
  /** Posts are thinner than the panels they carry, so they never show through a face. */
  postM: 0.1,
  panelM: 0.12,
  boardHeight: 0.5,
  boardCentre: 2.2,
  displayHeight: 0.8,
  displayCentre: 1.9,
  roofM: 2.7,
  roofThickness: 0.12,
  glassHeight: 1.9,
  /** Paint stands over the island top and the track bed by these heights. */
  tactileLift: 0.015,
  ribLift: 0.025,
  markBed: 0.145,
  markStreet: 0.075,
};
const lineLabel = (lines: readonly string[]) => lines.join('  ');

function boardTexture(create: CreateCanvas, name: string) {
  const canvas = create(1024, 284),
    ctx = canvas.getContext('2d')!;
  ctx.fillStyle = hex(tramStopColors.plate);
  ctx.fillRect(0, 0, 1024, 284);
  ctx.strokeStyle = hex(0xf7f4e8);
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, 1000, 260);
  ctx.fillStyle = hex(0xf7f4e8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, name, 'bold {}px Arial, sans-serif', 150, 920);
  ctx.fillText(name, 512, 144);
  return canvasTexture(canvas);
}

/** The stop's name above its lines as small green chips, on a dark screen. */
function displayTexture(create: CreateCanvas, name: string, lines: readonly string[]) {
  const canvas = create(600, 400),
    ctx = canvas.getContext('2d')!;
  ctx.fillStyle = hex(tramStopColors.screen);
  ctx.fillRect(0, 0, 600, 400);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hex(tramStopColors.screenInk);
  fitText(ctx, name, 'bold {}px monospace', 64, 540);
  ctx.fillText(name, 300, 110);
  const chip = 112,
    gap = 20,
    shown = lines.slice(0, 4);
  const left = 300 - (shown.length * chip + (shown.length - 1) * gap) / 2;
  shown.forEach((line, i) => {
    const x = left + i * (chip + gap);
    ctx.fillStyle = hex(tramStopColors.plate);
    ctx.beginPath();
    ctx.roundRect(x, 210, chip, 100, 22);
    ctx.fill();
    ctx.fillStyle = hex(0xf7f4e8);
    fitText(ctx, line, 'bold {}px Arial, sans-serif', 60, chip - 16);
    ctx.fillText(line, x + chip / 2, 262);
  });
  return canvasTexture(canvas);
}

/**
 * TASK-137: tram stops in 3D. Islands (raised 0.25 m, kerb sides a shade darker), their tactile
 * strips and the markings across the tracks are one vertex-coloured mesh; posts, canopies, glass
 * and panels are instanced, one mesh per kind, a panel mesh per name board or display text.
 */
export class TramStops3D {
  readonly group = new Group();
  readonly paint: Mesh;
  readonly posts: InstancedMesh;
  readonly roofs: InstancedMesh;
  readonly glass: InstancedMesh;
  readonly panels: InstancedMesh[] = [];
  readonly counts: ReturnType<typeof tramStopCounts>;
  /** The text of every board and display, for tests. */
  readonly texts: string[] = [];
  private readonly textures = new Map<string, CanvasTexture>();

  constructor(
    placements: readonly TramStopPlacement[],
    heights: ReturnType<typeof cityHeights>,
    create: CreateCanvas = documentCanvas,
  ) {
    this.counts = tramStopCounts(placements);
    const grade = (x: number, y: number, layer: number) =>
      heights.terrain.groundAt(x, y) + layer * 5;
    const positions: number[] = [],
      colors: number[] = [];
    const color = new Color();
    const tri = (pts: [number, number, number][], hex: number, shade = 1) => {
      color.setHex(hex).multiplyScalar(shade);
      for (const p of pts) {
        positions.push(...p);
        colors.push(color.r, color.g, color.b);
      }
    };
    const quad = (pts: [number, number, number][], hex: number, shade = 1) => {
      tri([pts[0]!, pts[1]!, pts[2]!], hex, shade);
      tri([pts[0]!, pts[2]!, pts[3]!], hex, shade);
    };
    const { islandM } = tramStopSize;

    type Post = { x: number; y: number; layer: number; height: number };
    const posts: Post[] = [],
      roofs: { box: FurnitureBox; layer: number }[] = [],
      glass: { box: FurnitureBox; layer: number; back: number }[] = [];
    const panels = new Map<
      string,
      {
        name: string;
        display: boolean;
        items: { x: number; y: number; layer: number; box: FurnitureBox }[];
      }
    >();
    const panel = (key: string, display: boolean, name: string) => {
      if (!panels.has(key)) panels.set(key, { name, display, items: [] });
      return panels.get(key)!.items;
    };
    /** Offsets from a box centre: `u` along its heading, `v` across it. */
    const corner = (b: FurnitureBox, u: number, v: number) => ({
      x: b.x + u * Math.cos(b.heading) - v * Math.sin(b.heading),
      y: b.y + u * Math.sin(b.heading) + v * Math.cos(b.heading),
    });
    const lines = new Map<string, readonly string[]>();

    for (const p of placements) {
      if (p.ring.length) {
        const ring = p.ring.slice(0, -1);
        const top = (v: { x: number; y: number }, lift = 0): [number, number, number] => [
          v.x,
          grade(v.x, v.y, p.layer) + islandM + lift,
          v.y,
        ];
        const foot = (v: { x: number; y: number }): [number, number, number] => [
          v.x,
          grade(v.x, v.y, p.layer),
          v.y,
        ];
        const contour = ring.map((v) => new Vector2(v.x, v.y));
        for (const [a, b, c] of ShapeUtils.triangulateShape(contour, []))
          tri([top(ring[a!]!), top(ring[b!]!), top(ring[c!]!)], tramStopColors.island);
        // Kerbs: a shade darker than the top, like the sides of the tram beds.
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!,
            b = ring[(i + 1) % ring.length]!;
          quad([top(a), top(b), foot(b), foot(a)], tramStopColors.island, 0.72);
        }
        if (p.tactile) {
          const half = tramStopSize.tactileWidthM / 2;
          for (let i = 1; i < p.tactile.length; i++) {
            const a = p.tactile[i - 1]!,
              b = p.tactile[i]!,
              length = Math.hypot(b.x - a.x, b.y - a.y);
            const nx = (-(b.y - a.y) / length) * half,
              ny = ((b.x - a.x) / length) * half;
            quad(
              [
                top({ x: a.x - nx, y: a.y - ny }, dims.tactileLift),
                top({ x: b.x - nx, y: b.y - ny }, dims.tactileLift),
                top({ x: b.x + nx, y: b.y + ny }, dims.tactileLift),
                top({ x: a.x + nx, y: a.y + ny }, dims.tactileLift),
              ],
              tramStopColors.tactile,
            );
            for (let d = 0.3; d < length; d += 0.6) {
              const t = d / length,
                x = a.x + (b.x - a.x) * t,
                y = a.y + (b.y - a.y) * t,
                ux = ((b.x - a.x) / length) * 0.03,
                uy = ((b.y - a.y) / length) * 0.03;
              quad(
                [
                  top({ x: x - nx - ux, y: y - ny - uy }, dims.ribLift),
                  top({ x: x - nx + ux, y: y - ny + uy }, dims.ribLift),
                  top({ x: x + nx + ux, y: y + ny + uy }, dims.ribLift),
                  top({ x: x + nx - ux, y: y + ny - uy }, dims.ribLift),
                ],
                tramStopColors.rib,
              );
            }
          }
        }
      }
      for (const m of p.marks) {
        const lift = m.embedded ? dims.markStreet : dims.markBed;
        quad(
          boxCorners(m).map(
            (v) => [v.x, grade(v.x, v.y, p.layer) + lift, v.y] as [number, number, number],
          ),
          tramStopColors.mark,
        );
      }
      for (const box of p.boards) {
        const key = `board/${p.name}`;
        panel(key, false, p.name).push({ x: box.x, y: box.y, layer: p.layer, box });
        for (const u of [-1, 1])
          posts.push({
            ...corner(box, (u * (box.length - 0.4)) / 2, 0),
            layer: p.layer,
            height: dims.boardCentre + dims.boardHeight / 2,
          });
      }
      if (p.display) {
        const key = `display/${p.name}/${lineLabel(p.lines)}`;
        lines.set(key, p.lines);
        panel(key, true, p.name).push({
          x: p.display.x,
          y: p.display.y,
          layer: p.layer,
          box: p.display,
        });
        for (const u of [-1, 1])
          posts.push({
            ...corner(p.display, (u * (p.display.length - 0.2)) / 2, 0),
            layer: p.layer,
            height: dims.displayCentre + dims.displayHeight / 2,
          });
      }
      for (const box of p.shelters) {
        roofs.push({ box, layer: p.layer });
        glass.push({ box, layer: p.layer, back: p.back });
        for (const u of [-1, 1])
          for (const v of [-1, 1])
            posts.push({
              ...corner(box, (u * (box.length - 0.2)) / 2, (v * (box.width - 0.2)) / 2),
              layer: p.layer,
              height: dims.roofM,
            });
      }
    }

    const geometry = new BufferGeometry()
      .setAttribute('position', new Float32BufferAttribute(positions, 3))
      .setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.paint = new Mesh(
      geometry,
      new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
    );
    if (positions.length) this.group.add(this.paint);

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
    const level = (x: number, y: number, layer: number) => grade(x, y, layer) + islandM;
    const lambert = (hex: number) => new MeshLambertMaterial({ color: hex });
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
        level(p.x, p.y, p.layer) + p.height / 2,
        p.y,
        0,
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
        level(box.x, box.y, layer) + dims.roofM + dims.roofThickness / 2,
        box.y,
        -box.heading,
        box.length + 0.2,
        dims.roofThickness,
        box.width + 0.2,
      ),
    );
    this.roofs.count = roofs.length;
    // A glass back wall, as most Munich shelters have.
    this.glass = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({
        color: 0xbcd5d1,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
      Math.max(1, glass.length),
    );
    glass.forEach(({ box, layer, back }, i) => {
      const at = corner(box, 0, (back * (box.width - 0.04)) / 2);
      place(
        this.glass,
        i,
        at.x,
        level(at.x, at.y, layer) + 0.1 + dims.glassHeight / 2,
        at.y,
        -box.heading,
        box.length - 0.3,
        dims.glassHeight,
        0.04,
      );
    });
    this.glass.count = glass.length;
    for (const mesh of [this.posts, this.roofs, this.glass]) if (mesh.count) this.group.add(mesh);

    const edge = lambert(0x7d8b86);
    for (const [key, { name, display, items }] of panels) {
      if (!this.textures.has(key))
        this.textures.set(
          key,
          display ? displayTexture(create, name, lines.get(key)!) : boardTexture(create, name),
        );
      this.texts.push(display ? `${name}\n${lineLabel(lines.get(key)!)}` : name);
      const face = new MeshBasicMaterial({ map: this.textures.get(key)! });
      const size = display
        ? { w: tramStopSize.display.length, h: dims.displayHeight, centre: dims.displayCentre }
        : { w: tramStopSize.board.length, h: dims.boardHeight, centre: dims.boardCentre };
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
      const mesh = new InstancedMesh(
        new BoxGeometry(1, 1, 1),
        [edge, edge, edge, edge, face, face],
        items.length,
      );
      items.forEach((it, i) =>
        place(
          mesh,
          i,
          it.x,
          level(it.x, it.y, it.layer) + size.centre,
          it.y,
          -it.box.heading,
          size.w,
          size.h,
          dims.panelM,
        ),
      );
      this.panels.push(mesh);
      this.group.add(mesh);
    }
    for (const mesh of [this.posts, this.roofs, this.glass, ...this.panels])
      mesh.computeBoundingSphere();
  }
}
