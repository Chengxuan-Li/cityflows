import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  Float32BufferAttribute,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../geo/vec2';
import { mix32, treeKits, type FoliageColour, type Season, type TreeKit } from '../render/lighting';
import { style } from '../render/style';
import { surfaceGrain, type Surface, type Tree } from '../render/vegetation';

/** TASK-105's groundAt is wired here at merge; every tree base uses this one adapter. */
export const groundHeight: (point: Vec2) => number = () => 0;

export function surfaceTexture(surface: Surface) {
  const texture = new DataTexture(surfaceGrain(surface), 64, 64, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** TASK-340: how the trees look. `weights` is the species mix over the kits. */
export interface TreeLook {
  weights: Record<TreeKit, number>;
  season: Season;
  colour: FoliageColour;
  variation: number;
  castShadow: boolean;
}
/** The look before TASK-340: the map's round broadleaf and cone conifer in the map palette. */
export const mapLook: TreeLook = {
  weights: { round: 1, spreading: 0, columnar: 0, palm: 0, cone: 1, cypress: 0, umbrella: 0 },
  season: 'spring',
  colour: 'map',
  variation: 0.3,
  castShadow: false,
};

/** A kit's trunk and crown, one unit tall from the ground (the instance scales it to the tree's
 * height) and one unit in crown radius. Round and cone are the map's two shapes. */
function kitGeometry(kit: TreeKit) {
  const trunk = (top: number, radius = 0.08, base = 0.11) =>
    new CylinderGeometry(radius, base, top, kit === 'palm' ? 5 : 4).translate(0, top / 2, 0);
  const sphere = (width: number, height: number, segments = 6, rings = 4) =>
    new SphereGeometry(1, segments, rings).scale(width, height, width).translate(0, 1 - height, 0);
  const cone = (radius: number, height: number) =>
    new ConeGeometry(radius, 2, 7).scale(1, height / 2, 1).translate(0, 1 - height / 2, 0);
  const parts: Record<TreeKit, () => [BufferGeometry, BufferGeometry]> = {
    // Exactly the map's shapes before TASK-340.
    round: () => [trunk(0.5), new SphereGeometry(1, 6, 4).scale(1, 0.35, 1).translate(0, 0.65, 0)],
    cone: () => [trunk(0.5), new ConeGeometry(1, 2, 7).scale(1, 0.35, 1).translate(0, 0.65, 0)],
    spreading: () => [trunk(0.55, 0.085, 0.12), sphere(1.2, 0.27, 7)],
    columnar: () => [trunk(0.3, 0.07, 0.095), sphere(0.5, 0.45, 6, 5)],
    palm: () => [trunk(0.88, 0.055, 0.08), cone(1, 0.18)],
    cypress: () => [trunk(0.2, 0.06, 0.08), cone(0.38, 0.9)],
    umbrella: () => [trunk(0.7, 0.07, 0.095), sphere(1.15, 0.18, 7)],
  };
  const [stem, crown] = parts[kit]();
  for (const [part, fill] of [
    [stem, kit === 'palm' ? style.vegetation.palmTrunk : style.vegetation.trunk],
    [crown, 0xffffff],
  ] as const) {
    const color = new Color(fill),
      colors = new Float32BufferAttribute(
        new Float32Array(part.getAttribute('position').count * 3),
        3,
      );
    for (let i = 0; i < colors.count; i++) colors.setXYZ(i, color.r, color.g, color.b);
    part.setAttribute('color', colors);
  }
  const geometry = mergeGeometries([stem, crown], false)!;
  stem.dispose();
  crown.dispose();
  return geometry;
}

/** The kit a tree takes: a weighted pick among the kits of its leaf type, from a hash of its
 * position, so a tree keeps its kit as long as the mix stays. */
export function treeKit(tree: Tree, weights: Record<TreeKit, number>): TreeKit {
  const needle = tree.leafType === 'needleleaved';
  const kits = treeKits.filter((k) => k.needle === needle && weights[k.kit] > 0);
  if (!kits.length) return needle ? 'cone' : 'round';
  const total = kits.reduce((sum, k) => sum + weights[k.kit], 0);
  const seed = mix32(
    (Math.imul(Math.round(tree.pos.x * 10), 0x9e3779b1) ^ Math.round(tree.pos.y * 10)) >>> 0,
  );
  let u = (seed / 4294967296) * total;
  for (const k of kits) if ((u -= weights[k.kit]) < 0) return k.kit;
  return kits[kits.length - 1]!.kit;
}

/** A kit's three leaf tones in the look's colour style, spread by its variation (0.3 keeps the
 * tones as they are, 0 gives their mean). */
function tones(kit: TreeKit, look: TreeLook) {
  const needle = treeKits.find((k) => k.kit === kit)!.needle;
  const bare = look.season === 'winter' && !needle && kit !== 'palm';
  const base =
    look.colour === 'map'
      ? bare
        ? style.vegetation.twigs
        : style.vegetation.canopy
      : style.foliage[kit][look.season];
  const colours = base.map((hex) => {
    const color = new Color(hex);
    if (look.colour === 'vivid' || look.colour === 'muted') {
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      if (look.colour === 'vivid') color.setHSL(hsl.h, Math.min(1, hsl.s * 1.35), hsl.l * 1.06);
      else color.setHSL(hsl.h, hsl.s * 0.5, Math.min(1, hsl.l * 1.08 + 0.04));
    }
    return color;
  });
  const k = look.variation / 0.3;
  if (k === 1) return colours;
  const mean = colours
    .reduce((sum, c) => sum.add(c), new Color(0, 0, 0))
    .multiplyScalar(1 / colours.length);
  return colours.map(
    (c) =>
      new Color(
        Math.max(0, mean.r + (c.r - mean.r) * k),
        Math.max(0, mean.g + (c.g - mean.g) * k),
        Math.max(0, mean.b + (c.b - mean.b) * k),
      ),
  );
}

export function buildVegetation(
  trees: readonly Tree[],
  groundAt: (p: Vec2) => number = groundHeight,
  look: TreeLook = mapLook,
) {
  const group = new Group(),
    natural = new Group(),
    street = new Group();
  group.add(natural, street);
  const transform = new Object3D();
  const palettes = new Map(treeKits.map(({ kit }) => [kit, tones(kit, look)]));
  const details: Group[] = [],
    blobs: Group[] = [],
    meshes: InstancedMesh[] = [];
  for (const [parent, generated] of [
    [natural, false],
    [street, true],
  ] as const) {
    const near = new Group(),
      far = new Group();
    parent.add(near, far);
    details.push(near);
    blobs.push(far);
    const selected = trees.filter((tree) => (tree.source === 'street') === generated);
    const kits = selected.map((tree) => treeKit(tree, look.weights));
    const blob = new InstancedMesh(
      new SphereGeometry(1, 6, 3),
      new MeshLambertMaterial(),
      selected.length,
    );
    far.add(blob);
    meshes.push(blob);
    selected.forEach((tree, i) => {
      const ground = groundAt(tree.pos);
      transform.position.set(tree.pos.x, ground + tree.heightM * 0.68, tree.pos.y);
      transform.scale.set(tree.crownM / 2, tree.heightM * 0.32, tree.crownM / 2);
      transform.updateMatrix();
      blob.setMatrixAt(i, transform.matrix);
      const palette = palettes.get(kits[i]!)!;
      blob.setColorAt(i, palette[i % palette.length]!);
    });
    for (const { kit } of treeKits) {
      const crowns = selected.filter((_, i) => kits[i] === kit);
      // The map's two meshes are always built, as before TASK-340; the other kits only when used.
      if (!crowns.length && kit !== 'round' && kit !== 'cone') continue;
      const mesh = new InstancedMesh(
        kitGeometry(kit),
        new MeshLambertMaterial({ vertexColors: true }),
        crowns.length,
      );
      const palette = palettes.get(kit)!;
      crowns.forEach((tree, i) => {
        transform.position.set(tree.pos.x, groundAt(tree.pos), tree.pos.y);
        transform.scale.set(tree.crownM / 2, tree.heightM, tree.crownM / 2);
        transform.rotation.y = tree.heightM;
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        mesh.setColorAt(i, palette[i % palette.length]!);
      });
      mesh.computeBoundingSphere();
      near.add(mesh);
      meshes.push(mesh);
    }
    blob.computeBoundingSphere();
  }
  for (const mesh of meshes) mesh.castShadow = look.castShadow;
  // Only visibility changes during camera motion; instance buffers stay immutable.
  const update = (distance: number) => {
    for (const near of details) near.visible = distance < 1200;
    for (const far of blobs) far.visible = distance >= 1200;
  };
  update(0);
  const counts = Object.fromEntries(
    treeKits.map(({ kit }) => [
      kit,
      trees.filter((tree) => treeKit(tree, look.weights) === kit).length,
    ]),
  ) as Record<TreeKit, number>;
  return {
    group,
    natural,
    street,
    update,
    counts,
    setCastShadow: (cast: boolean) => {
      for (const mesh of meshes) mesh.castShadow = cast;
    },
  };
}
