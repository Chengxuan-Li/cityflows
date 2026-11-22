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
  // TASK-290: moved driveway openings alter sidewalk and footway meshes.
  freiburg: '483ac21ae773737a5e475326c6eeb42535268e3c45efc0fa2245a0fb3e915451',
  munich: '85a9cdda5d900e047110a3f3713092910a1e164e5aebf30182bad1323eda1859',
  sindelfingen: '99e8635b168b60c518c7f2b55262df295e88c4504e15b39cda851fea1d67c8ec',
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
