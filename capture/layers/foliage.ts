import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  MeshLambertMaterial,
  SRGBColorSpace,
  Vector3,
  type Group,
  type InstancedMesh,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom } from '../../src/geo/random';

type Trees = { natural: Group; street: Group; update: (distance: number) => void };

/** A bough drawn once in branch space. Little sprays share a direction and overlap in depth.
 * The clear space between their tips survives the mip chain as larger, softer openings. */
function boughTexture(needle: boolean) {
  const random = createRandom(needle ? 812 : 510);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const leaves: { x: number; y: number; z: number; angle: number; tone: number }[] = [];
  const stem = (x: number, y: number, endX: number, endY: number, width: number) => {
    ctx.strokeStyle = '#969487';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  };
  stem(128, 231, 128, 54, 2.2);
  for (let k = 0; k < (needle ? 34 : 39); k++) {
    const a = random.uniform(0, Math.PI * 2);
    const r = Math.sqrt(random.next());
    const y = needle ? random.uniform(24, 216) : 126 + 86 * r * Math.sin(a);
    const x = needle
      ? 128 + (k % 2 ? 1 : -1) * (0.15 + y / 256) * random.uniform(57, 110)
      : 128 + 90 * r * Math.cos(a);
    const baseY = Math.min(231, y + random.uniform(18, 65));
    stem(128, baseY, x, y, 1.3);
    const depth = 1 - r * r + random.uniform(-0.25, 0.25);
    for (let i = 0; i < (needle ? 68 : 54); i++) {
      const rad = Math.sqrt(random.next());
      const dir = random.uniform(0, 2 * Math.PI);
      const dx = Math.cos(dir) * rad,
        dy = Math.sin(dir) * rad;
      leaves.push({
        x: x + dx * (needle ? 15 : 21),
        y: y + dy * (needle ? 17 : 20),
        z: depth + 0.16 * (1 - rad),
        angle: needle
          ? (x - 128) * 0.009 - 1.5 + random.uniform(-0.4, 0.4)
          : dir + random.uniform(-0.6, 0.6),
        tone: 160 + 35 * depth + 27 * (1 - rad) - 17 * dy + random.uniform(-25, 25),
      });
    }
  }
  for (const leaf of leaves.sort((a, b) => a.z - b.z)) {
    const c = Math.round(leaf.tone);
    ctx.fillStyle = `rgb(${c} ${c + 3} ${c - 9})`;
    ctx.beginPath();
    ctx.ellipse(leaf.x, leaf.y, needle ? 6 : 3.4, needle ? 1.25 : 2.2, leaf.angle, 0, Math.PI * 2);
    ctx.fill();
  }
  // All the wood UVs address this solid texel block.
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 6, 6);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/** The instancer scales x/z by the crown radius and y by the tree height. Build boughs in
 * roughly isotropic crown units first, so their normals follow the domed shape of each tuft. */
function treeGeometry(needle: boolean) {
  const random = createRandom(needle ? 104 : 887);
  const pos: number[] = [],
    normals: number[] = [],
    colours: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const wood: BufferGeometry[] = [];
  const axis = new Vector3(0, 1, 0);
  function branch(start: Vector3, end: Vector3, radius: number, tip: number) {
    const line = end.clone().sub(start);
    const g = new CylinderGeometry(tip, radius, line.length(), 5, 1, true);
    const dir = line.clone().normalize();
    g.applyQuaternion(new Quaternion().setFromUnitVectors(axis, dir));
    g.translate(...start.clone().lerp(end, 0.5).toArray());
    const col: number[] = [];
    const tex = g.getAttribute('uv');
    for (let i = 0; i < tex.count; i++) {
      tex.setXY(i, 0.009, 0.991);
      col.push(0.7, 0.37, 0.39);
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    wood.push(g);
  }
  branch(new Vector3(), new Vector3(0.02, needle ? 2.87 : 2.33, -0.025), 0.059, 0.012);
  function tuft(
    center: Vector3,
    a: number,
    halfWidth: number,
    halfLength: number,
    tilt: number,
    shade: number,
  ) {
    const out = new Vector3(Math.cos(a), 0, Math.sin(a));
    const across = new Vector3(-out.z, 0, out.x);
    const along = out.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(axis, Math.sin(tilt));
    const up = along.clone().cross(across).negate();
    const first = pos.length / 3;
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [0, 0],
    ] as const) {
      const p = center
        .clone()
        .addScaledVector(across, u * halfWidth)
        .addScaledVector(along, v * halfLength);
      if (!u) p.addScaledVector(up, halfWidth * 0.32);
      pos.push(...p.toArray());
      const n = up
        .clone()
        .addScaledVector(across, 0.65 * u)
        .addScaledVector(along, 0.65 * v)
        .normalize();
      normals.push(...n.toArray());
      const s = shade * (u ? 0.87 : 1.12);
      colours.push(s, s, s);
      // Inset the UVs to keep the trunk swatch outside the foliage.
      uv.push(0.5 + u * 0.473, 0.5 + v * 0.473);
    }
    for (let j = 0; j < 4; j++) indices.push(first + j, first + ((j + 1) % 4), first + 4);
  }
  if (needle) {
    for (let k = 0; k < 8; k++) {
      const reach = 1 - k / 8.6;
      const offset = random.uniform(0, 2 * Math.PI);
      for (let j = 0; j < 12; j++) {
        const a = offset + ((j + random.uniform(-0.3, 0.3)) * Math.PI) / 6;
        const r = 0.6 * reach * random.uniform(0.88, 1.1);
        const center = new Vector3(
          r * Math.cos(a),
          1.08 + 0.24 * k + random.uniform(-0.1, 0.1),
          r * Math.sin(a),
        );
        tuft(center, a, reach * 0.49, reach * 0.7, random.uniform(-0.48, 0.04), 0.84 + 0.023 * k);
      }
    }
  } else {
    // Each limb forks below its own group of foliage. Overlap the tips at unequal heights
    // and angles so a camera tipping off vertical sees into the crown between limbs.
    for (let i = 0; i < 13; i++) {
      const a = i * 2.39996 + random.uniform(-0.2, 0.2);
      const upper = i / 12;
      const reach = (0.7 - 0.4 * upper ** 2) * random.uniform(0.74, 1.05);
      const hub = new Vector3(
        Math.cos(a) * reach,
        1.54 + 0.91 * upper + random.uniform(-0.12, 0.12),
        Math.sin(a) * reach,
      );
      const fork = new Vector3(hub.x * 0.59, hub.y - 0.22, hub.z * 0.59);
      branch(new Vector3(0, 0.97 + 0.8 * upper, 0), fork, 0.031, 0.016);
      branch(fork, hub, 0.016, 0.006);
      for (let j = 0; j < 4; j++) {
        const bearing = a + j * 1.56 + random.uniform(-0.55, 0.55);
        const offset = random.uniform(0.09, 0.25);
        const center = hub
          .clone()
          .add(
            new Vector3(
              Math.cos(bearing) * offset,
              random.uniform(-0.16, 0.21),
              Math.sin(bearing) * offset,
            ),
          );
        const size = random.uniform(0.27, 0.4);
        tuft(
          center,
          bearing,
          size,
          size * random.uniform(1.05, 1.3),
          random.uniform(-0.9, 1.22),
          random.uniform(0.8, 1.02) + upper * 0.15,
        );
      }
    }
  }
  const foliage = new BufferGeometry();
  foliage.setAttribute('position', new Float32BufferAttribute(pos, 3));
  foliage.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  foliage.setAttribute('color', new Float32BufferAttribute(colours, 3));
  foliage.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  foliage.setIndex(indices);
  return mergeGeometries([foliage, ...wood])!.scale(1, 1 / 2.96, 1);
}

/** Trees layer: layered, open boughs in species colours, crowns `widen` times as broad as the
 * app's; trees on ground the location paves (`paved`) are taken out. */
export const params = { widen: 1.3 };

export function detailTrees(
  vegetation: Trees | undefined,
  paved: ((p: { x: number; y: number }) => boolean) | undefined,
  widen: number,
) {
  if (!vegetation) return () => {};
  const restore: (() => void)[] = [];
  const colour = new Color(),
    matrix = new Matrix4(),
    crown = new Matrix4().makeScale(widen, 1, widen);
  const greens = [0x829f6a, 0x8fa773, 0x789868, 0x96aa72, 0x829d70, 0x99a96d];
  // buildVegetation orders each near group broadleaf, then conifer.
  for (const [species, needle] of [false, true].entries()) {
    const geometry = treeGeometry(needle),
      map = boughTexture(needle);
    const material = new MeshLambertMaterial({
      map,
      vertexColors: true,
      side: DoubleSide,
      alphaTest: 0.31,
    });
    for (const group of [vegetation.natural, vegetation.street]) {
      const mesh = group.children[0]!.children[species] as InstancedMesh;
      const original = { geometry: mesh.geometry, material: mesh.material, cast: mesh.castShadow };
      const count = mesh.count;
      const matrices = mesh.instanceMatrix.array.slice(),
        colours = mesh.instanceColor?.array.slice();
      const random = createRandom(315 + species + (group === vegetation.street ? 47 : 0));
      mesh.geometry = geometry;
      mesh.material = material;
      mesh.castShadow = true;
      let kept = 0;
      for (let i = 0; i < count; i++) {
        mesh.getMatrixAt(i, matrix);

        colour.setHex(needle ? random.pick([0x6e8b6e, 0x80966e]) : random.pick(greens));
        colour.offsetHSL(
          random.uniform(-0.018, 0.021),
          random.uniform(-0.035, 0.02),
          random.uniform(-0.045, 0.047),
        );
        if (paved?.({ x: matrix.elements[12]!, y: matrix.elements[14]! })) continue;
        mesh.setMatrixAt(kept, matrix.multiply(crown));
        mesh.setColorAt(kept++, colour);
      }
      mesh.count = kept;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      restore.push(() => {
        mesh.geometry = original.geometry;
        mesh.material = original.material;
        mesh.castShadow = original.cast;
        mesh.count = count;
        mesh.instanceMatrix.array.set(matrices);
        mesh.instanceMatrix.needsUpdate = true;
        if (colours && mesh.instanceColor) {
          mesh.instanceColor.array.set(colours);
          mesh.instanceColor.needsUpdate = true;
        }
        mesh.computeBoundingSphere();
      });
    }
    restore.push(() => {
      geometry.dispose();
      map.dispose();
      material.dispose();
    });
  }
  const update = vegetation.update;
  const groups = [vegetation.natural, vegetation.street].flatMap((g) => g.children);
  const visibility = groups.map((g) => g.visible);
  vegetation.update = () =>
    groups.forEach((g, i) => {
      g.visible = i % 2 === 0;
    });
  vegetation.update(0);
  return () => {
    restore.forEach((r) => r());
    vegetation.update = update;
    groups.forEach((g, i) => {
      g.visible = visibility[i]!;
    });
  };
}
