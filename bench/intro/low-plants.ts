import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { createRandom } from '../../src/geo/random';
import type { Vec2 } from '../../src/geo/vec2';
import { grain, patchMaterial } from './weathering';

export type PlantKind = 'hedge' | 'scrub' | 'grass';
export interface LowPlant {
  p: Vec2;
  heading: number;
  length: number;
  width: number;
  height: number;
  colour: number;
  lamp: number;
  form: number;
}

function crown(seed: number, hedge: boolean) {
  const random = createRandom(seed);
  const fine = new IcosahedronGeometry(1, 1),
    coarse = new IcosahedronGeometry(1, 0);
  const positions: number[] = [],
    normals: number[] = [],
    tones: number[] = [];
  function lobe(x: number, y: number, z: number, w: number, h: number, d: number, detail: boolean) {
    const corners = (detail ? fine : coarse).getAttribute('position');
    const tint = random.uniform(0.86, 1.12),
      phase = random.uniform(0, 6.28);
    for (let i = 0; i < corners.count; i++) {
      const a = corners.getX(i),
        b = corners.getY(i),
        c = corners.getZ(i);
      const r =
        1 +
        0.1 * Math.sin(a * 8.2 + b * 4.5 + c * 5.6 + phase) +
        0.06 * Math.sin(c * 10.7 - b * 11.9 + a * 2.0);
      const rise = y + b * h * r;
      positions.push(x + a * w * r, rise, z + c * d * r);
      const n = Math.hypot(a / w, b / h, c / d);
      normals.push(a / w / n, b / h / n, c / d / n);
      const shade = (0.55 + 0.43 * Math.max(0, Math.min(1, rise))) * tint * (0.96 + 0.16 * (r - 1));
      tones.push(shade, shade, shade);
    }
  }

  // A dense interior under the lobes keeps the silhouette coherent from the pull-back.
  lobe(0, 0.32, 0, 0.49, 0.4, 0.45, false);
  for (let i = 0; i < 5; i++) {
    const a = i * 2.39996 + random.uniform(-0.39, 0.39);
    const radial = random.uniform(0.51, 0.93);
    lobe(
      Math.cos(a) * 0.36 * radial,
      random.uniform(hedge ? 0.59 : 0.44, 0.73),
      Math.sin(a) * 0.37 * radial,
      random.uniform(0.2, 0.36),
      random.uniform(0.23, 0.37),
      random.uniform(0.22, 0.36),
      true,
    );
  }
  for (let i = 0; i < 4; i++) {
    const a = i * 1.51 + random.uniform(-0.5, 0.5);
    lobe(
      Math.cos(a) * random.uniform(0.35, 0.55),
      random.uniform(0.23, 0.5),
      Math.sin(a) * random.uniform(0.34, 0.56),
      0.19,
      random.uniform(0.19, 0.28),
      0.18,
      false,
    );
  }
  // A few small sprays break the outline between the larger crown lobes.
  for (let k = 0; k < 9; k++) {
    const a = k * 2.39996 + random.uniform(-0.3, 0.3),
      r = random.uniform(0.35, 0.55);
    lobe(
      Math.cos(a) * r,
      random.uniform(0.37, 0.81),
      Math.sin(a) * r,
      random.uniform(0.09, 0.155),
      random.uniform(0.07, 0.14),
      random.uniform(0.085, 0.153),
      false,
    );
  }
  fine.dispose();
  coarse.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(tones, 3));
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;
  geometry.translate(-(min.x + max.x) / 2, 0, -(min.z + max.z) / 2);
  geometry.scale(1 / (max.x - min.x), 1 / max.y, 1 / (max.z - min.z));
  return geometry;
}

function blades() {
  const random = createRandom(6431);
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = i * 2.39996 + random.uniform(-0.66, 0.66);
    const x = Math.cos(angle),
      z = Math.sin(angle);
    const root = random.uniform(0.03, 0.3),
      reach = random.uniform(0.08, 0.31);
    const h = random.uniform(0.35, 1),
      w = random.uniform(0.035, 0.085);
    const start = positions.length / 3;
    for (const [r, y, damped] of [
      [root, 0, 1],
      [root + reach * 0.33, h * 0.57, 0.72],
      [root + reach, h, 0],
    ] as const) {
      for (const side of damped ? [-1, 1] : [0]) {
        positions.push(x * r + z * w * damped * side, y, z * r - x * w * damped * side);
        const tint = 0.56 + 0.48 * y;
        colors.push(tint, tint, tint);
      }
    }
    indices.push(
      start,
      start + 1,
      start + 2,
      start + 1,
      start + 3,
      start + 2,
      start + 2,
      start + 3,
      start + 4,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.scale(0.8, 1, 0.8);
  return geometry;
}

export function lowPlantMeshes(
  group: Group,
  plants: Record<PlantKind, LowPlant[]>,
  groundAt: (x: number, y: number) => number,
  artificial: () => number,
) {
  const geometry = [crown(794, true), crown(155, true), crown(623, false), blades()];
  const batches = [
    plants.hedge.filter((p) => p.form === 0),
    plants.hedge.filter((p) => p.form === 1),
    plants.scrub,
    plants.grass,
  ];
  const shrub = new MeshLambertMaterial({ vertexColors: true });
  const grass = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const dusk = { value: 0 };
  for (const [material, name, strength] of [
    [shrub, 'shrub', 0.84],
    [grass, 'grass', 0.31],
  ] as const) {
    patchMaterial(material, 'low-' + name, (shader) => {
      shader.uniforms.introPlantDusk = dusk;
      const vary = 'varying vec3 vPlantWorld; varying float vPlantHeight,vPlantLamp;\n';
      shader.vertexShader =
        vary +
        'attribute float introLamp;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvPlantWorld=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz; vPlantHeight=position.y; vPlantLamp=introLamp;',
        );
      shader.fragmentShader =
        grain +
        vary +
        'uniform float introPlantDusk;\n' +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
          vec2 leaf = vPlantWorld.xz+vPlantWorld.y*vec2(1.3,1.7);
          float sprays = grit(leaf*5.2);
          float tips = grit(leaf*16.4);
          diffuseColor.rgb *= 1.0+${strength}*sprays+0.24*tips;
        `,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb*vec3(0.68,0.45,0.20)*vPlantLamp*introPlantDusk
            *smoothstep(-0.05,0.84,vPlantHeight);
        `,
          );
    });
  }
  const object = new Object3D(),
    colour = new Color();
  const meshes = batches.flatMap((list, k) => {
    if (!list.length) return [];
    const g = geometry[k]!;
    g.setAttribute(
      'introLamp',
      new InstancedBufferAttribute(new Float32Array(list.map((p) => p.lamp)), 1),
    );
    const mesh = new InstancedMesh(g, k === 3 ? grass : shrub, list.length);
    list.forEach((plant, i) => {
      object.position.set(plant.p.x, groundAt(plant.p.x, plant.p.y) - 0.025, plant.p.y);
      object.rotation.y = -plant.heading;
      object.scale.set(plant.length, plant.height, plant.width);
      object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix);
      mesh.setColorAt(i, colour.setHex(plant.colour));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.onBeforeRender = () => {
      dusk.value = artificial();
    };
    mesh.computeBoundingSphere();
    group.add(mesh);
    return [mesh];
  });
  return () => {
    for (const mesh of meshes) mesh.dispose();
    geometry.forEach((g) => g.dispose());
    shrub.dispose();
    grass.dispose();
  };
}
