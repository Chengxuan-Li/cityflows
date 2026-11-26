import { createHash } from 'node:crypto';
import { InstancedMesh, type BufferGeometry } from 'three';
import { expect, test } from 'vitest';
import { openBundled } from '../../bench/bundled-cities';
import { compile } from '../../src/network';
import { paintedCity } from '../../src/render/road-paint';
import { buildFootbridges } from '../../src/render3d/footbridges';
import { cityHeights } from '../../src/render3d/heights';
import { buildWalk } from '../../src/render3d/walk';
import { limit } from '../timeouts';

// TASK-278: the walk's height lookups are indexed and asked once per point. The walk and
// footbridge meshes of each bundled city, to the bit, equal main 9ac29c5's, which scanned every
// road's reference line for every triangle corner.
const pins = {
  // Lead merge: re-pinned on TASK-275's canopies and handrails (the same hashes with and without
  // TASK-278's lookups on the merged tree).
  // Lead merge: re-pinned on TASK-271 (passages and covered ways at grade change the walk).
  // TASK-290: Freiburg's nine mapped garage entrances change the 3D sidewalk mesh.
  // TASK-294: three Freiburg places keep their driveways in pockets behind destination streets.
  freiburg: 'ce296aef70de55077234233dbf899a9c883dcbecc8bb0c05e28c51e79a172e5d',
  // TASK-290: Munich's garage connector moves to r:1070 and changes the 3D footway mesh.
  munich: '5614a9951e1deae84aa1849bf50796883cafd4bb7066d67af367956e9f079d07',
  // TASK-290: Sindelfingen's garage connector moves to r:954 and changes the 3D sidewalk mesh.
  sindelfingen: '4c158fc2e97354bf2ede48d5fb2cd2038c12902f608ea48ca32f85586bb53da3',
};

for (const [name, pin] of Object.entries(pins))
  test(
    `${name}: the 3D walk and footbridges are unchanged`,
    async () => {
      const project = await openBundled(name);
      const result = compile(project.city);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
      const city = paintedCity(result.compiled);
      const heights = cityHeights(city, project.city);
      const walk = buildWalk(city, project.city, heights);
      const hash = createHash('sha256');
      const add = (array: ArrayLike<number> & ArrayBufferView) =>
        hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      const geometry = (g: BufferGeometry) => {
        for (const attribute of Object.keys(g.attributes).sort())
          add(g.getAttribute(attribute).array as Float32Array);
      };
      for (const g of [walk.sidewalks, walk.footways, walk.steps]) geometry(g);
      // Deck and railing meshes, then the piers and posts (one box per instance).
      buildFootbridges(city, project.city, heights).group.traverse((o) => {
        if (o instanceof InstancedMesh) add(o.instanceMatrix.array as Float32Array);
        else if ('geometry' in o) geometry(o.geometry as BufferGeometry);
      });
      expect(hash.digest('hex')).toBe(pin);
    },
    limit(120_000),
  );
