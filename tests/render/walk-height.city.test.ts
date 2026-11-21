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
  freiburg: '36362e1f6e57bd0b102f8841a9a8078ece9b0a79548e680219c222d00de84613',
  munich: '129283c3a7c8ae7d7a5733e2ec8c80b539e244bd7cf3d3e5033d2f8fc5e6eb19',
  sindelfingen: '6bb02c52f5fa278a97666b3908bc4667d4fbfe253ba354671b107cd929cc36b2',
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
