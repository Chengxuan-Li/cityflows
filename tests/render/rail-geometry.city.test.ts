import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { openFreiburg } from '../../bench/freiburg';
import { loadAuditCity } from '../../bench/junction-audit';
import { compile } from '../../src/network';
import { railGeometry } from '../../src/render/rail-geometry';
import type { City } from '../../src/schema';
import { limit } from '../timeouts';

// TASK-266: the level crossings' rails are cut to the roads within reach only, with the other
// roads' scanline levels kept. Every shape, to the bit, equals main 41e50d3's, which cut them to
// every ground road.
const pins = {
  // TASK-270 (lead merge): the same triangles, two level-crossing shapes list theirs in another
  // order after the gateway ids move.
  freiburg: '55198bb7a3345be6b68a90d2b3564c648b347b19de18407494f7e547633594ec',
  munich: 'f35c2fa18c1fc8c56dac4d8385c1dc65714009d42166b2d909517c85b4e3c6bf',
  sindelfingen: '2d25533967d65b1dcbfc623363e1a6376785e3974bf2bf2e1d72ff83d29a9191',
};

for (const [name, pin] of Object.entries(pins))
  test(
    `${name}: rail geometry is unchanged`,
    async () => {
      const city: City =
        name === 'freiburg'
          ? (await openFreiburg()).city
          : loadAuditCity(name as 'munich' | 'sindelfingen');
      const result = compile(city);
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics.slice(0, 3)));
      const shapes = railGeometry(result.compiled, city);
      expect(createHash('sha256').update(JSON.stringify(shapes)).digest('hex')).toBe(pin);
    },
    limit(120_000),
  );
