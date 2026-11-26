import {
  CanvasTexture,
  DoubleSide,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import type { City } from '../../src/schema';

// Capture layer: glass-walled buildings below `towerHeight` (the surfaces layer's towers start
// there) take a curtain wall: mullions, storey bands and panes lit after dark.

export const params = { towerHeight: 38 };

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function curtainTextures() {
  const cells = 16,
    w = 32,
    h = 48;
  const make = (paint: (g: CanvasRenderingContext2D, i: number, j: number) => void) => {
    const canvas = Object.assign(document.createElement('canvas'), {
      width: cells * w,
      height: cells * h,
    });
    const g = canvas.getContext('2d')!;
    for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) paint(g, i, j);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 16;
    return texture;
  };
  // A pane spans 92 % of its width (the terminal's 0.04 to 0.96) and its storey less 0.35 m.
  const pane = (g: CanvasRenderingContext2D, i: number, j: number) =>
    g.fillRect(i * w + w * 0.04, j * h + h * 0.09, w * 0.92, h * 0.91);
  const map = make((g, i, j) => {
    g.fillStyle = '#d6cbbd';
    g.fillRect(i * w, j * h, w, h);
    g.fillStyle = '#7f97a7';
    pane(g, i, j);
  });
  const glow = make((g, i, j) => {
    g.fillStyle = '#000000';
    g.fillRect(i * w, j * h, w, h);
    // Offices lit in short runs along a floor.
    const run = Math.floor((i + (j % 2)) / 2) + j * 7;
    if (hash(run * 3.7 + 0.3) < 0.3) {
      g.fillStyle = hash(i + j * 31) < 0.85 ? '#ffffff' : '#9a9a9a';
      pane(g, i, j);
    }
  });
  return { map, glow };
}
export function glazedTowers(
  features: NonNullable<City['context']>['features'],
  night: () => number,
  towerHeightM: number,
) {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [];
  for (const f of features) {
    if (f.kind !== 'area' || f.class !== 'building' || f.material !== 'glass') continue;
    const heightM = f.heightM ?? (f.levels === undefined ? 10 : f.levels * 3);
    if (heightM >= towerHeightM) continue;
    // The terminal's storeys: about 4 m, from 0.8 m up to 1.5 m below the roof.
    const storeys = Math.max(1, Math.round((heightM - 1.5) / 4));
    const storeyM = (heightM - 1.5 - 0.8) / storeys;
    const ring = f.rings[0]!;
    let area = 0;
    for (let i = 1; i < ring.length; i++)
      area += ring[i - 1]!.x * ring[i]!.y - ring[i]!.x * ring[i - 1]!.y;
    const sign = area > 0 ? 1 : -1;
    // Each tower starts somewhere else in the tile, so the lit pattern never repeats in a row.
    const seed = Math.round(ring[0]!.x * 3 + ring[0]!.y * 7);
    let along = Math.floor(hash(seed) * 16);
    const lift = Math.floor(hash(seed + 1) * 16);
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!,
        b = ring[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 3) continue;
      const n = { x: (sign * (b.y - a.y)) / length, y: (sign * -(b.x - a.x)) / length };
      const pa = { x: a.x + n.x * 0.12, y: a.y + n.y * 0.12 },
        pb = { x: b.x + n.x * 0.12, y: b.y + n.y * 0.12 };
      // Whole panes along each wall, as the terminal rounds them.
      const panes = Math.max(1, Math.round(length / 2.2));
      const u0 = along,
        u1 = along + panes;
      const low = 0.8,
        high = 0.8 + storeys * storeyM;
      for (const [p, y, u, v] of [
        [pa, low, u0, 0],
        [pb, low, u1, 0],
        [pb, high, u1, storeys],
        [pa, low, u0, 0],
        [pb, high, u1, storeys],
        [pa, high, u0, storeys],
      ] as const) {
        positions.push(p.x, y, p.y);
        normals.push(n.x, 0, n.y);
        uvs.push(u / 16, (v + lift) / 16);
      }
      along += panes;
    }
  }
  const geometry = new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new Float32BufferAttribute(normals, 3))
    .setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  const { map, glow } = curtainTextures();
  const material = new MeshLambertMaterial({
    map,
    emissive: 0xffe2b0,
    emissiveMap: glow,
    emissiveIntensity: 0,
    side: DoubleSide,
  });
  const glazing = new Mesh(geometry, material);
  glazing.name = 'capture-glazing';
  glazing.castShadow = true;
  glazing.receiveShadow = true;
  glazing.onBeforeRender = () => {
    // Lit only once it is properly dark.
    material.emissiveIntensity = 0.3 * Math.max(0, (night() - 0.45) / 0.55);
  };
  return glazing;
}
