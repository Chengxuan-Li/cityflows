import {
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

function treeGeometry(needle: boolean) {
  const trunk = new CylinderGeometry(0.08, 0.11, 0.5, 4).translate(0, 0.25, 0);
  const crown = (needle ? new ConeGeometry(1, 2, 7) : new SphereGeometry(1, 6, 4))
    .scale(1, 0.35, 1)
    .translate(0, 0.65, 0);
  for (const [part, fill] of [
    [trunk, style.vegetation.trunk],
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
  const geometry = mergeGeometries([trunk, crown], false)!;
  trunk.dispose();
  crown.dispose();
  return geometry;
}

export function buildVegetation(
  trees: readonly Tree[],
  groundAt: (p: Vec2) => number = groundHeight,
) {
  const group = new Group(),
    natural = new Group(),
    street = new Group();
  group.add(natural, street);
  const transform = new Object3D(),
    color = new Color();
  const details: Group[] = [],
    blobs: Group[] = [];
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
    const blob = new InstancedMesh(
      new SphereGeometry(1, 6, 3),
      new MeshLambertMaterial(),
      selected.length,
    );
    far.add(blob);
    selected.forEach((tree, i) => {
      const ground = groundAt(tree.pos);
      transform.position.set(tree.pos.x, ground + tree.heightM * 0.68, tree.pos.y);
      transform.scale.set(tree.crownM / 2, tree.heightM * 0.32, tree.crownM / 2);
      transform.updateMatrix();
      blob.setMatrixAt(i, transform.matrix);
      color.setHex(style.vegetation.canopy[i % style.vegetation.canopy.length]!);
      blob.setColorAt(i, color);
    });
    for (const needle of [false, true]) {
      const crowns = selected.filter((t) => (t.leafType === 'needleleaved') === needle);
      const mesh = new InstancedMesh(
        treeGeometry(needle),
        new MeshLambertMaterial({ vertexColors: true }),
        crowns.length,
      );
      crowns.forEach((tree, i) => {
        transform.position.set(tree.pos.x, groundAt(tree.pos), tree.pos.y);
        transform.scale.set(tree.crownM / 2, tree.heightM, tree.crownM / 2);
        transform.rotation.y = tree.heightM;
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        color.setHex(style.vegetation.canopy[i % style.vegetation.canopy.length]!);
        mesh.setColorAt(i, color);
      });
      mesh.computeBoundingSphere();
      near.add(mesh);
    }
    blob.computeBoundingSphere();
  }
  // Only visibility changes during camera motion; instance buffers stay immutable.
  const update = (distance: number) => {
    for (const near of details) near.visible = distance < 1200;
    for (const far of blobs) far.visible = distance >= 1200;
  };
  update(0);
  return { group, natural, street, update };
}
